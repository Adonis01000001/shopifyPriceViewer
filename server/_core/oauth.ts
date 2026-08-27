import { COOKIE_NAME } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as cookie from "cookie";
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import {
  sdk,
  encryptToken,
  isValidShopDomain,
  verifyShopifyHmac,
} from "./sdk";
import * as db from "../db";
import { eq, and } from "drizzle-orm";
import { shopifyStores, users } from "../../drizzle/schema";
import { logger } from "./logger";
import { setAuthSessionCookies } from "./auth/session-cookies";

const GOOGLE_STATE_COOKIE = "google_oauth_state";
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

type GoogleOAuthState = {
  state: string;
  nonce: string;
  createdAt: number;
};

function createGoogleState(): GoogleOAuthState {
  return {
    state: randomBytes(24).toString("hex"),
    nonce: randomBytes(24).toString("hex"),
    createdAt: Date.now(),
  };
}

function encodeGoogleState(state: GoogleOAuthState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", ENV.jwtSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function decodeGoogleState(value: string): GoogleOAuthState | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = createHmac("sha256", ENV.jwtSecret)
    .update(payload)
    .digest("base64url");
  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<GoogleOAuthState>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > GOOGLE_STATE_TTL_MS
    ) {
      return null;
    }
    return parsed as GoogleOAuthState;
  } catch {
    return null;
  }
}

function clearGoogleStateCookie(req: Request, res: Response): void {
  res.clearCookie(GOOGLE_STATE_COOKIE, getSessionCookieOptions(req));
}

function redirectGoogleError(res: Response, code: string): void {
  res.redirect(302, `/auth?oauth_error=${encodeURIComponent(code)}`);
}

async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
  if (!ENV.googleClientId || !ENV.googleClientSecret) {
    redirectGoogleError(res, "google_not_configured");
    return;
  }

  const state = getQueryParam(req, "state");
  const code = getQueryParam(req, "code");
  const oauthError = getQueryParam(req, "error");
  const stateCookie = req.cookies?.[GOOGLE_STATE_COOKIE];

  if (oauthError) {
    clearGoogleStateCookie(req, res);
    redirectGoogleError(res, "google_cancelled");
    return;
  }
  if (!state || !code || !stateCookie) {
    redirectGoogleError(res, "google_state_invalid");
    return;
  }

  const storedState = decodeGoogleState(stateCookie);
  if (!storedState || storedState.state !== state) {
    clearGoogleStateCookie(req, res);
    redirectGoogleError(res, "google_state_invalid");
    return;
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: ENV.googleClientId,
        client_secret: ENV.googleClientSecret,
        redirect_uri: ENV.googleRedirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      logger.warn(
        { status: tokenResponse.status },
        "Google OAuth token exchange failed"
      );
      clearGoogleStateCookie(req, res);
      redirectGoogleError(res, "google_exchange_failed");
      return;
    }

    const tokenData = (await tokenResponse.json()) as {
      id_token?: unknown;
    };
    if (typeof tokenData.id_token !== "string") {
      clearGoogleStateCookie(req, res);
      redirectGoogleError(res, "google_identity_missing");
      return;
    }

    const verified = await jwtVerify(tokenData.id_token, googleJwks, {
      audience: ENV.googleClientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    const claims = verified.payload;
    if (
      claims.nonce !== storedState.nonce ||
      typeof claims.sub !== "string" ||
      typeof claims.email !== "string" ||
      claims.email_verified !== true
    ) {
      clearGoogleStateCookie(req, res);
      redirectGoogleError(res, "google_identity_invalid");
      return;
    }

    const email = claims.email.trim().toLowerCase();
    if (!email || email.length > 320) {
      clearGoogleStateCookie(req, res);
      redirectGoogleError(res, "google_identity_invalid");
      return;
    }

    const database = await db.getDb();
    if (!database) {
      logger.error(
        "Google OAuth login failed because the database is unavailable"
      );
      clearGoogleStateCookie(req, res);
      redirectGoogleError(res, "google_database_unavailable");
      return;
    }

    const providerOpenId = `google_${claims.sub}`;
    let [user] = await database
      .select()
      .from(users)
      .where(eq(users.openId, providerOpenId))
      .limit(1);

    if (!user) {
      [user] = await database
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
    }

    if (!user) {
      const [createdUser] = await database
        .insert(users)
        .values({
          openId: providerOpenId,
          email,
          name: typeof claims.name === "string" ? claims.name : null,
          loginMethod: "google",
          avatarUrl: typeof claims.picture === "string" ? claims.picture : null,
          lastSignedIn: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      user = createdUser;
    }

    if (!user) {
      [user] = await database
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
    }
    if (!user || !user.openId) {
      logger.error("Google OAuth login did not resolve a local user");
      clearGoogleStateCookie(req, res);
      redirectGoogleError(res, "google_account_failed");
      return;
    }

    await database
      .update(users)
      .set({ lastSignedIn: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await setAuthSessionCookies(req, res, {
      id: String(user.id),
      openId: user.openId,
      name: user.name,
    });
    clearGoogleStateCookie(req, res);
    res.redirect(302, "/");
  } catch (error) {
    logger.error({ err: error }, "Google OAuth callback failed");
    clearGoogleStateCookie(req, res);
    redirectGoogleError(res, "google_login_failed");
  }
}

/**
 * Connect failures used to return raw JSON on a blank page, which is what the
 * merchant saw as the very first thing the product ever showed them. This
 * renders the same information as a page they can act on.
 */
function sendConnectError(
  res: Response,
  status: number,
  heading: string,
  detail: string
) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(status).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connect your Shopify store</title>
<style>
 *{box-sizing:border-box} body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f0b2e;color:#e0e0e0}
 .card{background:#1a1145;border-radius:12px;padding:36px;max-width:460px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.3)}
 h1{font-size:19px;margin:0 0 10px;color:#fff} p{font-size:14px;line-height:1.6;color:#b6b6d0;margin:0 0 22px}
 a{display:inline-block;padding:10px 18px;border-radius:8px;background:#818cf8;color:#fff;text-decoration:none;font-size:14px}
 a:hover{background:#6d78e8}
</style></head>
<body><div class="card">
 <h1>${heading}</h1>
 <p>${detail}</p>
 <a href="/api/shopify/login">Try again</a>
</div></body></html>`);
}

const SHOPIFY_API_VERSION = "2025-01";

/**
 * Shopify only sends webhooks a shop is subscribed to. Without this the
 * uninstall handler never fires, so an app removed from a store leaves us
 * holding a dead token and a permanent claim on that shop domain.
 *
 * Failures are logged rather than thrown: a merchant who has just approved
 * the permissions should end up connected even if this call does not land.
 */
async function registerShopifyWebhooks(shop: string, accessToken: string) {
  const address = `${ENV.appUrl.replace(/\/$/, "")}/api/shopify/webhooks`;
  const topics = [
    "app/uninstalled",
    "customers/data_request",
    "customers/redact",
    "shop/redact",
  ];

  for (const topic of topics) {
    try {
      const response = await fetch(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
          signal: AbortSignal.timeout(15000),
        }
      );
      // 422 is Shopify's "already subscribed", which is success for us.
      if (!response.ok && response.status !== 422) {
        logger.warn(
          { shop, topic, status: response.status },
          "Shopify webhook subscription rejected"
        );
      }
    } catch (err) {
      logger.warn({ shop, topic, err }, "Shopify webhook subscription failed");
    }
  }
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/google/start", (req: Request, res: Response) => {
    if (!ENV.googleClientId || !ENV.googleClientSecret) {
      redirectGoogleError(res, "google_not_configured");
      return;
    }

    const oauthState = createGoogleState();
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", ENV.googleClientId);
    authUrl.searchParams.set("redirect_uri", ENV.googleRedirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", oauthState.state);
    authUrl.searchParams.set("nonce", oauthState.nonce);
    authUrl.searchParams.set("prompt", "select_account");
    authUrl.searchParams.set("access_type", "online");

    res.cookie(GOOGLE_STATE_COOKIE, encodeGoogleState(oauthState), {
      ...getSessionCookieOptions(req),
      maxAge: GOOGLE_STATE_TTL_MS,
    });
    res.redirect(302, authUrl.toString());
  });

  app.get("/api/oauth/google/callback", (req: Request, res: Response) => {
    void handleGoogleCallback(req, res);
  });
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
    <form id="shopify-form" action="/shopify/start" method="get">
      <label for="shop">Store domain</label>
      <input type="text" id="shop" name="shop" placeholder="mystore" autofocus />
      <div class="hint">e.g. mystore.myshopify.com</div>
      <div class="error" id="error-msg">Please enter a valid shop domain</div>
      <button type="submit">Connect Store</button>
    </form>
  </div>
</body>
</html>`);
  });

  /**
   * GET /shopify/connect?shop=mystore.myshopify.com
   *
   * Initiates the Shopify OAuth flow by redirecting to Shopify's
   * permission grant screen. The user must be authenticated (session cookie).
   * The /api/shopify/connect alias remains for backwards compatibility with
   * existing clients and integrations.
   */
  /**
   * The connect form accepts either the store handle on its own
   * ("my-store") or the full domain ("my-store.myshopify.com").
   */
  const normalizeShopDomain = (value: string | undefined) => {
    const trimmed = value?.trim().toLowerCase().replace(/\/+$/, "");
    if (!trimmed) return trimmed;
    const withoutScheme = trimmed.replace(/^https?:\/\//, "");
    if (withoutScheme.includes(".")) return withoutScheme;
    return `${withoutScheme}.myshopify.com`;
  };

  const handleShopifyConnect = async (
    req: Request,
    res: Response,
    interactive = false
  ) => {
    const shop = normalizeShopDomain(getQueryParam(req, "shop"));

    if (!shop || !isValidShopDomain(shop)) {
      sendConnectError(
        res,
        400,
        "That does not look like a Shopify store address",
        "Enter the full address of your store, ending in .myshopify.com &mdash; for example <strong>my-store.myshopify.com</strong>."
      );
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

    const database = await db.getDb();
    if (!database) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    const [user] = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, session.openId))
      .limit(1);
    if (!user) {
      res.status(401).json({ error: "Authenticated user not found" });
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
      JSON.stringify({ state, userId: user.id, shop }),
      {
        httpOnly: true,
        secure: ENV.isProduction,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000, // 10 minutes
      }
    );

    if (interactive) {
      const safeAuthUrl = authUrl.toString().replace(/&/g, "&amp;");
      res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Continue to Shopify</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f0b2e;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1145;border-radius:12px;padding:40px;width:100%;max-width:420px;box-shadow:0 4px 24px rgba(0,0,0,.3)}h1{font-size:20px;margin-bottom:8px;color:#fff}p{font-size:13px;color:#b0b0cc;margin-bottom:24px}a{display:block;text-align:center;padding:10px;border-radius:8px;background:#818cf8;color:#fff;text-decoration:none;font-size:14px;font-weight:500}a:hover{background:#6d78e8}</style></head>
<body><div class="card"><h1>Continue to Shopify</h1><p>Authorize Price Intelligence to access your store.</p><a href="${safeAuthUrl}">Continue</a></div></body></html>`);
      return;
    }

    res.redirect(302, authUrl.toString());
  };

  app.get("/shopify/connect", (req, res) =>
    handleShopifyConnect(req, res, true)
  );
  app.get("/shopify/start", (req, res) =>
    handleShopifyConnect(req, res, true)
  );
  app.get("/api/shopify/connect", (req, res) =>
    handleShopifyConnect(req, res)
  );

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

    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value !== "string") {
        res.status(400).json({ error: "Invalid OAuth query parameters" });
        return;
      }
      queryParams[key] = value;
    }
    if (!verifyShopifyHmac(queryParams)) {
      res.status(400).json({ error: "Invalid Shopify OAuth signature" });
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

      await registerShopifyWebhooks(shop, accessToken);

      // Encrypt token before storing
      const encryptedToken = encryptToken(accessToken);

      // Store in database
      const database = await db.getDb();
      if (!database) {
        // Redirecting to a success page without having saved anything left the
        // app claiming a store it did not have, and the only symptom was an
        // onboarding step that never ticked off.
        sendConnectError(
          res,
          503,
          "Could not save the connection",
          "Your store authorised the app, but we could not record it. Try connecting again in a moment."
        );
        return;
      }
      {
        // Check if store already exists for this user
        const existing = await database.query.shopifyStores.findFirst({
          where: eq(shopifyStores.shopDomain, shop),
        });

        if (existing) {
          // A store whose app was uninstalled (or disconnected here) holds no
          // token, so nobody is really using it. Whoever reinstalls next takes
          // it over; otherwise an uninstall would lock the domain forever.
          const claimIsLive = existing.isActive && !!existing.accessToken;
          if (existing.userId !== userId && claimIsLive) {
            sendConnectError(
              res,
              403,
              "This store is already connected to another account",
              "Each Shopify store can currently be connected to one PriceIntel account at a time. Sign in with the account that connected it and disconnect it there, or remove the app from your Shopify admin, then try again."
            );
            return;
          }
          await database
            .update(shopifyStores)
            .set({
              userId,
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
