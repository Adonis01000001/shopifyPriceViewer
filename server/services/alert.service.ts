import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireDb } from "../_core/db-assert";
import { alerts, products, accountShopConnections, type Alert, type InsertAlert } from "../../drizzle/schema";
import { notificationBroadcaster } from "./notification-broadcaster";

export const alertService = {
  async getByUserId(
    userId: string,
    options?: { unreadOnly?: boolean; limit?: number; offset?: number; storeId?: string }
  ): Promise<Alert[]> {
    const database = await requireDb();

    const conditions = [eq(alerts.userId, userId)];
    if (options?.unreadOnly) conditions.push(eq(alerts.isRead, false));
    if (options?.storeId) {
      const [connection] = await database
        .select({ id: accountShopConnections.id })
        .from(accountShopConnections)
        .where(and(eq(accountShopConnections.id, options.storeId), eq(accountShopConnections.userId, userId), eq(accountShopConnections.isActive, true)))
        .limit(1);
      if (!connection) return [];
      conditions.push(
        inArray(
          alerts.productId,
          database.select({ id: products.id }).from(products).where(eq(products.storeId, options.storeId))
        )
      );
    }

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
    options?: { unreadOnly?: boolean; storeId?: string }
  ): Promise<number> {
    const database = await requireDb();
    const conditions = [eq(alerts.userId, userId)];
    if (options?.unreadOnly) conditions.push(eq(alerts.isRead, false));
    if (options?.storeId) {
      const [connection] = await database
        .select({ id: accountShopConnections.id })
        .from(accountShopConnections)
        .where(and(eq(accountShopConnections.id, options.storeId), eq(accountShopConnections.userId, userId), eq(accountShopConnections.isActive, true)))
        .limit(1);
      if (!connection) return 0;
      conditions.push(
        inArray(
          alerts.productId,
          database.select({ id: products.id }).from(products).where(eq(products.storeId, options.storeId))
        )
      );
    }
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
    const alert = result[0];
    notificationBroadcaster.broadcast({
      type: "alert_created",
      userId: alert.userId,
      payload: alert,
    });
    return alert;
  },

  async markRead(userId: string, alertId: string): Promise<Alert | undefined> {
    const database = await requireDb();
    const result = await database
      .update(alerts)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
      .returning();
    const alert = result[0];
    if (alert) {
      notificationBroadcaster.broadcast({
        type: "alert_updated",
        userId,
        payload: alert,
      });
    }
    return alert;
  },

  async markAllRead(userId: string): Promise<number> {
    const database = await requireDb();
    const result = await database
      .update(alerts)
      .set({ isRead: true, updatedAt: new Date() })
      .where(and(eq(alerts.userId, userId), eq(alerts.isRead, false)))
      .returning();
    const count = result.length;
    if (count > 0) {
      notificationBroadcaster.broadcast({
        type: "alert_updated",
        userId,
        payload: { count, isRead: true },
      });
    }
    return count;
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
    const alert = result[0];
    if (alert) {
      notificationBroadcaster.broadcast({
        type: "alert_updated",
        userId,
        payload: alert,
      });
    }
    return alert;
  },

  async delete(userId: string, alertId: string): Promise<void> {
    const database = await requireDb();
    await database
      .delete(alerts)
      .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)));
    notificationBroadcaster.broadcast({
      type: "alert_deleted",
      userId,
      payload: { id: alertId },
    });
  },

  async getStats(userId: string, storeId?: string) {
    const database = await requireDb();
    if (storeId) {
      const [connection] = await database
        .select({ id: accountShopConnections.id })
        .from(accountShopConnections)
        .where(and(eq(accountShopConnections.id, storeId), eq(accountShopConnections.userId, userId), eq(accountShopConnections.isActive, true)))
        .limit(1);
      if (!connection) return { total: 0, unread: 0, critical: 0, resolved: 0 };
    }
    const result = await database
      .select({
        severity: alerts.severity,
        isRead: alerts.isRead,
        isResolved: alerts.isResolved,
        count: sql<number>`count(*)::int`,
      })
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, userId),
          storeId
            ? inArray(
                alerts.productId,
                database.select({ id: products.id }).from(products).where(eq(products.storeId, storeId))
              )
            : undefined
        )
      )
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
