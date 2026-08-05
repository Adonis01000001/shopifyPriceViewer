import { eq, and, desc, sql, ilike, or, inArray } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import { TRPCError } from "@trpc/server";
import {
  competitors,
  competitorProducts,
  products,
  priceHistory,
  scrapeJobs,
  activityLogs,
  priceRadarProducts,
  priceRadarSources,
  scoopCompetitorProducts,
  scoopSearches,
  scoopSearchResults,
  type Competitor,
  type InsertCompetitor,
  type CompetitorProduct,
  type InsertCompetitorProduct,
} from "../../drizzle/schema";
import {
  countMergedCompetitorProducts,
  getVisibleRadarProducts,
} from "./competitor-product-count";

async function getMergedProductCounts(
  userId: string,
  competitorRows: Array<Pick<Competitor, "id" | "domain">>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (competitorRows.length === 0) return counts;

  const database = await requireDb();
  const competitorIds = competitorRows.map(competitor => competitor.id);
  const [matchedProducts, radarProducts, scoopProducts] = await Promise.all([
    database
      .select({
        competitorId: competitorProducts.competitorId,
        competitorProductUrl: competitorProducts.competitorProductUrl,
      })
      .from(competitorProducts)
      .where(inArray(competitorProducts.competitorId, competitorIds)),
    database
      .select({
        name: priceRadarProducts.name,
        productUrl: priceRadarProducts.productUrl,
        structuredMetadata: priceRadarProducts.structuredMetadata,
        sourceCompetitorId: priceRadarSources.competitorId,
        sourceDomain: priceRadarSources.domain,
      })
      .from(priceRadarProducts)
      .innerJoin(
        priceRadarSources,
        eq(priceRadarProducts.sourceId, priceRadarSources.id)
      )
      .where(
        and(
          eq(priceRadarProducts.userId, userId),
          eq(priceRadarProducts.isActive, true)
        )
      ),
    database
      .select({
        competitorId: scoopCompetitorProducts.competitorId,
        productUrl: scoopCompetitorProducts.productUrl,
      })
      .from(scoopCompetitorProducts)
      .where(
        and(
          eq(scoopCompetitorProducts.userId, userId),
          eq(scoopCompetitorProducts.isActive, true),
          inArray(scoopCompetitorProducts.competitorId, competitorIds)
        )
      ),
  ]);

  const matchedByCompetitor = new Map<string, typeof matchedProducts>();
  for (const product of matchedProducts) {
    const rows = matchedByCompetitor.get(product.competitorId) ?? [];
    rows.push(product);
    matchedByCompetitor.set(product.competitorId, rows);
  }

  const scoopUrlsByCompetitor = new Map<string, Set<string>>();
  for (const product of scoopProducts) {
    const urls = scoopUrlsByCompetitor.get(product.competitorId) ?? new Set();
    urls.add(product.productUrl);
    scoopUrlsByCompetitor.set(product.competitorId, urls);
  }

  for (const competitor of competitorRows) {
    counts.set(
      competitor.id,
      countMergedCompetitorProducts(
        competitor,
        matchedByCompetitor.get(competitor.id) ?? [],
        radarProducts
      ) + (scoopUrlsByCompetitor.get(competitor.id)?.size ?? 0)
    );
  }
  return counts;
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
    const counts = await getMergedProductCounts(userId, rows);
    return rows.map(competitor => ({
      ...competitor,
      productsTracked: counts.get(competitor.id) ?? competitor.productsTracked,
    }));
  },

  async countByUserId(userId: string): Promise<number> {
    const database = await requireDb();
    const result = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(competitors)
      .where(eq(competitors.userId, userId));
    return result[0]?.count ?? 0;
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
    const [matchedProducts, radarProducts, scoopProducts] = await Promise.all([
      database
        .select()
        .from(competitorProducts)
        .where(eq(competitorProducts.competitorId, competitorId))
        .orderBy(desc(competitorProducts.matchScore)),
      database
        .select({
          id: priceRadarProducts.id,
          name: priceRadarProducts.name,
          price: priceRadarProducts.price,
          currency: priceRadarProducts.currency,
          previousPrice: priceRadarProducts.previousPrice,
          productUrl: priceRadarProducts.productUrl,
          sku: priceRadarProducts.sku,
          extractionConfidence: priceRadarProducts.extractionConfidence,
          structuredMetadata: priceRadarProducts.structuredMetadata,
          firstSeenAt: priceRadarProducts.firstSeenAt,
          lastSeenAt: priceRadarProducts.lastSeenAt,
          sourceCompetitorId: priceRadarSources.competitorId,
          sourceDomain: priceRadarSources.domain,
        })
        .from(priceRadarProducts)
        .innerJoin(
          priceRadarSources,
          eq(priceRadarProducts.sourceId, priceRadarSources.id)
        )
        .where(
          and(
            eq(priceRadarProducts.userId, userId),
            eq(priceRadarProducts.isActive, true)
          )
        )
        .orderBy(desc(priceRadarProducts.lastSeenAt)),
      database
        .select()
        .from(scoopCompetitorProducts)
        .where(
          and(
            eq(scoopCompetitorProducts.competitorId, competitorId),
            eq(scoopCompetitorProducts.userId, userId),
            eq(scoopCompetitorProducts.isActive, true)
          )
        )
        .orderBy(desc(scoopCompetitorProducts.lastSeenAt)),
    ]);

    const radarRows = getVisibleRadarProducts(
      comp,
      matchedProducts,
      radarProducts
    ).map(({ product, displayName }) => ({
      id: `price-radar:${product.id}`,
      competitorId,
      productId: null,
      competitorProductUrl: product.productUrl,
      competitorProductTitle: displayName,
      competitorSku: product.sku,
      price: product.price,
      currency: product.currency ?? "USD",
      matchScore: product.extractionConfidence,
      matchMethod: "price-radar",
      isVerified: false,
      isActive: true,
      previousPrice: product.previousPrice,
      lastPriceUpdate: product.lastSeenAt,
      lastScrapedAt: product.lastSeenAt,
      createdAt: product.firstSeenAt,
      updatedAt: product.lastSeenAt,
      source: "price-radar" as const,
    }));

    const scoopRows = scoopProducts.map(product => ({
      id: `scoop:${product.id}`,
      competitorId,
      productId: null,
      competitorProductUrl: product.productUrl,
      competitorProductTitle: product.productName,
      competitorSku: null,
      price: product.price,
      currency: product.currency ?? "USD",
      matchScore: product.confidenceScore,
      matchMethod: "scoop",
      isVerified: false,
      isActive: product.isActive,
      previousPrice: null,
      lastPriceUpdate: product.lastSeenAt,
      lastScrapedAt: product.lastSeenAt,
      createdAt: product.firstSeenAt,
      updatedAt: product.lastSeenAt,
      source: "scoop" as const,
      imageUrl: product.imageUrl,
      rating: product.rating,
      reviewCount: product.reviewCount,
      marketplace: product.marketplace,
      seller: product.seller,
      searchTimestamp: product.lastSeenAt,
    }));

    return [
      ...matchedProducts.map(product => ({
        ...product,
        source: "matched" as const,
      })),
      ...radarRows,
      ...scoopRows,
    ].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
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
    return result[0];
  },

  async moveScoopProduct(
    userId: string,
    scoopProductId: string,
    targetCompetitorId: string
  ): Promise<
    | {
        productId: string;
        productName: string;
        targetCompetitorId: string;
        merged: boolean;
      }
    | undefined
  > {
    const database = await requireDb();
    return database.transaction(async tx => {
      const [source] = await tx
        .select()
        .from(scoopCompetitorProducts)
        .where(
          and(
            eq(scoopCompetitorProducts.id, scoopProductId),
            eq(scoopCompetitorProducts.userId, userId)
          )
        )
        .limit(1);
      if (!source) return undefined;

      const [target] = await tx
        .select({ id: competitors.id, name: competitors.name })
        .from(competitors)
        .where(
          and(
            eq(competitors.id, targetCompetitorId),
            eq(competitors.userId, userId)
          )
        )
        .limit(1);
      if (!target) return undefined;

      if (source.competitorId === target.id) {
        return {
          productId: source.id,
          productName: source.productName,
          targetCompetitorId: target.id,
          merged: false,
        };
      }

      const [existing] = await tx
        .select()
        .from(scoopCompetitorProducts)
        .where(
          and(
            eq(scoopCompetitorProducts.competitorId, target.id),
            eq(scoopCompetitorProducts.userId, userId),
            eq(scoopCompetitorProducts.productUrl, source.productUrl)
          )
        )
        .limit(1);

      if (existing) {
        const sourceIsNewer = source.lastSeenAt >= existing.lastSeenAt;
        const latest = sourceIsNewer ? source : existing;
        const firstSeenAt =
          source.firstSeenAt < existing.firstSeenAt
            ? source.firstSeenAt
            : existing.firstSeenAt;

        await tx
          .update(scoopCompetitorProducts)
          .set({
            productName: latest.productName,
            brand: latest.brand,
            model: latest.model,
            imageUrl: latest.imageUrl,
            price: latest.price,
            currency: latest.currency,
            rating: latest.rating,
            reviewCount: latest.reviewCount,
            availability: latest.availability,
            seller: latest.seller,
            condition: latest.condition,
            shipping: latest.shipping,
            marketplace: latest.marketplace,
            firstSeenAt,
            lastSeenAt: latest.lastSeenAt,
            latestSearchId: latest.latestSearchId,
            confidenceScore: latest.confidenceScore,
            extractionMethod: latest.extractionMethod,
            discoveredBy: latest.discoveredBy,
            isActive: latest.isActive,
          })
          .where(eq(scoopCompetitorProducts.id, existing.id));
        await tx
          .delete(scoopCompetitorProducts)
          .where(eq(scoopCompetitorProducts.id, source.id));
      } else {
        await tx
          .update(scoopCompetitorProducts)
          .set({ competitorId: target.id })
          .where(eq(scoopCompetitorProducts.id, source.id));
      }

      // Keep historical Scoop rows attached to the destination competitor.
      await tx
        .update(scoopSearchResults)
        .set({ competitorId: target.id })
        .where(
          and(
            eq(scoopSearchResults.userId, userId),
            eq(scoopSearchResults.competitorId, source.competitorId),
            eq(scoopSearchResults.productUrl, source.productUrl)
          )
        );

      const now = new Date();
      await tx
        .update(competitors)
        .set({ updatedAt: now })
        .where(
          and(
            eq(competitors.userId, userId),
            inArray(competitors.id, [source.competitorId, target.id])
          )
        );
      await tx.insert(activityLogs).values({
        userId,
        action: "competitor.product.moved",
        entityType: "competitor",
        entityId: source.competitorId,
        detail: `Moved ${source.productName} to ${target.name}`,
      });

      return {
        productId: source.id,
        productName: source.productName,
        targetCompetitorId: target.id,
        merged: Boolean(existing),
      };
    });
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
    const counts = await getMergedProductCounts(userId, result);

    const stats = {
      total: 0,
      active: 0,
      inactive: 0,
      error: 0,
      productsTracked: 0,
    };
    for (const row of result) {
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

    const scoopSearchEntries = await database
      .select({
        id: scoopSearches.id,
        query: scoopSearches.query,
        status: scoopSearches.status,
        summary: scoopSearches.summary,
        retrievedAt: scoopSearches.retrievedAt,
      })
      .from(scoopSearches)
      .innerJoin(
        scoopSearchResults,
        eq(scoopSearchResults.searchId, scoopSearches.id)
      )
      .where(
        and(
          eq(scoopSearches.userId, userId),
          eq(scoopSearchResults.competitorId, competitorId)
        )
      )
      .orderBy(desc(scoopSearches.retrievedAt))
      .limit(limit * 5);
    const scoopSearchHistory = Array.from(
      new Map(scoopSearchEntries.map(entry => [entry.id, entry])).values()
    ).slice(0, limit);

    const scoopProductHistory = await database
      .select({
        id: scoopSearchResults.id,
        searchId: scoopSearchResults.searchId,
        productName: scoopSearchResults.productName,
        productUrl: scoopSearchResults.productUrl,
        price: scoopSearchResults.price,
        currency: scoopSearchResults.currency,
        rating: scoopSearchResults.rating,
        reviewCount: scoopSearchResults.reviewCount,
        marketplace: scoopSearchResults.marketplace,
        retrievedAt: scoopSearchResults.retrievedAt,
      })
      .from(scoopSearchResults)
      .where(
        and(
          eq(scoopSearchResults.userId, userId),
          eq(scoopSearchResults.competitorId, competitorId)
        )
      )
      .orderBy(desc(scoopSearchResults.retrievedAt))
      .limit(limit * 5);

    // Competitor's matched products with current prices
    const products = await this.getProducts(userId, competitorId);

    return {
      priceHistory: priceHistoryEntries,
      scrapeJobs: scrapeEntries,
      activityLog: activityEntries,
      scoopSearchHistory,
      scoopProductHistory,
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
