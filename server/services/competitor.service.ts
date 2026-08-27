import { AUTO_GENERATED_COMPETITOR_MATCH_METHOD } from "@shared/const";
import {
  eq,
  and,
  desc,
  sql,
  ilike,
  or,
  inArray,
  isNull,
  ne,
} from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import { TRPCError } from "@trpc/server";
import {
  competitors,
  competitorProducts,
  products,
  priceHistory,
  scrapeJobs,
  activityLogs,
  type Competitor,
  type InsertCompetitor,
  type CompetitorProduct,
  type InsertCompetitorProduct,
} from "../../drizzle/schema";

async function getMergedProductCounts(
  userId: string,
  competitorRows: Array<Pick<Competitor, "id" | "domain">>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (competitorRows.length === 0) return counts;

  const database = await requireDb();
  const competitorIds = competitorRows.map(competitor => competitor.id);
  // Only real competitor products now. The separate discovery feeds were
  // parallel discovery systems; they were removed and nothing writes to their
  // tables any more, so querying them only ever returned empty lists.
  const matchedProducts = await database
    .select({
      competitorId: competitorProducts.competitorId,
      competitorProductUrl: competitorProducts.competitorProductUrl,
    })
    .from(competitorProducts)
    .where(
      and(
        inArray(competitorProducts.competitorId, competitorIds),
        or(
          isNull(competitorProducts.matchMethod),
          ne(
            competitorProducts.matchMethod,
            AUTO_GENERATED_COMPETITOR_MATCH_METHOD
          )
        )
      )
    );

  const matchedByCompetitor = new Map<string, typeof matchedProducts>();
  for (const product of matchedProducts) {
    const rows = matchedByCompetitor.get(product.competitorId) ?? [];
    rows.push(product);
    matchedByCompetitor.set(product.competitorId, rows);
  }

  for (const competitor of competitorRows) {
    counts.set(
      competitor.id,
      (matchedByCompetitor.get(competitor.id) ?? []).length
    );
  }
  return counts;
}

/**
 * Synthetic competitor links were created by an older demo generator.
 * Keep manually linked and discovered competitors visible, but hide a
 * competitor whose active links are exclusively synthetic.
 */
async function filterSyntheticOnlyCompetitors<T extends Pick<Competitor, "id">>(
  userId: string,
  competitorRows: T[]
): Promise<T[]> {
  if (competitorRows.length === 0) return competitorRows;

  const database = await requireDb();
  const links = await database
    .select({
      competitorId: competitorProducts.competitorId,
      matchMethod: competitorProducts.matchMethod,
    })
    .from(competitorProducts)
    .innerJoin(products, eq(competitorProducts.productId, products.id))
    .where(
      and(
        eq(products.userId, userId),
        eq(products.isActive, true),
        eq(competitorProducts.isActive, true),
        inArray(
          competitorProducts.competitorId,
          competitorRows.map(row => row.id)
        )
      )
    );

  const syntheticIds = new Set<string>();
  const realLinkIds = new Set<string>();
  for (const link of links) {
    if (link.matchMethod === AUTO_GENERATED_COMPETITOR_MATCH_METHOD) {
      syntheticIds.add(link.competitorId);
    } else {
      realLinkIds.add(link.competitorId);
    }
  }

  return competitorRows.filter(
    row => !syntheticIds.has(row.id) || realLinkIds.has(row.id)
  );
}

export const competitorService = {
  async getByUserId(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<Competitor[]> {
    const database = await requireDb();
    const limit = Math.min(options?.limit ?? 50, 200);
    const offset = options?.offset ?? 0;
    const rows = await database
      .select()
      .from(competitors)
      .where(eq(competitors.userId, userId))
      .orderBy(desc(competitors.createdAt))
      .limit(limit)
      .offset(offset);
    const visibleRows = await filterSyntheticOnlyCompetitors(userId, rows);
    const counts = await getMergedProductCounts(userId, visibleRows);
    return visibleRows.map(competitor => ({
      ...competitor,
      productsTracked: counts.get(competitor.id) ?? competitor.productsTracked,
    }));
  },

  async countByUserId(userId: string): Promise<number> {
    const database = await requireDb();
    const rows = await database
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.userId, userId));
    const visibleRows = await filterSyntheticOnlyCompetitors(userId, rows);
    return visibleRows.length;
  },

  async getById(
    userId: string,
    competitorId: string
  ): Promise<Competitor | undefined> {
    const database = await requireDb();
    const result = await database
      .select()
      .from(competitors)
      .where(
        and(eq(competitors.id, competitorId), eq(competitors.userId, userId))
      )
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

  async update(
    userId: string,
    competitorId: string,
    data: Partial<InsertCompetitor>
  ): Promise<Competitor | undefined> {
    const database = await requireDb();
    const result = await database
      .update(competitors)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(eq(competitors.id, competitorId), eq(competitors.userId, userId))
      )
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
      .where(
        and(eq(competitors.id, competitorId), eq(competitors.userId, userId))
      );
  },

  async getProducts(userId: string, competitorId: string) {
    // Verify ownership
    const comp = await this.getById(userId, competitorId);
    if (!comp) return [];
    const database = await requireDb();
    const matchedProducts = await
      database
        .select()
        .from(competitorProducts)
        .where(
          and(
            eq(competitorProducts.competitorId, competitorId),
            or(
              isNull(competitorProducts.matchMethod),
              ne(
                competitorProducts.matchMethod,
                AUTO_GENERATED_COMPETITOR_MATCH_METHOD
              )
            )
          )
        )
        .orderBy(desc(competitorProducts.matchScore));


    return matchedProducts
      .map(product => ({ ...product, source: "matched" as const }))
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
      );
  },


  async addProduct(
    userId: string,
    data: InsertCompetitorProduct
  ): Promise<CompetitorProduct> {
    const database = await requireDb();
    const [ownedCompetitor] = await database
      .select({ id: competitors.id })
      .from(competitors)
      .where(
        and(
          eq(competitors.id, data.competitorId),
          eq(competitors.userId, userId)
        )
      )
      .limit(1);
    if (!ownedCompetitor) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Competitor not found",
      });
    }
    if (data.productId) {
      const [ownedProduct] = await database
        .select({ id: products.id })
        .from(products)
        .where(
          and(eq(products.id, data.productId), eq(products.userId, userId))
        )
        .limit(1);
      if (!ownedProduct) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }
    }
    const [existingLink] = await database
      .select({ id: competitorProducts.id })
      .from(competitorProducts)
      .where(
        and(
          eq(competitorProducts.competitorId, data.competitorId),
          eq(competitorProducts.productId, data.productId)
        )
      )
      .limit(1);
    if (existingLink) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This product is already linked to that competitor",
      });
    }
    const result = await database
      .insert(competitorProducts)
      .values(data)
      .returning();
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
    // Recalculate productsTracked
    if (data.competitorId) {
      await this.recalcTrackedCount(data.competitorId);
    }
    return result[0];
  },

  async removeProduct(
    userId: string,
    competitorProductId: string
  ): Promise<boolean> {
    const database = await requireDb();
    const cp = await database
      .select({
        id: competitorProducts.id,
        competitorId: competitorProducts.competitorId,
      })
      .from(competitorProducts)
      .where(eq(competitorProducts.id, competitorProductId))
      .limit(1);
    if (!cp[0]) return false;
    const comp = await this.getById(userId, cp[0].competitorId);
    if (!comp) return false;
    await database
      .delete(competitorProducts)
      .where(eq(competitorProducts.id, competitorProductId));
    await database.insert(activityLogs).values({
      userId,
      action: "competitor.product.removed",
      entityType: "competitor_product",
      entityId: competitorProductId,
      detail: `Removed product link from ${comp.name}`,
    });
    await this.recalcTrackedCount(cp[0].competitorId);
    return true;
  },

  async recalcTrackedCount(competitorId: string): Promise<void> {
    const database = await requireDb();
    const [{ count }] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(competitorProducts)
      .where(eq(competitorProducts.competitorId, competitorId));
    await database
      .update(competitors)
      .set({ productsTracked: count, updatedAt: new Date() })
      .where(eq(competitors.id, competitorId));
  },

  async updateProduct(
    userId: string,
    productId: string,
    data: Partial<InsertCompetitorProduct>
  ): Promise<CompetitorProduct | undefined> {
    const database = await requireDb();
    const [current] = await database
      .select({
        id: competitorProducts.id,
        competitorId: competitorProducts.competitorId,
        productId: competitorProducts.productId,
      })
      .from(competitorProducts)
      .innerJoin(
        competitors,
        eq(competitorProducts.competitorId, competitors.id)
      )
      .where(
        and(
          eq(competitorProducts.id, productId),
          eq(competitors.userId, userId)
        )
      )
      .limit(1);
    if (!current) return undefined;

    const productIds = [current.productId, data.productId].filter(
      (value): value is string => Boolean(value)
    );
    if (productIds.length > 0) {
      const ownedProducts = await database
        .select({ id: products.id })
        .from(products)
        .where(
          and(eq(products.userId, userId), inArray(products.id, productIds))
        );
      if (ownedProducts.length !== new Set(productIds).size) return undefined;
    }
    if (data.competitorId) {
      const [ownedCompetitor] = await database
        .select({ id: competitors.id })
        .from(competitors)
        .where(
          and(
            eq(competitors.id, data.competitorId),
            eq(competitors.userId, userId)
          )
        )
        .limit(1);
      if (!ownedCompetitor) return undefined;
    }
    const result = await database
      .update(competitorProducts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(competitorProducts.id, productId))
      .returning();
    if (
      result[0] &&
      data.competitorId &&
      data.competitorId !== current.competitorId
    ) {
      await this.recalcTrackedCount(current.competitorId);
      await this.recalcTrackedCount(data.competitorId);
    }
    return result[0];
  },

  async getStats(userId: string) {
    const database = await requireDb();
    const result = await database
      .select({
        id: competitors.id,
        domain: competitors.domain,
        status: competitors.status,
      })
      .from(competitors)
      .where(eq(competitors.userId, userId));
    const visibleRows = await filterSyntheticOnlyCompetitors(userId, result);
    const counts = await getMergedProductCounts(userId, visibleRows);

    const stats = {
      total: 0,
      active: 0,
      inactive: 0,
      error: 0,
      productsTracked: 0,
    };
    for (const row of visibleRows) {
      stats.total += 1;
      stats.productsTracked += counts.get(row.id) ?? 0;
      if (row.status === "active") stats.active += 1;
      if (row.status === "inactive") stats.inactive += 1;
      if (row.status === "error") stats.error += 1;
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

    const cpIdList = cpIds.map((c: { id: string }) => c.id);

    // Price history for this competitor's matched products
    const priceHistoryEntries =
      cpIdList.length > 0
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
      .where(
        and(
          eq(activityLogs.userId, userId),
          eq(activityLogs.entityType, "competitor"),
          eq(activityLogs.entityId, competitorId)
        )
      )
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
            ilike(competitors.domain, pattern)
          )
        )
      )
      .orderBy(desc(competitors.createdAt))
      .limit(5);
  },
};
