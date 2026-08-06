import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  analyzePortfolio,
  getLatestWisdomAnalysis,
  saveWisdomAnalysis,
} from "../services/wisdom.service";
import { entitlementService } from "../services/entitlement.service";

export const wisdomRouter = router({
  latest: protectedProcedure.query(async ({ ctx }) => {
    await entitlementService.assertFeature(ctx.user!.id, "advancedAnalytics");
    return getLatestWisdomAnalysis(ctx.user!.id);
  }),

  analyze: protectedProcedure.mutation(async ({ ctx }) => {
    await entitlementService.assertFeature(ctx.user!.id, "advancedAnalytics");
    const result = await analyzePortfolio(ctx.user!.id);

    // A failed or incomplete run must never replace the user's last good
    // result. The client can continue displaying the latest saved output.
    if (result.error || !result.analysis) return result;

    return saveWisdomAnalysis(ctx.user!.id, result);
  }),
});
