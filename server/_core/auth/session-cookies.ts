import type { Request, Response } from "express";
import {
  COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_EXPIRY_MS,
  SESSION_EXPIRY_MS,
} from "@shared/const";
import { getSessionCookieOptions } from "../cookies";
import { sdk } from "../sdk";
import { createRefreshToken } from "./refresh-token";

type AuthenticatedUser = {
  id: string;
  openId: string;
  name: string | null;
};

/** Creates the same session and refresh cookies used by the tRPC auth router. */
export async function setAuthSessionCookies(
  req: Request,
  res: Response,
  user: AuthenticatedUser
): Promise<void> {
  const cookieOptions = getSessionCookieOptions(req);
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name ?? "",
  });
  res.cookie(COOKIE_NAME, sessionToken, {
    ...cookieOptions,
    maxAge: SESSION_EXPIRY_MS,
  });

  const refreshToken = await createRefreshToken(user.id);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...cookieOptions,
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
    path: "/api/trpc",
  });
}
