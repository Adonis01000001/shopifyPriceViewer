import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireDb } from "../../_core/db-assert";
import {
  competitors,
  priceRadarCrawlErrors,
  priceRadarExtractionLogs,
  priceRadarJobs,
  priceRadarPages,
  priceRadarPriceSnapshots,
  priceRadarProductAttributes,
  priceRadarProducts,
  priceRadarSources,
} from "../../../drizzle/schema";
import type {
  PriceRadarCrawlPolicy,
  PriceRadarFetchedPage,
  PriceRadarPageKind,
  PriceRadarProduct,
  PriceRadarQueueItem,
} from "./types";

export const hashPriceRadarUrl = (url: string): string =>
  createHash("sha256").update(url).digest("hex");

export const priceRadarRepository = {
  async assertCompetitorOwnership(userId: string, competitorId: string) {
    const db = await requireDb();
    const [row] = await db
      .select({ id: competitors.id })
      .from(competitors)
      .where(and(eq(competitors.id, competitorId), eq(competitors.userId, userId)))
      .limit(1);
    return !!row;
  },

  async createSource(input: {
    userId: string;
    competitorId?: string;
    name: string;
    domain: string;
    baseUrl: string;
    crawlDelayMs: number;
  }) {
    const db = await requireDb();
    const [source] = await db.insert(priceRadarSources).values(input).returning();
    return source;
  },

  async getSource(userId: string, sourceId: string) {
    const db = await requireDb();
    const [source] = await db
      .select()
      .from(priceRadarSources)
      .where(
        and(
          eq(priceRadarSources.id, sourceId),
          eq(priceRadarSources.userId, userId),
          eq(priceRadarSources.isActive, true)
        )
      )
      .limit(1);
    return source;
  },

  async listSources(userId: string) {
    const db = await requireDb();
    return db
      .select()
      .from(priceRadarSources)
      .where(
        and(
          eq(priceRadarSources.userId, userId),
          eq(priceRadarSources.isActive, true)
        )
      )
      .orderBy(desc(priceRadarSources.updatedAt));
  },

  async updateSource(
    userId: string,
    sourceId: string,
    data: Partial<{
      name: string;
      status: string;
      crawlDelayMs: number;
      robotsTxt: string;
      lastCrawledAt: Date;
      isActive: boolean;
    }>
  ) {
    const db = await requireDb();
    const [source] = await db
      .update(priceRadarSources)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(priceRadarSources.id, sourceId),
          eq(priceRadarSources.userId, userId)
        )
      )
      .returning();
    return source;
  },

  async findActiveJob(userId: string, sourceId: string) {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(priceRadarJobs)
      .where(
        and(
          eq(priceRadarJobs.userId, userId),
          eq(priceRadarJobs.sourceId, sourceId),
          inArray(priceRadarJobs.status, ["queued", "running"])
        )
      )
      .limit(1);
    return rows[0];
  },

  async createJob(
    userId: string,
    sourceId: string,
    rootUrl: string,
    policy: PriceRadarCrawlPolicy
  ) {
    const db = await requireDb();
    const [job] = await db
      .insert(priceRadarJobs)
      .values({ userId, sourceId, rootUrl, config: policy, pagesQueued: 1 })
      .returning();
    return job;
  },

  async getJob(userId: string, jobId: string) {
    const db = await requireDb();
    const [job] = await db
      .select()
      .from(priceRadarJobs)
      .where(and(eq(priceRadarJobs.id, jobId), eq(priceRadarJobs.userId, userId)))
      .limit(1);
    return job;
  },

  async updateJob(
    jobId: string,
    data: Partial<typeof priceRadarJobs.$inferInsert>
  ) {
    const db = await requireDb();
    const [job] = await db
      .update(priceRadarJobs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(priceRadarJobs.id, jobId))
      .returning();
    return job;
  },

  async recordPage(input: {
    userId: string;
    sourceId: string;
    jobId: string;
    item: PriceRadarQueueItem;
    page?: PriceRadarFetchedPage;
    pageKind: PriceRadarPageKind;
    status: string;
    metadata?: Record<string, unknown>;
  }) {
    const db = await requireDb();
    const url = input.page?.finalUrl ?? input.item.url;
    const [page] = await db
      .insert(priceRadarPages)
      .values({
        userId: input.userId,
        sourceId: input.sourceId,
        jobId: input.jobId,
        url,
        urlHash: hashPriceRadarUrl(url),
        referrerUrl: input.item.referrerUrl,
        depth: input.item.depth,
        pageKind: input.pageKind,
        status: input.status,
        httpStatus: input.page?.statusCode,
        contentType: input.page?.contentType,
        renderMode: input.page?.renderMode,
        responseTimeMs: input.page?.responseTimeMs,
        retryCount: input.page?.retryCount ?? 0,
        contentBytes: input.page
          ? Buffer.byteLength(input.page.html, "utf8")
          : undefined,
        metadata: input.metadata,
        fetchedAt: input.page?.fetchedAt,
      })
      .onConflictDoNothing()
      .returning();
    return page;
  },

  async upsertProduct(input: {
    userId: string;
    sourceId: string;
    pageId: string;
    jobId: string;
    product: PriceRadarProduct;
  }) {
    const db = await requireDb();
    return db.transaction(async tx => {
      const values = {
        userId: input.userId,
        sourceId: input.sourceId,
        pageId: input.pageId,
        productUrl: input.product.productUrl,
        productUrlHash: hashPriceRadarUrl(input.product.productUrl),
        name: input.product.name,
        brand: input.product.brand,
        price: input.product.price,
        currency: input.product.currency,
        previousPrice: input.product.previousPrice,
        discountPercent: input.product.discountPercent,
        imageUrls: input.product.images,
        availability: input.product.availability,
        sku: input.product.sku,
        barcode: input.product.barcode,
        gtin: input.product.gtin,
        category: input.product.category,
        rating: input.product.rating,
        reviewCount: input.product.reviewCount,
        seller: input.product.seller,
        structuredMetadata: input.product.structuredMetadata,
        jsonLd: input.product.jsonLd,
        extractionMethod: input.product.extractionMethod,
        extractionConfidence: input.product.extractionConfidence,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      };
      const [stored] = await tx
        .insert(priceRadarProducts)
        .values(values)
        .onConflictDoUpdate({
          target: [
            priceRadarProducts.sourceId,
            priceRadarProducts.productUrlHash,
          ],
          set: values,
        })
        .returning();

      for (const [name, value] of Object.entries(input.product.attributes)) {
        await tx
          .insert(priceRadarProductAttributes)
          .values({ productId: stored.id, name, value })
          .onConflictDoUpdate({
            target: [
              priceRadarProductAttributes.productId,
              priceRadarProductAttributes.name,
            ],
            set: { value, updatedAt: new Date() },
          });
      }
      await tx.insert(priceRadarPriceSnapshots).values({
        productId: stored.id,
        jobId: input.jobId,
        price: input.product.price,
        previousPrice: input.product.previousPrice,
        currency: input.product.currency,
        availability: input.product.availability,
      });
      return stored;
    });
  },

  async recordExtraction(input: {
    userId: string;
    jobId: string;
    pageId: string;
    productId?: string;
    methods: string[];
    warnings: string[];
    confidence: number;
    durationMs: number;
  }) {
    const db = await requireDb();
    await db.insert(priceRadarExtractionLogs).values(input);
  },

  async recordError(input: {
    userId: string;
    jobId: string;
    pageId?: string;
    url: string;
    stage: string;
    code?: string;
    message: string;
    retryable: boolean;
    retryCount: number;
  }) {
    const db = await requireDb();
    await db.insert(priceRadarCrawlErrors).values(input);
  },

  async listJobs(userId: string, limit: number, offset: number) {
    const db = await requireDb();
    return db
      .select()
      .from(priceRadarJobs)
      .where(eq(priceRadarJobs.userId, userId))
      .orderBy(desc(priceRadarJobs.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async listProducts(
    userId: string,
    options: { sourceId?: string; limit: number; offset: number }
  ) {
    const db = await requireDb();
    const conditions = [
      eq(priceRadarProducts.userId, userId),
      eq(priceRadarProducts.isActive, true),
    ];
    if (options.sourceId)
      conditions.push(eq(priceRadarProducts.sourceId, options.sourceId));
    return db
      .select()
      .from(priceRadarProducts)
      .where(and(...conditions))
      .orderBy(desc(priceRadarProducts.lastSeenAt))
      .limit(options.limit)
      .offset(options.offset);
  },

  async listErrors(userId: string, jobId: string, limit: number) {
    const db = await requireDb();
    return db
      .select()
      .from(priceRadarCrawlErrors)
      .where(
        and(
          eq(priceRadarCrawlErrors.userId, userId),
          eq(priceRadarCrawlErrors.jobId, jobId)
        )
      )
      .orderBy(desc(priceRadarCrawlErrors.createdAt))
      .limit(limit);
  },
};
