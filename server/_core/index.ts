import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import {
  apiLimiter,
  authLimiter,
  closeRateLimitStore,
  shopifyLimiter,
  scrapeLimiter,
} from "./rate-limit";
import { csrfTokenMiddleware, doubleCsrfProtection } from "./csrf";
import { logger } from "./logger";
import { ENV } from "./env";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { cronScheduler } from "../services/cron-scheduler.service";
import { priceRadarService } from "../services/price-radar/price-radar.service";
import { notificationBroadcaster } from "../services/notification-broadcaster";
import type { BroadcastEvent } from "../services/notification-broadcaster";
import { sdk } from "./sdk";
import { closeDb, testConnection } from "../db";
import { requestIdMiddleware } from "./request-id";
import { billingService } from "../services/billing.service";
import { jobQueueService } from "../services/job-queue.service";
import { registerShopifyWebhookRoute } from "./shopify-webhooks";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(requestIdMiddleware);

  // Security headers (H-002)
  app.use(
    helmet({
      contentSecurityPolicy: ENV.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: ENV.isProduction,
    })
  );

  // CORS — restrict to known origins in production (H-009)
  app.use(
    cors({
      origin: ENV.isProduction ? ENV.allowedOrigins : true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"],
    })
  );

  // Rate limiting (H-001)
  app.use("/api/", apiLimiter);
  app.use("/api/shopify/connect", shopifyLimiter);
  app.use("/api/shopify/callback", shopifyLimiter);
  app.use("/shopify/connect", shopifyLimiter);
  app.use("/shopify/start", shopifyLimiter);

  // Auth rate limiting (brute force protection)
  app.use("/api/trpc/auth.login", authLimiter);
  app.use("/api/trpc/auth.register", authLimiter);
  app.use("/api/trpc/auth.requestPasswordReset", authLimiter);
  app.use("/api/trpc/auth.resetPassword", authLimiter);

  // Scrape rate limiting (tRPC mutation endpoint)
  app.use("/api/trpc/competitors.scrapeProducts", scrapeLimiter);
  app.use("/api/trpc/scout", scrapeLimiter);
  app.use("/api/trpc/priceRadar.startCrawl", scrapeLimiter);

  // Stripe signs the exact raw request body. This route must run before the
  // JSON parser and intentionally bypasses CSRF because Stripe authenticates
  // the request with the Stripe-Signature header.
  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "2mb" }),
    async (req, res) => {
      const signature = req.header("stripe-signature");
      if (!signature || !Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: "Invalid Stripe webhook request" });
        return;
      }
      try {
        const result = await billingService.handleWebhook(req.body, signature);
        res.status(200).json(result);
      } catch (error) {
        logger.error(
          { err: error, requestId: res.locals.requestId },
          "Stripe webhook processing failed"
        );
        res.status(400).json({ error: "Webhook could not be processed" });
      }
    }
  );

  // Body parsers — 1MB limit (largest legitimate payload ~250KB for product sync)
  registerShopifyWebhookRoute(app);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  // Cookie parser — required for CSRF double-submit cookie pattern
  app.use(cookieParser());

  // CSRF protection on Express OAuth routes only (traditional form submissions).
  // tRPC routes are protected by JWT session cookies and don't need CSRF.
  app.use("/api/shopify/", doubleCsrfProtection);
  app.use("/api/oauth/", doubleCsrfProtection);
  app.get("/api/csrf-token", csrfTokenMiddleware, (_req, res) => {
    res.json({ csrfToken: res.locals.csrfToken });
  });

  const liveResponse = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      status: "ok",
      service: "shopify-price-intelligence",
      uptimeSeconds: Math.floor(process.uptime()),
    });
  };
  app.get("/health/live", liveResponse);
  app.get("/healthz", liveResponse);
  app.get("/health/ready", async (_req, res) => {
    const [databaseReady, queueHealth] = await Promise.all([
      testConnection(),
      jobQueueService.getHealth().catch(error => ({
        enabled: false,
        error: error instanceof Error ? error.message : "Queue health failed",
        queues: {},
      })),
    ]);
    const queueReady =
      ENV.queueMode === "inline" ||
      (queueHealth.enabled &&
        "redisStatus" in queueHealth &&
        queueHealth.redisStatus === "ready");
    if (!databaseReady || !queueReady) {
      res.status(503).json({
        status: "not_ready",
        checks: {
          database: databaseReady ? "ok" : "failed",
          queue: queueReady ? "ok" : "failed",
        },
      });
      return;
    }
    res.status(200).json({
      status: "ready",
      checks: { database: "ok", queue: "ok" },
    });
  });
  app.get("/readyz", async (_req, res) => {
    const databaseReady = await testConnection();
    res.status(databaseReady ? 200 : 503).json({
      status: databaseReady ? "ready" : "not_ready",
      checks: { database: databaseReady ? "ok" : "failed" },
    });
  });

  registerOAuthRoutes(app);

  // SSE — real-time notification stream
  app.get("/api/notifications/stream", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendEvent = (event: BroadcastEvent) => {
        if (event.userId === user.id) {
          res.write(
            `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`
          );
        }
      };

      const unsubscribe = notificationBroadcaster.subscribe(sendEvent);

      const keepalive = setInterval(() => {
        res.write(": keepalive\n\n");
      }, 30000);

      req.on("close", () => {
        unsubscribe();
        clearInterval(keepalive);
      });
    } catch {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized");
    }
  });

  // tRPC API
  // tRPC mutations use cookie-based authentication, so they require the same
  // double-submit CSRF protection as the traditional Express routes.
  app.use("/api/trpc", doubleCsrfProtection);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, path, type, ctx }) => {
        logger.error(
          {
            err: error,
            path,
            type,
            requestId: ctx?.requestId,
            code: error.code,
          },
          "tRPC request failed"
        );
      },
    })
  );

  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      logger.error(
        {
          err: error,
          method: req.method,
          path: req.path,
          requestId: res.locals.requestId,
        },
        "Unhandled HTTP request error"
      );
      if (res.headersSent) {
        next(error);
        return;
      }
      res.status(500).json({
        error: "Internal server error",
        requestId: res.locals.requestId,
      });
    }
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");
    await cronScheduler.stop();
    await priceRadarService.shutdown();
    await jobQueueService.close();
    await closeRateLimitStore();
    const forceCloseTimer = setTimeout(() => {
      logger.error("Graceful shutdown timeout reached; closing connections");
      server.closeAllConnections?.();
    }, 10_000);
    forceCloseTimer.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      await closeDb();
      logger.info({ signal }, "Graceful shutdown completed");
    } catch (error) {
      logger.fatal({ err: error, signal }, "Graceful shutdown failed");
      process.exitCode = 1;
    } finally {
      clearTimeout(forceCloseTimer);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  const preferredPort = Number(process.env.PORT) || 3000;
  const port = ENV.isProduction
    ? preferredPort
    : await findAvailablePort(preferredPort);

  if (!ENV.isProduction && port !== preferredPort) {
    logger.warn(
      { port, preferredPort },
      "Preferred port was busy, using alternate"
    );
  }

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server, port);
  } else {
    serveStatic(app);
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
  logger.info(
    { port, env: ENV.isProduction ? "production" : "development" },
    "Server started"
  );

  // Start cron scheduler for price monitoring & competitor discovery
  try {
    cronScheduler.start();
  } catch (err) {
    logger.error({ err }, "Failed to start cron scheduler");
  }
}

startServer().catch(err => {
  logger.fatal({ err }, "Server failed to start");
  process.exitCode = 1;
});
