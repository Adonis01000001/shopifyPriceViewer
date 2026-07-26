import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  for (const row of res.rows) {
    console.log(row.table_name);
  }
  await pool.end();
}
main().catch(e => console.error(e.message));
