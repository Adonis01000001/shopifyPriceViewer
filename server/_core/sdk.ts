/**
 * SDK Server — orchestrates authentication and OAuth flows.
 *
 * Delegates to:
 * - auth/jwt.ts          — JWT session creation/verification, user DB ops
 * - auth/hmac.ts         — Shopify HMAC verification, domain validation
 * - auth/token-crypto.ts — AES-256-CBC token encryption/decryption
 */

import { AXIOS_TIMEOUT_MS, COOKIE_NAME } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import axios, { type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import type { InsertUser, User } from "../../drizzle/schema";
import { ENV } from "./env";
import {
  createSessionToken,
  getUserByOpenId,
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
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
import { logger } from "./logger";

// Re-export for backward compatibility
export { verifyShopifyHmac, verifyWebhookHmac, isValidShopDomain };
export { encryptToken, decryptToken };
export type { SessionPayload };

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

function deriveLoginMethod(
  platforms: unknown,
  fallback: string | null | undefined
): string | null {
  if (fallback && fallback.length > 0) return fallback;
  if (!Array.isArray(platforms) || platforms.length === 0) return null;
  const set = new Set<string>(
    platforms.filter((p): p is string => typeof p === "string")
  );
  if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
  if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
  if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
  if (
    set.has("REGISTERED_PLATFORM_MICROSOFT") ||
    set.has("REGISTERED_PLATFORM_AZURE")
  )
    return "microsoft";
  if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
  const first = Array.from(set)[0];
  return first ? first.toLowerCase() : null;
}

// ── Legacy OAuth (portal-based) ──────────────────────────────────────────

class OAuthService {
  constructor(private client: ReturnType<typeof axios.create>) {
    logger.debug({ baseURL: ENV.oAuthServerUrl }, "OAuth service initialized");
    if (!ENV.oAuthServerUrl) {
      logger.warn("OAUTH_SERVER_URL is not configured");
    }
  }

  private decodeState(state: string): string {
    return atob(state);
  }

  async getTokenByCode(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };
    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      }
    );
    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  axios.create({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

// ── Authenticated user type ──────────────────────────────────────────────

const CRON_OPEN_ID_PREFIX = "cron_";

export type AuthenticatedUser = User & {
  taskUid?: string;
  isCron?: boolean;
};

function buildCronUser(
  userInfo: GetUserInfoWithJwtResponse
): AuthenticatedUser {
  const now = new Date();
  return {
    id: "00000000-0000-0000-0000-000000000000" as any,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? undefined,
    isCron: true,
  } as AuthenticatedUser;
}

// ── SDK Server ────────────────────────────────────────────────────────────

class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(client: AxiosInstance = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  // Legacy OAuth
  async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  // Session / JWT — delegates to auth/jwt.ts
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

  async getUserInfoWithJwt(
    jwtToken: string
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };
    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  // User DB operations — delegates to auth/jwt.ts
  async upsertUser(user: InsertUser): Promise<void> {
    return upsertUser(user);
  }

  async getUserByOpenId(openId: string): Promise<User | undefined> {
    return getUserByOpenId(openId);
  }

  // Request authentication
  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    const cookieHeader: string = req.headers.cookie || "";
    const cookies: Record<string, string> = parseCookieHeader(cookieHeader);
    const sessionCookie = cookies[COOKIE_NAME];
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionCookie || "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) throw ForbiddenError("Cron session missing task_uid");
      return buildCronUser(userInfo);
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user = await this.getUserByOpenId(sessionUserId);

    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie || "");
        await this.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt,
        });
        user = await this.getUserByOpenId(userInfo.openId);
      } catch (error) {
        logger.error({ err: error }, "Failed to sync user from OAuth");
        throw ForbiddenError("Failed to sync user info");
      }
    }

    if (!user) throw ForbiddenError("User not found");

    await this.upsertUser({ openId: user.openId, lastSignedIn: signedInAt });
    return user;
  }
}

export const sdk = new SDKServer();
