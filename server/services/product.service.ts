import { eq, and, desc, sql, ilike, or } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  products,
  productEmbeddings,
  shopifyStores,
  competitorProducts,
  type Product,
  type InsertProduct,
  type CompetitorProduct,
} from "../../drizzle/schema";

export const productService = {
  async getByUserId(userId: string, options?: { limit?: number; offset?: number }): Promise<Product[]> {
    const database = await requireDb();
    const limit = Math.min(options?.limit ?? 500, 1000);
    const offset = options?.offset ?? 0;
    return database
      .select()
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.isActive, true)))
      .orderBy(desc(products.updatedAt))
      .limit(limit)
      .offset(offset);
  },

  async countByUserId(userId: string): Promise<number> {
    const database = await requireDb();
    const result = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.isActive, true)));
    return result[0]?.count ?? 0;
  },

  async getByStoreId(userId: string, storeId: string): Promise<Product[]> {
    const database = await requireDb();
    return database
      .select()
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.storeId, storeId), eq(products.isActive, true)))
      .orderBy(desc(products.updatedAt));
  },

  async getById(userId: string, productId: string): Promise<Product | undefined> {
    const database = await requireDb();
    const result = await database
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1);
    return result[0];
  },

  async create(data: InsertProduct): Promise<Product> {
    const database = await requireDb();
    const result = await database.insert(products).values(data).returning();
    return result[0];
  },

  async update(userId: string, productId: string, data: Partial<InsertProduct>): Promise<Product | undefined> {
    const database = await requireDb();
    const result = await database
      .update(products)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .returning();
    return result[0];
  },

  async delete(userId: string, productId: string): Promise<void> {
    const database = await requireDb();
    await database
      .update(products)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(products.id, productId), eq(products.userId, userId)));
  },

  async toggleTracking(userId: string, productId: string, isTracked: boolean): Promise<Product | undefined> {
    return this.update(userId, productId, { isTracked });
  },

  async getCompetitorPrices(productId: string): Promise<CompetitorProduct[]> {
    const database = await requireDb();
    return database
      .select()
      .from(competitorProducts)
      .where(and(eq(competitorProducts.productId, productId), eq(competitorProducts.isActive, true)));
  },

  async getStats(userId: string) {
    const database = await requireDb();
    const result = await database
      .select({
        status: products.status,
        count: sql<number>`count(*)::int`,
        avgPrice: sql<number>`coalesce(avg(${products.price}), 0)`,
      })
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.isActive, true)))
      .groupBy(products.status);

    const stats = { total: 0, optimal: 0, underpriced: 0, overpriced: 0, alert: 0, avgPrice: 0 };
    let sumPriceTimesCount = 0;
    for (const row of result) {
      stats.total += row.count;
      sumPriceTimesCount += Number(row.avgPrice) * row.count;
      if (row.status === "optimal") stats.optimal = row.count;
      if (row.status === "underpriced") stats.underpriced = row.count;
      if (row.status === "overpriced") stats.overpriced = row.count;
      if (row.status === "alert") stats.alert = row.count;
    }
    if (stats.total > 0) {
      stats.avgPrice = Math.round((sumPriceTimesCount / stats.total) * 100) / 100;
    }
    return stats;
  },

  async getStores(userId: string) {
    const database = await requireDb();
    return database
      .select()
      .from(shopifyStores)
      .where(and(eq(shopifyStores.userId, userId), eq(shopifyStores.isActive, true)));
  },

  async upsertStore(data: typeof shopifyStores.$inferInsert) {
    const database = await requireDb();
    const result = await database
      .insert(shopifyStores)
      .values(data)
      .onConflictDoUpdate({
        target: shopifyStores.shopDomain,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return result[0];
  },

  async bulkUpsertProducts(items: InsertProduct[]): Promise<number> {
    if (items.length === 0) return 0;
    const database = await requireDb();
    const result = await database
      .insert(products)
      .values(items)
      .onConflictDoUpdate({
        target: products.shopifyProductId,
        set: {
          title: sql`excluded.title`,
          price: sql`excluded.price`,
          compareAtPrice: sql`excluded.compare_at_price`,
          imageUrl: sql`excluded.image_url`,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return result.length;
  },

  async search(userId: string, query: string): Promise<Product[]> {
    const database = await requireDb();
    const pattern = `%${query}%`;
    return database
      .select()
      .from(products)
      .where(
        and(
          eq(products.userId, userId),
          eq(products.isActive, true),
          or(
            ilike(products.title, pattern),
            ilike(products.sku, pattern),
            ilike(products.category, pattern),
          ),
        ),
      )
      .orderBy(desc(products.updatedAt))
      .limit(10);
  },
};
