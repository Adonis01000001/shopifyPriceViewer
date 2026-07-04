import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const tables = [
    "products",
    "competitor_products",
    "competitors",
    "price_history",
    "price_snapshots",
    "price_changes",
    "scrape_logs",
    "cron_runs",
    "alerts",
    "recommendations",
    "activity_logs",
    "notification_preferences",
    "shopify_stores",
    "users",
  ];

  console.log("=== ROW COUNTS ===");
  for (const t of tables) {
    const r = await pool.query(`SELECT count(*)::int AS n FROM ${t}`);
    console.log(`  ${t}: ${r.rows[0].n}`);
  }

  console.log("\n=== PRODUCTS BY CATEGORY (top 20) ===");
  const cat = await pool.query(
    `SELECT category, count(*)::int AS n FROM products GROUP BY category ORDER BY n DESC LIMIT 20`
  );
  for (const r of cat.rows) {
    console.log(`  ${r.n.toString().padStart(6)}  ${r.category}`);
  }

  console.log("\n=== NON-ELECTRONICS PRODUCTS ===");
  const nonE = await pool.query(
    `SELECT id, title, category, price FROM products WHERE category NOT ILIKE '%Electronics%' ORDER BY title LIMIT 50`
  );
  console.log(`  (${nonE.rows.length} rows)`);
  for (const r of nonE.rows) {
    console.log(
      `  ${r.id}  ${r.category}  "${r.title.slice(0, 60)}"  ${r.price}`
    );
  }

  console.log("\n=== ELECTRONICS PRODUCTS ===");
  const elec = await pool.query(
    `SELECT id, title, category, price FROM products WHERE category ILIKE '%Electronics%' ORDER BY title`
  );
  console.log(`  (${elec.rows.length} rows)`);
  for (const r of elec.rows) {
    console.log(
      `  ${r.id}  ${r.category}  "${r.title.slice(0, 60)}"  ${r.price}`
    );
  }

  console.log("\n=== FK REFERENCES TO NON-ELECTRONICS PRODUCTS ===");
  const fkChecks = [
    { table: "competitor_products", col: "product_id" },
    { table: "price_history", col: "product_id" },
    { table: "alerts", col: "product_id" },
    { table: "recommendations", col: "product_id" },
  ];
  for (const f of fkChecks) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM ${f.table} WHERE EXISTS (SELECT 1 FROM products p WHERE p.category NOT ILIKE '%Electronics%' AND p.id::text = ${f.table}.${f.col}::text)`
    );
    console.log(
      `  ${f.table}.${f.col}: ${r.rows[0].n} rows referencing non-electronics`
    );
  }

  await pool.end();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
