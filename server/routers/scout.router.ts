import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { scoutService } from "../services/scout.service";
import { scoopService } from "../services/scoop.service";
import { productService } from "../services/product.service";

export const scoutRouter = router({
  scoopSearch: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(2).max(240),
        maxResults: z.number().int().min(1).max(20).default(10),
        ranking: z
          .enum(["relevance", "lowest_price", "best_value", "newest"])
          .default("relevance"),
      })
    )
    .mutation(({ ctx, input }) =>
      scoopService.search({
        userId: ctx.user!.id,
        ...input,
      })
    ),

  scoutProduct: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        maxResults: z.number().min(1).max(20).default(10),
      })
    )
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
      return scoutService.scoutProduct(
        ctx.user!.id,
        input.productId,
        input.maxResults
      );
    }),

  scoutAllProducts: protectedProcedure
    .input(
      z
        .object({
          maxResults: z.number().min(1).max(20).default(10),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      return scoutService.scoutAllProducts(
        ctx.user!.id,
        input?.maxResults ?? 10
      );
    }),

  // ─── SerpAPI Batch Scout (5 queries per product) ──────────────────────────

  scoutProductSerpApi: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        maxResults: z.number().min(1).max(20).default(10),
      })
    )
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
      return scoutService.scoutProductWithSerpApi(
        ctx.user!.id,
        input.productId,
        input.maxResults
      );
    }),

  scoutAllSerpApi: protectedProcedure
    .input(
      z
        .object({
          maxResults: z.number().min(1).max(20).default(10),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      return scoutService.scoutAllWithSerpApi(
        ctx.user!.id,
        input?.maxResults ?? 10
      );
    }),

  // ─── Exa Neural Search Scout (structured product extraction) ──────────────

  scoutProductExa: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        maxResults: z.number().min(1).max(20).default(10),
      })
    )
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
      return scoutService.scoutProductWithExa(
        ctx.user!.id,
        input.productId,
        input.maxResults
      );
    }),

  scoutAllExa: protectedProcedure
    .input(
      z
        .object({
          maxResults: z.number().min(1).max(20).default(10),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      return scoutService.scoutAllWithExa(
        ctx.user!.id,
        input?.maxResults ?? 10
      );
    }),

  getScoutHistory: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      return scoutService.getScoutHistory(ctx.user!.id, input.productId);
    }),

  // ─── Price Radar Scout (Google direct search for Amazon/eBay/Walmart) ──

  scoutProductPriceRadar: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        maxResults: z.number().min(1).max(20).default(10),
      })
    )
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
      return scoutService.scoutProductWithPriceRadar(
        ctx.user!.id,
        input.productId,
        input.maxResults
      );
    }),

  scoutAllPriceRadar: protectedProcedure
    .input(
      z
        .object({
          maxResults: z.number().min(1).max(20).default(10),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      return scoutService.scoutAllWithPriceRadar(
        ctx.user!.id,
        input?.maxResults ?? 10
      );
    }),

  getAllScoutHistory: protectedProcedure.query(async ({ ctx }) => {
    return scoutService.getAllScoutHistory(ctx.user!.id);
  }),
});
