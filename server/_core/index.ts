import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { apiLimiter, shopifyLimiter, scrapeLimiter } from "./rate-limit";
import { doubleCsrfProtection } from "./csrf";
import { logger } from "./logger";
import { ENV } from "./env";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { cronScheduler } from "../services/cron-scheduler.service";

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
  app.use(helmet({
    contentSecurityPolicy: ENV.isProduction ? undefined : false,
    crossOriginEmbedderPolicy: ENV.isProduction,
  }));

  // CORS — restrict to known origins in production (H-009)
  app.use(cors({
    origin: ENV.isProduction
      ? (process.env.ALLOWED_ORIGINS?.split(",") ?? [])
      : true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-csrf-token"],
  }));

  // Rate limiting (H-001)
  app.use("/api/", apiLimiter);
  app.use("/api/shopify/connect", shopifyLimiter);
  app.use("/api/shopify/callback", shopifyLimiter);

  // Scrape rate limiting (tRPC mutation endpoint)
  app.use("/api/trpc/competitors.scrapeProducts", scrapeLimiter);

  // Body parsers
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Cookie parser — required for CSRF double-submit cookie pattern
  app.use(cookieParser());

  // CSRF protection on Express OAuth routes only (traditional form submissions).
  // tRPC routes are protected by JWT session cookies and don't need CSRF.
  app.use("/api/shopify/", doubleCsrfProtection);
  app.use("/api/oauth/", doubleCsrfProtection);

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    logger.warn({ port, preferredPort }, "Preferred port was busy, using alternate");
  }

  server.listen(port, () => {
    logger.info({ port, env: ENV.isProduction ? "production" : "development" }, "Server started");
  });

  // Start cron scheduler for price monitoring & competitor discovery
  cronScheduler.start();
}

startServer().catch((err) => {
  logger.fatal({ err }, "Server failed to start");
});
