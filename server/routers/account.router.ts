import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { PLAN_CATALOG } from "../../shared/plans";
import { usageService } from "../services/usage.service";

export const accountRouter = router({
  plans: publicProcedure.query(() => Object.values(PLAN_CATALOG)),
  usage: protectedProcedure.query(({ ctx }) =>
    usageService.getAccountUsage(ctx.user!.id)
  ),
});
