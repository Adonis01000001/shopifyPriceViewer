import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, or, isNull } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import {
  competitors,
  priceRadarPages,
  priceRadarPriceSnapshots,
  priceRadarProducts,
  priceRadarSources,
} from "../drizzle/schema";
import { requireDb } from "../server/_core/db-assert";
import { extractProductData } from "../server/services/price-radar/extraction";
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

async function main(): Promise<void> {
  const sourceId = argument("--source-id");
  const competitorId = argument("--competitor-id");
  const db = await requireDb();

  const [source] = await db
    .select()
    .from(priceRadarSources)
    .where(eq(priceRadarSources.id, sourceId))
    .limit(1);
  const [competitor] = await db
    .select()
    .from(competitors)
    .where(eq(competitors.id, competitorId))
    .limit(1);

  if (!source || !competitor) throw new Error("Source or competitor not found");
  if (source.userId !== competitor.userId)
    throw new Error("Source and competitor have different owners");
  if (
    normalizeCompetitorDomain(source.domain) !==
    normalizeCompetitorDomain(competitor.domain)
  ) {
    throw new Error("Source and competitor domains do not match");
  }

  const rows = await db
    .select({
      product: priceRadarProducts,
      jobId: priceRadarPages.jobId,
    })
    .from(priceRadarProducts)
    .leftJoin(
      priceRadarPages,
      eq(priceRadarProducts.pageId, priceRadarPages.id)
    )
    .where(
      and(
        eq(priceRadarProducts.sourceId, sourceId),
        eq(priceRadarProducts.isActive, true),
        or(
          isNull(priceRadarProducts.price),
          eq(priceRadarProducts.name, "Amazon")
        )
      )
    );

  await db
    .update(priceRadarSources)
    .set({ competitorId, updatedAt: new Date() })
    .where(
      and(
        eq(priceRadarSources.id, sourceId),
        eq(priceRadarSources.userId, competitor.userId)
      )
    );

  let browser: Browser | null = null;
  let updated = 0;
  let skipped = 0;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      serviceWorkers: "block",
    });

    log("start", {
      sourceId,
      competitorId,
      competitor: competitor.name,
      products: rows.length,
    });

    for (const [index, row] of rows.entries()) {
      const page = await context.newPage();
      try {
        await page.route("**/*", route => {
          const type = route.request().resourceType();
          if (["media", "font"].includes(type)) void route.abort();
          else void route.continue();
        });
        const response = await page.goto(row.product.productUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page
          .waitForLoadState("networkidle", { timeout: 5_000 })
          .catch(() => undefined);
        const extraction = extractProductData(
          await page.content(),
          page.url()
        );
        const product = extraction.product;

        if (
          !response?.ok() ||
          !product?.price ||
          /^Amazon(?:\.com)?$/i.test(product.name)
        ) {
          skipped += 1;
          log("skipped", {
            index: index + 1,
            total: rows.length,
            productId: row.product.id,
            status: response?.status() ?? null,
            reason: !product?.price ? "price_missing" : "name_missing",
          });
          continue;
        }

        const capturedAt = new Date();
        await db.transaction(async tx => {
          await tx
            .update(priceRadarProducts)
            .set({
              name: product.name,
              brand: product.brand,
              price: product.price,
              currency: product.currency,
              previousPrice: product.previousPrice,
              discountPercent: product.discountPercent,
              imageUrls:
                product.images.length > 0
                  ? product.images
                  : row.product.imageUrls,
              availability: product.availability,
              sku: product.sku ?? row.product.sku,
              barcode: product.barcode ?? row.product.barcode,
              gtin: product.gtin ?? row.product.gtin,
              category: product.category ?? row.product.category,
              rating: product.rating ?? row.product.rating,
              reviewCount: product.reviewCount ?? row.product.reviewCount,
              seller: product.seller ?? row.product.seller,
              structuredMetadata: product.structuredMetadata,
              jsonLd: product.jsonLd,
              extractionMethod: product.extractionMethod,
              extractionConfidence: product.extractionConfidence,
              lastSeenAt: capturedAt,
              updatedAt: capturedAt,
            })
            .where(eq(priceRadarProducts.id, row.product.id));
          await tx.insert(priceRadarPriceSnapshots).values({
            productId: row.product.id,
            jobId: row.jobId,
            price: product.price,
            previousPrice: product.previousPrice,
            currency: product.currency,
            availability: product.availability,
            capturedAt,
          });
        });

        updated += 1;
        log("updated", {
          index: index + 1,
          total: rows.length,
          productId: row.product.id,
          name: product.name,
          price: product.price,
          currency: product.currency,
        });
      } catch (error) {
        skipped += 1;
        log("error", {
          index: index + 1,
          total: rows.length,
          productId: row.product.id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await page.close();
      }
      await delay(500);
    }
    await context.close();
  } finally {
    await browser?.close();
  }

  log("complete", { updated, skipped, total: rows.length });
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    log("failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
