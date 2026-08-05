import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { notificationPreferenceService } from "../services/notification-preference.service";

const percentage = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/)
  .refine(value => Number(value) >= 0 && Number(value) <= 100);

export const notificationRouter = router({
  preferences: protectedProcedure.query(({ ctx }) =>
    notificationPreferenceService.getOrCreate(ctx.user!.id)
  ),

  updatePreferences: protectedProcedure
    .input(
      z
        .object({
          emailNotifications: z.boolean().optional(),
          inAppNotifications: z.boolean().optional(),
          frequency: z
            .enum(["realtime", "hourly", "daily", "weekly"])
            .optional(),
          priceDropThreshold: percentage.optional(),
          priceIncreaseThreshold: percentage.optional(),
        })
        .refine(value => Object.keys(value).length > 0, {
          message: "At least one preference is required",
        })
    )
    .mutation(({ ctx, input }) =>
      notificationPreferenceService.update(ctx.user!.id, input)
    ),
});
