import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk, encryptToken, isValidShopDomain, verifyShopifyHmac } from "./sdk";
import * as db from "../db";
import { eq, and } from "drizzle-orm";
import { shopifyStores } from "../../drizzle/schema";
import { logger } from "./logger";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // ── Legacy OAuth portal callback (kept for backward compat) ─────────────

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await sdk.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.redirect(302, "/");
    } catch (error) {
      logger.error({ err: error }, "OAuth callback failed");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  // ── Direct Shopify OAuth ────────────────────────────────────────────────

  /**
   * GET /api/shopify/connect?shop=mystore.myshopify.com
   *
   * Initiates the Shopify OAuth flow by redirecting to Shopify's
   * permission grant screen. The user must be authenticated (session cookie).
   */
  app.get("/api/shopify/connect", async (req: Request, res: Response) => {
    const shop = getQueryParam(req, "shop");

    if (!shop || !isValidShopDomain(shop)) {
      res
        .status(400)
        .json({ error: "Valid shop parameter required (*.myshopify.com)" });
      return;
    }

    if (!ENV.shopifyApiKey || !ENV.shopifyApiSecret) {
      res.status(503).json({
        error:
          "Shopify app not configured. Set SHOPIFY_API_KEY and SHOPIFY_API_SECRET.",
      });
      return;
    }

    // Verify user is authenticated via session
    const cookies = req.headers.cookie
      ? new Map(Object.entries(require("cookie").parse(req.headers.cookie)))
      : new Map();
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await sdk.verifySession(sessionCookie);

    if (!session) {
      res
        .status(401)
        .json({ error: "Authentication required. Please sign in first." });
      return;
    }

    // Build the Shopify OAuth URL.
    // SECURITY (S5146): do not interpolate the raw `shop` query param into the
    // redirect target. Extract the validated shop slug and reconstruct the
    // authority from it, so the redirect URL is derived solely from trusted data.
    const crypto = require("crypto");
    const state = crypto.randomBytes(16).toString("hex");
    const redirectUri = `${ENV.shopifyAppUrl}/api/shopify/callback`;

    const shopSlug = shop.replace(/\.myshopify\.com$/, "");
    // Re-validate the slug contains only safe subdomain characters.
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(shopSlug)) {
      res.status(400).json({ error: "Invalid shop parameter" });
      return;
    }
    const authUrl = new URL(
      `https://${shopSlug}.myshopify.com/admin/oauth/authorize`
    );
    authUrl.searchParams.set("client_id", ENV.shopifyApiKey);
    authUrl.searchParams.set("scope", ENV.shopifyScopes);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);

    // Store state → user mapping in a temporary cookie for callback verification
    res.cookie(
      "shopify_oauth_state",
      JSON.stringify({ state, userId: session.openId, shop }),
      {
        httpOnly: true,
        secure: ENV.isProduction,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000, // 10 minutes
      }
    );

    res.redirect(302, authUrl.toString());
  });

  /**
   * GET /api/shopify/callback?shop=mystore.myshopify.com&code=xxx&state=xxx
   *
   * Handles the Shopify OAuth callback. Exchanges the code for an access token
   * and stores it encrypted in the database.
   */
  app.get("/api/shopify/callback", async (req: Request, res: Response) => {
    const shop = getQueryParam(req, "shop");
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!shop || !code || !state) {
      res.status(400).json({ error: "shop, code, and state are required" });
      return;
    }

    if (!isValidShopDomain(shop)) {
      res.status(400).json({ error: "Invalid shop domain" });
      return;
    }

    // Verify state cookie to prevent CSRF
    const stateCookie = req.cookies?.shopify_oauth_state;
    if (!stateCookie) {
      res
        .status(400)
        .json({ error: "OAuth state expired or missing. Please try again." });
      return;
    }

    try {
      const { state: storedState, userId } = JSON.parse(stateCookie);
      if (storedState !== state) {
        res.status(400).json({ error: "Invalid OAuth state" });
        return;
      }

      // Exchange code for access token
      const tokenUrl = `https://${shop}/admin/oauth/access_token`;
      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: ENV.shopifyApiKey,
          client_secret: ENV.shopifyApiSecret,
          code,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text().catch(() => "");
        logger.error(
          { status: tokenRes.status, err: errText },
          "Shopify token exchange failed"
        );
        res
          .status(400)
          .json({ error: "Failed to exchange code for access token" });
        return;
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData?.access_token;
      if (!accessToken) {
        res.status(400).json({ error: "No access token in Shopify response" });
        return;
      }

      // Encrypt token before storing
      const encryptedToken = encryptToken(accessToken);

      // Store in database
      const database = await db.getDb();
      if (database) {
        // Check if store already exists for this user
        const existing = await database.query.shopifyStores.findFirst({
          where: eq(shopifyStores.shopDomain, shop),
        });

        if (existing) {
          await database
            .update(shopifyStores)
            .set({
              accessToken: encryptedToken,
              scopes: ENV.shopifyScopes,
              isActive: true,
              updatedAt: new Date(),
            })
            .where(eq(shopifyStores.id, existing.id));
        } else {
          await database.insert(shopifyStores).values({
            userId,
            shopDomain: shop,
            accessToken: encryptedToken,
            scopes: ENV.shopifyScopes,
            storeName: shop.split(".")[0].replace(/-/g, " "),
            currency: "USD",
            isActive: true,
          });
        }
      }

      // Clear the state cookie
      res.clearCookie("shopify_oauth_state");

      // Redirect to dashboard with success
      res.redirect(302, "/?shopify_connected=true");
    } catch (error) {
      logger.error({ err: error }, "Shopify OAuth callback failed");
      res.status(500).json({ error: "Shopify connection failed" });
    }
  });

  /**
   * DELETE /api/shopify/disconnect?shopDomain=mystore.myshopify.com
   *
   * Disconnects a Shopify store. User must be authenticated.
   */
  app.delete("/api/shopify/disconnect", async (req: Request, res: Response) => {
    const shopDomain = getQueryParam(req, "shopDomain");

    if (!shopDomain) {
      res.status(400).json({ error: "shopDomain is required" });
      return;
    }

    const cookies = req.headers.cookie
      ? new Map(Object.entries(require("cookie").parse(req.headers.cookie)))
      : new Map();
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await sdk.verifySession(sessionCookie);

    if (!session) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const database = await db.getDb();
    if (database) {
      await database
        .update(shopifyStores)
        .set({ isActive: false, accessToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(shopifyStores.userId, session.openId),
            eq(shopifyStores.shopDomain, shopDomain)
          )
        );
    }

    res.json({ success: true, message: `Store ${shopDomain} disconnected` });
  });
}
