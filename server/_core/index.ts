import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { apiLimiter, authLimiter, shopifyLimiter, scrapeLimiter } from "./rate-limit";
import { doubleCsrfProtection } from "./csrf";
import { logger } from "./logger";
import { ENV } from "./env";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { cronScheduler } from "../services/cron-scheduler.service";
import { notificationBroadcaster } from "../services/notification-broadcaster";
import type { BroadcastEvent } from "../services/notification-broadcaster";
import { sdk } from "./sdk";

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
      origin: ENV.isProduction
        ? (process.env.ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [])
        : true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"],
    })
  );

  // Rate limiting (H-001)
  app.use("/api/", apiLimiter);
  app.use("/api/shopify/connect", shopifyLimiter);
  app.use("/api/shopify/callback", shopifyLimiter);

  // Auth rate limiting (brute force protection)
  app.use("/api/trpc/auth.login", authLimiter);
  app.use("/api/trpc/auth.register", authLimiter);

  // Scrape rate limiting (tRPC mutation endpoint)
  app.use("/api/trpc/competitors.scrapeProducts", scrapeLimiter);
  app.use("/api/trpc/scout", scrapeLimiter);

  // Body parsers — 1MB limit (largest legitimate payload ~250KB for product sync)
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  // Cookie parser — required for CSRF double-submit cookie pattern
  app.use(cookieParser());

  // CSRF protection on Express OAuth routes only (traditional form submissions).
  // tRPC routes are protected by JWT session cookies and don't need CSRF.
  app.use("/api/shopify/", doubleCsrfProtection);
  app.use("/api/oauth/", doubleCsrfProtection);

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
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
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
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  const preferredPort = Number(process.env.PORT) || 3000;
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
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

  server.listen(port, () => {
    logger.info(
      { port, env: ENV.isProduction ? "production" : "development" },
      "Server started"
    );
  });

  // Start cron scheduler for price monitoring & competitor discovery
  try {
    cronScheduler.start();
  } catch (err) {
    logger.error({ err }, "Failed to start cron scheduler");
  }
}

startServer().catch(err => {
  logger.fatal({ err }, "Server failed to start");
});
