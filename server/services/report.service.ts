import { and, desc, eq } from "drizzle-orm";
import { reportRuns, notificationDeliveries } from "../../drizzle/schema";
import type { ReportRun } from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";
import { actionCenterService } from "./action-center.service";
import { notificationPreferenceService } from "./notification-preference.service";
import { jobQueueService } from "./job-queue.service";

export type ReportType =
  | "daily_summary"
  | "weekly_competitors"
  | "pricing_opportunities";

function asIso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

async function buildSummary(userId: string, type: ReportType) {
  const actionCenter = await actionCenterService.getForUser(userId);
  const generatedAt = actionCenter.generatedAt.toISOString();
  const opportunities = actionCenter.pendingRecommendations.map(item => ({
    product: item.productTitle,
    currentPrice: item.currentPrice,
    recommendedPrice: item.recommendedPrice,
    changePercent: item.priceChangePercent,
    reason: item.reason,
  }));
  const risks = actionCenter.unreadAlerts.map(item => ({
    product: item.productTitle,
    severity: item.severity,
    title: item.title,
    message: item.message,
  }));
  const movements = actionCenter.recentChanges.map(item => ({
    product: item.productTitle,
    competitor: item.competitorName,
    changeType: item.changeType,
    previousPrice: item.previousPrice,
    newPrice: item.newPrice,
    changePercent: item.priceDiffPercent,
    detectedAt: asIso(item.detectedAt),
  }));

  if (type === "weekly_competitors") {
    return {
      title: "Weekly competitor movement report",
      generatedAt,
      metrics: actionCenter.totals,
      movements,
      nextActions: opportunities.slice(0, 3),
    };
  }
  if (type === "pricing_opportunities") {
    return {
      title: "Pricing opportunities report",
      generatedAt,
      metrics: actionCenter.totals,
      opportunities,
      risks,
    };
  }
  return {
    title: "Daily pricing intelligence summary",
    generatedAt,
    metrics: actionCenter.totals,
    opportunities: opportunities.slice(0, 5),
    risks: risks.slice(0, 5),
    movements: movements.slice(0, 8),
  };
}

export const reportService = {
  async getSummary(userId: string, type: ReportType) {
    return buildSummary(userId, type);
  },

  async queueReport(userId: string, type: ReportType): Promise<ReportRun> {
    const database = await requireDb();
    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - (type === "weekly_competitors" ? 7 : 1) * 86_400_000
    );
    const summary = await buildSummary(userId, type);
    const [run] = await database
      .insert(reportRuns)
      .values({
        userId,
        reportType: type,
        status: "queued",
        periodStart,
        periodEnd,
        summary,
      })
      .returning();
    if (!run) throw new Error("Unable to create report run");

    const preferences = await notificationPreferenceService.getOrCreate(userId);
    if (preferences.emailNotifications && jobQueueService.isEnabled) {
      await jobQueueService.enqueueNotification(userId, run.id);
    }
    return run;
  },

  async list(userId: string, limit = 20) {
    const database = await requireDb();
    return database
      .select({
        id: reportRuns.id,
        reportType: reportRuns.reportType,
        status: reportRuns.status,
        periodStart: reportRuns.periodStart,
        periodEnd: reportRuns.periodEnd,
        summary: reportRuns.summary,
        errorMessage: reportRuns.errorMessage,
        sentAt: reportRuns.sentAt,
        createdAt: reportRuns.createdAt,
      })
      .from(reportRuns)
      .where(eq(reportRuns.userId, userId))
      .orderBy(desc(reportRuns.createdAt))
      .limit(limit);
  },

  async listDeliveries(userId: string, limit = 30) {
    const database = await requireDb();
    return database
      .select({
        id: notificationDeliveries.id,
        reportRunId: notificationDeliveries.reportRunId,
        channel: notificationDeliveries.channel,
        category: notificationDeliveries.category,
        status: notificationDeliveries.status,
        providerMessageId: notificationDeliveries.providerMessageId,
        errorMessage: notificationDeliveries.errorMessage,
        sentAt: notificationDeliveries.sentAt,
        createdAt: notificationDeliveries.createdAt,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.userId, userId))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(limit);
  },
};
