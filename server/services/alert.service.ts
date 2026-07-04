import { eq, and, desc, sql } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import { alerts, type Alert, type InsertAlert } from "../../drizzle/schema";

export const alertService = {
  async getByUserId(
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number; offset?: number }
  ): Promise<Alert[]> {
    const database = await requireDb();

    const conditions = [eq(alerts.userId, userId)];
    if (options?.unreadOnly) conditions.push(eq(alerts.isRead, false));

    const limit = Math.min(options?.limit ?? 50, 200);
    const offset = options?.offset ?? 0;

    return database
      .select()
      .from(alerts)
      .where(and(...conditions))
      .orderBy(desc(alerts.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async countByUserId(
    userId: string,
    options?: { unreadOnly?: boolean }
  ): Promise<number> {
    const database = await requireDb();
    const conditions = [eq(alerts.userId, userId)];
    if (options?.unreadOnly) conditions.push(eq(alerts.isRead, false));
    const result = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(alerts)
      .where(and(...conditions));
    return result[0]?.count ?? 0;
  },

  async getById(userId: string, alertId: string): Promise<Alert | undefined> {
    const database = await requireDb();
    const result = await database
      .select()
      .from(alerts)
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
      .limit(1);
    return result[0];
  },

  async create(data: InsertAlert): Promise<Alert> {
    const database = await requireDb();
    const result = await database.insert(alerts).values(data).returning();
    return result[0];
  },

  async markRead(userId: string, alertId: string): Promise<Alert | undefined> {
    const database = await requireDb();
    const result = await database
      .update(alerts)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
      .returning();
    return result[0];
  },

  async markAllRead(userId: string): Promise<number> {
    const database = await requireDb();
    const result = await database
      .update(alerts)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(eq(alerts.userId, userId), eq(alerts.isRead, false)))
      .returning();
    return result.length;
  },

  async resolve(userId: string, alertId: string): Promise<Alert | undefined> {
    const database = await requireDb();
    const result = await database
      .update(alerts)
      .set({
        isResolved: true,
        isRead: true,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
      .returning();
    return result[0];
  },

  async delete(userId: string, alertId: string): Promise<void> {
    const database = await requireDb();
    await database
      .delete(alerts)
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)));
  },

  async getStats(userId: string) {
    const database = await requireDb();
    const result = await database
      .select({
        severity: alerts.severity,
        isRead: alerts.isRead,
        isResolved: alerts.isResolved,
        count: sql<number>`count(*)::int`,
      })
      .from(alerts)
      .where(eq(alerts.userId, userId))
      .groupBy(alerts.severity, alerts.isRead, alerts.isResolved);

    const stats = { total: 0, unread: 0, critical: 0, resolved: 0 };
    for (const row of result) {
      stats.total += row.count;
      if (!row.isRead) stats.unread += row.count;
      if (row.severity === "critical" && !row.isResolved)
        stats.critical += row.count;
      if (row.isResolved) stats.resolved += row.count;
    }
    return stats;
  },
};
