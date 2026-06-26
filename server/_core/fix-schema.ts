import "dotenv/config";
import { Pool } from "pg";

async function fix() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });

  const migrations = [
    `ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS margin_protection_applied BOOLEAN DEFAULT false NOT NULL;`,
  ];

  try {
    for (const sql of migrations) {
      console.log(`Running: ${sql}`);
      await pool.query(sql);
    }
    console.log("✅ Schema fixed");
  } catch (err: any) {
    console.error("Fix failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

fix();
