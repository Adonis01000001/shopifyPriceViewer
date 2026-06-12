import { eq, and, desc, sql, ilike, or, inArray } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  competitors,
  competitorProducts,
  priceHistory,
  scrapeJobs,
  activityLogs,
  type Competitor,
  type InsertCompetitor,
  type CompetitorProduct,
  type InsertCompetitorProduct,
} from "../../drizzle/schema";

export const competitorService = {
  async getByUserId(userId: string, options?: { limit?: number; offset?: number }): Promise<Competitor[]> {
    const database = await requireDb();
    const limit = Math.min(options?.limit ?? 50, 200);
    const offset = options?.offset ?? 0;
    return database
      .select()
      .from(competitors)
      .where(eq(competitors.userId, userId))
      .orderBy(desc(competitors.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async countByUserId(userId: string): Promise<number> {
    const database = await requireDb();
    const result = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(competitors)
      .where(eq(competitors.userId, userId));
    return result[0]?.count ?? 0;
  },

  async getById(userId: string, competitorId: string): Promise<Competitor | undefined> {
    const database = await requireDb();
    const result = await database
      .select()
      .from(competitors)
      .where(and(eq(competitors.id, competitorId), eq(competitors.userId, userId)))
      .limit(1);
    return result[0];
  },

  async create(data: InsertCompetitor): Promise<Competitor> {
    const database = await requireDb();
    const result = await database.insert(competitors).values(data).returning();
    return result[0];
  },

  async bulkCreate(data: InsertCompetitor[]): Promise<Competitor[]> {
    if (data.length === 0) return [];
    const database = await requireDb();
    const result = await database.insert(competitors).values(data).returning();
    return result;
  },

  async update(userId: string, competitorId: string, data: Partial<InsertCompetitor>): Promise<Competitor | undefined> {
    const database = await requireDb();
    const result = await database
      .update(competitors)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(competitors.id, competitorId), eq(competitors.userId, userId)))
      .returning();
    return result[0];
  },

  async delete(userId: string, competitorId: string): Promise<void> {
    const database = await requireDb();
    // Log the deletion before removing
    await database.insert(activityLogs).values({
      userId,
      action: "competitor.deleted",
      entityType: "competitor",
      entityId: competitorId,
      detail: `Deleted competitor`,
    });
    // Hard delete — cascades to competitorProducts via FK
    await database
      .delete(competitors)
      .where(and(eq(competitors.id, competitorId), eq(competitors.userId, userId)));
  },

  async getProducts(userId: string, competitorId: string): Promise<CompetitorProduct[]> {
    // Verify ownership
    const comp = await this.getById(userId, competitorId);
    if (!comp) return [];
    const database = await requireDb();
    return database
      .select()
      .from(competitorProducts)
      .where(eq(competitorProducts.competitorId, competitorId))
      .orderBy(desc(competitorProducts.matchScore));
  },

  async addProduct(data: InsertCompetitorProduct): Promise<CompetitorProduct> {
    const database = await requireDb();
    const result = await database.insert(competitorProducts).values(data).returning();
    // Record initial price in price history
    if (data.productId) {
      await database.insert(priceHistory).values({
        productId: data.productId,
        competitorProductId: result[0].id,
        price: data.price,
        currency: data.currency ?? "USD",
        source: "manual",
      });
    }
    return result[0];
  },

  async removeProduct(userId: string, competitorProductId: string): Promise<boolean> {
    const database = await requireDb();
    const cp = await database
      .select({ id: competitorProducts.id, competitorId: competitorProducts.competitorId })
      .from(competitorProducts)
      .where(eq(competitorProducts.id, competitorProductId))
      .limit(1);
    if (!cp[0]) return false;
    const comp = await this.getById(userId, cp[0].competitorId);
    if (!comp) return false;
    await database.delete(competitorProducts)
      .where(eq(competitorProducts.id, competitorProductId));
    await database.insert(activityLogs).values({
      userId,
      action: "competitor.product.removed",
      entityType: "competitor_product",
      entityId: competitorProductId,
      detail: `Removed product link from ${comp.name}`,
    });
    return true;
  },

  async updateProduct(userId: string, productId: string, data: Partial<InsertCompetitorProduct>): Promise<CompetitorProduct | undefined> {
    const database = await requireDb();
    const result = await database
      .update(competitorProducts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(competitorProducts.id, productId))
      .returning();
    return result[0];
  },

  async getStats(userId: string) {
    const database = await requireDb();
    const result = await database
      .select({
        status: competitors.status,
        count: sql<number>`count(*)::int`,
        productsTracked: sql<number>`coalesce(sum(${competitors.productsTracked}), 0)::int`,
      })
      .from(competitors)
      .where(eq(competitors.userId, userId))
      .groupBy(competitors.status);

    const stats = { total: 0, active: 0, inactive: 0, error: 0, productsTracked: 0 };
    for (const row of result) {
      stats.total += row.count;
      stats.productsTracked += row.productsTracked;
      if (row.status === "active") stats.active = row.count;
      if (row.status === "inactive") stats.inactive = row.count;
      if (row.status === "error") stats.error = row.count;
    }
    return stats;
  },

  async getFeed(userId: string, competitorId: string, limit: number = 50) {
    // Verify ownership
    const comp = await this.getById(userId, competitorId);
    if (!comp) return null;
    const database = await requireDb();

    // Get all competitor product IDs for this competitor
    const cpIds = await database
      .select({ id: competitorProducts.id })
      .from(competitorProducts)
      .where(eq(competitorProducts.competitorId, competitorId));

    const cpIdList = cpIds.map(c => c.id);

    // Price history for this competitor's matched products
    const priceHistoryEntries = cpIdList.length > 0
      ? await database
          .select()
          .from(priceHistory)
          .where(inArray(priceHistory.competitorProductId, cpIdList))
          .orderBy(desc(priceHistory.recordedAt))
          .limit(limit)
      : [];

    // Scrape jobs for this competitor
    const scrapeEntries = await database
      .select()
      .from(scrapeJobs)
      .where(eq(scrapeJobs.competitorId, competitorId))
      .orderBy(desc(scrapeJobs.createdAt))
      .limit(limit);

    // Activity log entries for this competitor
    const activityEntries = await database
      .select()
      .from(activityLogs)
      .where(and(
        eq(activityLogs.userId, userId),
        eq(activityLogs.entityType, "competitor"),
        eq(activityLogs.entityId, competitorId),
      ))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);

    // Competitor's matched products with current prices
    const products = await this.getProducts(userId, competitorId);

    return {
      priceHistory: priceHistoryEntries,
      scrapeJobs: scrapeEntries,
      activityLog: activityEntries,
      products,
    };
  },

  async search(userId: string, query: string): Promise<Competitor[]> {
    const database = await requireDb();
    const pattern = `%${query}%`;
    return database
      .select()
      .from(competitors)
      .where(
        and(
          eq(competitors.userId, userId),
          or(
            ilike(competitors.name, pattern),
            ilike(competitors.domain, pattern),
          ),
        ),
      )
      .orderBy(desc(competitors.createdAt))
      .limit(5);
  },
};
