import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  alerts,
  competitorProducts,
  competitors,
  priceChanges,
  products,
  recommendations,
  accountShopConnections,
} from "../../drizzle/schema";

export type ActionCenter = {
  generatedAt: Date;
  pendingRecommendations: Array<{
    id: string;
    productId: string;
    productTitle: string;
    currentPrice: string;
    recommendedPrice: string;
    priceChange: string;
    priceChangePercent: string;
    confidenceScore: number;
    reason: string;
    createdAt: Date;
  }>;
  unreadAlerts: Array<{
    id: string;
    productId: string;
    productTitle: string;
    alertType: string;
    severity: string;
    title: string;
    message: string;
    triggerPrice: string | null;
    createdAt: Date;
  }>;
  recentChanges: Array<{
    id: string;
    productId: string;
    productTitle: string;
    competitorName: string;
    changeType: string;
    previousPrice: string | null;
    newPrice: string | null;
    priceDiffPercent: string | null;
    detectedAt: Date;
  }>;
  totals: {
    pendingRecommendations: number;
    unreadAlerts: number;
    changesLast24Hours: number;
  };
};

async function countRows(
  query: Promise<Array<{ count: number | string }>>
): Promise<number> {
  const result = await query;
  return Number(result[0]?.count ?? 0);
}

export const actionCenterService = {
  async getForUser(userId: string, storeId?: string): Promise<ActionCenter> {
    const database = await requireDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    if (storeId) {
      const [connection] = await database
        .select({ id: accountShopConnections.id })
        .from(accountShopConnections)
        .where(
          and(
            eq(accountShopConnections.id, storeId),
            eq(accountShopConnections.userId, userId),
            eq(accountShopConnections.isActive, true)
          )
        )
        .limit(1);
      if (!connection) {
        return {
          generatedAt: new Date(),
          pendingRecommendations: [],
          unreadAlerts: [],
          recentChanges: [],
          totals: {
            pendingRecommendations: 0,
            unreadAlerts: 0,
            changesLast24Hours: 0,
          },
        };
      }
    }

    const [
      pendingRecommendations,
      unreadAlerts,
      recentChanges,
      pendingRecommendationCount,
      unreadAlertCount,
      changesLast24Hours,
    ] = await Promise.all([
      database
        .select({
          id: recommendations.id,
          productId: recommendations.productId,
          productTitle: products.title,
          currentPrice: recommendations.currentPrice,
          recommendedPrice: recommendations.recommendedPrice,
          priceChange: recommendations.priceChange,
          priceChangePercent: recommendations.priceChangePercent,
          confidenceScore: recommendations.confidenceScore,
          reason: recommendations.reason,
          createdAt: recommendations.createdAt,
        })
        .from(recommendations)
        .innerJoin(products, eq(recommendations.productId, products.id))
        .where(
          and(
            eq(recommendations.userId, userId),
            eq(recommendations.status, "pending"),
            eq(products.isActive, true),
            storeId ? eq(products.storeId, storeId) : undefined
          )
        )
        .orderBy(
          desc(recommendations.confidenceScore),
          desc(recommendations.createdAt)
        )
        .limit(6),
      database
        .select({
          id: alerts.id,
          productId: alerts.productId,
          productTitle: products.title,
          alertType: alerts.alertType,
          severity: alerts.severity,
          title: alerts.title,
          message: alerts.message,
          triggerPrice: alerts.triggerPrice,
          createdAt: alerts.createdAt,
        })
        .from(alerts)
        .innerJoin(products, eq(alerts.productId, products.id))
        .where(
          and(
            eq(alerts.userId, userId),
            eq(alerts.isRead, false),
            eq(alerts.isResolved, false),
            storeId ? eq(products.storeId, storeId) : undefined
          )
        )
        .orderBy(desc(alerts.createdAt))
        .limit(6),
      database
        .select({
          id: priceChanges.id,
          productId: priceChanges.productId,
          productTitle: products.title,
          competitorName: competitors.name,
          changeType: priceChanges.changeType,
          previousPrice: priceChanges.previousPrice,
          newPrice: priceChanges.newPrice,
          priceDiffPercent: priceChanges.priceDiffPercent,
          detectedAt: priceChanges.detectedAt,
        })
        .from(priceChanges)
        .innerJoin(products, eq(priceChanges.productId, products.id))
        .innerJoin(
          competitorProducts,
          eq(priceChanges.competitorProductId, competitorProducts.id)
        )
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .where(
          and(
            eq(products.userId, userId),
            storeId ? eq(products.storeId, storeId) : undefined
          )
        )
        .orderBy(desc(priceChanges.detectedAt))
        .limit(12),
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(recommendations)
          .where(
            and(
              eq(recommendations.userId, userId),
              eq(recommendations.status, "pending"),
              storeId
                ? inArray(
                    recommendations.productId,
                    database
                      .select({ id: products.id })
                      .from(products)
                      .where(eq(products.storeId, storeId))
                  )
                : undefined
            )
          )
      ),
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(alerts)
          .where(
            and(
              eq(alerts.userId, userId),
              eq(alerts.isRead, false),
              eq(alerts.isResolved, false),
              storeId
                ? inArray(
                    alerts.productId,
                    database
                      .select({ id: products.id })
                      .from(products)
                      .where(eq(products.storeId, storeId))
                  )
                : undefined
            )
          )
      ),
      countRows(
        database
          .select({ count: sql<number>`count(*)::int` })
          .from(priceChanges)
          .innerJoin(
            competitorProducts,
            eq(priceChanges.competitorProductId, competitorProducts.id)
          )
          .innerJoin(
            competitors,
            eq(competitorProducts.competitorId, competitors.id)
          )
          .innerJoin(products, eq(priceChanges.productId, products.id))
          .where(
            and(
              eq(products.userId, userId),
              gte(priceChanges.detectedAt, since),
              storeId ? eq(products.storeId, storeId) : undefined
            )
          )
      ),
    ]);

    return {
      generatedAt: new Date(),
      pendingRecommendations,
      unreadAlerts,
      recentChanges,
      totals: {
        pendingRecommendations: pendingRecommendationCount,
        unreadAlerts: unreadAlertCount,
        changesLast24Hours,
      },
    };
  },
};
