import pino from "pino";

/**
 * Structured JSON logger.
 *
 * In development (NODE_ENV !== 'production') output is pretty-printed via pino-pretty.
 * In production, outputs JSON lines for log aggregation (Datadog, CloudWatch, etc.).
 *
 * Usage:
 *   import { logger } from "./_core/logger";
 *   logger.info({ userId, action: "login" }, "User logged in");
 *   logger.error({ err, requestId }, "Failed to process request");
 *
 * createChildLogger() creates a bound child logger (e.g. per-request):
 *   const reqLogger = createChildLogger({ requestId: nanoid() });
 *   reqLogger.info("Handling request");
 */

const isDev = process.env.NODE_ENV !== "production";

export const logger: pino.Logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          singleLine: false,
        },
      }
    : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createChildLogger(bindings: pino.Bindings): pino.Logger {
  return logger.child(bindings);
}
