import { eq } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  notificationPreferences,
  type InsertNotificationPreference,
  type NotificationPreference,
} from "../../drizzle/schema";

export type NotificationPreferenceUpdate = Partial<
  Pick<
    InsertNotificationPreference,
    | "emailNotifications"
    | "inAppNotifications"
    | "frequency"
    | "priceDropThreshold"
    | "priceIncreaseThreshold"
  >
>;

export const notificationPreferenceService = {
  async getOrCreate(userId: string): Promise<NotificationPreference> {
    const database = await requireDb();
    const existing = await database
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    if (existing[0]) return existing[0];

    const [created] = await database
      .insert(notificationPreferences)
      .values({ userId })
      .onConflictDoNothing({ target: notificationPreferences.userId })
      .returning();
    if (created) return created;

    const [raced] = await database
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    if (!raced)
      throw new Error("Unable to initialize notification preferences");
    return raced;
  },

  async update(
    userId: string,
    update: NotificationPreferenceUpdate
  ): Promise<NotificationPreference> {
    const database = await requireDb();
    const [result] = await database
      .insert(notificationPreferences)
      .values({ userId, ...update })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...update, updatedAt: new Date() },
      })
      .returning();
    if (!result) throw new Error("Unable to update notification preferences");
    return result;
  },
};
