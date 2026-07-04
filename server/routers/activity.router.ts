import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { activityService } from "../services/activity.service";

export const activityRouter = router({
  recent: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(50).default(10) }).optional()
    )
    .query(async ({ ctx, input }) => {
      return activityService.getRecentActions(ctx.user!.id, input?.limit ?? 10);
    }),
});
