import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, isNotNull } from "drizzle-orm";
import { chromium, type Browser, type Page } from "playwright";
import {
  competitorProducts,
  competitors,
  priceRadarSources,
} from "../drizzle/schema";
import { requireDb } from "../server/_core/db-assert";
import { extractProductData } from "../server/services/price-radar/extraction";
import { priceRadarRepository } from "../server/services/price-radar/repository";
import {
  DEFAULT_PRICE_RADAR_POLICY,
  type PriceRadarFetchedPage,
  type PriceRadarProduct,
} from "../server/services/price-radar/types";
import { normalizeCompetitorDomain } from "../server/services/price-radar/url-policy";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

function log(event: string, data: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
}

function sourceOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/`;
}

async function ensureSource(
  competitor: typeof competitors.$inferSelect,
  firstProductUrl: string
) {
  const db = await requireDb();
  const sourceRows = await db
    .select()
    .from(priceRadarSources)
    .where(eq(priceRadarSources.userId, competitor.userId));
  const normalizedDomain = normalizeCompetitorDomain(competitor.domain);
  const existing = sourceRows.find(
    source =>
      normalizeCompetitorDomain(source.domain) === normalizedDomain
  );

  if (existing) {
    const [source] = await db
      .update(priceRadarSources)
      .set({
        competitorId: competitor.id,
        isActive: true,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(priceRadarSources.id, existing.id),
          eq(priceRadarSources.userId, competitor.userId)
        )
      )
      .returning();
    if (!source) throw new Error("Unable to reactivate Price Radar source");
    return source;
  }

  const baseUrl = sourceOrigin(firstProductUrl);
  const hostname = new URL(baseUrl).hostname;
  if (normalizeCompetitorDomain(hostname) !== normalizedDomain) {
    throw new Error("Competitor and product URL domains do not match");
  }

  return priceRadarRepository.createSource({
    userId: competitor.userId,
    competitorId: competitor.id,
    name: competitor.name,
    domain: hostname,
    baseUrl,
    crawlDelayMs: DEFAULT_PRICE_RADAR_POLICY.minRequestIntervalMs,
  });
}

async function renderProductPage(page: Page, url: string) {
  const startedAt = Date.now();
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page
    .waitForLoadState("networkidle", { timeout: 5_000 })
    .catch(() => undefined);
  const html = await page.content();
  const extraction = extractProductData(html, page.url());
  const fetchedPage: PriceRadarFetchedPage = {
    requestedUrl: url,
    finalUrl: page.url(),
    statusCode: response?.status() ?? 0,
    contentType: response?.headers()["content-type"] ?? "text/html",
    html,
    renderMode: "browser",
    responseTimeMs: Date.now() - startedAt,
    fetchedAt: new Date(),
    retryCount: 0,
  };
  return { response, extraction, fetchedPage };
}

function verifiedProduct(
  product: PriceRadarProduct | null,
  originalUrl: string,
  responseOk: boolean
): PriceRadarProduct | null {
  if (!responseOk || !product?.name || !product.price) return null;
  return { ...product, productUrl: originalUrl };
}

async function main(): Promise<void> {
  const competitorId = argument("--competitor-id");
  const db = await requireDb();
  const [competitor] = await db
    .select()
    .from(competitors)
    .where(eq(competitors.id, competitorId))
    .limit(1);
  if (!competitor) throw new Error("Competitor not found");

  const rows = await db
    .select()
    .from(competitorProducts)
    .where(
      and(
        eq(competitorProducts.competitorId, competitor.id),
        eq(competitorProducts.isActive, true),
        isNotNull(competitorProducts.competitorProductUrl)
      )
    );
  const firstProductUrl = rows[0]?.competitorProductUrl;
  if (!firstProductUrl) throw new Error("Competitor has no active product URLs");

  const source = await ensureSource(competitor, firstProductUrl);
  const policy = {
    ...DEFAULT_PRICE_RADAR_POLICY,
    maxPages: rows.length,
    maxDepth: 0,
    concurrency: 1,
    renderMode: "browser" as const,
  };
  const job = await priceRadarRepository.createJob(
    competitor.userId,
    source.id,
    source.baseUrl,
    policy
  );
  await priceRadarRepository.updateJob(job.id, {
    status: "running",
    pagesQueued: rows.length,
    startedAt: new Date(),
  });

  let browser: Browser | null = null;
  let succeeded = 0;
  let failed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      locale: "en-US",
      serviceWorkers: "block",
    });

    log("start", {
      competitor: competitor.name,
      competitorId: competitor.id,
      sourceId: source.id,
      jobId: job.id,
      products: rows.length,
    });

    for (const [index, row] of rows.entries()) {
      const url = row.competitorProductUrl;
      if (!url) continue;
      const page = await context.newPage();
      const startedAt = Date.now();
      try {
        await page.route("**/*", route => {
          const type = route.request().resourceType();
          if (["image", "media", "font"].includes(type)) void route.abort();
          else void route.continue();
        });
        const { response, extraction, fetchedPage } =
          await renderProductPage(page, url);
        const product = verifiedProduct(
          extraction.product,
          url,
          response?.ok() ?? false
        );
        const storedPage = await priceRadarRepository.recordPage({
          userId: competitor.userId,
          sourceId: source.id,
          jobId: job.id,
          item: {
            url,
            depth: 0,
            referrerUrl: null,
            kindHint: "product",
          },
          page: fetchedPage,
          pageKind: extraction.pageKind,
          status: product ? "succeeded" : "failed",
          metadata: { warnings: extraction.warnings },
        });
        if (!storedPage) throw new Error("Unable to record crawled page");

        if (!product) {
          failed += 1;
          const blocked = /\/blocked(?:[/?]|$)/i.test(fetchedPage.finalUrl);
          await priceRadarRepository.recordExtraction({
            userId: competitor.userId,
            jobId: job.id,
            pageId: storedPage.id,
            methods: extraction.methods,
            warnings: extraction.warnings,
            confidence: extraction.product?.extractionConfidence ?? 0,
            durationMs: Date.now() - startedAt,
          });
          await priceRadarRepository.recordError({
            userId: competitor.userId,
            jobId: job.id,
            pageId: storedPage.id,
            url,
            stage: "extraction",
            code: blocked ? "ROBOT_CHALLENGE" : `HTTP_${fetchedPage.statusCode}`,
            message: blocked
              ? "Source redirected Price Radar to a robot challenge"
              : extraction.warnings.join("; ") || "Product data unavailable",
            retryable: blocked || fetchedPage.statusCode === 403,
            retryCount: 0,
          });
          log("skipped", {
            index: index + 1,
            url,
            status: fetchedPage.statusCode,
            finalUrl: fetchedPage.finalUrl,
            reason: blocked ? "robot_challenge" : "product_unavailable",
          });
          continue;
        }

        const storedProduct = await priceRadarRepository.upsertProduct({
          userId: competitor.userId,
          sourceId: source.id,
          pageId: storedPage.id,
          jobId: job.id,
          product,
        });
        await priceRadarRepository.recordExtraction({
          userId: competitor.userId,
          jobId: job.id,
          pageId: storedPage.id,
          productId: storedProduct.id,
          methods: extraction.methods,
          warnings: extraction.warnings,
          confidence: product.extractionConfidence,
          durationMs: Date.now() - startedAt,
        });
        await db
          .update(competitorProducts)
          .set({
            competitorProductTitle: product.name,
            previousPrice:
              row.price !== product.price ? row.price : row.previousPrice,
            price: product.price,
            currency: product.currency ?? row.currency,
            lastPriceUpdate: new Date(),
            lastScrapedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(competitorProducts.id, row.id));
        succeeded += 1;
        log("imported", {
          index: index + 1,
          url,
          name: product.name,
          price: product.price,
          currency: product.currency,
        });
      } catch (error) {
        failed += 1;
        await priceRadarRepository.recordError({
          userId: competitor.userId,
          jobId: job.id,
          url,
          stage: "crawl",
          code: "CRAWL_FAILURE",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
          retryCount: 0,
        });
        log("error", {
          index: index + 1,
          url,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await page.close();
      }
      await delay(source.crawlDelayMs);
    }
    await context.close();
  } finally {
    await browser?.close();
  }

  const completedAt = new Date();
  const status =
    succeeded === 0 ? "failed" : failed > 0 ? "partial" : "completed";
  await priceRadarRepository.updateJob(job.id, {
    status,
    pagesVisited: succeeded + failed,
    pagesSucceeded: succeeded,
    pagesFailed: failed,
    productsExtracted: succeeded,
    completedAt,
    errorMessage:
      failed > 0 ? `${failed} product page(s) could not be extracted` : null,
  });
  await db
    .update(priceRadarSources)
    .set({
      competitorId: competitor.id,
      status: succeeded > 0 ? "active" : "error",
      lastCrawledAt: completedAt,
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(priceRadarSources.id, source.id),
        eq(priceRadarSources.userId, competitor.userId)
      )
    );

  log("complete", {
    competitor: competitor.name,
    sourceId: source.id,
    jobId: job.id,
    status,
    succeeded,
    failed,
  });
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    log("failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
