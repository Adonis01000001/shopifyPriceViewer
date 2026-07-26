import { Firecrawl } from "firecrawl";
import { requireDb } from "../_core/db-assert";
import {
  products,
  serpApiScouts,
  type InsertSerpApiScout,
} from "../../drizzle/schema";
import { desc, eq, and } from "drizzle-orm";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";
import { exaSearchService } from "./exa-search.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScoutPrice {
  sourceUrl: string;
  domain: string;
  title: string;
  price: string;
  currency: string;
  imageUrl: string | null;
  position: number;
  confidence: number;
}

export interface ScoutResult {
  productId: string;
  productTitle: string;
  productPrice: string;
  prices: ScoutPrice[];
  totalFound: number;
  searchEngine: string;
  status: "success" | "partial" | "failed";
  errorMessage: string | null;
}

export interface SerpApiScoutResult extends ScoutResult {
  reviews: Array<{ title: string; snippet: string; url: string }>;
  searchQueries: string[];
}

export interface ScoutHistoryResult extends SerpApiScoutResult {
  scrapedAt: Date | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isValidFetchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function parsePrice(raw: string): { value: string; currency: string } | null {
  if (!raw) return null;
  const match = raw.match(
    /(\$|€|£|USD|EUR|GBP)?\s*([0-9]{1,3}(?:[,.][0-9]{3})*(?:[,.][0-9]{2})|[0-9]+(?:[,.][0-9]{2})?)/
  );
  if (!match) return null;
  const currencyMap: Record<string, string> = {
    $: "USD",
    "€": "EUR",
    "£": "GBP",
  };
  const currency = currencyMap[match[1] ?? ""] || "USD";
  let value = match[2].replace(/,/g, "");
  if (/^\d{1,3}\.\d{3}$/.test(value)) {
    value = value.replace(".", "");
  }
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return null;
  return { value: num.toFixed(2), currency };
}

// ─── Search via Firecrawl ────────────────────────────────────────────────────

async function searchFirecrawl(
  query: string,
  limit: number
): Promise<Array<{ url: string; title: string }>> {
  if (!ENV.firecrawlApiKey) return [];
  try {
    const app = new Firecrawl({
      apiKey: ENV.firecrawlApiKey,
      apiUrl: ENV.firecrawlBaseUrl,
    });
    const result = await app.search(query, {
      limit,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
    });
    const data = (
      result as unknown as {
        data?: Array<{
          url?: string;
          title?: string;
          metadata?: { url?: string };
        }>;
      }
    ).data;
    if (!data) return [];
    return data
      .filter(item => (item.url ?? item.metadata?.url ?? "").startsWith("http"))
      .map(item => ({
        url: item.url ?? item.metadata?.url ?? "",
        title: item.title ?? "",
      }));
  } catch (err) {
    logger.warn({ query, err }, "Scout: Firecrawl search failed");
    return [];
  }
}

// ─── Search via SerpAPI ──────────────────────────────────────────────────────

async function searchSerpApi(
  query: string,
  limit: number
): Promise<Array<{ url: string; title: string; snippet?: string }>> {
  if (!ENV.serpApiKey) return [];
  try {
    const params = new URLSearchParams({
      api_key: ENV.serpApiKey,
      q: query,
      engine: "google",
      num: String(limit),
      gl: "us",
      hl: "en",
    });
    const res = await fetch(`https://serpapi.com/search?${params}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.organic_results ?? [])
      .filter((r: any) => r.link)
      .map((r: any) => ({
        url: r.link,
        title: r.title ?? "",
        snippet: r.snippet ?? "",
      }));
  } catch (err) {
    logger.warn({ query, err }, "Scout: SerpAPI search failed");
    return [];
  }
}

// ─── Search via Exa ─────────────────────────────────────────────────────────

async function searchExa(
  query: string,
  limit: number
): Promise<Array<{ url: string; title: string; snippet?: string }>> {
  if (!ENV.exaApiKey) return [];
  try {
    const results = await exaSearchService.searchProducts(query, limit);
    return results.map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
    }));
  } catch (err) {
    logger.warn({ query, err }, "Scout: Exa search failed");
    return [];
  }
}

// ─── Scrape a single URL for product price ───────────────────────────────────

async function scrapeUrlForPrice(
  url: string,
  productTitle: string
): Promise<ScoutPrice | null> {
  // Try Firecrawl first
  if (ENV.firecrawlApiKey) {
    try {
      const app = new Firecrawl({
        apiKey: ENV.firecrawlApiKey,
        apiUrl: ENV.firecrawlBaseUrl,
      });
      const result = await app.scrape(url, {
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 20000,
      });
      const markdown = (result as { markdown?: string }).markdown ?? "";
      if (markdown.length > 100) {
        const price = extractPriceFromText(markdown);
        const title = extractTitleFromMarkdown(markdown) || productTitle;
        if (price) {
          return {
            sourceUrl: url,
            domain: extractDomain(url),
            title: title.slice(0, 200),
            price: price.value,
            currency: price.currency,
            imageUrl: null,
            position: 0,
            confidence: 0.8,
          };
        }
      }
    } catch {
      // Fall through
    }
  }

  // Fallback: fetch and parse basic HTML
  if (!isValidFetchUrl(url)) return null;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const price = extractPriceFromText(html);
    if (price) {
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      return {
        sourceUrl: url,
        domain: extractDomain(url),
        title: (titleMatch?.[1] ?? productTitle).slice(0, 200),
        price: price.value,
        currency: price.currency,
        imageUrl: null,
        position: 0,
        confidence: 0.6,
      };
    }
  } catch {
    // Ignore
  }

  return null;
}

function extractStructuredPrice(
  text: string
): { value: string; currency: string } | null {
  // 1. JSON-LD schema.org Product/Offer
  const jsonLdRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const jsonLdBlocks: RegExpExecArray[] = [];
  let jsonLdMatch: RegExpExecArray | null;
  while ((jsonLdMatch = jsonLdRegex.exec(text)) !== null) {
    jsonLdBlocks.push(jsonLdMatch);
  }
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        const offers = item?.offers ?? item?.Offers;
        const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
        for (const offer of offerList) {
          const price = offer?.price ?? offer?.lowPrice;
          const currency = offer?.priceCurrency;
          if (price != null) {
            const num = parseFloat(String(price));
            if (!isNaN(num) && num > 0 && num < 1000000) {
              return { value: num.toFixed(2), currency: currency || "USD" };
            }
          }
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // 2. Open Graph / meta price tags
  const metaPatterns = [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([\d.,]+)["']/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([\d.,]+)["']/i,
    /<span[^>]+itemprop=["']price["'][^>]*>[\s$€£]*([\d.,]+)/i,
  ];
  for (const pattern of metaPatterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseFloat(match[1].replace(/,/g, ""));
      if (!isNaN(num) && num > 0 && num < 1000000) {
        return { value: num.toFixed(2), currency: "USD" };
      }
    }
  }

  return null;
}

function extractPriceFromText(
  text: string
): { value: string; currency: string } | null {
  const structured = extractStructuredPrice(text);
  if (structured) return structured;

  const patterns = [
    /[$€£]\s*([0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]{2})?)/g,
    /(?:USD|EUR|GBP)\s*([0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]{2})?)/gi,
    /(?:price|Price|PRICE)[\s:]*[$€£]?\s*([0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]{2})?)/g,
  ];
  const currencyMap: Record<string, string> = {
    $: "USD",
    "€": "EUR",
    "£": "GBP",
  };
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const currencySymbol = raw.match(/[$€£]/)?.[0];
      const currency = currencyMap[currencySymbol ?? ""] || "USD";
      const value = match[1].replace(/,/g, "");
      const num = parseFloat(value);
      if (!isNaN(num) && num > 0 && num < 100000) {
        return { value: num.toFixed(2), currency };
      }
    }
  }
  return null;
}

function extractTitleFromMarkdown(md: string): string {
  const h1 = md.match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim();
  const title = md.match(/title["\s:]+["']?([^"'\n]+)/i);
  if (title) return title[1].trim();
  return "";
}

function toScoutRows(input: {
  productId: string;
  userId: string;
  searchResults: Array<{
    url: string;
    title: string;
    snippet?: string;
    query?: string;
    position?: number;
  }>;
  prices: ScoutPrice[];
  defaultQuery: string;
}): InsertSerpApiScout[] {
  const rowsByUrl = new Map<string, InsertSerpApiScout>();

  for (let i = 0; i < input.searchResults.length; i++) {
    const result = input.searchResults[i];
    const price = input.prices.find(p => p.sourceUrl === result.url);
    rowsByUrl.set(result.url, {
      productId: input.productId,
      userId: input.userId,
      query: result.query ?? input.defaultQuery,
      title: result.title,
      snippet: result.snippet ?? "",
      url: result.url,
      price: price?.price ?? null,
      currency: price?.currency ?? "USD",
      source: extractDomain(result.url),
      position: result.position ?? i + 1,
    });
  }

  for (const price of input.prices) {
    const existing = rowsByUrl.get(price.sourceUrl);
    rowsByUrl.set(price.sourceUrl, {
      productId: input.productId,
      userId: input.userId,
      query: existing?.query ?? input.defaultQuery,
      title: price.title || existing?.title || input.defaultQuery,
      snippet: existing?.snippet ?? "",
      url: price.sourceUrl,
      price: price.price,
      currency: price.currency,
      source: price.domain || extractDomain(price.sourceUrl),
      position: price.position || existing?.position || rowsByUrl.size + 1,
    });
  }

  return Array.from(rowsByUrl.values());
}

async function replaceScoutRows(
  database: any,
  userId: string,
  productId: string,
  rows: InsertSerpApiScout[]
): Promise<void> {
  await database
    .delete(serpApiScouts)
    .where(
      and(
        eq(serpApiScouts.productId, productId),
        eq(serpApiScouts.userId, userId)
      )
    );

  if (rows.length > 0) {
    await database.insert(serpApiScouts).values(rows);
  }
}

// ─── Main Scout Service ──────────────────────────────────────────────────────

export const scoutService = {
  async scoutProduct(
    userId: string,
    productId: string,
    maxResults: number = 10
  ): Promise<ScoutResult> {
    const database: any = await requireDb();

    const product = await database.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.userId, userId)),
    });
    if (!product) {
      return {
        productId,
        productTitle: "",
        productPrice: "0",
        prices: [],
        totalFound: 0,
        searchEngine: "none",
        status: "failed",
        errorMessage: "Product not found",
      };
    }

    const searchQuery = product.title.slice(0, 120);

    // Step 1: Search the web
    let searchResults: Array<{ url: string; title: string }> = [];
    let searchEngine = "none";

    if (ENV.firecrawlApiKey) {
      searchResults = await searchFirecrawl(searchQuery, maxResults + 5);
      searchEngine = "firecrawl";
    }
    if (searchResults.length === 0 && ENV.exaApiKey) {
      searchResults = await searchExa(searchQuery, maxResults + 5);
      searchEngine = "exa";
    }
    if (searchResults.length === 0 && ENV.serpApiKey) {
      searchResults = await searchSerpApi(searchQuery, maxResults + 5);
      searchEngine = "serpapi";
    }

    if (searchResults.length === 0) {
      return {
        productId,
        productTitle: product.title,
        productPrice: product.price?.toString() ?? "0",
        prices: [],
        totalFound: 0,
        searchEngine,
        status: "failed",
        errorMessage:
          "No search results found. Check Firecrawl/SerpAPI configuration.",
      };
    }

    // Step 2: Scrape each URL for pricing
    const prices: ScoutPrice[] = [];
    const urlsToScrape = searchResults.slice(0, maxResults + 5);

    for (
      let i = 0;
      i < urlsToScrape.length && prices.length < maxResults;
      i++
    ) {
      const { url, title } = urlsToScrape[i];
      try {
        const price = await scrapeUrlForPrice(url, product.title);
        if (price) {
          price.position = prices.length + 1;
          prices.push(price);
        }
      } catch (err) {
        logger.debug({ url, err }, "Scout: failed to scrape URL");
      }
    }

    // Step 3: Persist to database (replace old data for this product)
    try {
      const rows = toScoutRows({
        productId,
        userId,
        searchResults,
        prices,
        defaultQuery: searchQuery,
      });
      await replaceScoutRows(database, userId, productId, rows);
    } catch (err) {
      logger.warn({ productId, err }, "Scout: failed to persist scout results");
    }

    const status =
      prices.length > 0
        ? prices.length >= maxResults
          ? "success"
          : "partial"
        : "failed";
    const errorMessage =
      prices.length === 0
        ? "Found search results but could not extract prices from any of them."
        : null;

    logger.info(
      {
        productId,
        query: searchQuery,
        found: prices.length,
        engine: searchEngine,
      },
      "Scout: product scouting completed"
    );

    return {
      productId,
      productTitle: product.title,
      productPrice: product.price?.toString() ?? "0",
      prices,
      totalFound: prices.length,
      searchEngine,
      status,
      errorMessage,
    };
  },

  async scoutAllProducts(
    userId: string,
    maxResults: number = 10
  ): Promise<ScoutResult[]> {
    const database = await requireDb();
    const userProducts = await database
      .select()
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.isActive, true)))
      .limit(50);

    const results: ScoutResult[] = [];
    for (const product of userProducts) {
      try {
        const result = await this.scoutProduct(userId, product.id, maxResults);
        results.push(result);
      } catch (err) {
        logger.warn(
          { productId: product.id, err },
          "Scout: failed to scout product"
        );
        results.push({
          productId: product.id,
          productTitle: product.title,
          productPrice: product.price?.toString() ?? "0",
          prices: [],
          totalFound: 0,
          searchEngine: "none",
          status: "failed",
          errorMessage: String(err),
        });
      }
    }
    return results;
  },

  // ─── SerpAPI Batch Scout (5 queries per product) ──────────────────────────

  async scoutProductWithSerpApi(
    userId: string,
    productId: string,
    maxResults: number = 10
  ): Promise<SerpApiScoutResult> {
    const database: any = await requireDb();

    const product = await database.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.userId, userId)),
    });
    if (!product) {
      return {
        productId,
        productTitle: "",
        productPrice: "0",
        prices: [],
        reviews: [],
        searchQueries: [],
        totalFound: 0,
        searchEngine: "none",
        status: "failed",
        errorMessage: "Product not found",
      };
    }

    if (!ENV.serpApiKey) {
      return {
        productId,
        productTitle: product.title,
        productPrice: product.price?.toString() ?? "0",
        prices: [],
        reviews: [],
        searchQueries: [],
        totalFound: 0,
        searchEngine: "none",
        status: "failed",
        errorMessage: "SERP_API_KEY is not configured in .env",
      };
    }

    const baseQuery = product.title.slice(0, 120);
    const searchQueries = [
      baseQuery,
      `${baseQuery} price`,
      `${baseQuery} review`,
      `${baseQuery} buy`,
      `${baseQuery} best deal`,
    ];

    // Step 1: Run all 5 searches, deduplicate URLs
    const seenUrls = new Set<string>();
    const allSearchResults: Array<{
      url: string;
      title: string;
      snippet?: string;
      query: string;
      position: number;
    }> = [];

    for (const query of searchQueries) {
      try {
        const results = await searchSerpApi(query, 10);
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (seenUrls.has(r.url)) continue;
          seenUrls.add(r.url);

          // Get snippet from SerpAPI organic_results
          allSearchResults.push({
            url: r.url,
            title: r.title,
            snippet: r.snippet ?? "",
            query,
            position: i + 1,
          });
        }
      } catch (err) {
        logger.warn({ query, err }, "Scout: SerpAPI query failed");
      }
    }

    if (allSearchResults.length === 0) {
      return {
        productId,
        productTitle: product.title,
        productPrice: product.price?.toString() ?? "0",
        prices: [],
        reviews: [],
        searchQueries,
        totalFound: 0,
        searchEngine: "serpapi",
        status: "failed",
        errorMessage:
          "No search results from SerpAPI. Check your API key and credits.",
      };
    }

    // Step 2: Scrape each unique URL for pricing
    const prices: ScoutPrice[] = [];
    const reviews: Array<{ title: string; snippet: string; url: string }> = [];
    const urlsToScrape = allSearchResults.slice(0, maxResults + 5);

    for (
      let i = 0;
      i < urlsToScrape.length && prices.length < maxResults;
      i++
    ) {
      const { url, title, snippet } = urlsToScrape[i];
      try {
        const price = await scrapeUrlForPrice(url, product.title);
        if (price) {
          price.position = prices.length + 1;
          prices.push(price);
        }
      } catch (err) {
        logger.debug({ url, err }, "Scout: failed to scrape URL");
      }

      // Collect review snippets (from search results that have snippets)
      if (snippet && snippet.length > 20) {
        reviews.push({ title, snippet, url });
      }
    }

    // Step 3: Persist to database (replace old data for this product)
    try {
      const rows = toScoutRows({
        productId,
        userId,
        searchResults: allSearchResults,
        prices,
        defaultQuery: baseQuery,
      });
      await replaceScoutRows(database, userId, productId, rows);
    } catch (err) {
      logger.warn(
        { productId, err },
        "Scout: failed to persist serp_api_scouts"
      );
    }

    const status =
      prices.length > 0
        ? prices.length >= maxResults
          ? "success"
          : "partial"
        : "failed";
    const errorMessage =
      prices.length === 0
        ? "Found search results but could not extract prices from any of them."
        : null;

    logger.info(
      {
        productId,
        queries: searchQueries.length,
        urlsFound: allSearchResults.length,
        pricesFound: prices.length,
        reviewsFound: reviews.length,
      },
      "Scout: SerpAPI batch scouting completed"
    );

    return {
      productId,
      productTitle: product.title,
      productPrice: product.price?.toString() ?? "0",
      prices,
      reviews: reviews.slice(0, 10),
      searchQueries,
      totalFound: prices.length,
      searchEngine: "serpapi",
      status,
      errorMessage,
    };
  },

  async scoutAllWithSerpApi(
    userId: string,
    maxResults: number = 10
  ): Promise<SerpApiScoutResult[]> {
    const database = await requireDb();
    const userProducts = await database
      .select()
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.isActive, true)))
      .limit(50);

    const results: SerpApiScoutResult[] = [];
    for (const product of userProducts) {
      try {
        const result = await this.scoutProductWithSerpApi(
          userId,
          product.id,
          maxResults
        );
        results.push(result);
      } catch (err) {
        logger.warn(
          { productId: product.id, err },
          "Scout: failed to scout product with SerpAPI"
        );
        results.push({
          productId: product.id,
          productTitle: product.title,
          productPrice: product.price?.toString() ?? "0",
          prices: [],
          reviews: [],
          searchQueries: [],
          totalFound: 0,
          searchEngine: "none",
          status: "failed",
          errorMessage: String(err),
        });
      }
    }
    return results;
  },

  // ─── Exa Structured Scout (direct product extraction) ─────────────────────

  async scoutProductWithExa(
    userId: string,
    productId: string,
    maxResults: number = 10
  ): Promise<SerpApiScoutResult> {
    const database: any = await requireDb();

    const product = await database.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.userId, userId)),
    });
    if (!product) {
      return {
        productId,
        productTitle: "",
        productPrice: "0",
        prices: [],
        reviews: [],
        searchQueries: [],
        totalFound: 0,
        searchEngine: "none",
        status: "failed",
        errorMessage: "Product not found",
      };
    }

    if (!ENV.exaApiKey) {
      return {
        productId,
        productTitle: product.title,
        productPrice: product.price?.toString() ?? "0",
        prices: [],
        reviews: [],
        searchQueries: [],
        totalFound: 0,
        searchEngine: "none",
        status: "failed",
        errorMessage: "EXA_API_KEY is not configured in .env",
      };
    }

    const baseQuery = product.title.slice(0, 120);
    const searchQueries = [
      baseQuery,
      `${baseQuery} price`,
      `${baseQuery} buy online`,
      `${baseQuery} best deal`,
    ];

    // Step 1: Try structured search first (search + extract in one call)
    const exaResult = await exaSearchService.structuredSearchProducts(
      baseQuery,
      maxResults
    );

    // Step 2: If structured search returned few results, try raw search + scrape
    const prices: ScoutPrice[] = [];
    const reviews: Array<{ title: string; snippet: string; url: string }> = [];

    if (exaResult.products.length > 0) {
      // Map structured Exa results to ScoutPrice format
      for (let i = 0; i < exaResult.products.length; i++) {
        const p = exaResult.products[i];
        const parsed = parsePrice(p.price);
        if (parsed) {
          prices.push({
            sourceUrl: p.sourceUrl,
            domain: extractDomain(p.sourceUrl),
            title: p.title.slice(0, 200),
            price: parsed.value,
            currency: parsed.currency || p.currency || "USD",
            imageUrl: null,
            position: i + 1,
            confidence: 0.85, // Exa structured output has high confidence
          });
        } else {
          // Price string couldn't be parsed — store raw value
          prices.push({
            sourceUrl: p.sourceUrl,
            domain: extractDomain(p.sourceUrl),
            title: p.title.slice(0, 200),
            price: p.price.replace(/[^0-9.]/g, "") || "0.00",
            currency: p.currency || "USD",
            imageUrl: null,
            position: i + 1,
            confidence: 0.7,
          });
        }
      }
    }

    // Step 3: If structured search was weak, supplement with raw Exa search
    if (prices.length < 3) {
      for (const query of searchQueries.slice(1)) {
        try {
          const rawResults = await searchExa(query, 10);
          for (const r of rawResults) {
            try {
              const price = await scrapeUrlForPrice(r.url, product.title);
              if (price && !prices.some(p => p.sourceUrl === r.url)) {
                price.position = prices.length + 1;
                prices.push(price);
              }
              // Collect review snippets from highlights
              if (r.snippet && r.snippet.length > 20) {
                reviews.push({
                  title: r.title,
                  snippet: r.snippet,
                  url: r.url,
                });
              }
            } catch (err) {
              logger.debug({ url: r.url, err }, "Scout: Exa URL scrape failed");
            }
          }
        } catch (err) {
          logger.warn(
            { query, err },
            "Scout: Exa raw search supplement failed"
          );
        }
        if (prices.length >= maxResults) break;
      }
    }

    // Step 4: Persist to database
    try {
      // Build search results from Exa raw results for storage
      const allSearchResults = await searchExa(baseQuery, maxResults + 5);
      const rows = toScoutRows({
        productId,
        userId,
        searchResults: allSearchResults,
        prices,
        defaultQuery: baseQuery,
      });
      await replaceScoutRows(database, userId, productId, rows);
    } catch (err) {
      logger.warn(
        { productId, err },
        "Scout: failed to persist Exa scout results"
      );
    }

    const status =
      prices.length > 0
        ? prices.length >= maxResults
          ? "success"
          : "partial"
        : "failed";
    const errorMessage =
      prices.length === 0
        ? "Exa search could not find pricing for this product."
        : null;

    logger.info(
      {
        productId,
        query: baseQuery,
        found: prices.length,
        structuredCount: exaResult.products.length,
      },
      "Scout: Exa scouting completed"
    );

    return {
      productId,
      productTitle: product.title,
      productPrice: product.price?.toString() ?? "0",
      prices,
      reviews: reviews.slice(0, 10),
      searchQueries,
      totalFound: prices.length,
      searchEngine: "exa",
      status,
      errorMessage,
    };
  },

  async scoutAllWithExa(
    userId: string,
    maxResults: number = 10
  ): Promise<SerpApiScoutResult[]> {
    const database = await requireDb();
    const userProducts = await database
      .select()
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.isActive, true)))
      .limit(50);

    const results: SerpApiScoutResult[] = [];
    for (const product of userProducts) {
      try {
        const result = await this.scoutProductWithExa(
          userId,
          product.id,
          maxResults
        );
        results.push(result);
      } catch (err) {
        logger.warn(
          { productId: product.id, err },
          "Scout: failed to scout product with Exa"
        );
        results.push({
          productId: product.id,
          productTitle: product.title,
          productPrice: product.price?.toString() ?? "0",
          prices: [],
          reviews: [],
          searchQueries: [],
          totalFound: 0,
          searchEngine: "none",
          status: "failed",
          errorMessage: String(err),
        });
      }
    }
    return results;
  },

  async getScoutHistory(
    userId: string,
    productId: string
  ): Promise<
    Array<{
      query: string;
      title: string | null;
      snippet: string | null;
      url: string;
      price: string | null;
      currency: string | null;
      source: string | null;
      position: number | null;
      scrapedAt: Date;
    }>
  > {
    const database: any = await requireDb();
    const rows = await database
      .select({
        query: serpApiScouts.query,
        title: serpApiScouts.title,
        snippet: serpApiScouts.snippet,
        url: serpApiScouts.url,
        price: serpApiScouts.price,
        currency: serpApiScouts.currency,
        source: serpApiScouts.source,
        position: serpApiScouts.position,
        scrapedAt: serpApiScouts.scrapedAt,
      })
      .from(serpApiScouts)
      .where(
        and(
          eq(serpApiScouts.userId, userId),
          eq(serpApiScouts.productId, productId)
        )
      )
      .orderBy(desc(serpApiScouts.scrapedAt));
    return rows;
  },

  async getAllScoutHistory(userId: string): Promise<ScoutHistoryResult[]> {
    const database: any = await requireDb();
    const rows = await database
      .select({
        productId: products.id,
        productTitle: products.title,
        productPrice: products.price,
        query: serpApiScouts.query,
        title: serpApiScouts.title,
        snippet: serpApiScouts.snippet,
        url: serpApiScouts.url,
        price: serpApiScouts.price,
        currency: serpApiScouts.currency,
        source: serpApiScouts.source,
        position: serpApiScouts.position,
        scrapedAt: serpApiScouts.scrapedAt,
      })
      .from(serpApiScouts)
      .innerJoin(products, eq(serpApiScouts.productId, products.id))
      .where(and(eq(serpApiScouts.userId, userId), eq(products.userId, userId)))
      .orderBy(desc(serpApiScouts.scrapedAt));

    const grouped = new Map<string, ScoutHistoryResult>();
    for (const row of rows) {
      const current: ScoutHistoryResult = grouped.get(row.productId) ?? {
        productId: row.productId,
        productTitle: row.productTitle,
        productPrice: row.productPrice?.toString() ?? "0",
        prices: [] as ScoutPrice[],
        reviews: [] as Array<{ title: string; snippet: string; url: string }>,
        searchQueries: [] as string[],
        totalFound: 0,
        searchEngine: "postgres",
        status: "failed" as const,
        errorMessage: null,
        scrapedAt: row.scrapedAt ?? null,
      };

      if (row.query && !current.searchQueries.includes(row.query)) {
        current.searchQueries.push(row.query);
      }

      if (row.snippet && row.snippet.length > 20) {
        current.reviews.push({
          title: row.title ?? row.source ?? "Search result",
          snippet: row.snippet,
          url: row.url,
        });
      }

      if (row.price) {
        current.prices.push({
          sourceUrl: row.url,
          domain: row.source ?? extractDomain(row.url),
          title: row.title ?? row.source ?? row.url,
          price: row.price,
          currency: row.currency ?? "USD",
          imageUrl: null,
          position: row.position ?? current.prices.length + 1,
          confidence: 0.8,
        });
      }

      if (!current.scrapedAt || row.scrapedAt > current.scrapedAt) {
        current.scrapedAt = row.scrapedAt;
      }

      grouped.set(row.productId, current);
    }

    return Array.from(grouped.values()).map(
      (result: ScoutHistoryResult): ScoutHistoryResult => ({
        ...result,
        prices: result.prices.sort((a, b) => a.position - b.position),
        reviews: result.reviews.slice(0, 10),
        totalFound: result.prices.length,
        status: result.prices.length > 0 ? "success" : ("partial" as const),
      })
    );
  },

  // ─── Price Radar Scout (Google direct search) ───────────────────────────

  async scoutProductWithPriceRadar(
    userId: string,
    productId: string,
    maxResults: number = 10
  ): Promise<ScoutResult> {
    const database: any = await requireDb();

    const product = await database.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.userId, userId)),
    });
    if (!product) {
      return {
        productId,
        productTitle: "",
        productPrice: "0",
        prices: [],
        totalFound: 0,
        searchEngine: "none",
        status: "failed",
        errorMessage: "Product not found",
      };
    }

    const seenUrls = new Set<string>();
    const allPrices: ScoutPrice[] = [];
    let position = 0;

    const marketplaces = [
      { name: "Amazon", siteQuery: `site:amazon.com ${product.title.slice(0, 100)}` },
      { name: "eBay", siteQuery: `site:ebay.com ${product.title.slice(0, 100)}` },
      { name: "Walmart", siteQuery: `site:walmart.com ${product.title.slice(0, 100)}` },
    ];

    for (const mp of marketplaces) {
      try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(mp.siteQuery)}&num=${maxResults + 3}`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) continue;
        const html = await res.text();

        const resultBlocks = html.match(/<div[^>]*class="[^"]*g[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/gi) ?? [];
        if (resultBlocks.length === 0) continue;

        for (const block of resultBlocks) {
          await new Promise(r => setTimeout(r, 500));

          const hrefMatch = block.match(/href="(https?:\/\/[^"]+)"/);
          const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
          if (!hrefMatch) continue;

          const link = hrefMatch[1];
          if (!link.startsWith("http") || seenUrls.has(link)) continue;
          seenUrls.add(link);

          const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : product.title;
          position++;

          const snippetText = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
          const price = extractPriceFromText(snippetText);

          allPrices.push({
            sourceUrl: link,
            domain: mp.name.toLowerCase(),
            title,
            price: price?.value ?? "0",
            currency: price?.currency ?? "USD",
            imageUrl: null,
            position,
            confidence: price ? 0.7 : 0.3,
          });
        }
      } catch (err) {
        logger.warn({ mp: mp.name, err }, "Price Radar scout: Google search failed");
      }
    }

    return {
      productId,
      productTitle: product.title,
      productPrice: product.price?.toString() ?? "0",
      prices: allPrices.slice(0, maxResults * 3),
      totalFound: allPrices.length,
      searchEngine: "price-radar",
      status: allPrices.length > 0 ? "success" : "failed",
      errorMessage: allPrices.length > 0 ? null : "No prices found on Amazon, eBay, or Walmart",
    };
  },

  async scoutAllWithPriceRadar(
    userId: string,
    maxResults: number = 10
  ): Promise<ScoutResult[]> {
    const database = await requireDb();
    const userProducts = await database
      .select()
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.isActive, true)))
      .limit(50);

    const results: ScoutResult[] = [];
    for (const product of userProducts) {
      try {
        const result = await this.scoutProductWithPriceRadar(
          userId,
          product.id,
          maxResults
        );
        results.push(result);
      } catch (err) {
        logger.warn(
          { productId: product.id, err },
          "Scout: failed to scout product with Price Radar"
        );
        results.push({
          productId: product.id,
          productTitle: product.title,
          productPrice: product.price?.toString() ?? "0",
          prices: [],
          totalFound: 0,
          searchEngine: "none",
          status: "failed",
          errorMessage: String(err),
        });
      }
    }
    return results;
  },
};
