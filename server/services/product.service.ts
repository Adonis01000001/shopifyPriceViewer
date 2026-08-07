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
import { TRPCError } from "@trpc/server";
import { requireDb } from "../_core/db-assert";
import {
  products,
  productEmbeddings,
  shopifyStores,
  competitors,
  competitorProducts,
  competitorProductDismissals,
  priceRadarProducts,
  priceRadarSources,
  scoopCompetitorProducts,
  type Product,
  type InsertProduct,
  type CompetitorProduct,
} from "../../drizzle/schema";
import { normalizeName } from "../../shared/validation";
import { publicShopifyStoreColumns } from "../_core/public-views";
import { getVisibleRadarProducts } from "./competitor-product-count";
import { normalizeCompetitorDomain } from "./price-radar/url-policy";

function validateProductTitle(title: string | undefined): void {
  if (title !== undefined && title.trim().length < 2) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Product title must be at least 2 characters",
    });
  }
}

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
    validateProductTitle(data.title);
    const storeId = data.storeId;
    if (!storeId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Store not found",
      });
    }
    const [ownedStore] = await database
      .select({ id: shopifyStores.id })
      .from(shopifyStores)
      .where(
        and(
          eq(shopifyStores.id, storeId),
          eq(shopifyStores.userId, data.userId)
        )
      )
      .limit(1);
    if (!ownedStore) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Store not found",
      });
    }

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
    validateProductTitle(data.title);

    // Normalize SKU if provided.
    const normalizedSku =
      data.sku !== undefined ? this.normalizeSku(data.sku) : undefined;

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

    const updateData: Partial<InsertProduct> = {
      ...data,
      updatedAt: new Date() as any,
    };
    if (data.sku !== undefined) {
      updateData.sku = normalizedSku ?? null;
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

  async getCompetitorPrices(
    userId: string,
    productId: string
  ): Promise<CompetitorProduct[]> {
    const database = await requireDb();
    const [ownedProduct] = await database
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .limit(1);
    if (!ownedProduct) return [];
    return database
      .select()
      .from(competitorProducts)
      .where(
        and(
          eq(competitorProducts.productId, productId),
          inArray(
            competitorProducts.competitorId,
            database
              .select({ id: competitors.id })
              .from(competitors)
              .where(eq(competitors.userId, userId))
          ),
          eq(competitorProducts.isActive, true),
          or(
            isNull(competitorProducts.matchMethod),
            ne(
              competitorProducts.matchMethod,
              AUTO_GENERATED_COMPETITOR_MATCH_METHOD
            )
          )
        )
      );
  },

  async getCompetitorPricesForUser(userId: string) {
    const database = await requireDb();
    const [
      matchedRows,
      catalogProducts,
      competitorRows,
      radarRows,
      scoopRows,
      dismissals,
    ] = await Promise.all([
      database
        .select({
          id: competitorProducts.id,
          productId: competitorProducts.productId,
          competitorId: competitorProducts.competitorId,
          competitorName: competitors.name,
          competitorDomain: competitors.domain,
          title: competitorProducts.competitorProductTitle,
          sku: competitorProducts.competitorSku,
          price: competitorProducts.price,
          currency: competitorProducts.currency,
          url: competitorProducts.competitorProductUrl,
          matchScore: competitorProducts.matchScore,
          sourceType: competitorProducts.sourceType,
          sourceProductId: competitorProducts.sourceProductId,
          isVerified: competitorProducts.isVerified,
          lastPriceUpdate: competitorProducts.lastPriceUpdate,
          lastScrapedAt: competitorProducts.lastScrapedAt,
          updatedAt: competitorProducts.updatedAt,
        })
        .from(competitorProducts)
        .innerJoin(products, eq(competitorProducts.productId, products.id))
        .innerJoin(
          competitors,
          eq(competitorProducts.competitorId, competitors.id)
        )
        .where(
          and(
            eq(products.userId, userId),
            eq(products.isActive, true),
            eq(competitors.userId, userId),
            eq(competitorProducts.isActive, true),
            or(
              isNull(competitorProducts.matchMethod),
              ne(
                competitorProducts.matchMethod,
                AUTO_GENERATED_COMPETITOR_MATCH_METHOD
              )
            )
          )
        ),
      database
        .select({ id: products.id, title: products.title })
        .from(products)
        .where(and(eq(products.userId, userId), eq(products.isActive, true))),
      database
        .select({
          id: competitors.id,
          name: competitors.name,
          domain: competitors.domain,
        })
        .from(competitors)
        .where(eq(competitors.userId, userId)),
      database
        .select({
          sourceProductId: priceRadarProducts.id,
          sourceCompetitorId: priceRadarSources.competitorId,
          sourceDomain: priceRadarSources.domain,
          title: priceRadarProducts.name,
          sku: priceRadarProducts.sku,
          price: priceRadarProducts.price,
          currency: priceRadarProducts.currency,
          url: priceRadarProducts.productUrl,
          matchScore: priceRadarProducts.extractionConfidence,
          lastPriceUpdate: priceRadarProducts.lastSeenAt,
          lastScrapedAt: priceRadarProducts.lastSeenAt,
          updatedAt: priceRadarProducts.updatedAt,
          structuredMetadata: priceRadarProducts.structuredMetadata,
        })
        .from(priceRadarProducts)
        .innerJoin(
          priceRadarSources,
          eq(priceRadarProducts.sourceId, priceRadarSources.id)
        )
        .where(
          and(
            eq(priceRadarProducts.userId, userId),
            eq(priceRadarProducts.isActive, true),
            eq(priceRadarSources.userId, userId),
            eq(priceRadarSources.isActive, true)
          )
        ),
      database
        .select({
          sourceProductId: scoopCompetitorProducts.id,
          competitorId: scoopCompetitorProducts.competitorId,
          competitorName: competitors.name,
          competitorDomain: competitors.domain,
          title: scoopCompetitorProducts.productName,
          sku: sql<string | null>`null`,
          price: scoopCompetitorProducts.price,
          currency: scoopCompetitorProducts.currency,
          url: scoopCompetitorProducts.productUrl,
          matchScore: scoopCompetitorProducts.confidenceScore,
          lastPriceUpdate: scoopCompetitorProducts.lastSeenAt,
          lastScrapedAt: scoopCompetitorProducts.lastSeenAt,
          updatedAt: scoopCompetitorProducts.lastSeenAt,
        })
        .from(scoopCompetitorProducts)
        .innerJoin(
          competitors,
          eq(scoopCompetitorProducts.competitorId, competitors.id)
        )
        .where(
          and(
            eq(scoopCompetitorProducts.userId, userId),
            eq(scoopCompetitorProducts.isActive, true),
            eq(competitors.userId, userId)
          )
        ),
      database
        .select({
          productId: competitorProductDismissals.productId,
          competitorId: competitorProductDismissals.competitorId,
          sourceType: competitorProductDismissals.sourceType,
          sourceProductId: competitorProductDismissals.sourceProductId,
        })
        .from(competitorProductDismissals)
        .where(eq(competitorProductDismissals.userId, userId)),
    ]);

    const dismissedKeys = new Set(
      dismissals.map(dismissal =>
        [
          dismissal.productId,
          dismissal.competitorId,
          dismissal.sourceType,
          dismissal.sourceProductId,
        ].join(":")
      )
    );
    const productsByName = new Map<string, Array<{ id: string }>>();
    for (const product of catalogProducts) {
      const normalizedTitle = normalizeName(product.title);
      if (!normalizedTitle) continue;
      const matches = productsByName.get(normalizedTitle) ?? [];
      matches.push({ id: product.id });
      productsByName.set(normalizedTitle, matches);
    }

    const linkedUrls = new Set(
      matchedRows
        .filter(row => row.url)
        .map(row => `${row.competitorId}:${row.url}`)
    );
    const matchedPairs = new Set(
      matchedRows.map(row => `${row.productId}:${row.competitorId}`)
    );
    const automaticPairKeys = new Set<string>();
    const radarCandidates = radarRows.flatMap(row => {
      const matchingCompetitors = competitorRows.filter(
        competitor =>
          row.sourceCompetitorId === competitor.id ||
          normalizeCompetitorDomain(row.sourceDomain) ===
            normalizeCompetitorDomain(competitor.domain)
      );

      return matchingCompetitors.flatMap(competitor => {
        const visibleProduct = getVisibleRadarProducts(
          competitor,
          matchedRows
            .filter(matchedRow => matchedRow.competitorId === competitor.id)
            .map(matchedRow => ({
              competitorProductUrl: matchedRow.url,
            })),
          [
            {
              name: row.title,
              productUrl: row.url,
              sourceCompetitorId: row.sourceCompetitorId,
              sourceDomain: row.sourceDomain,
              structuredMetadata: row.structuredMetadata,
            },
          ]
        )[0];
        if (!visibleProduct) return [];

        return [
          {
            ...row,
            competitorId: competitor.id,
            competitorName: competitor.name,
            competitorDomain: competitor.domain,
            title: visibleProduct.displayName,
            source: "price-radar" as const,
          },
        ];
      });
    });
    const automaticMappings = [
      ...radarCandidates,
      ...scoopRows.map(row => ({ ...row, source: "scoop" as const })),
    ].flatMap(candidate => {
      const candidatePrice = candidate.price;
      if (
        !candidate.competitorId ||
        !candidate.title ||
        !candidatePrice ||
        !candidate.url
      ) {
        return [];
      }
      if (linkedUrls.has(`${candidate.competitorId}:${candidate.url}`)) {
        return [];
      }

      const matchingProducts =
        productsByName.get(normalizeName(candidate.title)) ?? [];
      return matchingProducts.flatMap(product => {
        const pairKey = `${product.id}:${candidate.competitorId}`;
        if (matchedPairs.has(pairKey) || automaticPairKeys.has(pairKey)) {
          return [];
        }
        const dismissalKey = [
          product.id,
          candidate.competitorId,
          candidate.source,
          candidate.sourceProductId,
        ].join(":");
        if (dismissedKeys.has(dismissalKey)) return [];
        automaticPairKeys.add(pairKey);

        return [
          {
            id: `auto:${candidate.source}:${candidate.sourceProductId}:${product.id}`,
            productId: product.id,
            competitorId: candidate.competitorId,
            competitorName: candidate.competitorName,
            competitorDomain: candidate.competitorDomain,
            title: candidate.title,
            sku: candidate.sku,
            price: candidatePrice,
            currency: candidate.currency,
            url: candidate.url,
            matchScore: 1,
            isVerified: false,
            lastPriceUpdate: candidate.lastPriceUpdate,
            lastScrapedAt: candidate.lastScrapedAt,
            updatedAt: candidate.updatedAt,
            source: candidate.source,
            sourceProductId: candidate.sourceProductId,
            isAutomatic: true,
          },
        ];
      });
    });

    if (automaticMappings.length > 0) {
      await database
        .insert(competitorProducts)
        .values(
          automaticMappings.map(mapping => ({
            competitorId: mapping.competitorId,
            productId: mapping.productId,
            competitorProductUrl: mapping.url,
            competitorProductTitle: mapping.title,
            competitorSku: mapping.sku,
            price: mapping.price,
            currency: mapping.currency ?? "USD",
            matchScore: mapping.matchScore,
            matchMethod: "auto-name",
            sourceType: mapping.source,
            sourceProductId: mapping.sourceProductId,
            isVerified: false,
            isActive: true,
            lastPriceUpdate: mapping.lastPriceUpdate,
            lastScrapedAt: mapping.lastScrapedAt,
            updatedAt: mapping.updatedAt,
          }))
        )
        .onConflictDoNothing();
    }

    return [
      ...matchedRows.map(row => ({
        ...row,
        source:
          row.sourceType === "price-radar"
            ? ("price-radar" as const)
            : row.sourceType === "scoop"
              ? ("scoop" as const)
              : ("matched" as const),
        isAutomatic:
          row.sourceType === "price-radar" || row.sourceType === "scoop",
      })),
      ...automaticMappings,
    ].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  },

  async dismissCompetitorMapping(
    userId: string,
    data: {
      productId: string;
      competitorId: string;
      sourceType: "price-radar" | "scoop";
      sourceProductId: string;
    }
  ): Promise<void> {
    const database = await requireDb();
    const [ownedProduct] = await database
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.id, data.productId),
          eq(products.userId, userId),
          eq(products.isActive, true)
        )
      )
      .limit(1);
    if (!ownedProduct) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Product not found",
      });
    }

    const [ownedCompetitor] = await database
      .select({ id: competitors.id, domain: competitors.domain })
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
        message: "Competitor product not found",
      });
    }

    if (data.sourceType === "price-radar") {
      const [sourceProduct] = await database
        .select({
          id: priceRadarProducts.id,
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
            eq(priceRadarProducts.id, data.sourceProductId),
            eq(priceRadarProducts.userId, userId),
            eq(priceRadarProducts.isActive, true),
            eq(priceRadarSources.userId, userId),
            eq(priceRadarSources.isActive, true)
          )
        )
        .limit(1);
      const belongsToCompetitor =
        sourceProduct &&
        (sourceProduct.sourceCompetitorId === data.competitorId ||
          normalizeCompetitorDomain(sourceProduct.sourceDomain) ===
            normalizeCompetitorDomain(ownedCompetitor.domain));
      if (!belongsToCompetitor) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Competitor product not found",
        });
      }
    } else {
      const [sourceProduct] = await database
        .select({ id: scoopCompetitorProducts.id })
        .from(scoopCompetitorProducts)
        .where(
          and(
            eq(scoopCompetitorProducts.id, data.sourceProductId),
            eq(scoopCompetitorProducts.userId, userId),
            eq(scoopCompetitorProducts.competitorId, data.competitorId),
            eq(scoopCompetitorProducts.isActive, true)
          )
        )
        .limit(1);
      if (!sourceProduct) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Competitor product not found",
        });
      }
    }

    await database.transaction(async transaction => {
      await transaction
        .insert(competitorProductDismissals)
        .values({
          userId,
          productId: data.productId,
          competitorId: data.competitorId,
          sourceType: data.sourceType,
          sourceProductId: data.sourceProductId,
        })
        .onConflictDoNothing();

      await transaction
        .delete(competitorProducts)
        .where(
          and(
            eq(competitorProducts.productId, data.productId),
            eq(competitorProducts.competitorId, data.competitorId),
            eq(competitorProducts.sourceType, data.sourceType),
            eq(competitorProducts.sourceProductId, data.sourceProductId)
          )
        );
    });
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
      .select(publicShopifyStoreColumns)
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
  async findBySku(userId: string, sku: string): Promise<Product | undefined> {
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
  async findByName(userId: string, name: string): Promise<Product | undefined> {
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
    const [existing] = await database
      .select({ id: shopifyStores.id, userId: shopifyStores.userId })
      .from(shopifyStores)
      .where(eq(shopifyStores.shopDomain, data.shopDomain))
      .limit(1);

    if (existing && existing.userId !== data.userId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Store is already connected to another account",
      });
    }

    if (existing) {
      const { userId: _userId, ...updateData } = data;
      const result = await database
        .update(shopifyStores)
        .set({ ...updateData, updatedAt: new Date() })
        .where(
          and(
            eq(shopifyStores.id, existing.id),
            eq(shopifyStores.userId, data.userId)
          )
        )
        .returning();
      return result[0];
    }

    const result = await database
      .insert(shopifyStores)
      .values(data)
      .returning();
    return result[0];
  },

  async bulkUpsertProducts(items: InsertProduct[]): Promise<number> {
    if (items.length === 0) return 0;
    const database = await requireDb();
    const userIds = new Set(items.map(item => item.userId));
    if (userIds.size !== 1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Bulk sync must contain products for one account",
      });
    }
    const userId = items[0].userId;
    const rawStoreIds = items.map(item => item.storeId);
    if (rawStoreIds.some(storeId => !storeId)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Every product must reference a store",
      });
    }
    const storeIds = Array.from(new Set(rawStoreIds as string[]));
    const ownedStores = await database
      .select({ id: shopifyStores.id })
      .from(shopifyStores)
      .where(
        and(
          eq(shopifyStores.userId, userId),
          inArray(shopifyStores.id, storeIds)
        )
      );
    if (ownedStores.length !== storeIds.length) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "One or more stores were not found",
      });
    }
    const result = await database
      .insert(products)
      .values(items)
      .onConflictDoUpdate({
        target: [products.storeId, products.shopifyProductId],
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
        END`.as("rank"),
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
