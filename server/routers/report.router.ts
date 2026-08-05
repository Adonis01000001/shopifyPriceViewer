import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { entitlementService } from "../services/entitlement.service";
import { reportService } from "../services/report.service";

const reportType = z.enum([
  "daily_summary",
  "weekly_competitors",
  "pricing_opportunities",
]);

export const reportRouter = router({
  summary: protectedProcedure
    .input(z.object({ type: reportType }))
    .query(({ ctx, input }) => reportService.getSummary(ctx.user!.id, input.type)),
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(({ ctx, input }) => reportService.list(ctx.user!.id, input?.limit)),
  deliveries: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(({ ctx, input }) => reportService.listDeliveries(ctx.user!.id, input?.limit)),
  generate: protectedProcedure
    .input(z.object({ type: reportType }))
    .mutation(async ({ ctx, input }) => {
      await entitlementService.assertFeature(ctx.user!.id, "dailyReports");
      return reportService.queueReport(ctx.user!.id, input.type);
    }),
});
