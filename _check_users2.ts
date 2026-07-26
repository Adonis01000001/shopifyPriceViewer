import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./drizzle/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  const users = await db.select({ id: schema.users.id, email: schema.users.email, openId: schema.users.openId, name: schema.users.name }).from(schema.users);
  console.log("Users:", JSON.stringify(users, null, 2));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });