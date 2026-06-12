import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { recommendationService } from "../services/recommendation.service";

export const recommendationRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["pending", "implemented", "dismissed"]).optional(),
      limit: z.number().min(1).max(200).default(100),
    }).optional())
    .query(async ({ ctx, input }) => {
      return recommendationService.getByUserId(ctx.user!.id, input);
    }),

  getByProduct: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return recommendationService.getByProductId(ctx.user!.id, input.productId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rec = await recommendationService.getById(ctx.user!.id, input.id);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      return rec;
    }),

  generate: protectedProcedure
    .input(z.object({ productId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rec = await recommendationService.generateForProduct(ctx.user!.id, input.productId);
      if (!rec) throw new TRPCError({ code: "BAD_REQUEST", message: "Could not generate recommendation. Ensure the product has competitor prices." });
      return rec;
    }),

  implement: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rec = await recommendationService.implement(ctx.user!.id, input.id);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      return rec;
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const rec = await recommendationService.dismiss(ctx.user!.id, input.id);
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found" });
      return rec;
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    return recommendationService.getStats(ctx.user!.id);
  }),
});
