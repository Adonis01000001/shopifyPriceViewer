import { doubleCsrf } from "csrf-csrf";
import type { Request } from "express";
import { ENV } from "./env";

const CSRF_SECRET = process.env.JWT_SECRET ?? "change-me-in-production";

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  getSessionIdentifier: (_req: Request) => "anonymous",
  cookieName: "__csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "strict",
    secure: ENV.isProduction,
    path: "/",
  },
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
});

export { doubleCsrfProtection };

/**
 * Middleware to attach a fresh CSRF token to response locals.
 * Use in routes that need to provide a token to the frontend.
 */
export function csrfTokenMiddleware(req: any, res: any, next: any) {
  res.locals.csrfToken = generateCsrfToken(req, res);
  next();
}
