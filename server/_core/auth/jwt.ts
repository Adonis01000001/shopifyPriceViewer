import { SESSION_EXPIRY_MS } from "@shared/const";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import type { InsertUser, User } from "../../../drizzle/schema";
import { users } from "../../../drizzle/schema";
import * as db from "../../db";
import { ENV } from "../env";
import { logger } from "../logger";

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

function getSessionSecret() {
  return new TextEncoder().encode(ENV.jwtSecret);
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export async function createSessionToken(
  openId: string,
  options: { expiresInMs?: number; name?: string } = { expiresInMs: SESSION_EXPIRY_MS }
): Promise<string> {
  return signSession(
    { openId, appId: ENV.appId, name: options.name || "" },
    options
  );
}

export async function signSession(
  payload: SessionPayload,
  options: { expiresInMs?: number } = {}
): Promise<string> {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? SESSION_EXPIRY_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
  const secretKey = getSessionSecret();
  return new SignJWT({ openId: payload.openId, appId: payload.appId, name: payload.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(secretKey);
}

export async function verifySession(
  cookieValue: string | undefined | null
): Promise<SessionPayload | null> {
  if (!cookieValue) {
    logger.debug("Session verification failed: missing cookie");
    return null;
  }
  try {
    const secretKey = getSessionSecret();
    const { payload } = await jwtVerify(cookieValue, secretKey, { algorithms: ["HS256"] });
    const { openId, appId, name } = payload as Record<string, unknown>;
    if (!isNonEmptyString(openId)) {
      logger.warn("Session verification failed: payload missing required fields");
      return null;
    }
    return { openId, appId: String(appId ?? ""), name: String(name ?? "") };
  } catch (error) {
    logger.debug({ err: error }, "Session verification failed");
    return null;
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  const database = await db.getDb();
  if (!database) {
    logger.warn("Cannot upsert user: database not available");
    return;
  }
  await database.insert(users).values(user).onConflictDoUpdate({
    target: users.openId,
    set: {
      name: user.name,
      email: user.email,
      loginMethod: user.loginMethod,
      lastSignedIn: user.lastSignedIn ?? new Date(),
      updatedAt: new Date(),
    },
  });
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const database = await db.getDb();
  if (!database) {
    logger.warn("Cannot get user: database not available");
    return undefined;
  }
  const result = await database.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}
