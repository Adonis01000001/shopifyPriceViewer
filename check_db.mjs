import { Client } from "pg";

const client = new Client({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/shopify_price_intelligence",
});

try {
  await client.connect();
  const result = await client.query("SELECT count(*) FROM products");
  console.log("Connected! Products count:", result.rows[0].count);
  await client.end();
} catch (err) {
  console.log("Connection failed:", err.message);
  process.exit(1);
}
