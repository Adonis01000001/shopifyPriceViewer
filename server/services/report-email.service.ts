import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
import {
  notificationDeliveries,
  reportRuns,
  users,
} from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";
import { emailService } from "./email.service";

function formatSummary(summary: unknown): string {
  if (!summary || typeof summary !== "object") return "No report details available.";
  const record = summary as Record<string, unknown>;
  return Object.entries(record)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}

export const reportEmailService = {
  async deliverReport(reportRunId: string) {
    const database = await requireDb();
    const [run] = await database
      .select({
        id: reportRuns.id,
        userId: reportRuns.userId,
        reportType: reportRuns.reportType,
        summary: reportRuns.summary,
        status: reportRuns.status,
        email: users.email,
      })
      .from(reportRuns)
      .innerJoin(users, eq(reportRuns.userId, users.id))
      .where(eq(reportRuns.id, reportRunId))
      .limit(1);
    if (!run) throw new Error("Report run not found");
    if (run.status === "sent") return { sent: true, duplicate: true };
    if (!run.email) throw new Error("Account has no email address");

    const [existing] = await database
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.reportRunId, reportRunId),
          eq(notificationDeliveries.channel, "email")
        )
      )
      .limit(1);
    if (existing?.status === "sent") return { sent: true, duplicate: true };

    const [delivery] = existing
      ? await database
          .update(notificationDeliveries)
          .set({ status: "sending", errorMessage: null })
          .where(eq(notificationDeliveries.id, existing.id))
          .returning()
      : await database
          .insert(notificationDeliveries)
          .values({
            userId: run.userId,
            reportRunId,
            channel: "email",
            category: run.reportType,
            status: "sending",
          })
          .returning();
    if (!delivery) throw new Error("Unable to create notification delivery");

    await database
      .update(reportRuns)
      .set({ status: "sending", errorMessage: null })
      .where(eq(reportRuns.id, reportRunId));

    try {
      const config = await emailService.getByUserId(run.userId);
      if (!config || !config.isEnabled) {
        throw new Error("SMTP delivery is not configured for this account");
      }
      const transport = nodemailer.createTransport({
        host: config.smtpServer,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        auth: { user: config.smtpUsername, pass: config.smtpPassword },
      });
      const result = await transport.sendMail({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: run.email,
        subject: `Price Intelligence — ${run.reportType.replaceAll("_", " ")}`,
        text: formatSummary(run.summary),
      });
      await database
        .update(notificationDeliveries)
        .set({
          status: "sent",
          providerMessageId: result.messageId,
          sentAt: new Date(),
          errorMessage: null,
        })
        .where(eq(notificationDeliveries.id, delivery.id));
      await database
        .update(reportRuns)
        .set({ status: "sent", sentAt: new Date(), errorMessage: null })
        .where(eq(reportRuns.id, reportRunId));
      return { sent: true, duplicate: false };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown email delivery error";
      await database
        .update(notificationDeliveries)
        .set({ status: "failed", errorMessage })
        .where(eq(notificationDeliveries.id, delivery.id));
      await database
        .update(reportRuns)
        .set({ status: "failed", errorMessage })
        .where(eq(reportRuns.id, reportRunId));
      throw error;
    }
  },
};
