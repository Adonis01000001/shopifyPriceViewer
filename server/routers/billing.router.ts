import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { billingService } from "../services/billing.service";

const paidPlan = z.enum(["starter", "pro", "scale"]);

export const billingRouter = router({
  status: protectedProcedure.query(({ ctx }) =>
    billingService.getSubscription(ctx.user!.id)
  ),
  checkout: protectedProcedure
    .input(z.object({ plan: paidPlan }))
    .mutation(({ ctx, input }) =>
      billingService.createCheckoutSession(ctx.user!.id, input.plan)
    ),
  portal: protectedProcedure.mutation(({ ctx }) =>
    billingService.createPortalSession(ctx.user!.id)
  ),
  changePlan: protectedProcedure
    .input(z.object({ plan: paidPlan }))
    .mutation(({ ctx, input }) =>
      billingService.changePlan(ctx.user!.id, input.plan)
    ),
  cancel: protectedProcedure
    .input(z.object({ cancelAtPeriodEnd: z.boolean() }))
    .mutation(({ ctx, input }) =>
      billingService.cancelSubscription(ctx.user!.id, input.cancelAtPeriodEnd)
    ),
});
