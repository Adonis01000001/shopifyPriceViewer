import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { recommendationService } from "../services/recommendation.service";
import { entitlementService } from "../services/entitlement.service";

export const recommendationRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          status: z.enum(["pending", "implemented", "dismissed"]).optional(),
          limit: z.number().min(1).max(200).default(100),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return recommendationService.getByUserId(ctx.user!.id, input);
    }),

  getByProduct: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return recommendationService.getByProductId(
        ctx.user!.id,
        input.productId
      );
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rec = await recommendationService.getById(ctx.user!.id, input.id);
      if (!rec)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recommendation not found",
        });
      return rec;
    }),

  generate: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await entitlementService.assertFeature(
        ctx.user!.id,
        "aiRecommendations"
      );
      await entitlementService.assertWithinLimit(
        ctx.user!.id,
        "aiRunsMonthly"
      );
      const rec = await recommendationService.generateForProduct(
        ctx.user!.id,
        input.productId
      );
      if (!rec)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Could not generate recommendation. Ensure the product has competitor prices.",
        });
      return rec;
    }),

  /**
   * Accept a recommendation. With pushToStore the new price is written back to
   * Shopify; without it the recommendation is only marked as actioned, so a
   * merchant can change the price themselves and still clear the item.
   */
  implement: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        pushToStore: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await recommendationService.getById(ctx.user!.id, input.id);
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recommendation not found",
        });

      let pushed: { previousPrice: string; newPrice: number } | null = null;
      if (input.pushToStore) {
        const { pipelineService } = await import("../services/pipeline.service");
        try {
          const result = await pipelineService.pushPriceToShopify(
            ctx.user!.id,
            existing.productId,
            Number(existing.recommendedPrice)
          );
          pushed = { previousPrice: result.previousPrice, newPrice: result.newPrice };
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              err instanceof Error ? err.message : "Could not update the price in Shopify",
          });
        }
      }

      const rec = await recommendationService.implement(ctx.user!.id, input.id);
      if (!rec)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recommendation not found",
        });
      return { ...rec, pushed };
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rec = await recommendationService.dismiss(ctx.user!.id, input.id);
      if (!rec)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Recommendation not found",
        });
      return rec;
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    return recommendationService.getStats(ctx.user!.id);
  }),

  generateAll: adminProcedure.mutation(async () => {
    return recommendationService.generateForAllUsers();
  }),

  listAll: adminProcedure
    .input(
      z
        .object({
          status: z.enum(["pending", "implemented", "dismissed"]).optional(),
          limit: z.number().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return recommendationService.getAll(input);
    }),
});
