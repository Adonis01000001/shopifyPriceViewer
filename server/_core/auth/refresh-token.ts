import crypto from "crypto";
import { eq, and, isNull, gt } from "drizzle-orm";
import { REFRESH_TOKEN_EXPIRY_MS } from "@shared/const";
import { refreshTokens } from "../../../drizzle/schema";
import { requireDb } from "../db-assert";

/** Hash a raw token using SHA-256 for secure storage. */
function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function createRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  const database = await requireDb();
  await database.insert(refreshTokens).values({
    userId,
    tokenHash,
    expiresAt,
  });
  return raw;
}

export async function rotateRefreshToken(oldRaw: string): Promise<{ newRefresh: string; userId: string } | null> {
  const oldHash = hashToken(oldRaw);
  const database = await requireDb();

  // Find the token record — must be non-revoked and not expired
  const now = new Date();
  const result = await database
    .select()
    .from(refreshTokens)
    .where(and(
      eq(refreshTokens.tokenHash, oldHash),
      isNull(refreshTokens.revokedAt),
      gt(refreshTokens.expiresAt, now),
    ))
    .limit(1);
  const existing = result[0];

  if (!existing) return null;

  // Revoke the old token (single-use rotation)
  await database
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(eq(refreshTokens.id, existing.id));

  // Issue a new refresh token
  const newRaw = await createRefreshToken(existing.userId);
  return { newRefresh: newRaw, userId: existing.userId };
}

export function revokeRefreshToken(raw: string): void {
  // Fire-and-forget revocation — caller doesn't need to await
  const tokenHash = hashToken(raw);
  requireDb().then(database =>
    database
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, tokenHash))
  ).catch(() => { /* best-effort */ });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  const database = await requireDb();
  await database
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/** Cleanup expired tokens — run periodically (e.g., via cron). */
export async function purgeExpiredTokens(): Promise<number> {
  const database = await requireDb();
  const now = new Date();
  const result = await database
    .delete(refreshTokens)
    .where(gt(refreshTokens.expiresAt, now));
  return (result as unknown as { rowCount: number }).rowCount ?? 0;
}
