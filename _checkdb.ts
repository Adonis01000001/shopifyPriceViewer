import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./drizzle/schema";

async function main() {
  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "NOT SET");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  const allUsers = await db.select().from(schema.users);
  console.log("=== USERS (" + allUsers.length + ") ===");
  for (const u of allUsers) {
    console.log("  [" + u.id + "] " + u.email + " | role=" + u.role);
  }

  const allProducts = await db.select().from(schema.products);
  console.log("\n=== PRODUCTS (" + allProducts.length + ") ===");
  for (const p of allProducts) {
    console.log("  [" + p.id + "] " + p.title + " | $" + p.price + " | " + p.status);
  }

  const allCompetitors = await db.select().from(schema.competitors);
  console.log("\n=== COMPETITORS (" + allCompetitors.length + ") ===");
  for (const c of allCompetitors) {
    console.log("  [" + c.id + "] " + c.name + " | " + c.domain);
  }

  const allCp = await db.select().from(schema.competitorProducts);
  console.log("\n=== COMPETITOR PRODUCTS (" + allCp.length + ") ===");
  for (const cp of allCp) {
    console.log("  [" + cp.id + "] productId=" + cp.productId + " | $" + cp.price + " | " + (cp.competitorProductTitle || "-"));
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
