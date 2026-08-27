import "dotenv/config";
import { Pool } from "pg";
import { pipelineService } from "../../server/services/pipeline.service";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  "SELECT p.id, p.title, u.id AS user_id FROM products p JOIN users u ON u.id=p.user_id WHERE p.is_active AND p.title ILIKE $1 LIMIT 1",
  [process.argv[2] ?? '%WH-1000XM5%']);
const p = rows[0];
console.log("running pipeline for:", p.title, "\n");
const t0 = Date.now();
const r = await pipelineService.runForProduct(p.user_id, p.id);
console.log(JSON.stringify(r, null, 1));
console.log(`elapsed ${((Date.now()-t0)/1000).toFixed(1)}s`);
await pool.end();
