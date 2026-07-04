import { eq, and, desc, sql, ilike, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
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
import { normalizeName } from "../../shared/validation";

export const productService = {
  async getByUserId(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<Product[]> {
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
      .where(
        and(
          eq(products.userId, userId),
          eq(products.storeId, storeId),
          eq(products.isActive, true)
        )
      )
      .orderBy(desc(products.updatedAt));
  },

  async getById(
    userId: string,
    productId: string
  ): Promise<Product | undefined> {
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

    // Normalize SKU (trim/uppercase) — empty becomes undefined.
    const normalizedSku = this.normalizeSku(data.sku);

    // Duplicate detection: SKU path
    if (normalizedSku) {
      const existing = await this.findBySku(data.userId, normalizedSku);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have an active product with SKU "${normalizedSku}"`,
        });
      }
    } else {
      // Duplicate detection: name path (only when no SKU)
      const existing = await this.findByName(data.userId, data.title);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have an active product named "${data.title.trim()}"`,
        });
      }
    }

    const result = await database
      .insert(products)
      .values({ ...data, sku: normalizedSku })
      .returning();
    return result[0];
  },

  async update(
    userId: string,
    productId: string,
    data: Partial<InsertProduct>
  ): Promise<Product | undefined> {
    const database = await requireDb();

    // Normalize SKU if provided.
    const normalizedSku = data.sku !== undefined ? this.normalizeSku(data.sku) : undefined;

    // Duplicate SKU check (exclude current product).
    if (normalizedSku) {
      const existing = await this.findBySku(userId, normalizedSku);
      if (existing && existing.id !== productId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have an active product with SKU "${normalizedSku}"`,
        });
      }
    }

    // Duplicate name check: only when SKU is being cleared AND name is changing.
    if (data.sku !== undefined && !normalizedSku && data.title) {
      const existing = await this.findByName(userId, data.title);
      if (existing && existing.id !== productId) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have an active product named "${data.title.trim()}"`,
        });
      }
    }

    const updateData: Partial<InsertProduct> = { ...data, updatedAt: new Date() as any };
    if (data.sku !== undefined) {
      updateData.sku = normalizedSku;
    }

    const result = await database
      .update(products)
      .set(updateData)
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

  async toggleTracking(
    userId: string,
    productId: string,
    isTracked: boolean
  ): Promise<Product | undefined> {
    return this.update(userId, productId, { isTracked });
  },

  async getCompetitorPrices(productId: string): Promise<CompetitorProduct[]> {
    const database = await requireDb();
    return database
      .select()
      .from(competitorProducts)
      .where(
        and(
          eq(competitorProducts.productId, productId),
          eq(competitorProducts.isActive, true)
        )
      );
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

    const stats = {
      total: 0,
      optimal: 0,
      underpriced: 0,
      overpriced: 0,
      alert: 0,
      avgPrice: 0,
    };
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
      stats.avgPrice =
        Math.round((sumPriceTimesCount / stats.total) * 100) / 100;
    }
    return stats;
  },

  async getStores(userId: string) {
    const database = await requireDb();
    return database
      .select()
      .from(shopifyStores)
      .where(
        and(eq(shopifyStores.userId, userId), eq(shopifyStores.isActive, true))
      );
  },

  // ── SKU helpers ────────────────────────────────────────────────────────────

  /**
   * Normalize a SKU: trim whitespace, uppercase, return undefined if empty.
   */
  normalizeSku(sku?: string | null): string | undefined {
    if (!sku) return undefined;
    const normalized = sku.trim().toUpperCase();
    return normalized.length > 0 ? normalized : undefined;
  },

  /**
   * Find an active product by SKU for a specific user.
   * Returns the first match or undefined.
   */
  async findBySku(
    userId: string,
    sku: string
  ): Promise<Product | undefined> {
    const database = await requireDb();
    const result = await database
      .select()
      .from(products)
      .where(
        and(
          eq(products.userId, userId),
          eq(products.sku, sku),
          eq(products.isActive, true)
        )
      )
      .limit(1);
    return result[0];
  },

  /**
   * Find an active product by normalized name for a specific user.
   * Used for duplicate-name detection when SKU is empty.
   */
  async findByName(
    userId: string,
    name: string
  ): Promise<Product | undefined> {
    const database = await requireDb();
    const normalized = normalizeName(name);
    // Use ILIKE on a trimmed lowercase version. We compare against a
    // normalized expression: lower(trim(title)).
    const result = await database
      .select()
      .from(products)
      .where(
        and(
          eq(products.userId, userId),
          eq(products.isActive, true),
          sql`lower(trim(${products.title})) = ${normalized}`
        )
      )
      .limit(1);
    return result[0];
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
        target: [products.userId, products.shopifyProductId],
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
    const normalizedQuery = query.trim().toUpperCase();

    // Search SKU, title, and category. Prioritize exact SKU match first,
    // then SKU prefix, then name/category. Use a ranking column for ordering.
    return database
      .select({
        id: products.id,
        userId: products.userId,
        storeId: products.storeId,
        shopifyProductId: products.shopifyProductId,
        shopifyVariantId: products.shopifyVariantId,
        title: products.title,
        description: products.description,
        sku: products.sku,
        barcode: products.barcode,
        vendor: products.vendor,
        productType: products.productType,
        category: products.category,
        tags: products.tags,
        price: products.price,
        compareAtPrice: products.compareAtPrice,
        costPrice: products.costPrice,
        currency: products.currency,
        imageUrl: products.imageUrl,
        status: products.status,
        isTracked: products.isTracked,
        isActive: products.isActive,
        lastSyncedAt: products.lastSyncedAt,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        rank: sql<number>`CASE
          WHEN ${products.sku} = ${normalizedQuery} THEN 0
          WHEN ${products.sku} LIKE ${normalizedQuery + "%"} THEN 1
          ELSE 2
        END`,
      })
      .from(products)
      .where(
        and(
          eq(products.userId, userId),
          eq(products.isActive, true),
          or(
            ilike(products.title, pattern),
            ilike(products.sku, pattern),
            ilike(products.category, pattern)
          )
        )
      )
      .orderBy(sql`rank ASC, ${products.updatedAt} DESC`)
      .limit(10);
  },
};
