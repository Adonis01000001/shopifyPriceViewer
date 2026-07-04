import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import "dotenv/config";
import { logger } from "./logger";

async function truncate() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    logger.fatal("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle({ client: pool });

  logger.info("Truncating product-related tables...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE TABLE competitor_products, price_snapshots, price_changes, scrape_logs, products, cron_runs, activity_logs, alerts, recommendations RESTART IDENTITY CASCADE;"
    );
    await client.query("COMMIT");
    logger.info(
      "✅ All product data cleared. Re-run pnpm db:seed to seed fresh data."
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await pool.end();
}

truncate().catch(err => {
  logger.error({ err }, "Truncate failed");
  process.exit(1);
});
