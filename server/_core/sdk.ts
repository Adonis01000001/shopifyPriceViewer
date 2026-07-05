/**
 * SDK Server — orchestrates authentication and token security.
 *
 * Delegates to:
 * - auth/jwt.ts          — JWT session creation/verification, user DB ops
 * - auth/hmac.ts         — Shopify HMAC verification, domain validation
 * - auth/token-crypto.ts — AES-256-CBC token encryption/decryption
 */

import { COOKIE_NAME } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import type { InsertUser, User } from "../../drizzle/schema";
import {
  createSessionToken,
  getUserByOpenId,
  getUserById,
  upsertUser,
  verifySession,
  type SessionPayload,
} from "./auth/jwt";
import {
  verifyShopifyHmac,
  verifyWebhookHmac,
  isValidShopDomain,
} from "./auth/hmac";
import { encryptToken, decryptToken } from "./auth/token-crypto";

// Re-export for backward compatibility
export { verifyShopifyHmac, verifyWebhookHmac, isValidShopDomain };
export { encryptToken, decryptToken };
export type { SessionPayload };

// ── SDK Server ────────────────────────────────────────────────────────────

class SDKServer {
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return createSessionToken(openId, options);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<SessionPayload | null> {
    return verifySession(cookieValue);
  }

  async upsertUser(user: InsertUser): Promise<void> {
    return upsertUser(user);
  }

  async getUserByOpenId(openId: string): Promise<User | undefined> {
    return getUserByOpenId(openId);
  }

  async getUserById(id: string): Promise<User | undefined> {
    return getUserById(id);
  }

  async authenticateRequest(req: Request): Promise<User> {
    const cookieHeader: string = req.headers.cookie || "";
    const cookies = parseCookieHeader(cookieHeader);
    const sessionCookie = cookies[COOKIE_NAME];
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    const user = await this.getUserByOpenId(session.openId);

    if (!user) {
      throw ForbiddenError("User not found");
    }

    await this.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
    return user;
  }
}

export const sdk = new SDKServer();
