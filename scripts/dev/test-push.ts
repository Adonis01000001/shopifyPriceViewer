import "dotenv/config";
import { Pool } from "pg";
import { pipelineService } from "../../server/services/pipeline.service";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  `SELECT r.id, r.recommended_price, p.id AS product_id, p.title, p.price, p.cost_price, p.user_id
   FROM recommendations r JOIN products p ON p.id=r.product_id
   WHERE p.title ILIKE '%Kindle%' LIMIT 1`);
const r = rows[0];
console.log(`product: ${r.title}\n  shop price now: $${r.price}  -> pushing $${r.recommended_price}`);
try {
  const res = await pipelineService.pushPriceToShopify(r.user_id, r.product_id, Number(r.recommended_price));
  console.log("  RESULT:", JSON.stringify(res));
} catch (e:any) { console.log("  THREW:", e.message); }
// floor guard check
console.log("\nfloor guard: attempting an absurdly low push...");
try {
  await pipelineService.pushPriceToShopify(r.user_id, r.product_id, 1.0);
  console.log("  !! guard did NOT fire");
} catch (e:any) { console.log("  guard fired:", e.message); }
await pool.end();
