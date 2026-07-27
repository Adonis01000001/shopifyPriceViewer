import { Firecrawl } from "firecrawl";
import type { Browser, BrowserContext } from "playwright";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import { exaSearchService } from "./exa-search.service";
import {
  extractProductData,
  shouldRenderWithBrowser,
} from "./price-radar/extraction";
import {
  assertPublicUrl,
  canonicalizeUrl,
  isAllowedByRobots,
  parseRobotsTxt,
} from "./price-radar/url-policy";
import type { PriceRadarProduct } from "./price-radar/types";

export type ScoopRanking =
  | "relevance"
  | "lowest_price"
  | "best_value"
  | "newest";

export interface ScoopProduct {
  productName: string;
  brand: string | null;
  model: string | null;
  price: string | null;
  currency: string | null;
  availability: string | null;
  seller: string | null;
  condition: "new" | "refurbished" | "used" | null;
  shipping: string | null;
  productUrl: string;
  imageUrl: string | null;
  retrievedAt: string;
  publishedDate: string | null;
  confidenceScore: number;
  extractionMethod: string;
  discoveredBy: string[];
}

export interface ScoopSource {
  name: string;
  type: "search_provider" | "product_page";
  url: string | null;
}

export interface ScoopResult {
  searchQuery: string;
  summary: string;
  productsFound: ScoopProduct[];
  confidenceScore: number;
  sourcesUsed: ScoopSource[];
  ranking: ScoopRanking;
  status: "success" | "partial" | "failed";
  warnings: string[];
  retrievedAt: string;
}

interface StructuredCandidate {
  title: string;
  price: string;
  currency: string;
  seller: string;
}

interface SearchCandidate {
  url: string;
  title: string;
  snippet: string;
  providers: string[];
  position: number;
  publishedDate: string | null;
  structured: StructuredCandidate | null;
  relevance: number;
}

interface ExtractedCandidate {
  product: ScoopProduct | null;
  warning: string | null;
}

const SEARCH_LIMIT_MULTIPLIER = 3;
const MAX_PAGE_BYTES = 2_000_000;
const MAX_BROWSER_PAGES = 6;
const FETCH_TIMEOUT_MS = 15_000;
const EXCLUDED_HOSTS = new Set([
  "facebook.com",
  "google.com",
  "instagram.com",
  "linkedin.com",
  "pinterest.com",
  "reddit.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
]);
const QUERY_STOP_WORDS = new Set([
  "and",
  "best",
  "buy",
  "for",
  "from",
  "latest",
  "new",
  "of",
  "price",
  "product",
  "the",
  "with",
]);

function normalizedTokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^0-9a-zÀ-ÖØ-öø-ÿ]+/gi, " ")
        .split(/\s+/)
        .filter(token => token.length >= 2 && !QUERY_STOP_WORDS.has(token))
    )
  );
}

function relevanceScore(query: string, text: string): number {
  const queryTokens = normalizedTokens(query);
  if (queryTokens.length === 0) return 0;
  const haystack = new Set(normalizedTokens(text));
  const matches = queryTokens.filter(token => haystack.has(token)).length;
  const tokenScore = matches / queryTokens.length;
  const exactBoost = text.toLowerCase().includes(query.trim().toLowerCase())
    ? 0.2
    : 0;
  return Math.min(1, tokenScore + exactBoost);
}

function hostname(urlValue: string): string {
  try {
    return new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isUsefulCandidateUrl(urlValue: string): boolean {
  const canonical = canonicalizeUrl(urlValue);
  if (!canonical) return false;
  const url = new URL(canonical);
  const domain = url.hostname.replace(/^www\./, "");
  if (EXCLUDED_HOSTS.has(domain)) return false;
  if (
    /(?:googleadservices|doubleclick|\/aclk|\/ads?\/|\/login|\/account|\/cart|\/checkout)/i.test(
      canonical
    )
  ) {
    return false;
  }
  return !/\.(?:css|gif|jpe?g|js|json|pdf|png|svg|webp)$/i.test(
    url.pathname
  );
}

function numericPrice(value: string | null): number | null {
  if (!value) return null;
  const number = Number(value.replace(/[^\d.,-]/g, "").replace(/,/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeStructuredPrice(value: string): string | null {
  const number = numericPrice(value);
  return number == null ? null : number.toFixed(2);
}

function stringField(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    const result = String(value).trim();
    return result || null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      stringField(record.name) ??
      stringField(record.value) ??
      stringField(record["@id"])
    );
  }
  return null;
}

function offerFromJsonLd(
  jsonLd: Record<string, unknown> | null
): Record<string, unknown> {
  if (!jsonLd) return {};
  const offers = jsonLd.offers;
  if (Array.isArray(offers)) {
    const first = offers.find(
      offer => offer && typeof offer === "object"
    );
    return (first as Record<string, unknown> | undefined) ?? {};
  }
  return offers && typeof offers === "object"
    ? (offers as Record<string, unknown>)
    : {};
}

function normalizeCondition(
  value: unknown
): ScoopProduct["condition"] {
  const condition = stringField(value)?.toLowerCase() ?? "";
  if (condition.includes("refurbished")) return "refurbished";
  if (condition.includes("used")) return "used";
  if (condition.includes("new")) return "new";
  return null;
}

function shippingFromOffer(
  offer: Record<string, unknown>,
  snippet: string
): string | null {
  const details = Array.isArray(offer.shippingDetails)
    ? offer.shippingDetails[0]
    : offer.shippingDetails;
  if (details && typeof details === "object") {
    const record = details as Record<string, unknown>;
    const rate =
      record.shippingRate && typeof record.shippingRate === "object"
        ? (record.shippingRate as Record<string, unknown>)
        : {};
    const amount = stringField(rate.value);
    const currency = stringField(rate.currency);
    if (amount === "0") return "Free shipping";
    if (amount) return [currency, amount].filter(Boolean).join(" ");
    const name = stringField(record.name);
    if (name) return name;
  }
  return /\bfree shipping\b/i.test(snippet) ? "Free shipping" : null;
}

function availabilityValue(
  product: PriceRadarProduct
): string | null {
  return product.availability === "unknown"
    ? null
    : product.availability;
}

function conditionAndModel(product: PriceRadarProduct): {
  condition: ScoopProduct["condition"];
  model: string | null;
  shipping: string | null;
} {
  const offer = offerFromJsonLd(product.jsonLd);
  return {
    condition: normalizeCondition(
      offer.itemCondition ?? product.jsonLd?.itemCondition
    ),
    model: stringField(product.jsonLd?.model),
    shipping: shippingFromOffer(offer, ""),
  };
}

async function searchFirecrawl(
  query: string,
  limit: number
): Promise<SearchCandidate[]> {
  if (!ENV.firecrawlApiKey) return [];
  const app = new Firecrawl({
    apiKey: ENV.firecrawlApiKey,
    apiUrl: ENV.firecrawlBaseUrl,
  });
  const result = await app.search(`${query} buy price`, {
    limit,
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
  });
  const rows = (
    result as unknown as {
      data?: Array<{
        url?: string;
        title?: string;
        description?: string;
        markdown?: string;
        metadata?: { url?: string; title?: string; description?: string };
      }>;
    }
  ).data ?? [];
  return rows.flatMap((row, index) => {
    const url = row.url ?? row.metadata?.url ?? "";
    if (!isUsefulCandidateUrl(url)) return [];
    const title = row.title ?? row.metadata?.title ?? "";
    const snippet =
      row.description ??
      row.metadata?.description ??
      row.markdown?.slice(0, 500) ??
      "";
    return [{
      url,
      title,
      snippet,
      providers: ["Firecrawl"],
      position: index + 1,
      publishedDate: null,
      structured: null,
      relevance: relevanceScore(query, `${title} ${snippet}`),
    }];
  });
}

async function searchSerpApi(
  query: string,
  limit: number
): Promise<SearchCandidate[]> {
  if (!ENV.serpApiKey) return [];
  const params = new URLSearchParams({
    api_key: ENV.serpApiKey,
    q: `${query} buy price`,
    engine: "google",
    num: String(limit),
    gl: "us",
    hl: "en",
  });
  const response = await fetch(`https://serpapi.com/search?${params}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SerpAPI returned ${response.status}`);
  const payload = (await response.json()) as {
    organic_results?: Array<{
      link?: string;
      title?: string;
      snippet?: string;
      position?: number;
      date?: string;
    }>;
    shopping_results?: Array<{
      link?: string;
      product_link?: string;
      title?: string;
      snippet?: string;
      position?: number;
      price?: string;
      source?: string;
    }>;
  };
  const rows = [
    ...(payload.shopping_results ?? []).map(row => ({
      url: row.product_link ?? row.link,
      title: row.title,
      snippet: [row.snippet, row.price].filter(Boolean).join(" "),
      position: row.position,
      publishedDate: null,
    })),
    ...(payload.organic_results ?? []).map(row => ({
      url: row.link,
      title: row.title,
      snippet: row.snippet,
      position: row.position,
      publishedDate: row.date ?? null,
    })),
  ];
  return rows.flatMap((row, index) => {
    if (!row.url || !isUsefulCandidateUrl(row.url)) return [];
    const title = row.title ?? "";
    const snippet = row.snippet ?? "";
    return [{
      url: row.url,
      title,
      snippet,
      providers: ["SerpAPI"],
      position: row.position ?? index + 1,
      publishedDate: row.publishedDate,
      structured: null,
      relevance: relevanceScore(query, `${title} ${snippet}`),
    }];
  });
}

async function searchExa(
  query: string,
  limit: number
): Promise<SearchCandidate[]> {
  if (!ENV.exaApiKey) return [];
  const [raw, structured] = await Promise.all([
    exaSearchService.searchProducts(`${query} product price`, limit),
    exaSearchService.structuredSearchProducts(query, limit),
  ]);
  const candidates: SearchCandidate[] = raw.flatMap((row, index) => {
    if (!isUsefulCandidateUrl(row.url)) return [];
    return [{
      url: row.url,
      title: row.title,
      snippet: row.snippet,
      providers: ["Exa"],
      position: index + 1,
      publishedDate: row.publishedDate,
      structured: null,
      relevance: relevanceScore(query, `${row.title} ${row.snippet}`),
    }];
  });
  for (let index = 0; index < structured.products.length; index += 1) {
    const row = structured.products[index];
    if (!isUsefulCandidateUrl(row.sourceUrl)) continue;
    candidates.push({
      url: row.sourceUrl,
      title: row.title,
      snippet: "",
      providers: ["Exa structured"],
      position: index + 1,
      publishedDate: null,
      structured: {
        title: row.title,
        price: row.price,
        currency: row.currency,
        seller: row.sourceName,
      },
      relevance: relevanceScore(query, row.title),
    });
  }
  return candidates;
}

async function searchGoogleFallback(
  query: string,
  limit: number
): Promise<SearchCandidate[]> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(
    `${query} buy price`
  )}&num=${limit}`;
  const response = await fetch(url, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const html = await response.text();
  const candidates: SearchCandidate[] = [];
  const pattern =
    /<a[^>]+href=["'](?:\/url\?q=)?(https?%?3?A?%?2?F?%?2?F?[^"'&]+|https?:\/\/[^"'&]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of Array.from(html.matchAll(pattern))) {
    let candidateUrl = match[1];
    try {
      candidateUrl = decodeURIComponent(candidateUrl);
    } catch {
      // Keep original URL.
    }
    if (!isUsefulCandidateUrl(candidateUrl)) continue;
    const title = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    candidates.push({
      url: candidateUrl,
      title,
      snippet: "",
      providers: ["Google fallback"],
      position: candidates.length + 1,
      publishedDate: null,
      structured: null,
      relevance: relevanceScore(query, title),
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

function mergeCandidates(
  candidates: SearchCandidate[],
  limit: number
): SearchCandidate[] {
  const merged = new Map<string, SearchCandidate>();
  for (const candidate of candidates) {
    const canonical = canonicalizeUrl(candidate.url);
    if (!canonical || candidate.relevance < 0.1) continue;
    const existing = merged.get(canonical);
    if (!existing) {
      merged.set(canonical, { ...candidate, url: canonical });
      continue;
    }
    merged.set(canonical, {
      ...existing,
      title:
        candidate.title.length > existing.title.length
          ? candidate.title
          : existing.title,
      snippet:
        candidate.snippet.length > existing.snippet.length
          ? candidate.snippet
          : existing.snippet,
      providers: Array.from(
        new Set([...existing.providers, ...candidate.providers])
      ),
      position: Math.min(existing.position, candidate.position),
      publishedDate: existing.publishedDate ?? candidate.publishedDate,
      structured: existing.structured ?? candidate.structured,
      relevance: Math.max(existing.relevance, candidate.relevance),
    });
  }
  return Array.from(merged.values())
    .sort(
      (left, right) =>
        right.relevance - left.relevance || left.position - right.position
    )
    .slice(0, limit);
}

async function readLimitedText(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_PAGE_BYTES) throw new Error("Page exceeds size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) {
        throw new Error("Page exceeds size limit");
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function safeFetchPage(
  urlValue: string
): Promise<{ html: string; finalUrl: string }> {
  let current = urlValue;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "PriceRadar-Scoop/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = location ? canonicalizeUrl(location, current) : null;
      if (!next) throw new Error("Unsafe redirect");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`Product page returned ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|xhtml/i.test(contentType)) {
      throw new Error("Product page is not HTML");
    }
    return { html: await readLimitedText(response), finalUrl: current };
  }
  throw new Error("Too many redirects");
}

class ScoopBrowser {
  private resources:
    | Promise<{ browser: Browser; context: BrowserContext }>
    | null = null;

  private async getResources(): Promise<{
    browser: Browser;
    context: BrowserContext;
  }> {
    if (!this.resources) {
      this.resources = (async () => {
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
          javaScriptEnabled: true,
          locale: "en-US",
          serviceWorkers: "block",
        });
        return { browser, context };
      })();
    }
    return this.resources;
  }

  async render(url: string): Promise<{ html: string; finalUrl: string }> {
    const { context } = await this.getResources();
    const page = await context.newPage();
    try {
      await page.route("**/*", async route => {
        const request = route.request();
        if (["font", "media"].includes(request.resourceType())) {
          await route.abort();
          return;
        }
        if (request.isNavigationRequest()) {
          try {
            await assertPublicUrl(request.url());
          } catch {
            await route.abort();
            return;
          }
        }
        await route.continue();
      });
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 5_000 })
        .catch(() => undefined);
      if (!response?.ok()) {
        throw new Error(`Browser page returned ${response?.status() ?? 0}`);
      }
      await assertPublicUrl(page.url());
      return { html: await page.content(), finalUrl: page.url() };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (!this.resources) return;
    const { browser, context } = await this.resources;
    await context.close();
    await browser.close();
  }
}

const robotsCache = new Map<string, Promise<string[]>>();

async function robotsRules(urlValue: string): Promise<string[]> {
  const origin = new URL(urlValue).origin;
  let cached = robotsCache.get(origin);
  if (!cached) {
    cached = (async () => {
      try {
        const robotsUrl = `${origin}/robots.txt`;
        await assertPublicUrl(robotsUrl);
        const response = await fetch(robotsUrl, {
          headers: { "User-Agent": "PriceRadar-Scoop/1.0" },
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return [];
        return parseRobotsTxt(await response.text()).disallow;
      } catch {
        return [];
      }
    })();
    robotsCache.set(origin, cached);
  }
  return cached;
}

function toScoopProduct(
  candidate: SearchCandidate,
  extracted: PriceRadarProduct,
  retrievedAt: string
): ScoopProduct {
  const details = conditionAndModel(extracted);
  const confidence = Math.min(
    1,
    extracted.extractionConfidence * 0.75 +
      candidate.relevance * 0.15 +
      Math.min(0.1, (candidate.providers.length - 1) * 0.05)
  );
  return {
    productName: extracted.name,
    brand: extracted.brand,
    model: details.model,
    price: extracted.price,
    currency: extracted.currency,
    availability: availabilityValue(extracted),
    seller: extracted.seller ?? hostname(extracted.productUrl),
    condition: details.condition,
    shipping:
      details.shipping ??
      (/\bfree shipping\b/i.test(candidate.snippet)
        ? "Free shipping"
        : null),
    productUrl: canonicalizeUrl(extracted.productUrl) ?? candidate.url,
    imageUrl: extracted.images[0] ?? null,
    retrievedAt,
    publishedDate: candidate.publishedDate,
    confidenceScore: Number(confidence.toFixed(2)),
    extractionMethod: extracted.extractionMethod,
    discoveredBy: candidate.providers,
  };
}

function fromStructuredCandidate(
  candidate: SearchCandidate,
  retrievedAt: string
): ScoopProduct | null {
  if (!candidate.structured) return null;
  const price = normalizeStructuredPrice(candidate.structured.price);
  if (!price || !candidate.structured.title.trim()) return null;
  return {
    productName: candidate.structured.title.trim(),
    brand: null,
    model: null,
    price,
    currency: candidate.structured.currency?.toUpperCase() || null,
    availability: null,
    seller: candidate.structured.seller || hostname(candidate.url),
    condition: null,
    shipping: null,
    productUrl: candidate.url,
    imageUrl: null,
    retrievedAt,
    publishedDate: candidate.publishedDate,
    confidenceScore: Number(
      Math.min(0.7, 0.5 + candidate.relevance * 0.15).toFixed(2)
    ),
    extractionMethod: "exa-grounded-structured",
    discoveredBy: candidate.providers,
  };
}

async function extractCandidate(
  candidate: SearchCandidate,
  browser: ScoopBrowser,
  allowBrowser: boolean,
  retrievedAt: string
): Promise<ExtractedCandidate> {
  const rules = await robotsRules(candidate.url);
  if (!isAllowedByRobots(candidate.url, rules)) {
    return { product: null, warning: `robots.txt blocked ${hostname(candidate.url)}` };
  }
  try {
    const fetched = await safeFetchPage(candidate.url);
    let extraction = extractProductData(fetched.html, fetched.finalUrl);
    if (
      allowBrowser &&
      shouldRenderWithBrowser(fetched.html, extraction)
    ) {
      const rendered = await browser.render(candidate.url);
      extraction = extractProductData(rendered.html, rendered.finalUrl);
    }
    if (extraction.product) {
      return {
        product: toScoopProduct(candidate, extraction.product, retrievedAt),
        warning: extraction.product.price
          ? null
          : `Price unavailable at ${hostname(candidate.url)}`,
      };
    }
  } catch (error) {
    if (allowBrowser) {
      try {
        const rendered = await browser.render(candidate.url);
        const extraction = extractProductData(rendered.html, rendered.finalUrl);
        if (extraction.product) {
          return {
            product: toScoopProduct(candidate, extraction.product, retrievedAt),
            warning: extraction.product.price
              ? null
              : `Price unavailable at ${hostname(candidate.url)}`,
          };
        }
      } catch {
        // Grounded structured result may still be usable.
      }
    }
    const structured = fromStructuredCandidate(candidate, retrievedAt);
    if (structured) {
      return {
        product: structured,
        warning: `Direct verification unavailable at ${hostname(candidate.url)}`,
      };
    }
    return {
      product: null,
      warning: `${hostname(candidate.url)}: ${
        error instanceof Error ? error.message : "extraction failed"
      }`,
    };
  }
  const structured = fromStructuredCandidate(candidate, retrievedAt);
  return {
    product: structured,
    warning: structured
      ? `Direct verification unavailable at ${hostname(candidate.url)}`
      : `No product data found at ${hostname(candidate.url)}`,
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => run()
    )
  );
  return results;
}

function majorityCurrency(products: readonly ScoopProduct[]): string | null {
  const counts = new Map<string, number>();
  for (const product of products) {
    if (!product.currency || numericPrice(product.price) == null) continue;
    counts.set(product.currency, (counts.get(product.currency) ?? 0) + 1);
  }
  return (
    Array.from(counts.entries()).sort(
      (left, right) => right[1] - left[1]
    )[0]?.[0] ?? null
  );
}

export function dedupeAndRankScoopProducts(
  products: readonly ScoopProduct[],
  ranking: ScoopRanking
): ScoopProduct[] {
  const deduped = new Map<string, ScoopProduct>();
  for (const product of products) {
    const canonical = canonicalizeUrl(product.productUrl);
    if (!canonical) continue;
    const existing = deduped.get(canonical);
    if (!existing || product.confidenceScore > existing.confidenceScore) {
      deduped.set(canonical, { ...product, productUrl: canonical });
    } else {
      existing.discoveredBy = Array.from(
        new Set([...existing.discoveredBy, ...product.discoveredBy])
      );
    }
  }
  const rows = Array.from(deduped.values());
  const primaryCurrency = majorityCurrency(rows);
  const currencyRank = (product: ScoopProduct): number =>
    product.currency === primaryCurrency ? 0 : 1;
  const priceRank = (product: ScoopProduct): number =>
    numericPrice(product.price) ?? Number.POSITIVE_INFINITY;

  if (ranking === "lowest_price") {
    return rows.sort(
      (left, right) =>
        currencyRank(left) - currencyRank(right) ||
        String(left.currency).localeCompare(String(right.currency)) ||
        priceRank(left) - priceRank(right) ||
        right.confidenceScore - left.confidenceScore
    );
  }
  if (ranking === "newest") {
    return rows.sort((left, right) => {
      const leftDate = left.publishedDate
        ? Date.parse(left.publishedDate)
        : Number.NEGATIVE_INFINITY;
      const rightDate = right.publishedDate
        ? Date.parse(right.publishedDate)
        : Number.NEGATIVE_INFINITY;
      return rightDate - leftDate || right.confidenceScore - left.confidenceScore;
    });
  }
  if (ranking === "best_value") {
    const pricedByCurrency = new Map<string, number[]>();
    for (const product of rows) {
      const price = numericPrice(product.price);
      if (price == null || !product.currency) continue;
      const prices = pricedByCurrency.get(product.currency) ?? [];
      prices.push(price);
      pricedByCurrency.set(product.currency, prices);
    }
    const valueScore = (product: ScoopProduct): number => {
      const price = numericPrice(product.price);
      const prices = product.currency
        ? pricedByCurrency.get(product.currency) ?? []
        : [];
      const max = prices.length > 0 ? Math.max(...prices) : null;
      const min = prices.length > 0 ? Math.min(...prices) : null;
      const priceScore =
        price != null && max != null && min != null
          ? max === min
            ? 1
            : 1 - (price - min) / (max - min)
          : 0;
      return product.confidenceScore * 0.65 + priceScore * 0.35;
    };
    return rows.sort(
      (left, right) =>
        valueScore(right) - valueScore(left) ||
        right.confidenceScore - left.confidenceScore
    );
  }
  return rows.sort(
    (left, right) => right.confidenceScore - left.confidenceScore
  );
}

export function buildScoopSummary(products: readonly ScoopProduct[]): string {
  if (products.length === 0) {
    return "No verified product listings found.";
  }
  const domains = Array.from(
    new Set(products.map(product => hostname(product.productUrl)).filter(Boolean))
  );
  const currencyGroups = new Map<string, number[]>();
  for (const product of products) {
    const price = numericPrice(product.price);
    if (price == null || !product.currency) continue;
    const values = currencyGroups.get(product.currency) ?? [];
    values.push(price);
    currencyGroups.set(product.currency, values);
  }
  const ranges = Array.from(currencyGroups.entries()).map(
    ([currency, values]) => {
      const minimum = Math.min(...values).toFixed(2);
      const maximum = Math.max(...values).toFixed(2);
      return minimum === maximum
        ? `${currency} ${minimum}`
        : `${currency} ${minimum}–${maximum}`;
    }
  );
  const priceText =
    ranges.length > 0 ? ` Price range: ${ranges.join("; ")}.` : "";
  return `${products.length} product listing${
    products.length === 1 ? "" : "s"
  } found across ${domains.length} source${
    domains.length === 1 ? "" : "s"
  }.${priceText}`;
}

async function discoverCandidates(
  query: string,
  limit: number
): Promise<{ candidates: SearchCandidate[]; warnings: string[] }> {
  const warnings: string[] = [];
  const providers = await Promise.allSettled([
    searchFirecrawl(query, limit),
    searchExa(query, limit),
    searchSerpApi(query, limit),
  ]);
  const labels = ["Firecrawl", "Exa", "SerpAPI"];
  const rows: SearchCandidate[] = [];
  for (let index = 0; index < providers.length; index += 1) {
    const result = providers[index];
    if (result.status === "fulfilled") rows.push(...result.value);
    else warnings.push(`${labels[index]} search unavailable`);
  }
  if (rows.length === 0) {
    try {
      rows.push(...(await searchGoogleFallback(query, limit)));
    } catch {
      warnings.push("Google fallback search unavailable");
    }
  }
  return { candidates: mergeCandidates(rows, limit), warnings };
}

export const scoopService = {
  async search(input: {
    userId: string;
    query: string;
    maxResults: number;
    ranking: ScoopRanking;
  }): Promise<ScoopResult> {
    const retrievedAt = new Date().toISOString();
    const candidateLimit = Math.min(
      40,
      input.maxResults * SEARCH_LIMIT_MULTIPLIER
    );
    const { candidates, warnings } = await discoverCandidates(
      input.query,
      candidateLimit
    );
    if (candidates.length === 0) {
      logger.info(
        { userId: input.userId, query: input.query },
        "Scoop search returned no candidates"
      );
      return {
        searchQuery: input.query,
        summary: "No verified product listings found.",
        productsFound: [],
        confidenceScore: 0,
        sourcesUsed: [],
        ranking: input.ranking,
        status: "failed",
        warnings,
        retrievedAt,
      };
    }

    const browser = new ScoopBrowser();
    let extracted: ExtractedCandidate[] = [];
    try {
      extracted = await mapWithConcurrency(
        candidates,
        3,
        (candidate, index) =>
          extractCandidate(
            candidate,
            browser,
            index < MAX_BROWSER_PAGES,
            retrievedAt
          )
      );
    } finally {
      await browser.close();
    }

    const productRows = extracted.flatMap(result =>
      result.product ? [result.product] : []
    );
    const productsFound = dedupeAndRankScoopProducts(
      productRows,
      input.ranking
    ).slice(0, input.maxResults);
    for (const result of extracted) {
      if (result.warning && !warnings.includes(result.warning)) {
        warnings.push(result.warning);
      }
    }
    const providerNames = Array.from(
      new Set(candidates.flatMap(candidate => candidate.providers))
    );
    const sourcesUsed: ScoopSource[] = [
      ...providerNames.map(name => ({
        name,
        type: "search_provider" as const,
        url: null,
      })),
      ...productsFound.map(product => ({
        name: hostname(product.productUrl),
        type: "product_page" as const,
        url: product.productUrl,
      })),
    ];
    const confidenceScore =
      productsFound.length > 0
        ? Number(
            (
              productsFound.reduce(
                (sum, product) => sum + product.confidenceScore,
                0
              ) / productsFound.length
            ).toFixed(2)
          )
        : 0;
    const status =
      productsFound.length === 0
        ? "failed"
        : warnings.length > 0
          ? "partial"
          : "success";

    logger.info(
      {
        userId: input.userId,
        query: input.query,
        candidates: candidates.length,
        products: productsFound.length,
        status,
      },
      "Scoop search completed"
    );
    return {
      searchQuery: input.query,
      summary: buildScoopSummary(productsFound),
      productsFound,
      confidenceScore,
      sourcesUsed,
      ranking: input.ranking,
      status,
      warnings: warnings.slice(0, 20),
      retrievedAt,
    };
  },
};
