import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { eq } from "drizzle-orm";
import type { User } from "../../drizzle/schema";
import { users } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { sdk } from "./sdk";
import { logger } from "./logger";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

async function getFirstUser(): Promise<User | null> {
  try {
    const database = await db.getDb();
    if (!database) return null;
    const result = await database
      .select()
      .from(users)
      .limit(1);
    return result[0] ?? null;
  } catch {
    return null;
  }
}

function createDevUser(): User {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    openId: "dev-local",
    email: "dev@example.com",
    name: "Local Developer",
    role: "user",
    avatarUrl: null,
    loginMethod: "local",
    passwordHash: null,
    lastSignedIn: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as User;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    // Authentication is optional for public procedures.
  }

  // Dev bypass: auto-authenticate in non-production when bypass is enabled.
  // CRITICAL: Double-gated — bypass is NEVER active in production, regardless of env var.
  if (!user) {
    if (ENV.isProduction && ENV.bypassAuth) {
      logger.error("bypassAuth was set to true in production — ignoring. Remove VITE_BYPASS_AUTH from production env.");
    } else if (ENV.bypassAuth) {
      user = await getFirstUser() ?? createDevUser();
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
