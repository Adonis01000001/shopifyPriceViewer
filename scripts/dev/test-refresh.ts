import "dotenv/config";
import { Pool } from "pg";
import { pipelineService } from "../../server/services/pipeline.service";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query("SELECT id FROM users LIMIT 1");
console.log(JSON.stringify(await pipelineService.refreshPrices(rows[0].id)));
await pool.end();
