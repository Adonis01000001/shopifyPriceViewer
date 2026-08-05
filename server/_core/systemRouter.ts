import { adminProcedure, publicProcedure, router } from "./trpc";
import { jobQueueService } from "../services/job-queue.service";

export const systemRouter = router({
  health: publicProcedure.query(() => ({
    ok: true,
  })),
  queueHealth: adminProcedure.query(() => jobQueueService.getHealth()),
});
