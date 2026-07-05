import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "../drizzle/schema";
import { dbRelations } from "../drizzle/relations";
import { logger } from "./_core/logger";

// Relational schema: Drizzle tables + relation definitions, passed to
// drizzle() so the relational query builder (db.query.<table>) is typed.
// Relations live under a dedicated `relations` key to avoid colliding with
// the table objects (both would otherwise share keys like `shopifyStores`).
const relationalSchema = { ...schema, relations: dbRelations } as const;

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof relationalSchema>> | null = null;

function getPool(): Pool | null {
  if (!_pool && process.env.DATABASE_URL) {
    const isProduction = process.env.NODE_ENV === "production";
    const poolConfig: PoolConfig = {
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
    if (isProduction) {
      poolConfig.ssl = { rejectUnauthorized: true };
    }
    _pool = new Pool(poolConfig);
    _pool.on("error", err => {
      logger.error({ err }, "Unexpected database pool error");
    });
  }
  return _pool;
}

export async function getDb() {
  if (!_db) {
    const pool = getPool();
    if (!pool) {
      logger.warn("DATABASE_URL not configured, database unavailable");
      return null;
    }
    try {
      _db = drizzle(pool, { schema: relationalSchema });
      logger.debug("Database connection pool initialized");
    } catch (error) {
      logger.error({ err: error }, "Failed to create Drizzle instance");
      return null;
    }
  }
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
    logger.info("Database connection pool closed");
  }
}

export async function testConnection(): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    logger.debug("Database connection test passed");
    return true;
  } catch (error) {
    logger.error({ err: error }, "Database connection test failed");
    return false;
  }
}
