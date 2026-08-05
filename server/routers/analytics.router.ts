import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { PRODUCT_ANALYTICS_EVENTS } from "../../shared/analytics";
import { analyticsService } from "../services/analytics.service";

const analyticsPropertiesSchema = z
  .record(
    z.string().regex(/^[a-zA-Z0-9_]{1,64}$/),
    z.union([z.string().max(250), z.number().finite(), z.boolean(), z.null()])
  )
  .refine(properties => Object.keys(properties).length <= 20, {
    message: "Too many analytics properties",
  });

export const analyticsRouter = router({
  track: publicProcedure
    .input(
      z.object({
        eventName: z.enum(PRODUCT_ANALYTICS_EVENTS),
        sessionId: z.string().min(1).max(128).optional(),
        properties: analyticsPropertiesSchema.default({}),
      })
    )
    .mutation(async ({ ctx, input }) =>
      analyticsService.track({
        userId: ctx.user?.id ?? null,
        eventName: input.eventName,
        sessionId: input.sessionId,
        properties: input.properties,
      })
    ),
});
