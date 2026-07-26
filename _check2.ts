import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./drizzle/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  const sources = await db.select().from(schema.priceRadarSources);
  console.log("price_radar_sources:", sources.length);

  const jobs = await db.select().from(schema.priceRadarJobs);
  console.log("price_radar_jobs:", jobs.length);

  const prods = await db.select().from(schema.priceRadarProducts);
  console.log("price_radar_products:", prods.length);

  const snapshots = await db.select().from(schema.priceRadarPriceSnapshots);
  console.log("price_radar_price_snapshots:", snapshots.length);

  const competitors = await db.select({ id: schema.competitors.id, name: schema.competitors.name, domain: schema.competitors.domain }).from(schema.competitors);
  console.log("\ncompetitors:", competitors.length, JSON.stringify(competitors));

  const cp = await db.select({ id: schema.competitorProducts.id, productId: schema.competitorProducts.productId, price: schema.competitorProducts.price }).from(schema.competitorProducts);
  console.log("competitor_products:", cp.length);

  const products = await db.select({ id: schema.products.id, title: schema.products.title, price: schema.products.price }).from(schema.products);
  console.log("\nproducts:", products.length);

  const users = await db.select({ id: schema.users.id, email: schema.users.email }).from(schema.users);
  console.log("users:", users.length, JSON.stringify(users.map(u => u.email)));

  await pool.end();
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
