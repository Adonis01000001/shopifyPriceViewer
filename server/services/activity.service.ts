import { eq, desc } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import {
  activityLogs,
  type ActivityLog,
  type InsertActivityLog,
} from "../../drizzle/schema";

export const activityService = {
  async getByUserId(userId: string, limit: number = 20): Promise<ActivityLog[]> {
    const database = await requireDb();
    return database
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  },

  async log(data: InsertActivityLog): Promise<ActivityLog> {
    const database = await requireDb();
    const result = await database.insert(activityLogs).values(data).returning();
    return result[0];
  },

  async getRecentActions(userId: string, limit: number = 10) {
    const database = await requireDb();
    return database
      .select({
        action: activityLogs.action,
        detail: activityLogs.detail,
        entityType: activityLogs.entityType,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit);
  },
};
