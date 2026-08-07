import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  SESSION_EXPIRY_MS,
  REFRESH_TOKEN_EXPIRY_MS,
} from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { publicProcedure, router } from "../_core/trpc";
import { sdk } from "../_core/sdk";
import { logger } from "../_core/logger";
import { toPublicUser } from "../_core/public-views";
import { users } from "../../drizzle/schema";
import * as db from "../db";
import {
  requestPasswordReset,
  resetPassword,
} from "../services/password-reset.service";
import {
  createRefreshToken,
  rotateRefreshToken,
  revokeAllUserTokens,
  revokeRefreshToken,
} from "../_core/auth/refresh-token";

const SALT_ROUNDS = 12;

function getCookieOptions(ctx: { req: any; res: any }) {
  return getSessionCookieOptions(ctx.req);
}

async function setSessionCookies(
  ctx: { req: any; res: any },
  openId: string,
  name: string
) {
  const token = await sdk.createSessionToken(openId, { name });
  const opts = getCookieOptions(ctx);
  ctx.res.cookie(COOKIE_NAME, token, { ...opts, maxAge: SESSION_EXPIRY_MS });
  return token;
}

async function setRefreshCookie(ctx: { req: any; res: any }, userId: string) {
  const raw = await createRefreshToken(userId);
  const opts = getCookieOptions(ctx);
  ctx.res.cookie(REFRESH_COOKIE_NAME, raw, {
    ...opts,
    maxAge: REFRESH_TOKEN_EXPIRY_MS,
    path: "/api/trpc",
  });
  return raw;
}

export const authRouter = router({
  /** Return the currently authenticated user (null if not logged in). */
  me: publicProcedure.query(({ ctx }) =>
    ctx.user ? toPublicUser(ctx.user) : null
  ),

  /** Register a new user with email + password. */
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
        name: z.string().min(1, "Name is required"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await db.getDb();
      if (!database) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      }

      // Check if email already exists
      const existing = await database
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists",
        });
      }

      // Hash password and create user
      const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
      const openId = `local_${nanoid(24)}`;

      const [newUser] = await database
        .insert(users)
        .values({
          openId,
          email: input.email,
          passwordHash,
          name: input.name,
          loginMethod: "email",
          role: "user",
          lastSignedIn: new Date(),
        })
        .returning();

      // Create session JWT and refresh token cookies
      await setSessionCookies(ctx, openId, input.name);
      await setRefreshCookie(ctx, String(newUser.id));

      return {
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
        },
      };
    }),

  /** Login with email + password. */
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(1, "Password is required"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await db.getDb();
      if (!database) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      }

      // Find user by email
      const [user] = await database
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (!user || !user.passwordHash) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      // Verify password
      const isValid = await bcrypt.compare(input.password, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password",
        });
      }

      // Update last signed in
      await database
        .update(users)
        .set({ lastSignedIn: new Date(), updatedAt: new Date() })
        .where(eq(users.id, user.id));

      // Create session JWT and refresh token cookies
      await setSessionCookies(ctx, user.openId!, user.name || "");
      await setRefreshCookie(ctx, String(user.id));

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    }),

  /** Request a password reset email without revealing whether the email exists. */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email("Invalid email address") }))
    .mutation(async ({ input }) => {
      try {
        await requestPasswordReset(input.email.trim().toLowerCase());
      } catch (error) {
        logger.error({ err: error }, "Password reset request failed");
      }

      return {
        success: true,
        message:
          "If an account exists for that email, a password reset link has been sent.",
      } as const;
    }),

  /** Consume a valid reset token and revoke all refresh sessions. */
  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string().min(32, "Invalid reset token"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
      const userId = await resetPassword(input.token.trim(), passwordHash);
      if (!userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This reset link is invalid or has expired.",
        });
      }

      const opts = getCookieOptions(ctx);
      ctx.res.clearCookie(COOKIE_NAME, { ...opts, maxAge: -1 });
      ctx.res.clearCookie(REFRESH_COOKIE_NAME, {
        ...opts,
        maxAge: -1,
        path: "/api/trpc",
      });
      return { success: true } as const;
    }),

  /** Refresh the session JWT using a refresh token (rotation). */
  refreshSession: publicProcedure.mutation(async ({ ctx }) => {
    const raw = ctx.req.cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "No refresh token",
      });
    }
    const result = await rotateRefreshToken(raw);
    if (!result) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid or expired refresh token",
      });
    }
    const user = await sdk.getUserById(result.userId);
    if (!user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "User not found" });
    }
    await setSessionCookies(ctx, user.openId!, user.name || "");
    const opts = getCookieOptions(ctx);
    ctx.res.cookie(REFRESH_COOKIE_NAME, result.newRefresh, {
      ...opts,
      maxAge: REFRESH_TOKEN_EXPIRY_MS,
      path: "/api/trpc",
    });
    return { success: true };
  }),

  /** Logout — clear session cookie and revoke refresh token. */
  logout: publicProcedure.mutation(async ({ ctx }) => {
    const opts = getCookieOptions(ctx);
    ctx.res.clearCookie(COOKIE_NAME, { ...opts, maxAge: -1 });
    const raw = ctx.req.cookies?.[REFRESH_COOKIE_NAME];
    if (raw) {
      try {
        await revokeRefreshToken(raw);
      } catch (error) {
        // Sign-out must still clear the browser session if the database is
        // temporarily unavailable. Keep the revocation failure observable.
        logger.warn({ err: error }, "Refresh token revocation failed on logout");
      }
    }
    ctx.res.clearCookie(REFRESH_COOKIE_NAME, {
      ...opts,
      maxAge: -1,
      path: "/api/trpc",
    });
    return { success: true } as const;
  }),
});
