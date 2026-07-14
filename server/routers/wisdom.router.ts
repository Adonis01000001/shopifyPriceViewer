import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { analyzePortfolio } from "../services/wisdom.service";

export const wisdomRouter = router({
  analyze: protectedProcedure.query(async ({ ctx }) => {
    return analyzePortfolio(ctx.user!.id);
  }),
});