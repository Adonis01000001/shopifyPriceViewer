/**
 * The automated pricing pipeline.
 *
 * One path, entered once: discover where competitors sell a product, read
 * those pages, have a single AI call decide whether it is the same product and
 * pull the price out, store the result, then recommend a price.
 *
 * Cost shape (matters, the free tiers are small):
 *  - Discovery uses SerpAPI and runs ONCE per product. Never on a schedule.
 *  - Monitoring re-scrapes stored URLs with Firecrawl. That is the hourly job.
 *  - MAX_COMPETITOR_URLS caps how many pages one product can ever cost.
 */
import { and, eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import * as db from "../db";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import {
  competitors,
  competitorProducts,
  priceHistory,
  products,
  recommendations,
  accountShopConnections,
  accountCompetitorConnections,
  shops,
} from "../../drizzle/schema";
import { aiExtractionService } from "./ai-extraction.service";
import { pricingEngine } from "./pricing-engine.service";
import { pricingRulesService } from "./pricing-rules.service";
import { activityService } from "./activity.service";
import { getOrCreateShop, normalizeShopDomain } from "./shop.service";

/**
 * The run is unattended on a cron, so a single product that never returns
 * would stall every product behind it. Each one gets a hard ceiling.
 */
const PRODUCT_DEADLINE_MS = 6 * 60 * 1000;

function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Pipeline deadline exceeded for ${label}`)),
      ms
    );
  });
  return Promise.race([work, deadline]).finally(() =>
    clearTimeout(timer)
  ) as Promise<T>;
}

/**
 * The run happens in the background, so the only way anyone can see it is if
 * it says what it is doing. Every step writes one activity row; the status
 * endpoint reads them back to drive the progress indicator.
 */
export const PIPELINE_ACTIONS = {
  runStarted: "pipeline_run_started",
  productStarted: "pipeline_product_started",
  productStep: "pipeline_product_step",
  productDone: "pipeline_product_done",
  runFinished: "pipeline_run_finished",
} as const;

/**
 * A line for the activity log, in the words a merchant would use rather than
 * the internals. One product used to produce two rows over eighty seconds,
 * which read as nothing happening; this is what fills that gap.
 */
async function step(userId: string, productId: string, detail: string) {
  try {
    await activityService.log({
      userId,
      action: PIPELINE_ACTIONS.productStep,
      entityType: "product",
      entityId: productId,
      detail,
    });
  } catch {
    // Narrating progress must never be the thing that breaks a run.
  }
}

/** Below this, a price change is not worth a merchant's attention. */
const TRIVIAL_CHANGE = 0.01;

export const MAX_COMPETITOR_URLS = 3;

/** Localised search parameters. Prices are only useful if they are the prices
 *  a shopper in the merchant's own market would actually see. */
export interface SearchLocale {
  country: string;
  gl: string;
  hl: string;
  googleDomain: string;
}

export const LOCALES: Record<string, SearchLocale> = {
  US: { country: "US", gl: "us", hl: "en", googleDomain: "google.com" },
  GB: { country: "GB", gl: "uk", hl: "en", googleDomain: "google.co.uk" },
  DE: { country: "DE", gl: "de", hl: "de", googleDomain: "google.de" },
  FR: { country: "FR", gl: "fr", hl: "fr", googleDomain: "google.fr" },
  CA: { country: "CA", gl: "ca", hl: "en", googleDomain: "google.ca" },
  AU: { country: "AU", gl: "au", hl: "en", googleDomain: "google.com.au" },
  JP: { country: "JP", gl: "jp", hl: "ja", googleDomain: "google.co.jp" },
  BR: { country: "BR", gl: "br", hl: "pt", googleDomain: "google.com.br" },
  IN: { country: "IN", gl: "in", hl: "en", googleDomain: "google.co.in" },
  NL: { country: "NL", gl: "nl", hl: "nl", googleDomain: "google.nl" },
  MA: { country: "MA", gl: "ma", hl: "fr", googleDomain: "google.co.ma" },
};

/** Currency is the best signal we hold about which market a store sells into. */
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: "US", GBP: "GB", EUR: "FR", CAD: "CA", AUD: "AU",
  JPY: "JP", BRL: "BR", INR: "IN", MAD: "MA",
};

export function resolveLocale(
  country?: string | null,
  currency?: string | null
): SearchLocale {
  if (country && LOCALES[country.toUpperCase()]) return LOCALES[country.toUpperCase()];
  if (currency) {
    const mapped = CURRENCY_TO_COUNTRY[currency.toUpperCase()];
    if (mapped && LOCALES[mapped]) return LOCALES[mapped];
  }
  return LOCALES.US;
}
const SERP_QUERIES_PER_PRODUCT = 2;
/** Try more domains than we keep: protected sites fail and we move on. */
const CANDIDATE_POOL = 4;

export interface PipelineProductResult {
  productId: string;
  title: string;
  discovered: number;
  scraped: number;
  matched: number;
  competitorPrices: number[];
  recommendedPrice: number | null;
  marginProtectionApplied: boolean;
  skipped?: string;
}

interface Candidate {
  url: string;
  domain: string;
  title: string;
  sourceName: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Domains that are never competitors: marketplaces of reviews, video, social. */
const EXCLUDED = new Set([
  "youtube.com", "m.youtube.com", "reddit.com", "facebook.com", "instagram.com",
  "twitter.com", "x.com", "pinterest.com", "tiktok.com", "wikipedia.org",
  "quora.com", "medium.com",
]);

/** Find candidate competitor product pages via SerpAPI Google Shopping. */
async function discoverCandidates(
  productTitle: string,
  ownDomain: string | null,
  locale: SearchLocale
): Promise<Candidate[]> {
  if (!ENV.serpApiKey && !ENV.serperApiKey) {
    logger.warn("Pipeline: no search provider configured (SERPER_API_KEY or SERP_API_KEY), discovery skipped");
    return [];
  }

  // Organic search results, not Shopping. Shopping only returns Google's own
  // product_link URLs; organic returns the retailer's real product page, which
  // is what we need to scrape.
  //
  // Provider: Serper if configured (roughly 10-30x cheaper per query than
  // SerpApi, and a far larger free allowance), otherwise SerpApi.
  const queries = [`${productTitle} buy`, productTitle].slice(
    0,
    SERP_QUERIES_PER_PRODUCT
  );
  const byDomain = new Map<string, Candidate>();
  const useSerper = Boolean(ENV.serperApiKey);

  for (const q of queries) {
    let organic: any[] = [];

    try {
      if (useSerper) {
        const resp = await fetch("https://google.serper.dev/search", {
          method: "POST",
          headers: {
            "X-API-KEY": ENV.serperApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ q, gl: locale.gl, hl: locale.hl, num: 20 }),
          signal: AbortSignal.timeout(45000),
        });
        if (!resp.ok) {
          logger.warn({ status: resp.status, q }, "Pipeline: Serper request failed");
          continue;
        }
        organic = (await resp.json())?.organic ?? [];
      } else {
        const url =
          "https://serpapi.com/search.json?" +
          new URLSearchParams({
            engine: "google",
            q,
            gl: locale.gl,
            hl: locale.hl,
            google_domain: locale.googleDomain,
            num: "20",
            api_key: ENV.serpApiKey,
          }).toString();
        const resp = await fetch(url, { signal: AbortSignal.timeout(45000) });
        if (!resp.ok) {
          logger.warn({ status: resp.status, q }, "Pipeline: SerpApi request failed");
          continue;
        }
        organic = (await resp.json())?.organic_results ?? [];
      }
    } catch (err) {
      logger.warn({ err, q, provider: useSerper ? "serper" : "serpapi" }, "Pipeline: search threw");
      continue;
    }

    for (const r of organic) {
      const link: string | undefined = r.link;
      if (!link) continue;
      const host = hostOf(link);
      if (!host || EXCLUDED.has(host)) continue;
      if (ownDomain && host === ownDomain) continue;
      if (byDomain.has(host)) continue;
      byDomain.set(host, {
        url: link,
        domain: host,
        title: String(r.title ?? ""),
        sourceName: host.split(".")[0].replace(/^\w/, c => c.toUpperCase()),
      });
      if (byDomain.size >= CANDIDATE_POOL) break;
    }
    if (byDomain.size >= CANDIDATE_POOL) break;
  }

  return Array.from(byDomain.values());
}

/**
 * Read a page. Cheapest source first.
 *  1. Jina Reader  - free, no key, handles most retailer pages.
 *  2. Firecrawl    - paid credits, used only when Jina fails.
 * Heavily protected retailers (Best Buy, Amazon) block both; those candidates
 * are simply skipped and the next domain is tried instead.
 */
async function scrapePage(url: string): Promise<string | null> {
  // 1. Jina Reader
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(45000),
    });
    if (resp.ok) {
      const text = await resp.text();
      if (text && text.length > 500) {
        logger.debug({ url, chars: text.length }, "Pipeline: scraped via Jina");
        return text;
      }
    }
  } catch {
    // fall through to Firecrawl
  }

  // 2. Firecrawl fallback
  if (!ENV.firecrawlApiKey) return await playwrightScrape(url);
  try {
    const resp = await fetch(`${ENV.firecrawlBaseUrl}/v2/scrape`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"] }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status, url }, "Pipeline: Firecrawl scrape failed");
      return null;
    }
    const j: any = await resp.json();
    const md: string | null = j?.data?.markdown ?? null;
    if (md && md.length > 500) {
      logger.debug({ url, chars: md.length }, "Pipeline: scraped via Firecrawl");
      return md;
    }
    logger.warn({ url, chars: md?.length ?? 0 }, "Pipeline: Firecrawl returned nothing, trying Playwright");
    return await playwrightScrape(url);
  } catch (err) {
    logger.warn({ err, url }, "Pipeline: Firecrawl scrape threw, trying Playwright");
    return await playwrightScrape(url);
  }
}

/**
 * Last resort: render the page in a real browser. Slower and heavier than the
 * hosted scrapers, but it is the only option that executes JavaScript and
 * presents a genuine browser fingerprint, which is what some retailers check.
 */
async function playwrightScrape(url: string): Promise<string | null> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    if (text && text.length > 500) {
      logger.debug({ url, chars: text.length }, "Pipeline: scraped via Playwright");
      return text;
    }
    return null;
  } catch (err) {
    logger.warn({ err, url }, "Pipeline: Playwright scrape failed");
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * A page is only worth an AI call if it actually shows a price. Blocked or
 * near-empty pages otherwise reach the model, which then has nothing to read
 * and echoes whatever number is in the prompt -- in practice the merchant's
 * own price, which would poison every recommendation built on it.
 */
function pageHasPrice(content: string): boolean {
  return /(?:[$£€]\s?\d[\d,]*(?:\.\d{2})?)|(?:\d[\d,]*\.\d{2}\s?(?:USD|EUR|GBP))/i.test(
    content
  );
}

/**
 * The extracted price must literally appear on the page. This is the single
 * cheapest defence against hallucination, prompt echo and mis-parsing: if the
 * model reports a number the page never showed, we do not trust it.
 */
function priceAppearsOnPage(price: number, content: string): boolean {
  const normalized = content.replace(/[,\s]/g, "");
  const exact = price.toFixed(2);
  const whole = String(Math.round(price));
  return (
    normalized.includes(exact) ||
    (Number.isInteger(price) && normalized.includes(whole + ".00")) ||
    normalized.includes(whole + ".")
  );
}

async function findOrCreateCompetitor(
  userId: string,
  domain: string,
  name: string
) {
  const database = await db.getDb();
  if (!database) throw new Error("Database not available");

  const normalizedDomain = normalizeShopDomain(domain);
  const shop = await getOrCreateShop(normalizedDomain, { database });
  const existing = await database.query.competitors.findFirst({
    where: eq(competitors.shopId, shop.id),
  });
  if (existing) {
    await database
      .insert(accountCompetitorConnections)
      .values({ userId, competitorId: existing.id, isActive: true })
      .onConflictDoUpdate({
        target: [
          accountCompetitorConnections.userId,
          accountCompetitorConnections.competitorId,
        ],
        set: { isActive: true, updatedAt: new Date() },
      });
    return existing;
  }

  const [created] = await database
    .insert(competitors)
    .values({
      shopId: shop.id,
      name,
      domain: normalizedDomain,
      status: "active",
      productsTracked: 0,
      avgPriceDiff: "0.00",
      scrapeStatus: "pending",
    })
    .returning();
  await database
    .insert(accountCompetitorConnections)
    .values({ userId, competitorId: created.id, isActive: true })
    .onConflictDoUpdate({
      target: [
        accountCompetitorConnections.userId,
        accountCompetitorConnections.competitorId,
      ],
      set: { isActive: true, updatedAt: new Date() },
    });
  return created;
}

export const pipelineService = {
  /** Run the whole chain for one product. */
  async runForProduct(
    userId: string,
    productId: string,
    countryOverride?: string | null
  ): Promise<PipelineProductResult> {
    const database = await db.getDb();
    if (!database) throw new Error("Database not available");

    const product = await database.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.userId, userId)),
    });
    if (!product) throw new Error("Product not found");

    const base: PipelineProductResult = {
      productId,
      title: product.title,
      discovered: 0,
      scraped: 0,
      matched: 0,
      competitorPrices: [],
      recommendedPrice: null,
      marginProtectionApplied: false,
    };

    let ownDomain: string | null = null;
    let storeCurrency: string | null = null;
    if (product.storeId) {
      const store = await database
        .select({ domain: shops.normalizedDomain, currency: accountShopConnections.currency })
        .from(accountShopConnections)
        .innerJoin(shops, eq(accountShopConnections.shopId, shops.id))
        .where(eq(accountShopConnections.id, product.storeId))
        .limit(1);
      ownDomain = store[0]?.domain?.toLowerCase() ?? null;
      storeCurrency = store[0]?.currency ?? null;
    }

    // Search the merchant's own market, not always the US.
    const locale = resolveLocale(countryOverride, storeCurrency ?? product.currency);
    logger.info(
      { productId, country: locale.country, gl: locale.gl, hl: locale.hl },
      "Pipeline: searching in locale"
    );

    await step(userId, productId, `Searching the ${locale.country} market`);
    const candidates = await discoverCandidates(product.title, ownDomain, locale);
    base.discovered = candidates.length;
    if (candidates.length === 0) {
      await step(userId, productId, "No shops found selling this");
      base.skipped = "no candidates found";
      return base;
    }
    await step(
      userId,
      productId,
      `Found ${candidates.length} possible shop${candidates.length === 1 ? "" : "s"}`
    );

    const prices: number[] = [];

    for (const cand of candidates) {
      if (base.matched >= MAX_COMPETITOR_URLS) break;
      await step(userId, productId, `Reading ${cand.domain}`);
      const content = await scrapePage(cand.url);
      if (!content) {
        await step(userId, productId, `${cand.domain} could not be read`);
        continue;
      }
      base.scraped++;

      if (!pageHasPrice(content)) {
        await step(userId, productId, `${cand.domain} showed no price`);
        logger.info(
          { url: cand.url },
          "Pipeline: no price on page (likely blocked), skipping AI call"
        );
        continue;
      }
      await step(userId, productId, `Checking if ${cand.domain} sells the same thing`);

      const competitor = await findOrCreateCompetitor(
        userId,
        cand.domain,
        cand.sourceName || cand.domain
      );
      if (!competitor) continue;

      let extraction;
      try {
        const validated = await aiExtractionService.extractAndValidate({
          merchantProduct: {
            id: product.id,
            title: product.title,
            description: product.description,
            sku: product.sku,
            barcode: product.barcode,
            vendor: product.vendor,
            category: product.category,
            price: product.price,
          },
          competitorPageContent: content.slice(0, 12000),
          competitorUrl: cand.url,
          competitorDomain: cand.domain,
          competitorId: competitor.id,
        });
        extraction = validated.extraction;
      } catch (err) {
        logger.warn({ err, url: cand.url }, "Pipeline: AI extraction failed");
        await step(userId, productId, `Could not read ${cand.domain} properly`);
        continue;
      }

      if (
        !extraction.isMatch ||
        extraction.price == null ||
        extraction.price <= 0 ||
        extraction.confidence < ENV.matchConfidenceThreshold
      ) {
        await step(userId, productId, `${cand.domain} sells something different`);
        continue;
      }

      // Sanity band. A "competitor price" at a fraction of ours is a parse
      // artefact (0.05, 0.96 and similar were common before this guard), not a
      // real offer.
      const merchantPrice = Number(product.price);
      if (
        merchantPrice > 0 &&
        (extraction.price < merchantPrice * 0.25 ||
          extraction.price > merchantPrice * 4)
      ) {
        await step(
          userId,
          productId,
          `Ignored an implausible price at ${cand.domain}`
        );
        logger.warn(
          { url: cand.url, price: extraction.price, merchantPrice },
          "Pipeline: extracted price outside plausible band, rejecting"
        );
        continue;
      }

      if (!priceAppearsOnPage(extraction.price, content)) {
        logger.warn(
          { url: cand.url, price: extraction.price },
          "Pipeline: extracted price is not present on the page, rejecting"
        );
        await step(
          userId,
          productId,
          `Discarded a price not shown on ${cand.domain}`
        );
        continue;
      }

      base.matched++;
      prices.push(extraction.price);
      await step(
        userId,
        productId,
        `${cand.domain} sells it for $${extraction.price.toFixed(2)}`
      );

      const existingLink = await database.query.competitorProducts.findFirst({
        where: and(
          eq(competitorProducts.competitorId, competitor.id),
          eq(competitorProducts.productId, product.id)
        ),
      });

      let competitorProductId: string;
      if (existingLink) {
        await database
          .update(competitorProducts)
          .set({
            price: String(extraction.price),
            competitorProductUrl: cand.url,
            competitorProductTitle: extraction.title ?? cand.title,
            matchScore: extraction.confidence,
            matchMethod: "ai",
            lastScrapedAt: new Date(),
            isActive: true,
          })
          .where(eq(competitorProducts.id, existingLink.id));
        competitorProductId = existingLink.id;
      } else {
        const [row] = await database
          .insert(competitorProducts)
          .values({
            competitorId: competitor.id,
            productId: product.id,
            competitorProductUrl: cand.url,
            competitorProductTitle: extraction.title ?? cand.title,
            price: String(extraction.price),
            currency: extraction.currency || "USD",
            matchScore: extraction.confidence,
            matchMethod: "ai",
            isVerified: true,
            isActive: true,
            lastScrapedAt: new Date(),
          })
          .returning();
        competitorProductId = row.id;
      }

      await database.insert(priceHistory).values({
        productId: product.id,
        competitorProductId,
        price: String(extraction.price),
        currency: extraction.currency || "USD",
        source: "pipeline",
      });
    }

    base.competitorPrices = prices;
    if (prices.length === 0) {
      base.skipped = "no confident matches";
      return base;
    }

    const analysis = pricingEngine.analyzeProduct({
      merchantPrice: Number(product.price),
      costPrice: product.costPrice != null ? Number(product.costPrice) : null,
      competitorPrices: prices,
      rules: await pricingRulesService.forUser(userId),
    });

    const rec = analysis.recommendation;
    if (rec) {
      const current = Number(product.price);
      const change = rec.recommendedPrice - current;

      // A suggestion to charge what you already charge is not a suggestion.
      // Anything under a percent is noise on a list of things to act on, and
      // the market position still tells the merchant where they stand.
      if (current > 0 && Math.abs(change) / current < TRIVIAL_CHANGE) {
        base.skipped = "already priced about right";
        base.competitorPrices = prices;
        return base;
      }

      // Supersede any pending recommendation for this product. Re-running the
      // pipeline should refresh the advice, not stack duplicates on the
      // merchant's dashboard.
      await database
        .update(recommendations)
        .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(recommendations.productId, product.id),
            eq(recommendations.status, "pending")
          )
        );

      await database.insert(recommendations).values({
        userId,
        productId: product.id,
        currentPrice: String(current),
        recommendedPrice: String(rec.recommendedPrice),
        priceChange: String(change.toFixed(2)),
        priceChangePercent: String(
          current > 0 ? ((change / current) * 100).toFixed(2) : "0.00"
        ),
        confidenceScore: Math.min(1, 0.5 + prices.length * 0.15),
        reason: rec.explanation,
        factors: {
          competitorPrices: prices,
          avgCompetitorPrice: rec.avgCompetitorPrice,
          marginProtectionApplied: rec.marginProtectionApplied,
          marketPosition: analysis.position?.status ?? null,
        },
        status: "pending",
      });
      base.recommendedPrice = rec.recommendedPrice;
      base.marginProtectionApplied = rec.marginProtectionApplied;
    }

    return base;
  },

  /**
   * Monitoring pass. Re-reads the competitor pages we already know about and
   * updates their prices. Deliberately does NOT search again: discovery is the
   * expensive call and only needs to happen once per product, while prices
   * need re-reading on a schedule.
   */
  async refreshPrices(
    userId?: string
  ): Promise<{ checked: number; updated: number; changed: number }> {
    const database = await db.getDb();
    if (!database) throw new Error("Database not available");

    const links = await database
      .select({
        id: competitorProducts.id,
        url: competitorProducts.competitorProductUrl,
        oldPrice: competitorProducts.price,
        productId: competitorProducts.productId,
        competitorId: competitorProducts.competitorId,
        merchantPrice: products.price,
        merchantTitle: products.title,
        ownerId: products.userId,
      })
      .from(competitorProducts)
      .innerJoin(products, eq(products.id, competitorProducts.productId))
      .where(
        userId
          ? and(eq(products.userId, userId), eq(competitorProducts.isActive, true))
          : eq(competitorProducts.isActive, true)
      );

    let checked = 0;
    let updated = 0;
    let changed = 0;

    for (const link of links) {
      if (!link.url) continue;
      checked++;

      const content = await scrapePage(link.url);
      if (!content || !pageHasPrice(content)) continue;

      let price: number | null = null;
      try {
        const validated = await aiExtractionService.extractAndValidate({
          merchantProduct: {
            id: link.productId,
            title: link.merchantTitle,
            price: link.merchantPrice,
          },
          competitorPageContent: content.slice(0, 12000),
          competitorUrl: link.url,
          competitorDomain: hostOf(link.url) ?? "",
          competitorId: link.competitorId,
        });
        price = validated.extraction.price;
      } catch (err) {
        logger.warn({ err, url: link.url }, "Pipeline refresh: extraction failed");
        continue;
      }

      const merchantPrice = Number(link.merchantPrice);
      if (
        price == null ||
        price <= 0 ||
        !priceAppearsOnPage(price, content) ||
        (merchantPrice > 0 && (price < merchantPrice * 0.25 || price > merchantPrice * 4))
      ) {
        continue;
      }

      updated++;
      if (Math.abs(price - Number(link.oldPrice)) > 0.005) changed++;

      await database
        .update(competitorProducts)
        .set({ price: String(price), lastScrapedAt: new Date() })
        .where(eq(competitorProducts.id, link.id));

      await database.insert(priceHistory).values({
        productId: link.productId,
        competitorProductId: link.id,
        price: String(price),
        source: "monitor",
      });
    }

    logger.info({ checked, updated, changed }, "Pipeline: price refresh complete");
    return { checked, updated, changed };
  },

  /**
   * Write an approved price back to Shopify, then mirror it locally.
   * This is the only call in the system that mutates a merchant's store, so it
   * is explicit, one product at a time, and never runs automatically.
   */
  async pushPriceToShopify(
    userId: string,
    productId: string,
    newPrice: number
  ): Promise<{ ok: true; previousPrice: string; newPrice: number }> {
    const database = await db.getDb();
    if (!database) throw new Error("Database not available");
    if (!(newPrice > 0)) throw new Error("Price must be greater than zero");

    const product = await database.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.userId, userId)),
    });
    if (!product) throw new Error("Product not found");
    if (!product.storeId || !product.shopifyVariantId) {
      throw new Error("This product is not linked to a Shopify variant");
    }

    // Never push below the merchant's own floor, whatever the caller asked for.
    if (product.costPrice != null) {
      const floor = Number(product.costPrice) * 1.1;
      if (newPrice < floor) {
        throw new Error(
          `Refusing to push ${newPrice.toFixed(2)}: below the margin floor of ${floor.toFixed(2)} (cost + 10%)`
        );
      }
    }

    const store = await database
      .select({
        accessToken: accountShopConnections.accessToken,
        shopDomain: shops.normalizedDomain,
      })
      .from(accountShopConnections)
      .innerJoin(shops, eq(accountShopConnections.shopId, shops.id))
      .where(
        and(
          eq(accountShopConnections.id, product.storeId),
          eq(accountShopConnections.isActive, true)
        )
      )
      .limit(1);
    if (!store[0]?.accessToken) throw new Error("Store is not connected");

    const { decryptToken } = await import("../_core/sdk");
    const token = decryptToken(store[0].accessToken);

    const resp = await fetch(
      `https://${store[0].shopDomain}/admin/api/2025-01/variants/${product.shopifyVariantId}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          variant: {
            id: Number(product.shopifyVariantId),
            price: newPrice.toFixed(2),
          },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      logger.error({ status: resp.status, detail }, "Pipeline: price push failed");
      throw new Error(`Shopify rejected the price update (${resp.status})`);
    }

    const previousPrice = product.price;
    await database
      .update(products)
      .set({ price: newPrice.toFixed(2), updatedAt: new Date() })
      .where(eq(products.id, productId));

    await database.insert(priceHistory).values({
      productId,
      price: newPrice.toFixed(2),
      source: "merchant-push",
    });

    logger.info(
      { productId, previousPrice, newPrice, shop: store[0].shopDomain },
      "Pipeline: pushed new price to Shopify"
    );
    return { ok: true, previousPrice, newPrice };
  },

  /** Run the chain for every tracked product a user has. */
  async runForUser(
    userId: string,
    limit = 50,
    countryOverride?: string | null,
    storeId?: string
  ): Promise<{ products: PipelineProductResult[]; totals: Record<string, number> }> {
    const database = await db.getDb();
    if (!database) throw new Error("Database not available");

    const rows = await database
      .select({ id: products.id, title: products.title })
      .from(products)
      .where(
        and(
          eq(products.userId, userId),
          eq(products.isActive, true),
          storeId ? eq(products.storeId, storeId) : undefined
        )
      )
      .limit(limit);

    const startedAt = Date.now();
    await activityService.log({
      userId,
      action: PIPELINE_ACTIONS.runStarted,
      entityType: "pipeline",
      detail: `Checking ${rows.length} products`,
      metadata: { total: rows.length, connectionId: storeId ?? null },
    });

    const results: PipelineProductResult[] = [];
    for (const r of rows) {
      await activityService.log({
        userId,
        action: PIPELINE_ACTIONS.productStarted,
        entityType: "product",
        entityId: r.id,
        detail: r.title,
      });
      try {
        const result = await withDeadline(
          this.runForProduct(userId, r.id, countryOverride),
          PRODUCT_DEADLINE_MS,
          `product ${r.id}`
        );
        results.push(result);
        await activityService.log({
          userId,
          action: PIPELINE_ACTIONS.productDone,
          entityType: "product",
          entityId: r.id,
          detail: result.title,
          metadata: {
            matched: result.matched,
            scraped: result.scraped,
            recommendedPrice: result.recommendedPrice,
            marginProtectionApplied: result.marginProtectionApplied,
            skipped: result.skipped ?? null,
          },
        });
      } catch (err) {
        logger.warn({ err, productId: r.id }, "Pipeline: product run failed");
        await activityService.log({
          userId,
          action: PIPELINE_ACTIONS.productDone,
          entityType: "product",
          entityId: r.id,
          detail: r.title,
          metadata: { failed: true },
        });
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        products: acc.products + 1,
        discovered: acc.discovered + r.discovered,
        scraped: acc.scraped + r.scraped,
        matched: acc.matched + r.matched,
        recommended: acc.recommended + (r.recommendedPrice != null ? 1 : 0),
      }),
      { products: 0, discovered: 0, scraped: 0, matched: 0, recommended: 0 }
    );

    await activityService.log({
      userId,
      action: PIPELINE_ACTIONS.runFinished,
      entityType: "pipeline",
      detail: `${totals.recommended} recommendations from ${totals.products} products`,
      metadata: { ...totals, durationMs: Date.now() - startedAt },
    });

    logger.info({ userId, ...totals }, "Pipeline: run complete");
    return { products: results, totals };
  },
};
