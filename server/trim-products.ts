import { Client } from "pg";

const client = new Client({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "devpassword",
  database: "shopify_price_intelligence",
});

const KEEP_IDS = [
  "67375567-e460-432a-a77a-3f75e1ef9acf",
  "73552132-7b64-41ca-8996-a29ca354b8cb",
  "94b92f9c-bc06-4db2-8eff-1043ae04f011",
  "afdc642a-ab60-4126-912d-6843555710fb",
  "e7e3dc43-d8aa-438f-ba49-4f3ac4c8494d",
  "a710bda8-f613-4575-8e4a-40a7a559bb9f",
  "ef9d67f8-dbb9-4ecb-8f80-eaa834c4d0c0",
  "e4b3bf6a-0ceb-40f0-bf00-a026ce1d830b",
  "2025ca29-f5cf-4d62-8c26-3224291d4bdc",
  "daf58a8a-cccd-4f0d-ba23-f6e60687297e",
];

async function main() {
  await client.connect();
  console.log("Connected to database");

  // Deactivate all electronics products NOT in the keep list
  const result = await client.query(
    `UPDATE products SET is_active = false, updated_at = now()
     WHERE is_active = true
       AND category LIKE '%Electronics%'
       AND id NOT IN ('${KEEP_IDS.join("','")}')`
  );
  console.log(`Deactivated ${result.rowCount} electronics products`);

  // Verify counts
  const activeElec = await client.query(
    `SELECT count(*) FROM products WHERE is_active = true AND category LIKE '%Electronics%'`
  );
  console.log("Active electronics products:", activeElec.rows[0].count);

  const totalActive = await client.query(
    `SELECT count(*) FROM products WHERE is_active = true`
  );
  console.log("Total active products:", totalActive.rows[0].count);

  // Show the 10 kept products
  const kept = await client.query(
    `SELECT id, title, price FROM products WHERE is_active = true AND category LIKE '%Electronics%' ORDER BY created_at ASC`
  );
  console.log("\nKept electronics products:");
  kept.rows.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.title} ($${p.price})`);
  });

  await client.end();
}

main().catch((err) => {
  console.error("Error:", err.message);
  client.end().catch(() => {});
  process.exit(1);
});
