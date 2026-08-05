import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { priceService } from "../services/price.service";

export const priceRouter = router({
  history: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        fromDate: z.date().optional(),
        toDate: z.date().optional(),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      return priceService.getHistory(ctx.user!.id, input.productId, {
        fromDate: input.fromDate,
        toDate: input.toDate,
        limit: input.limit,
      });
    }),

  summary: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const summary = await priceService.getPriceSummary(
        ctx.user!.id,
        input.productId
      );
      if (!summary)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product not found",
        });
      return summary;
    }),

  record: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        competitorProductId: z.string().uuid().optional(),
        price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        currency: z.string().length(3).default("USD"),
        source: z.enum(["shopify", "competitor", "manual"]).default("manual"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const record = await priceService.recordPrice(ctx.user!.id, {
        productId: input.productId,
        competitorProductId: input.competitorProductId,
        price: input.price,
        currency: input.currency,
        source: input.source,
        recordedAt: new Date(),
      });
      if (!record)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to record price",
        });
      return record;
    }),

  trend: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        months: z.number().min(1).max(24).default(12),
      })
    )
    .query(async ({ ctx, input }) => {
      return priceService.getTrendData(
        ctx.user!.id,
        input.productId,
        input.months
      );
    }),
});
