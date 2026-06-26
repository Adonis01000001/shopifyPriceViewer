import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../drizzle/schema";
import "dotenv/config";
import { logger } from "./logger";

async function debug() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    logger.fatal("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const db = drizzle({ client: pool, schema });

  const products = await db.select().from(schema.products);
  logger.info({ count: products.length }, "Products in DB");
  for (const p of products) {
    logger.info({ id: p.id, title: p.title }, "  -");
  }

  const cps = await db.select().from(schema.competitorProducts);
  logger.info({ count: cps.length }, "Competitor products in DB");

  await pool.end();
}

debug().catch((err) => {
  logger.error({ err }, "Debug failed");
  process.exit(1);
});
