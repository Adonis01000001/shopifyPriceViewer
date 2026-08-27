import { z } from "zod";
import { eq } from "drizzle-orm";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { PLAN_CATALOG } from "../../shared/plans";
import { usageService } from "../services/usage.service";
import { pricingRulesService } from "../services/pricing-rules.service";
import { requireDb } from "../_core/db-assert";
import { users } from "../../drizzle/schema";

export const accountRouter = router({
  plans: publicProcedure.query(() => Object.values(PLAN_CATALOG)),
  usage: protectedProcedure.query(({ ctx }) =>
    usageService.getAccountUsage(ctx.user!.id)
  ),

  /** The two rules behind every suggested price. */
  pricingRules: protectedProcedure.query(({ ctx }) =>
    pricingRulesService.percentsForUser(ctx.user!.id)
  ),

  updatePricingRules: protectedProcedure
    .input(
      z.object({
        // Aiming above the competitor average is a legitimate choice, so the
        // undercut may be negative; a floor below cost is not, so margin
        // starts at zero. Both stop short of 100%, where the maths breaks.
        undercutPercent: z.number().min(-50).max(90),
        minMarginPercent: z.number().min(0).max(90),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await requireDb();
      await database
        .update(users)
        .set({
          undercutPercent: input.undercutPercent.toFixed(2),
          minMarginPercent: input.minMarginPercent.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user!.id));
      return pricingRulesService.percentsForUser(ctx.user!.id);
    }),
});
