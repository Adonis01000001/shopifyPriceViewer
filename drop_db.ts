import { Client } from "pg";
import "dotenv/config";

async function dropTables() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("Connected to database. Dropping all tables...");

    const query = `
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO postgres;
      GRANT ALL ON SCHEMA public TO public;
    `;

    await client.query(query);
    console.log("✅ Schema dropped and recreated successfully.");
  } catch (error) {
    console.error("❌ Failed to drop tables:", error);
  } finally {
    await client.end();
  }
}

dropTables();
