import { COOKIE_NAME } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as cookie from "cookie";
import { randomBytes } from "node:crypto";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk, encryptToken, isValidShopDomain } from "./sdk";
import * as db from "../db";
import { eq, and } from "drizzle-orm";
import { shopifyStores, users } from "../../drizzle/schema";
import { logger } from "./logger";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // ── Shopify OAuth ───────────────────────────────────────────────────────

  /**
   * GET /api/shopify/login
   *
   * Entry point for connecting a Shopify store. If the user already has
   * an active store, redirects to dashboard. Otherwise shows a form to
   * enter their store domain which then proceeds to the OAuth flow.
   */
  app.get("/api/shopify/login", async (req: Request, res: Response) => {
    const cookies = req.headers.cookie
      ? new Map(Object.entries(cookie.parse(req.headers.cookie)))
      : new Map();
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await sdk.verifySession(sessionCookie);

    if (!session) {
      res.redirect(302, "/auth");
      return;
    }

    // Check if user already has a connected store
    const database = await db.getDb();
    let hasStore = false;
    if (database) {
      const [user] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.openId, session.openId))
        .limit(1);
      if (user) {
        const store = await database.query.shopifyStores.findFirst({
          where: and(eq(shopifyStores.userId, user.id), eq(shopifyStores.isActive, true)),
        });
        hasStore = !!store;
      }
    }

    if (hasStore) {
      res.redirect(302, "/");
      return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Shopify Store</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f0b2e; color: #e0e0e0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1a1145; border-radius: 12px; padding: 40px; width: 100%; max-width: 420px; box-shadow: 0 4px 24px rgba(0,0,0,0.3); }
    h1 { font-size: 20px; margin-bottom: 8px; color: #fff; }
    p { font-size: 13px; color: #9e9eb8; margin-bottom: 24px; }
    label { display: block; font-size: 12px; color: #b0b0cc; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #2d2a5e; background: #0f0b2e; color: #e0e0e0; font-size: 14px; outline: none; }
    input:focus { border-color: #818cf8; }
    .hint { font-size: 11px; color: #7c7c9e; margin-top: 4px; }
    button { margin-top: 20px; width: 100%; padding: 10px; border-radius: 8px; border: none; background: #818cf8; color: #fff; font-size: 14px; font-weight: 500; cursor: pointer; }
    button:hover { background: #6d78e8; }
    .error { color: #f87171; font-size: 12px; margin-top: 8px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect Your Shopify Store</h1>
    <p>Enter your store domain to connect it to Price Intelligence.</p>
    <form id="shopify-form">
      <label for="shop">Store domain</label>
      <input type="text" id="shop" placeholder="mystore" autofocus />
      <div class="hint">e.g. mystore.myshopify.com</div>
      <div class="error" id="error-msg">Please enter a valid shop domain</div>
      <button type="submit">Connect Store</button>
    </form>
  </div>
  <script>
    document.getElementById('shopify-form').addEventListener('submit', function(e) {
      e.preventDefault();
      const shop = document.getElementById('shop').value.trim().toLowerCase();
      const domain = shop.includes('.myshopify.com') ? shop : shop + '.myshopify.com';
      if (domain.length < 15 || !/^[a-z0-9][a-z0-9-]*\\.myshopify\\.com$/.test(domain)) {
        document.getElementById('error-msg').style.display = 'block';
        return;
      }
      window.location.href = '/api/shopify/connect?shop=' + encodeURIComponent(domain);
    });
  </script>
</body>
</html>`);
  });

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
      ? new Map(Object.entries(cookie.parse(req.headers.cookie)))
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
    const state = randomBytes(16).toString("hex");
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
        // `userId` from the state cookie is the session's openId; resolve it
        // to the users.id UUID that shopify_stores.user_id references.
        const [user] = await database
          .select({ id: users.id })
          .from(users)
          .where(eq(users.openId, userId))
          .limit(1);

        if (!user) {
          res.status(401).json({ error: "User not found. Please sign in again." });
          return;
        }

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
            userId: user.id,
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
      ? new Map(Object.entries(cookie.parse(req.headers.cookie)))
      : new Map();
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await sdk.verifySession(sessionCookie);

    if (!session) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const database = await db.getDb();
    if (database) {
      const [user] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.openId, session.openId))
        .limit(1);

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      await database
        .update(shopifyStores)
        .set({ isActive: false, accessToken: null, updatedAt: new Date() })
        .where(
          and(
            eq(shopifyStores.userId, user.id),
            eq(shopifyStores.shopDomain, shopDomain)
          )
        );
    }

    res.json({ success: true, message: `Store ${shopDomain} disconnected` });
  });
}
