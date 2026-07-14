import { eq, and, desc, sql } from "drizzle-orm";
import { Firecrawl } from "firecrawl";
import { requireDb } from "../_core/db-assert";
import {
  cronRuns,
  priceSnapshots,
  priceChanges,
  scrapeLogs,
  competitorProducts,
  competitors,
  products,
  alerts,
  activityLogs,
  notificationPreferences,
  type PriceChange,
  type InsertActivityLog,
} from "../../drizzle/schema";
import { aiExtractionService } from "./ai-extraction.service";
import { recommendationService } from "./recommendation.service";
import { notificationBroadcaster } from "./notification-broadcaster";
import { logger } from "../_core/logger";
import { ENV } from "../_core/env";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MonitoringResult {
  cronRunId: string;
  productsProcessed: number;
  productsUpdated: number;
  changesDetected: number;
  errors: number;
  changeDetails: PriceChange[];
}

interface ScrapedPageData {
  content: string;
  method: "firecrawl" | "api";
  responseTimeMs: number;
}

// ─── Page Scraper ────────────────────────────────────────────────────────────

async function scrapePage(url: string): Promise<ScrapedPageData | null> {
  if (!ENV.firecrawlApiKey) return null;
  const start = Date.now();
  try {
    const app = new Firecrawl({
      apiKey: ENV.firecrawlApiKey,
      apiUrl: ENV.firecrawlBaseUrl,
    });
    const result = await app.scrape(url, {
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 30000,
    });
    const content = (result as { markdown?: string }).markdown ?? "";
    if (!content || content.length < 100) return null;
    return { content, method: "firecrawl", responseTimeMs: Date.now() - start };
  } catch (err) {
    logger.warn({ url, err }, "Firecrawl scrape failed in monitoring");
    return null;
  }
}

// ─── Change Detector ─────────────────────────────────────────────────────────

function detectChanges(
  previousPrice: number | null,
  newPrice: number | null,
  previousAvailability: string,
  newAvailability: string
): {
  changeType: string | null;
  priceDiff: number | null;
  priceDiffPercent: number | null;
} {
  if (previousAvailability !== newAvailability) {
    if (newAvailability === "out_of_stock")
      return {
        changeType: "out_of_stock",
        priceDiff: null,
        priceDiffPercent: null,
      };
    if (
      previousAvailability === "out_of_stock" &&
      newAvailability === "in_stock"
    )
      return {
        changeType: "back_in_stock",
        priceDiff: null,
        priceDiffPercent: null,
      };
  }
  if (previousPrice != null && newPrice != null && previousPrice !== newPrice) {
    const diff = newPrice - previousPrice;
    const pct = previousPrice !== 0 ? (diff / previousPrice) * 100 : 0;
    return {
      changeType: diff < 0 ? "price_decrease" : "price_increase",
      priceDiff: diff,
      priceDiffPercent: pct,
    };
  }
  return { changeType: null, priceDiff: null, priceDiffPercent: null };
}

// ─── Timeline Event Generator ────────────────────────────────────────────────

function generateTimelineEvent(
  productTitle: string,
  competitorName: string,
  changeType: string,
  previousPrice: number | null,
  newPrice: number | null,
  priceDiffPercent: number | null,
  currency: string
): string {
  const fmt = (p: number | null) =>
    p != null ? `${currency} ${p.toFixed(2)}` : "N/A";
  switch (changeType) {
    case "price_decrease":
      return `${competitorName} lowered price for "${productTitle}" from ${fmt(previousPrice)} to ${fmt(newPrice)}${priceDiffPercent != null ? ` (${Math.abs(priceDiffPercent).toFixed(1)}% decrease)` : ""}.`;
    case "price_increase":
      return `${competitorName} raised price for "${productTitle}" from ${fmt(previousPrice)} to ${fmt(newPrice)}${priceDiffPercent != null ? ` (${priceDiffPercent.toFixed(1)}% increase)` : ""}.`;
    case "out_of_stock":
      return `"${productTitle}" is now OUT OF STOCK at ${competitorName}.`;
    case "back_in_stock":
      return `"${productTitle}" is BACK IN STOCK at ${competitorName}.`;
    case "new_promotion":
      return `${competitorName} started a promotion for "${productTitle}" — now ${fmt(newPrice)} (was ${fmt(previousPrice)}).`;
    case "product_removed":
      return `"${productTitle}" appears to have been removed from ${competitorName}.`;
    default:
      return `Change detected for "${productTitle}" at ${competitorName}.`;
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const priceMonitoringService = {
  async runFullMonitoring(userId?: string): Promise<MonitoringResult> {
    const database = await requireDb();

    const [cronRun] = await database
      .insert(cronRuns)
      .values({
        jobType: "price_monitor",
        status: "running",
        startedAt: new Date(),
      })
      .returning();

    let productsProcessed = 0,
      productsUpdated = 0,
      changesDetected = 0,
      errors = 0;
    const changeDetails: PriceChange[] = [];

    try {
      const whereClause = userId
        ? and(
            eq(competitorProducts.isActive, true),
            eq(competitors.userId, userId)
          )
        : eq(competitorProducts.isActive, true);

      const activeMatches = await database
        .select({
          competitorProduct: competitorProducts,
          competitor: competitors,
          product: products,
        })
        .from(competitorProducts)
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .innerJoin(products, eq(competitorProducts.productId, products.id))
        .where(whereClause);

      logger.info(
        { count: activeMatches.length },
        "Starting price monitoring run"
      );

      for (const match of activeMatches) {
        const { competitorProduct, competitor, product } = match;
        const url = competitorProduct.competitorProductUrl;
        if (!url) {
          productsProcessed++;
          continue;
        }

        try {
          const pageData = await scrapePage(url);

          await database.insert(scrapeLogs).values({
            competitorId: competitor.id,
            competitorProductId: competitorProduct.id,
            cronRunId: cronRun.id,
            url,
            status: pageData ? "success" : "failed",
            method: pageData?.method ?? "firecrawl",
            responseTimeMs: pageData?.responseTimeMs,
            errorMessage: pageData ? null : "Failed to scrape",
            htmlSize: pageData?.content?.length,
          });

          if (!pageData) {
            productsProcessed++;
            continue;
          }

          const extractionResult = await aiExtractionService.extractAndValidate(
            {
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
              competitorPageContent: pageData.content,
              competitorUrl: url,
              competitorDomain: competitor.domain,
            }
          );

          const extracted = extractionResult.extraction;
          if (!extracted.isMatch || !extractionResult.passedThreshold) {
            productsProcessed++;
            continue;
          }

          const previousPrice = competitorProduct.price
            ? Number(competitorProduct.price)
            : null;
          const newPrice = extracted.price;
          const change = detectChanges(
            previousPrice,
            newPrice,
            "in_stock",
            "in_stock"
          );

          // Store snapshot
          await database.insert(priceSnapshots).values({
            competitorProductId: competitorProduct.id,
            price: String(newPrice ?? 0),
            currency: extracted.currency,
            salePrice:
              extracted.salePrice != null ? String(extracted.salePrice) : null,
            originalPrice:
              extracted.originalPrice != null
                ? String(extracted.originalPrice)
                : null,
            availability: "in_stock",
            scrapeMethod: pageData.method,
          });

          // Update competitor product
          if (previousPrice !== newPrice && newPrice != null) {
            await database
              .update(competitorProducts)
              .set({
                previousPrice: competitorProduct.price,
                price: String(newPrice),
                lastPriceUpdate: new Date(),
                lastScrapedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(competitorProducts.id, competitorProduct.id));
            productsUpdated++;
          }

          // Record change event
          if (change.changeType) {
            const [pc] = await database
              .insert(priceChanges)
              .values({
                competitorProductId: competitorProduct.id,
                productId: product.id,
                changeType: change.changeType,
                previousPrice:
                  previousPrice != null ? String(previousPrice) : null,
                newPrice: newPrice != null ? String(newPrice) : null,
                previousAvailability: "in_stock",
                newAvailability: "in_stock",
                priceDiff:
                  change.priceDiff != null ? String(change.priceDiff) : null,
                priceDiffPercent:
                  change.priceDiffPercent != null
                    ? String(change.priceDiffPercent)
                    : null,
                currency: extracted.currency,
              })
              .returning();
            changeDetails.push(pc);
            changesDetected++;

            const timelineEvent = generateTimelineEvent(
              product.title,
              competitor.name,
              change.changeType,
              previousPrice,
              newPrice,
              change.priceDiffPercent,
              extracted.currency
            );
            await database.insert(activityLogs).values({
              userId: competitor.userId,
              action: `price_change.${change.changeType}`,
              entityType: "price_change",
              entityId: pc.id,
              detail: timelineEvent,
              metadata: {
                productId: product.id,
                competitorId: competitor.id,
                previousPrice:
                  previousPrice != null ? String(previousPrice) : null,
                newPrice: newPrice != null ? String(newPrice) : null,
                confidence: extracted.confidence,
              },
            } as InsertActivityLog);

            // Create alert for significant changes
            if (
              change.priceDiffPercent !== null &&
              Math.abs(change.priceDiffPercent) >= 2
            ) {
              const alertType =
                change.changeType === "price_decrease"
                  ? "price_drop"
                  : "price_increase";
              const severity: "high" | "medium" =
                Math.abs(change.priceDiffPercent) >= 10 ? "high" : "medium";
              await database.insert(alerts).values({
                userId: competitor.userId,
                productId: product.id,
                competitorProductId: competitorProduct.id,
                alertType,
                severity,
                title: `${change.changeType === "price_decrease" ? "Price Drop" : "Price Increase"} Detected`,
                message: timelineEvent,
                triggerPrice: newPrice != null ? String(newPrice) : null,
                triggerCondition:
                  change.changeType === "price_decrease" ? "below" : "above",
              });

              notificationBroadcaster.broadcast({
                type: "alert_created",
                userId: competitor.userId,
                payload: {
                  alertType,
                  severity,
                  title: `${change.changeType === "price_decrease" ? "Price Drop" : "Price Increase"} Detected`,
                  message: timelineEvent,
                },
              });

              // G3 — Threshold alert: check user's notification preferences
              try {
                const prefs = await database
                  .select()
                  .from(notificationPreferences)
                  .where(eq(notificationPreferences.userId, competitor.userId))
                  .limit(1);
                if (prefs[0]) {
                  const thresholdPct =
                    change.changeType === "price_decrease"
                      ? Number(prefs[0].priceDropThreshold)
                      : Number(prefs[0].priceIncreaseThreshold);
                  if (
                    thresholdPct > 0 &&
                    Math.abs(change.priceDiffPercent) >= thresholdPct
                  ) {
                    await database.insert(alerts).values({
                      userId: competitor.userId,
                      productId: product.id,
                      competitorProductId: competitorProduct.id,
                      alertType: "threshold",
                      severity,
                      title: `Threshold ${change.changeType === "price_decrease" ? "Drop" : "Increase"} Exceeded`,
                      message: `${product.title} ${change.changeType === "price_decrease" ? "dropped" : "rose"} ${Math.abs(change.priceDiffPercent).toFixed(1)}% at ${competitor.name}, exceeding your ${thresholdPct}% threshold.`,
                      triggerPrice: newPrice != null ? String(newPrice) : null,
                      triggerCondition:
                        change.changeType === "price_decrease"
                          ? "below"
                          : "above",
                    });

                    notificationBroadcaster.broadcast({
                      type: "alert_created",
                      userId: competitor.userId,
                      payload: {
                        alertType: "threshold",
                        severity,
                        title: `Threshold ${change.changeType === "price_decrease" ? "Drop" : "Increase"} Exceeded`,
                        message: `${product.title} ${change.changeType === "price_decrease" ? "dropped" : "rose"} ${Math.abs(change.priceDiffPercent).toFixed(1)}% at ${competitor.name}, exceeding your ${thresholdPct}% threshold.`,
                      },
                    });
                  }
                }
              } catch {
                // non-critical
              }
            }

            // G2 — Regenerate recommendation for this product
            try {
              await recommendationService.generateForProduct(
                competitor.userId,
                product.id
              );
            } catch {
              // non-critical — recommendation may fail silently
            }
          }
          productsProcessed++;
        } catch (err) {
          errors++;
          productsProcessed++;
          logger.warn(
            { competitorProductId: competitorProduct.id, url, err },
            "Error processing competitor product"
          );
          await database.insert(scrapeLogs).values({
            competitorId: competitor.id,
            competitorProductId: competitorProduct.id,
            cronRunId: cronRun.id,
            url,
            status: "failed",
            errorMessage: String(err),
          });
        }
      }

      await database
        .update(cronRuns)
        .set({
          status:
            errors > 0 && productsUpdated === 0
              ? "failed"
              : errors > 0
                ? "partial"
                : "completed",
          completedAt: new Date(),
          productsProcessed,
          productsUpdated,
          changesDetected,
          errorsCount: errors,
        })
        .where(eq(cronRuns.id, cronRun.id));

      return {
        cronRunId: cronRun.id,
        productsProcessed,
        productsUpdated,
        changesDetected,
        errors,
        changeDetails,
      };
    } catch (err) {
      logger.error({ err }, "Price monitoring run failed");
      await database
        .update(cronRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
          productsProcessed,
          productsUpdated,
          changesDetected,
          errorsCount: errors + 1,
        })
        .where(eq(cronRuns.id, cronRun.id));
      throw err;
    }
  },

  async getChanges(
    userId: string,
    options?: {
      productId?: string;
      competitorId?: string;
      changeType?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<PriceChange[]> {
    const database = await requireDb();
    const conditions: any[] = [eq(competitors.userId, userId)];
    if (options?.productId)
      conditions.push(eq(priceChanges.productId, options.productId));
    if (options?.changeType)
      conditions.push(eq(priceChanges.changeType, options.changeType));
    if (options?.competitorId)
      conditions.push(
        eq(competitorProducts.competitorId, options.competitorId)
      );

    const results = await database
      .select({ change: priceChanges })
      .from(priceChanges)
      .innerJoin(
        competitorProducts,
        eq(priceChanges.competitorProductId, competitorProducts.id)
      )
      .innerJoin(
        competitors,
        eq(competitorProducts.competitorId, competitors.id)
      )
      .where(and(...conditions))
      .orderBy(desc(priceChanges.detectedAt))
      .limit(Math.min(options?.limit ?? 50, 200))
      .offset(options?.offset ?? 0);
    return results.map((r: any) => r.change);
  },

  async getTimeline(
    userId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const database = await requireDb();
    return database
      .select()
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.userId, userId),
          sql`${activityLogs.action} LIKE 'price_change.%'`
        )
      )
      .orderBy(desc(activityLogs.createdAt))
      .limit(Math.min(options?.limit ?? 50, 200))
      .offset(options?.offset ?? 0);
  },

  async getCronRuns(limit: number = 20) {
    const database = await requireDb();
    return database
      .select()
      .from(cronRuns)
      .orderBy(desc(cronRuns.startedAt))
      .limit(limit);
  },

  async getSnapshotHistory(competitorProductId: string, limit: number = 30) {
    const database = await requireDb();
    return database
      .select()
      .from(priceSnapshots)
      .where(eq(priceSnapshots.competitorProductId, competitorProductId))
      .orderBy(desc(priceSnapshots.scrapedAt))
      .limit(limit);
  },
};
