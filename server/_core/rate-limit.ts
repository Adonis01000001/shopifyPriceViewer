import rateLimit from "express-rate-limit";
import Redis from "ioredis";
import { ENV } from "./env";
import { logger } from "./logger";
import { RedisRateLimitStore } from "./redis-rate-limit-store";

const redis =
  ENV.isProduction && ENV.redisUrl
    ? new Redis(ENV.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      })
    : null;

redis?.on("error", error => {
  logger.error({ err: error }, "Redis rate-limit connection error");
});

function createStore(namespace: string) {
  return redis ? new RedisRateLimitStore(redis, namespace) : undefined;
}

// General API rate limit, per IP.
//
// This is here to stop abuse, not to ration ordinary use. The dashboard is a
// single-page app that polls while a pipeline run is in progress, and every
// page load issues several queries, so a real session spends requests far
// faster than a page-per-click site would. The old ceiling of 100 per 15
// minutes was under half of what one active session needs, and hitting it
// logged people out: the 429 covers /api/csrf-token too, so the app could not
// even fetch the token needed to sign back in.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  store: createStore("api"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Strict auth rate limit: 10 attempts per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  store: createStore("auth"),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many login attempts. Please try again in 15 minutes.",
  },
});

// Shopify OAuth rate limit: 5 per hour per IP
export const shopifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  store: createStore("shopify"),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many Shopify connection attempts. Please try again later.",
  },
});

// Scrape rate limit: 5 scrapes per 15 minutes per IP
export const scrapeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: createStore("scrape"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many scrape requests. Please try again later." },
});

export async function closeRateLimitStore(): Promise<void> {
  await redis?.quit();
}
