import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { priceMonitoringService } from "../services/price-monitoring.service";
import { aiExtractionService } from "../services/ai-extraction.service";
import { cronScheduler } from "../services/cron-scheduler.service";
import { scrapingService } from "../services/scraping.service";
import { productService } from "../services/product.service";
import { actionCenterService } from "../services/action-center.service";

export const intelligenceRouter = router({
  actionCenter: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return actionCenterService.getForUser(ctx.user!.id, input?.storeId);
    }),

  // ── Competitor Discovery ──────────────────────────────────────────────────

  extractFromUrl: protectedProcedure
    .input(z.object({ productId: z.string().uuid(), url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const product = await productService.getById(
        ctx.user!.id,
        input.productId
      );
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      const scrapeResult = await scrapingService.scrapeCompetitorSite(
        "manual-extraction",
        new URL(input.url).hostname
      );
      if (scrapeResult.products.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not scrape the provided URL",
        });
      }
      const pageContent = scrapeResult.products
        .map(p => `${p.title} - ${p.price} ${p.currency}`)
        .join("\n");
      return aiExtractionService.extractAndValidate({
        merchantProduct: {
          id: product.id,
          title: product.title,
          description: product.description,
          sku: product.sku,
          barcode: product.barcode,
          vendor: product.vendor,
          category: product.category,
          price: product.price,
        },
        competitorPageContent: pageContent,
        competitorUrl: input.url,
        competitorDomain: new URL(input.url).hostname,
      });
    }),

  getExtractions: protectedProcedure
    .input(
      z
        .object({
          productId: z.string().uuid().optional(),
          isMatch: z.boolean().optional(),
          minConfidence: z.number().min(0).max(1).optional(),
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
          storeId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return aiExtractionService.getExtractions(ctx.user!.id, input);
    }),

  // ── Price Monitoring ──────────────────────────────────────────────────────

  runMonitoring: protectedProcedure.mutation(async ({ ctx }) => {
    return priceMonitoringService.runFullMonitoring(ctx.user!.id);
  }),

  getPriceChanges: protectedProcedure
    .input(
      z
        .object({
          productId: z.string().uuid().optional(),
          competitorId: z.string().uuid().optional(),
          changeType: z
            .enum([
              "price_increase",
              "price_decrease",
              "product_removed",
              "out_of_stock",
              "new_promotion",
              "back_in_stock",
            ])
            .optional(),
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
          storeId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return priceMonitoringService.getChanges(ctx.user!.id, input);
    }),

  getTimeline: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
          storeId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return priceMonitoringService.getTimeline(ctx.user!.id, input);
    }),

  getCronRuns: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      return priceMonitoringService.getCronRuns(input?.limit ?? 20);
    }),

  getCronStatus: protectedProcedure.query(async ({ ctx }) => {
    return cronScheduler.getStatus();
  }),

  getSnapshotHistory: protectedProcedure
    .input(
      z.object({
        competitorProductId: z.string().uuid(),
        limit: z.number().min(1).max(100).optional(),
        storeId: z.string().uuid().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return priceMonitoringService.getSnapshotHistory(
        ctx.user!.id,
        input.competitorProductId,
        input.limit ?? 30,
        input.storeId
      );
    }),

  // ── Scrape + AI Extract (combined) ───────────────────────────────────────

  scrapeAndExtract: protectedProcedure
    .input(z.object({ productId: z.string().uuid(), url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const product = await productService.getById(
        ctx.user!.id,
        input.productId
      );
      if (!product)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      const domain = new URL(input.url).hostname;
      const scrapeResult = await scrapingService.scrapeCompetitorSite(
        "ai-extraction",
        domain
      );
      if (scrapeResult.products.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Could not extract products from URL",
        });
      }
      const pageContent = scrapeResult.products
        .slice(0, 20)
        .map(
          p =>
            `Title: ${p.title}\nPrice: ${p.price} ${p.currency}\nURL: ${p.productUrl ?? ""}`
        )
        .join("\n\n");
      const extraction = await aiExtractionService.extractAndValidate({
        merchantProduct: {
          id: product.id,
          title: product.title,
          description: product.description,
          sku: product.sku,
          barcode: product.barcode,
          vendor: product.vendor,
          category: product.category,
          price: product.price,
        },
        competitorPageContent: pageContent,
        competitorUrl: input.url,
        competitorDomain: domain,
      });
      return {
        scraped: scrapeResult.products,
        extraction: extraction.extraction,
        passedThreshold: extraction.passedThreshold,
      };
    }),
});
