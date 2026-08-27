import "dotenv/config";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query("SELECT id FROM users LIMIT 1");
const { appRouter } = await import("../../server/routers");
const caller = appRouter.createCaller({
  req: { headers: {} } as never,
  res: {} as never,
  user: { id: rows[0].id } as never,
  requestId: "dev-script",
});
const res = await caller.products.importCsv({
  csv: readFileSync("/tmp/test.csv", "utf8"),
  runPipeline: false,
});
console.log(JSON.stringify(res, null, 1));
await pool.end();
