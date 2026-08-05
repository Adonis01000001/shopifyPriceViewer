import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { analyzePortfolio } from "../services/wisdom.service";
import { entitlementService } from "../services/entitlement.service";

export const wisdomRouter = router({
  analyze: protectedProcedure.query(async ({ ctx }) => {
    await entitlementService.assertFeature(ctx.user!.id, "advancedAnalytics");
    return analyzePortfolio(ctx.user!.id);
  }),
});
