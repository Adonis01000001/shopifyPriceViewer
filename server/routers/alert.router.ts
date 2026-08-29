import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { alertService } from "../services/alert.service";

export const alertRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          unreadOnly: z.boolean().default(false),
          limit: z.number().min(1).max(200).optional(),
          offset: z.number().min(0).optional(),
          storeId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return alertService.getByUserId(ctx.user!.id, input);
    }),

  count: protectedProcedure
    .input(
      z
        .object({
          unreadOnly: z.boolean().default(false),
          storeId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return alertService.countByUserId(ctx.user!.id, input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const alert = await alertService.getById(ctx.user!.id, input.id);
      if (!alert)
        throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      return alert;
    }),

  create: protectedProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        competitorProductId: z.string().uuid().optional(),
        alertType: z.enum([
          "price_drop",
          "price_increase",
          "competitor_change",
          "threshold",
        ]),
        severity: z
          .enum(["low", "medium", "high", "critical"])
          .default("medium"),
        title: z.string().min(1).max(255),
        message: z.string().min(1),
        triggerPrice: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/)
          .optional(),
        triggerCondition: z.enum(["below", "above", "equals"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const alert = await alertService.create({
        userId: ctx.user!.id,
        ...input,
        isRead: false,
        isResolved: false,
        isNotified: false,
      });
      if (!alert)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create alert",
        });
      return alert;
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const alert = await alertService.markRead(ctx.user!.id, input.id);
      if (!alert)
        throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      return alert;
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const count = await alertService.markAllRead(ctx.user!.id);
    return { markedRead: count };
  }),

  resolve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const alert = await alertService.resolve(ctx.user!.id, input.id);
      if (!alert)
        throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      return alert;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await alertService.delete(ctx.user!.id, input.id);
      return { success: true };
    }),

  stats: protectedProcedure
    .input(z.object({ storeId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
    return alertService.getStats(ctx.user!.id, input?.storeId);
  }),
});
