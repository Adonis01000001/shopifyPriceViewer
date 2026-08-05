import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  priceHistory,
  products,
  type PriceHistory,
  type InsertPriceHistory,
} from "../../drizzle/schema";

export const priceService = {
  async getHistory(
    userId: string,
    productId: string,
    options?: { fromDate?: Date; toDate?: Date; limit?: number }
  ): Promise<PriceHistory[]> {
    const database = await requireDb();

    // Verify ownership
    const product = await database
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1);

    if (product.length === 0) return [];

    const conditions = [eq(priceHistory.productId, productId)];
    if (options?.fromDate)
      conditions.push(gte(priceHistory.recordedAt, options.fromDate));
    if (options?.toDate)
      conditions.push(lte(priceHistory.recordedAt, options.toDate));

    return database
      .select()
      .from(priceHistory)
      .where(and(...conditions))
      .orderBy(desc(priceHistory.recordedAt))
      .limit(options?.limit ?? 100);
  },

  async getPriceSummary(userId: string, productId: string) {
    const database = await requireDb();

    const product = await database
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1);

    if (product.length === 0) return null;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const stats = await database
      .select({
        min: sql<number>`min(${priceHistory.price})`,
        max: sql<number>`max(${priceHistory.price})`,
        avg: sql<number>`avg(${priceHistory.price})`,
        count: sql<number>`count(*)::int`,
      })
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.productId, productId),
          gte(priceHistory.recordedAt, thirtyDaysAgo)
        )
      )
      .limit(1);

    const latest = await database
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.productId, productId))
      .orderBy(desc(priceHistory.recordedAt))
      .limit(1);

    return {
      product: product[0],
      currentPrice: product[0].price,
      minPrice: stats[0]?.min ?? 0,
      maxPrice: stats[0]?.max ?? 0,
      avgPrice: stats[0]?.avg ?? 0,
      dataPoints: stats[0]?.count ?? 0,
      latestRecordedAt: latest[0]?.recordedAt ?? null,
    };
  },

  async recordPrice(
    userId: string,
    data: InsertPriceHistory
  ): Promise<PriceHistory> {
    const database = await requireDb();
    const ownedProduct = await database
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, data.productId), eq(products.userId, userId)))
      .limit(1);
    if (ownedProduct.length === 0) {
      throw new Error("Product not found");
    }
    const result = await database.insert(priceHistory).values(data).returning();
    return result[0];
  },

  async bulkRecord(items: InsertPriceHistory[]): Promise<number> {
    if (items.length === 0) return 0;
    const database = await requireDb();
    const result = await database
      .insert(priceHistory)
      .values(items)
      .returning();
    return result.length;
  },

  async getTrendData(userId: string, productId: string, months: number = 12) {
    const database = await requireDb();

    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);

    const ownedProduct = await database
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1);
    if (ownedProduct.length === 0) return [];

    return database
      .select({
        date: sql<string>`date_trunc('month', ${priceHistory.recordedAt})`,
        avgPrice: sql<number>`avg(${priceHistory.price})`,
        minPrice: sql<number>`min(${priceHistory.price})`,
        maxPrice: sql<number>`max(${priceHistory.price})`,
      })
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.productId, productId),
          gte(priceHistory.recordedAt, fromDate)
        )
      )
      .groupBy(sql`date_trunc('month', ${priceHistory.recordedAt})`)
      .orderBy(sql`date_trunc('month', ${priceHistory.recordedAt})`);
  },
};
