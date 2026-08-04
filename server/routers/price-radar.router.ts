import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, desc, isNotNull, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { requireDb } from "../_core/db-assert";
import { priceRadarProducts, priceRadarSources, competitorProducts, competitors } from "../../drizzle/schema";
import { priceRadarService } from "../services/price-radar/price-radar.service";
import { resolveProductDisplayName } from "../services/price-radar/extraction";
import { normalizeCompetitorDomain } from "../services/price-radar/url-policy";

const crawlPolicySchema = z.object({
  maxPages: z.number().int().min(1).max(5_000).optional(),
  maxDepth: z.number().int().min(0).max(12).optional(),
  concurrency: z.number().int().min(1).max(12).optional(),
  requestTimeoutMs: z.number().int().min(2_000).max(60_000).optional(),
  maxRetries: z.number().int().min(0).max(6).optional(),
  retryBaseDelayMs: z.number().int().min(100).max(10_000).optional(),
  minRequestIntervalMs: z.number().int().min(0).max(60_000).optional(),
  renderMode: z.enum(["auto", "http", "browser"]).optional(),
  respectRobotsTxt: z.boolean().optional(),
});

function mapServiceError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Price Radar request failed";
  if (/not found/i.test(message))
    throw new TRPCError({ code: "NOT_FOUND", message });
  if (/already active/i.test(message))
    throw new TRPCError({ code: "CONFLICT", message });
  if (/invalid|private network|only http/i.test(message))
    throw new TRPCError({ code: "BAD_REQUEST", message });
  throw error;
}

export const priceRadarRouter = router({
  info: protectedProcedure.query(() => ({
    name: priceRadarService.engineName,
    defaults: priceRadarService.defaults,
  })),

  createSource: protectedProcedure
    .input(
      z.object({
        competitorId: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(255),
        url: z.string().url().max(2_048),
        crawlDelayMs: z.number().int().min(0).max(60_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await priceRadarService.createSource({
          userId: ctx.user.id,
          ...input,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  sources: protectedProcedure.query(({ ctx }) =>
    priceRadarService.listSources(ctx.user.id)
  ),

  deleteSource: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const source = await priceRadarService.deleteSource(
        ctx.user.id,
        input.sourceId
      );
      if (!source)
        throw new TRPCError({ code: "NOT_FOUND", message: "Source not found" });
      return { success: true };
    }),

  startCrawl: protectedProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        policy: crawlPolicySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await priceRadarService.startCrawl(
          ctx.user.id,
          input.sourceId,
          input.policy ?? {}
        );
      } catch (error) {
        mapServiceError(error);
      }
    }),

  cancelCrawl: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await priceRadarService.cancelCrawl(ctx.user.id, input.jobId);
      } catch (error) {
        mapServiceError(error);
      }
    }),

  job: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await priceRadarService.getJob(ctx.user.id, input.jobId);
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "Crawl job not found" });
      return job;
    }),

  history: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(({ ctx, input }) =>
      priceRadarService.listJobs(
        ctx.user.id,
        input?.limit ?? 50,
        input?.offset ?? 0
      )
    ),

  products: protectedProcedure
    .input(
      z
        .object({
          sourceId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const crawlConditions = [
        eq(priceRadarProducts.userId, ctx.user.id),
        eq(priceRadarProducts.isActive, true),
        isNotNull(priceRadarProducts.price),
      ];
      if (input?.sourceId)
        crawlConditions.push(eq(priceRadarProducts.sourceId, input.sourceId));

      const [crawlProducts, manualProducts] = await Promise.all([
        db
          .select({
            id: priceRadarProducts.id,
            name: priceRadarProducts.name,
            price: priceRadarProducts.price,
            sku: priceRadarProducts.sku,
            productUrl: priceRadarProducts.productUrl,
            domain: priceRadarSources.domain,
            currency: priceRadarProducts.currency,
            availability: priceRadarProducts.availability,
            imageUrl: priceRadarProducts.imageUrls,
            brand: priceRadarProducts.brand,
            category: priceRadarProducts.category,
            rating: priceRadarProducts.rating,
            reviewCount: priceRadarProducts.reviewCount,
            seller: priceRadarProducts.seller,
            structuredMetadata: priceRadarProducts.structuredMetadata,
            extractionConfidence: priceRadarProducts.extractionConfidence,
            firstSeenAt: priceRadarProducts.firstSeenAt,
            lastSeenAt: priceRadarProducts.lastSeenAt,
          })
          .from(priceRadarProducts)
          .innerJoin(
            priceRadarSources,
            eq(priceRadarProducts.sourceId, priceRadarSources.id)
          )
          .where(and(...crawlConditions))
          .orderBy(desc(priceRadarProducts.lastSeenAt))
          .limit(limit)
          .offset(offset),
        db
          .select({
            id: competitorProducts.id,
            name: competitorProducts.competitorProductTitle,
            price: competitorProducts.price,
            sku: competitorProducts.competitorSku,
            productUrl: competitorProducts.competitorProductUrl,
            domain: competitors.domain,
            currency: competitorProducts.currency,
            availability: sql`NULL::text`,
            imageUrl: sql`NULL::jsonb`,
            brand: sql`NULL::text`,
            category: sql`NULL::text`,
            rating: sql`NULL::numeric`,
            reviewCount: sql`NULL::integer`,
            seller: sql`NULL::text`,
            extractionConfidence: sql`NULL::numeric`,
            firstSeenAt: sql`NULL::timestamp`,
            lastSeenAt: competitorProducts.updatedAt,
          })
          .from(competitorProducts)
          .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
          .where(
            and(
              eq(competitors.userId, ctx.user.id),
              isNotNull(competitorProducts.price)
            )
          )
          .orderBy(desc(competitors.domain))
          .limit(limit)
          .offset(offset),
      ]);

      const merged = new Map<string, any>();
      for (const product of manualProducts) {
        const key = `${normalizeCompetitorDomain(product.domain)}-${product.productUrl}`;
        merged.set(key, product);
      }
      for (const product of crawlProducts) {
        const metadata =
          product.structuredMetadata &&
          typeof product.structuredMetadata === "object"
            ? (product.structuredMetadata as Record<string, unknown>)
            : {};
        const normalizedProduct = {
          ...product,
          name:
            resolveProductDisplayName(
              product.name,
              product.productUrl,
              typeof metadata.description === "string"
                ? metadata.description
                : null
            ) ?? product.name,
        };
        delete (normalizedProduct as any).structuredMetadata;
        if (
          normalizeCompetitorDomain(product.domain) === "amazon.com" &&
          /^Amazon(?:\.com)?$/i.test(normalizedProduct.name)
        ) {
          continue;
        }

        const key = `${normalizeCompetitorDomain(product.domain)}-${product.productUrl}`;
        const existing = merged.get(key);
        merged.set(
          key,
          existing
            ? {
                ...existing,
                ...normalizedProduct,
                name: normalizedProduct.name || existing.name,
                price: normalizedProduct.price ?? existing.price,
                currency: normalizedProduct.currency ?? existing.currency,
              }
            : normalizedProduct
        );
      }
      return Array.from(merged.values());
    }),

  errors: protectedProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const job = await priceRadarService.getJob(ctx.user.id, input.jobId);
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "Crawl job not found" });
      return priceRadarService.listErrors(ctx.user.id, input.jobId, input.limit);
    }),
});
