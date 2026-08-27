import "dotenv/config";
import { Pool } from "pg";
import { pipelineService } from "../../server/services/pipeline.service";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query("SELECT id FROM users LIMIT 1");
const t0 = Date.now();
const res = await pipelineService.runForUser(rows[0].id);
console.log("\n=== TOTALS ===");
console.log(JSON.stringify(res.totals, null, 1));
console.log("\n=== PER PRODUCT ===");
for (const p of res.products) {
  console.log(
    `${p.title.slice(0,36).padEnd(38)} disc=${p.discovered} scr=${p.scraped} match=${p.matched}` +
    (p.recommendedPrice != null ? `  rec=$${p.recommendedPrice}${p.marginProtectionApplied ? " FLOOR" : ""}` : `  (${p.skipped ?? "-"})`)
  );
}
console.log(`\nelapsed ${((Date.now()-t0)/1000/60).toFixed(1)} min`);
await pool.end();
