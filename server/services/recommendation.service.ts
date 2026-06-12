import { eq, and, desc, sql } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  recommendations,
  products,
  competitorProducts,
  type Recommendation,
  type InsertRecommendation,
} from "../../drizzle/schema";

export const recommendationService = {
  async getByUserId(userId: string, options?: { status?: string; limit?: number }): Promise<Recommendation[]> {
    const database = await requireDb();
    const conditions = [eq(recommendations.userId, userId)];
    if (options?.status) conditions.push(eq(recommendations.status, options.status as any));
    return database
      .select()
      .from(recommendations)
      .where(and(...conditions))
      .orderBy(desc(recommendations.createdAt))
      .limit(options?.limit ?? 100);
  },

  async getByProductId(userId: string, productId: string): Promise<Recommendation[]> {
    const database = await requireDb();
    return database
      .select()
      .from(recommendations)
      .where(and(eq(recommendations.productId, productId), eq(recommendations.userId, userId)))
      .orderBy(desc(recommendations.createdAt));
  },

  async getById(userId: string, recommendationId: string): Promise<Recommendation | undefined> {
    const database = await requireDb();
    const result = await database
      .select()
      .from(recommendations)
      .where(and(eq(recommendations.id, recommendationId), eq(recommendations.userId, userId)))
      .limit(1);
    return result[0];
  },

  async create(data: InsertRecommendation): Promise<Recommendation> {
    const database = await requireDb();
    const result = await database.insert(recommendations).values(data).returning();
    return result[0];
  },

  async implement(userId: string, recommendationId: string): Promise<Recommendation | undefined> {
    const database = await requireDb();

    const rec = await this.getById(userId, recommendationId);
    if (!rec) return undefined;

    const result = await database
      .update(recommendations)
      .set({ status: "implemented", implementedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(recommendations.id, recommendationId), eq(recommendations.userId, userId)))
      .returning();

    if (result[0]) {
      await database
        .update(products)
        .set({ price: result[0].recommendedPrice, updatedAt: new Date() })
        .where(and(eq(products.id, rec.productId), eq(products.userId, userId)));
    }

    return result[0];
  },

  async dismiss(userId: string, recommendationId: string): Promise<Recommendation | undefined> {
    const database = await requireDb();
    const result = await database
      .update(recommendations)
      .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(recommendations.id, recommendationId), eq(recommendations.userId, userId)))
      .returning();
    return result[0];
  },

  async generateForProduct(userId: string, productId: string): Promise<Recommendation | undefined> {
    const database = await requireDb();

    const product = await database
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1);

    if (product.length === 0) return undefined;

    const compPrices = await database
      .select({ price: competitorProducts.price })
      .from(competitorProducts)
      .where(and(eq(competitorProducts.productId, productId), eq(competitorProducts.isActive, true)));

    if (compPrices.length === 0) return undefined;

    const prices = compPrices.map((c) => Number(c.price));
    const avgCompetitorPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const minCompetitorPrice = Math.min(...prices);
    const currentPrice = Number(product[0].price);

    // Simple recommendation: price at 2% below average competitor price
    const recommendedPrice = Math.round(avgCompetitorPrice * 0.98 * 100) / 100;
    const priceChange = Math.round((recommendedPrice - currentPrice) * 100) / 100;
    const priceChangePercent = Math.round((priceChange / currentPrice) * 100 * 100) / 100;

    // Confidence based on number of competitor data points
    const confidenceScore = Math.min(0.5 + compPrices.length * 0.1, 0.95);

    const factors = {
      competitorCount: compPrices.length,
      avgCompetitorPrice,
      minCompetitorPrice,
      maxCompetitorPrice: Math.max(...prices),
      currentPrice,
    };

    return this.create({
      userId,
      productId,
      currentPrice: product[0].price,
      recommendedPrice: String(recommendedPrice),
      priceChange: String(priceChange),
      priceChangePercent: String(priceChangePercent),
      confidenceScore,
      reason: `Based on ${compPrices.length} competitor(s). Average competitor price is $${avgCompetitorPrice.toFixed(2)}. Recommended price is 2% below average to stay competitive.`,
      factors,
      status: "pending",
    });
  },

  async getStats(userId: string) {
    const database = await requireDb();
    const result = await database
      .select({
        status: recommendations.status,
        count: sql<number>`count(*)::int`,
        avgConfidence: sql<number>`coalesce(avg(${recommendations.confidenceScore}), 0)`,
        totalSavings: sql<number>`coalesce(sum(${recommendations.potentialSavings}), 0)`,
      })
      .from(recommendations)
      .where(eq(recommendations.userId, userId))
      .groupBy(recommendations.status);

    const stats = { total: 0, pending: 0, implemented: 0, dismissed: 0, avgConfidence: 0, totalSavings: 0 };
    for (const row of result) {
      stats.total += row.count;
      if (row.status === "pending") stats.pending = row.count;
      if (row.status === "implemented") stats.implemented = row.count;
      if (row.status === "dismissed") stats.dismissed = row.count;
      stats.avgConfidence = Math.max(stats.avgConfidence, row.avgConfidence);
      stats.totalSavings += row.totalSavings;
    }
    return stats;
  },
};
