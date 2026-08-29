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
  accountCompetitorConnections,
  competitorProducts,
  products,
  accountShopConnections,
  priceHistory,
  scrapeJobs,
  activityLogs,
  type Competitor,
  type InsertCompetitor,
  type CompetitorProduct,
  type InsertCompetitorProduct,
} from "../../drizzle/schema";
import { getOrCreateShop, normalizeShopDomain } from "./shop.service";

async function assertOwnedStore(userId: string, storeId?: string) {
  if (!storeId) return;
  const database = await requireDb();
  const [connection] = await database
    .select({ id: accountShopConnections.id })
    .from(accountShopConnections)
    .where(and(eq(accountShopConnections.id, storeId), eq(accountShopConnections.userId, userId), eq(accountShopConnections.isActive, true)))
    .limit(1);
  if (!connection) throw new TRPCError({ code: "FORBIDDEN", message: "Store not found" });
}

export async function findOrCreateCompetitor(
  userId: string,
  rawDomain: string,
  name: string,
  storeId?: string
): Promise<Competitor> {
  const database = await requireDb();
  await assertOwnedStore(userId, storeId);
  const domain = normalizeShopDomain(rawDomain);
  const shop = await getOrCreateShop(domain, { database });
  const [existing] = await database
    .select()
    .from(competitors)
    .where(eq(competitors.shopId, shop.id))
    .limit(1);
  if (existing) {
    await database
      .insert(accountCompetitorConnections)
      .values({ userId, competitorId: existing.id, isActive: true })
      .onConflictDoUpdate({
        target: [
          accountCompetitorConnections.userId,
          accountCompetitorConnections.competitorId,
        ],
        set: { isActive: true, updatedAt: new Date() },
      });
    return existing;
  }
  await database
    .insert(competitors)
    .values({
      shopId: shop.id,
      name: name.trim() || domain,
      domain,
      status: "active",
    })
    .onConflictDoNothing({ target: competitors.shopId });
  const [created] = await database
    .select()
    .from(competitors)
    .where(eq(competitors.shopId, shop.id))
    .limit(1);
  if (!created) throw new Error("Failed to create competitor");
  await database
    .insert(accountCompetitorConnections)
    .values({ userId, competitorId: created.id, isActive: true })
    .onConflictDoUpdate({
      target: [
        accountCompetitorConnections.userId,
        accountCompetitorConnections.competitorId,
      ],
      set: { isActive: true, updatedAt: new Date() },
    });
  return created;
}

/**
 * How a competitor's prices compare with the merchant's own, measured from the
 * matches themselves.
 *
 * `price_index` and `avg_price_diff` exist as columns but nothing has ever
 * written to them past the row's creation, so every competitor read back as
 * "+0.0%" — a number that looked measured and was not. Deriving it here means
 * the figure is always as current as the matches behind it.
 */
async function getPriceComparison(
  userId: string,
  competitorIds: string[],
  storeId?: string
): Promise<
  Map<
    string,
    { priceIndex: string; avgPriceDiff: string; lastScrapedAt: Date | null }
  >
> {
  const comparison = new Map<
    string,
    { priceIndex: string; avgPriceDiff: string; lastScrapedAt: Date | null }
  >();
  if (competitorIds.length === 0) return comparison;

  const database = await requireDb();
  const pairs = await database
    .select({
      competitorId: competitorProducts.competitorId,
      theirPrice: competitorProducts.price,
      ourPrice: products.price,
      scrapedAt: competitorProducts.lastScrapedAt,
    })
    .from(competitorProducts)
    .innerJoin(products, eq(products.id, competitorProducts.productId))
      .where(
      and(
        inArray(competitorProducts.competitorId, competitorIds),
        eq(competitorProducts.isActive, true),
        eq(products.userId, userId),
        storeId ? eq(products.storeId, storeId) : undefined
      )
    );

  const ratios = new Map<string, number[]>();
  // `competitors.last_scraped_at` is never written either, so "Never" showed
  // beside prices we had just read. The matches carry the real timestamp.
  const seenAt = new Map<string, Date>();
  for (const pair of pairs) {
    if (pair.scrapedAt) {
      const previous = seenAt.get(pair.competitorId);
      if (!previous || pair.scrapedAt > previous) {
        seenAt.set(pair.competitorId, pair.scrapedAt);
      }
    }
    const ours = Number(pair.ourPrice);
    const theirs = Number(pair.theirPrice);
    if (!(ours > 0) || !(theirs > 0)) continue;
    const list = ratios.get(pair.competitorId) ?? [];
    list.push(theirs / ours);
    ratios.set(pair.competitorId, list);
  }

  for (const [competitorId, list] of Array.from(ratios.entries())) {
    const mean =
      list.reduce((sum: number, r: number) => sum + r, 0) / list.length;
    comparison.set(competitorId, {
      priceIndex: (mean * 100).toFixed(2),
      avgPriceDiff: ((mean - 1) * 100).toFixed(2),
      lastScrapedAt: seenAt.get(competitorId) ?? null,
    });
  }
  return comparison;
}

async function getMergedProductCounts(
  userId: string,
  competitorRows: Array<Pick<Competitor, "id" | "domain">>,
  storeId?: string
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
    .innerJoin(products, eq(products.id, competitorProducts.productId))
    .where(
      and(
        inArray(competitorProducts.competitorId, competitorIds),
        eq(products.userId, userId),
        storeId ? eq(products.storeId, storeId) : undefined,
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
  competitorRows: T[],
  storeId?: string
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
        storeId ? eq(products.storeId, storeId) : undefined,
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
    options?: { limit?: number; offset?: number; storeId?: string }
  ): Promise<Competitor[]> {
    const database = await requireDb();
    await assertOwnedStore(userId, options?.storeId);
    const limit = Math.min(options?.limit ?? 50, 200);
    const offset = options?.offset ?? 0;
    const rows = await database
      .select()
      .from(competitors)
      .where(
        and(
          inArray(competitors.id, database.select({ id: accountCompetitorConnections.competitorId }).from(accountCompetitorConnections).where(and(eq(accountCompetitorConnections.userId, userId), eq(accountCompetitorConnections.isActive, true)))),
          options?.storeId
            ? inArray(
                competitors.id,
                database
                  .select({ id: competitorProducts.competitorId })
                  .from(competitorProducts)
                  .innerJoin(products, eq(competitorProducts.productId, products.id))
                  .where(eq(products.storeId, options.storeId))
              )
            : undefined
        )
      )
      .orderBy(desc(competitors.createdAt))
      .limit(limit)
      .offset(offset);
    const visibleRows = await filterSyntheticOnlyCompetitors(userId, rows, options?.storeId);
    const counts = await getMergedProductCounts(userId, visibleRows, options?.storeId);
    const comparison = await getPriceComparison(userId, visibleRows.map(r => r.id), options?.storeId);
    return visibleRows.map(competitor => {
      const measured = comparison.get(competitor.id);
      return {
        ...competitor,
        productsTracked: counts.get(competitor.id) ?? competitor.productsTracked,
        priceIndex: measured?.priceIndex ?? null,
        avgPriceDiff: measured?.avgPriceDiff ?? null,
        lastScrapedAt: measured?.lastScrapedAt ?? competitor.lastScrapedAt,
      };
    });
  },

  async countByUserId(userId: string, storeId?: string): Promise<number> {
    const database = await requireDb();
    await assertOwnedStore(userId, storeId);
    const rows = await database
      .select({ id: competitors.id })
      .from(competitors)
      .where(
        and(
          inArray(competitors.id, database.select({ id: accountCompetitorConnections.competitorId }).from(accountCompetitorConnections).where(and(eq(accountCompetitorConnections.userId, userId), eq(accountCompetitorConnections.isActive, true)))),
          storeId
            ? inArray(
                competitors.id,
                database
                  .select({ id: competitorProducts.competitorId })
                  .from(competitorProducts)
                  .innerJoin(products, eq(competitorProducts.productId, products.id))
                  .where(eq(products.storeId, storeId))
              )
            : undefined
        )
      );
    const visibleRows = await filterSyntheticOnlyCompetitors(userId, rows, storeId);
    return visibleRows.length;
  },

  async getById(
    userId: string,
    competitorId: string,
    storeId?: string
  ): Promise<Competitor | undefined> {
    const database = await requireDb();
    await assertOwnedStore(userId, storeId);
    const result = await database
      .select()
      .from(competitors)
      .where(
        and(
          eq(competitors.id, competitorId),
          inArray(competitors.id, database.select({ id: accountCompetitorConnections.competitorId }).from(accountCompetitorConnections).where(and(eq(accountCompetitorConnections.userId, userId), eq(accountCompetitorConnections.isActive, true)))),
          storeId
            ? inArray(
                competitors.id,
                database
                  .select({ id: competitorProducts.competitorId })
                  .from(competitorProducts)
                  .innerJoin(products, eq(competitorProducts.productId, products.id))
                  .where(eq(products.storeId, storeId))
              )
            : undefined
        )
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
    data: Partial<InsertCompetitor>,
    storeId?: string
  ): Promise<Competitor | undefined> {
    const database = await requireDb();
    await assertOwnedStore(userId, storeId);
    const result = await database
      .update(competitors)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(competitors.id, competitorId),
          inArray(
            competitors.id,
            database
              .select({ id: accountCompetitorConnections.competitorId })
              .from(accountCompetitorConnections)
              .where(
                and(
                  eq(accountCompetitorConnections.userId, userId),
                  eq(accountCompetitorConnections.isActive, true)
                )
              )
          )
        )
      )
      .returning();
    return result[0];
  },

  async delete(userId: string, competitorId: string, storeId?: string): Promise<void> {
    const database = await requireDb();
    await assertOwnedStore(userId, storeId);
    const competitor = await this.getById(userId, competitorId, storeId);
    if (!competitor) return;
    // Removing a competitor is account-specific. The canonical competitor and
    // its shop remain available to other accounts.
    await database
      .update(accountCompetitorConnections)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(accountCompetitorConnections.userId, userId),
          eq(accountCompetitorConnections.competitorId, competitorId)
        )
      );
    await database.insert(activityLogs).values({
      userId,
      action: "competitor.deleted",
      entityType: "competitor",
      entityId: competitorId,
      detail: `Disconnected competitor ${competitor.name}`,
    });
  },

  async getProducts(userId: string, competitorId: string, storeId?: string) {
    // Verify ownership
    const comp = await this.getById(userId, competitorId, storeId);
    if (!comp) return [];
    const database = await requireDb();
    const matchedProducts = await database
        .select({ cp: competitorProducts })
        .from(competitorProducts)
        .innerJoin(products, eq(competitorProducts.productId, products.id))
        .where(
          and(
            eq(competitorProducts.competitorId, competitorId),
            eq(products.userId, userId),
            storeId ? eq(products.storeId, storeId) : undefined,
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
      .map(({ cp }) => ({ ...cp, source: "matched" as const }))
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime()
      );
  },


  async addProduct(
    userId: string,
    data: InsertCompetitorProduct & { storeId?: string }
  ): Promise<CompetitorProduct> {
    const database = await requireDb();
    const { storeId, ...linkData } = data;
    await assertOwnedStore(userId, storeId);
    const [ownedCompetitor] = await database
      .select({ id: competitors.id })
      .from(competitors)
      .where(
        and(
          eq(competitors.id, data.competitorId),
          inArray(
            competitors.id,
            database
              .select({ id: accountCompetitorConnections.competitorId })
              .from(accountCompetitorConnections)
              .where(
                and(
                  eq(accountCompetitorConnections.userId, userId),
                  eq(accountCompetitorConnections.isActive, true)
                )
              )
          )
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
          and(
            eq(products.id, data.productId),
            eq(products.userId, userId),
            storeId ? eq(products.storeId, storeId) : undefined
          )
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
      .values(linkData)
      .returning();
    // Record initial price in price history
    if (data.productId) {
      await database.insert(priceHistory).values({
        productId: data.productId,
        competitorProductId: result[0].id,
        price: linkData.price,
        currency: linkData.currency ?? "USD",
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
    competitorProductId: string,
    storeId?: string
  ): Promise<boolean> {
    const database = await requireDb();
    const cp = await database
      .select({
        id: competitorProducts.id,
        competitorId: competitorProducts.competitorId,
        productId: competitorProducts.productId,
      })
      .from(competitorProducts)
      .where(eq(competitorProducts.id, competitorProductId))
      .limit(1);
    if (!cp[0]) return false;
    const comp = await this.getById(userId, cp[0].competitorId, storeId);
    if (!comp) return false;
    const [ownedProduct] = await database
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.id, cp[0].productId),
          eq(products.userId, userId),
          storeId ? eq(products.storeId, storeId) : undefined
        )
      )
      .limit(1);
    if (!ownedProduct) return false;
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
    data: Partial<InsertCompetitorProduct> & { storeId?: string }
  ): Promise<CompetitorProduct | undefined> {
    const database = await requireDb();
    const { storeId, ...linkData } = data;
    await assertOwnedStore(userId, storeId);
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
          inArray(
            competitors.id,
            database
              .select({ id: accountCompetitorConnections.competitorId })
              .from(accountCompetitorConnections)
              .where(
                and(
                  eq(accountCompetitorConnections.userId, userId),
                  eq(accountCompetitorConnections.isActive, true)
                )
              )
          ),
          storeId
            ? inArray(
                competitorProducts.productId,
                database
                  .select({ id: products.id })
                  .from(products)
                  .where(
                    and(eq(products.userId, userId), eq(products.storeId, storeId))
                  )
              )
            : undefined
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
          and(
            eq(products.userId, userId),
            inArray(products.id, productIds),
            storeId ? eq(products.storeId, storeId) : undefined
          )
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
            inArray(
              competitors.id,
              database
                .select({ id: accountCompetitorConnections.competitorId })
                .from(accountCompetitorConnections)
                .where(
                  and(
                    eq(accountCompetitorConnections.userId, userId),
                    eq(accountCompetitorConnections.isActive, true)
                  )
                )
            )
          )
        )
        .limit(1);
      if (!ownedCompetitor) return undefined;
    }
    const result = await database
      .update(competitorProducts)
      .set({ ...linkData, updatedAt: new Date() })
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

  async getStats(userId: string, storeId?: string) {
    const database = await requireDb();
    await assertOwnedStore(userId, storeId);
    const result = await database
      .select({
        id: competitors.id,
        domain: competitors.domain,
        status: competitors.status,
      })
      .from(competitors)
      .where(
        and(
          inArray(
            competitors.id,
            database
              .select({ id: accountCompetitorConnections.competitorId })
              .from(accountCompetitorConnections)
              .where(
                and(
                  eq(accountCompetitorConnections.userId, userId),
                  eq(accountCompetitorConnections.isActive, true)
                )
              )
          ),
          storeId
            ? inArray(
                competitors.id,
                database
                  .select({ id: competitorProducts.competitorId })
                  .from(competitorProducts)
                  .innerJoin(products, eq(competitorProducts.productId, products.id))
                  .where(eq(products.storeId, storeId))
              )
            : undefined
        )
      );
    const visibleRows = await filterSyntheticOnlyCompetitors(userId, result, storeId);
    const counts = await getMergedProductCounts(userId, visibleRows, storeId);

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

  async getFeed(userId: string, competitorId: string, limit: number = 50, storeId?: string) {
    // Verify ownership
    const comp = await this.getById(userId, competitorId, storeId);
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
    const products = await this.getProducts(userId, competitorId, storeId);

    return {
      priceHistory: priceHistoryEntries,
      scrapeJobs: scrapeEntries,
      activityLog: activityEntries,
      products,
    };
  },

  async search(userId: string, query: string, storeId?: string): Promise<Competitor[]> {
    const database = await requireDb();
    await assertOwnedStore(userId, storeId);
    const pattern = `%${query}%`;
    return database
      .select()
      .from(competitors)
      .where(
        and(
          inArray(
            competitors.id,
            database
              .select({ id: accountCompetitorConnections.competitorId })
              .from(accountCompetitorConnections)
              .where(
                and(
                  eq(accountCompetitorConnections.userId, userId),
                  eq(accountCompetitorConnections.isActive, true)
                )
              )
          ),
          storeId
            ? inArray(
                competitors.id,
                database
                  .select({ id: competitorProducts.competitorId })
                  .from(competitorProducts)
                  .innerJoin(products, eq(competitorProducts.productId, products.id))
                  .where(eq(products.storeId, storeId))
              )
            : undefined,
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
