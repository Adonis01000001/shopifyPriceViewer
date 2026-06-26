import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ELECTRONIC_PRODUCTS = [
  { title: "Apple iPhone 15 Pro 256GB Natural Titanium", description: "Apple iPhone 15 Pro with A17 Pro chip, 6.1-inch Super Retina XDR display, 48MP camera system, 256GB storage.", sku: "IPH15P-256-NT", barcode: "194253433651", vendor: "Apple", product_type: "Smartphone", category: "Smartphones", price: "1199.00", currency: "USD", cost_price: "850.00" },
  { title: "Apple iPhone 14 128GB Blue", description: "Apple iPhone 14 with A15 Bionic chip, 6.1-inch Super Retina XDR display, dual 12MP camera system, 128GB storage.", sku: "IPH14-128-BLU", barcode: "194253133654", vendor: "Apple", product_type: "Smartphone", category: "Smartphones", price: "699.00", currency: "USD", cost_price: "500.00" },
  { title: "Samsung Galaxy S24 Ultra 256GB Titanium Black", description: "Samsung Galaxy S24 Ultra with Snapdragon 8 Gen 3, 6.8-inch Dynamic AMOLED 2X, 200MP camera, S Pen, 256GB storage.", sku: "SGS24U-256-TB", barcode: "887276836452", vendor: "Samsung", product_type: "Smartphone", category: "Smartphones", price: "1299.99", currency: "USD", cost_price: "900.00" },
  { title: "Apple MacBook Air 15-inch M3 16GB 512GB Midnight", description: "Apple MacBook Air 15-inch with M3 chip, 16GB unified memory, 512GB SSD, Liquid Retina display, Midnight finish.", sku: "MBA15-M3-16-512", barcode: "194253739385", vendor: "Apple", product_type: "Laptop", category: "Laptops", price: "1699.00", currency: "USD", cost_price: "1200.00" },
  { title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black", description: "Sony WH-1000XM5 industry-leading noise cancellation, 30-hour battery life, multipoint connection, premium comfort.", sku: "SONY-WH1000XM5-BLK", barcode: "027242921023", vendor: "Sony", product_type: "Headphones", category: "Audio", price: "349.99", currency: "USD", cost_price: "180.00" },
  { title: "Apple iPad Pro 12.9-inch M2 256GB Wi-Fi Space Gray", description: "Apple iPad Pro 12.9-inch with M2 chip, Liquid Retina XDR display, 256GB storage, Wi-Fi, Space Gray.", sku: "IPD129-M2-256-SG", barcode: "194252513654", vendor: "Apple", product_type: "Tablet", category: "Tablets", price: "1199.00", currency: "USD", cost_price: "800.00" },
  { title: "Dell XPS 15 9530 Intel i7-13700H 16GB 512GB SSD", description: "Dell XPS 15 9530 with 13th Gen Intel Core i7-13700H, 16GB DDR5, 512GB SSD, 15.6-inch OLED 3.5K display.", sku: "DELL-XPS15-I7-512", barcode: "884116456789", vendor: "Dell", product_type: "Laptop", category: "Laptops", price: "1499.99", currency: "USD", cost_price: "1050.00" },
  { title: "Nintendo Switch OLED Model White", description: "Nintendo Switch OLED model with 7-inch OLED screen, 64GB internal storage, white Joy-Con controllers.", sku: "NSW-OLED-WHT", barcode: "045496883384", vendor: "Nintendo", product_type: "Console", category: "Gaming", price: "349.99", currency: "USD", cost_price: "220.00" },
  { title: "Bose QuietComfort Ultra Headphones Black", description: "Bose QuietComfort Ultra wireless noise cancelling headphones with Immersive Audio, 24-hour battery, premium comfort.", sku: "BOSE-QC-ULT-BLK", barcode: "017817846523", vendor: "Bose", product_type: "Headphones", category: "Audio", price: "429.00", currency: "USD", cost_price: "250.00" },
  { title: "Apple Watch Ultra 2 GPS + Cellular 49mm Alpine Loop", description: "Apple Watch Ultra 2 with S9 chip, 49mm titanium case, Alpine Loop band, GPS + Cellular, 3000-nit display.", sku: "AWU2-49-ALP-CELL", barcode: "194253875642", vendor: "Apple", product_type: "Smartwatch", category: "Wearables", price: "799.00", currency: "USD", cost_price: "550.00" },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query("SELECT id FROM users LIMIT 1");
    if (userResult.rows.length === 0) throw new Error("No users found");
    const userId = userResult.rows[0].id;

    // Get any active store (prefer user's, but fall back to any)
    const storeResult = await client.query("SELECT id FROM shopify_stores WHERE is_active = true LIMIT 1");
    let storeId = storeResult.rows[0]?.id || null;
    if (!storeId) {
      const anyStore = await client.query("SELECT id FROM shopify_stores LIMIT 1");
      storeId = anyStore.rows[0]?.id || null;
    }
    if (!storeId) {
      const created = await client.query("INSERT INTO shopify_stores (user_id, shop_domain, scopes, is_active) VALUES ($1, 'temp-store.myshopify.com', 'read_products', true) RETURNING id", [userId]);
      storeId = created.rows[0].id;
      console.log("Created temp store:", storeId);
    }

    console.log("Cleaning existing products...");

    // Delete child records first (respect FK constraints)
    await client.query("DELETE FROM price_snapshots WHERE competitor_product_id IN (SELECT id FROM competitor_products WHERE product_id IN (SELECT id FROM products WHERE user_id = $1))", [userId]);
    await client.query("DELETE FROM price_changes WHERE product_id IN (SELECT id FROM products WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM price_history WHERE product_id IN (SELECT id FROM products WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM competitor_products WHERE product_id IN (SELECT id FROM products WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM ai_extractions WHERE product_id IN (SELECT id FROM products WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM competitor_discoveries WHERE product_id IN (SELECT id FROM products WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM alerts WHERE product_id IN (SELECT id FROM products WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM recommendations WHERE product_id IN (SELECT id FROM products WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM product_embeddings WHERE product_id IN (SELECT id FROM products WHERE user_id = $1)", [userId]);
    await client.query("DELETE FROM products WHERE user_id = $1", [userId]);

    // Reset competitor stats
    await client.query("UPDATE competitors SET products_tracked = 0");

    console.log("Seeding 10 electronic products...");
    for (const p of ELECTRONIC_PRODUCTS) {
      const r = await client.query(
        `INSERT INTO products (user_id, store_id, title, description, sku, barcode, vendor, product_type, category, price, compare_at_price, cost_price, currency, status, is_tracked, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,'optimal',true,true) RETURNING id`,
        [userId, storeId, p.title, p.description, p.sku, p.barcode, p.vendor, p.product_type, p.category, p.price, p.cost_price, p.currency]
      );
      console.log("  " + p.title.slice(0, 55) + " | $" + p.price + " | " + r.rows[0].id.slice(0, 8));
    }

    const cnt = await client.query("SELECT COUNT(*) as n FROM products WHERE user_id = $1 AND is_active = true", [userId]);
    console.log("\nDone! " + cnt.rows[0].n + " electronic products seeded.");

    await client.query("COMMIT");
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("Failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
