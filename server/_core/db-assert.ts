import { TRPCError } from "@trpc/server";
import * as db from "../db";

/**
 * Get the database instance or throw a TRPC error.
 * Use this in tRPC route handlers and service methods instead of
 * silently returning empty results when the DB is unavailable.
 */
export async function requireDb() {
  const database = await db.getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database connection unavailable",
    });
  }
  return database;
}
