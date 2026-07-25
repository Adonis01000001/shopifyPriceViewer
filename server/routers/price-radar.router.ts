import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { requireDb } from "../_core/db-assert";
import { competitorProducts, competitors } from "../../drizzle/schema";
import { priceRadarService } from "../services/price-radar/price-radar.service";

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
    .query(async ({ ctx }) => {
      const database = await requireDb();
      const rows = await database
        .select({
          id: competitorProducts.id,
          name: competitorProducts.competitorProductTitle,
          price: competitorProducts.price,
          sku: competitorProducts.competitorSku,
          productUrl: competitorProducts.competitorProductUrl,
          domain: competitors.domain,
          isVerified: competitorProducts.isVerified,
          matchScore: competitorProducts.matchScore,
        })
        .from(competitorProducts)
        .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
        .where(eq(competitors.userId, ctx.user.id))
        .orderBy(desc(competitors.domain), desc(competitorProducts.matchScore));
      return rows;
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
