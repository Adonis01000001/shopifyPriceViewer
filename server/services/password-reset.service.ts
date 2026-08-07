import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  passwordResetTokens,
  refreshTokens,
  users,
} from "../../drizzle/schema";
import { ENV } from "../_core/env";
import { logger } from "../_core/logger";
import * as db from "../db";

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function isPlatformSmtpConfigured(): boolean {
  return Boolean(
    ENV.smtpServer &&
      ENV.smtpPort &&
      ENV.smtpUsername &&
      ENV.smtpPassword &&
      ENV.smtpFromEmail
  );
}

async function sendResetEmail(
  email: string,
  rawToken: string
): Promise<void> {
  if (!isPlatformSmtpConfigured()) {
    throw new Error(
      "Platform SMTP is not configured; set SMTP_SERVER, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL"
    );
  }

  const resetUrl = new URL("/auth", ENV.appUrl);
  // Keep the token in the fragment so it is not sent in HTTP request logs or
  // referrer headers when the reset page is opened.
  resetUrl.hash = `resetToken=${encodeURIComponent(rawToken)}`;
  const transport = nodemailer.createTransport({
    host: ENV.smtpServer,
    port: ENV.smtpPort,
    secure: ENV.smtpPort === 465,
    auth: { user: ENV.smtpUsername, pass: ENV.smtpPassword },
  });

  await transport.sendMail({
    from: `${ENV.smtpFromName} <${ENV.smtpFromEmail}>`,
    to: email,
    subject: "Reset your PriceIntel password",
    text: [
      "We received a request to reset your PriceIntel password.",
      "",
      `Use this link within 30 minutes: ${resetUrl.toString()}`,
      "",
      "If you did not request this, you can safely ignore this email.",
    ].join("\n"),
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const database = await db.getDb();
  if (!database) throw new Error("Database unavailable");

  const [user] = await database
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  if (!user?.email) return;

  if (!isPlatformSmtpConfigured()) {
    throw new Error(
      "Platform SMTP is not configured for password recovery email delivery"
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
  const rawToken = crypto.randomBytes(32).toString("base64url");

  await database.transaction(async tx => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt))
      );
    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt,
    });
  });

  try {
    await sendResetEmail(user.email, rawToken);
  } catch (error) {
    await database
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(rawToken)),
          isNull(passwordResetTokens.usedAt)
        )
      )
      .catch(revokeError => {
        logger.error(
          { err: revokeError },
          "Failed to invalidate undelivered password reset token"
        );
      });
    logger.error({ err: error }, "Password reset email delivery failed");
    throw error;
  }
}

export async function resetPassword(
  rawToken: string,
  passwordHash: string
): Promise<string | null> {
  const database = await db.getDb();
  if (!database) throw new Error("Database unavailable");

  const now = new Date();
  const tokenHash = hashToken(rawToken);
  return database.transaction(async tx => {
    const [token] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      )
      .returning({ userId: passwordResetTokens.userId });
    if (!token) return null;

    await tx
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, token.userId));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(eq(refreshTokens.userId, token.userId), isNull(refreshTokens.revokedAt))
      );
    return token.userId;
  });
}
