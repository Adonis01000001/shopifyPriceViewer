import "dotenv/config";
import { Pool } from "pg";
import { decryptToken } from "../../server/_core/sdk";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query("SELECT shop_domain, access_token FROM shopify_stores WHERE is_active=true LIMIT 1");
console.log(JSON.stringify({ shop: rows[0].shop_domain, token: decryptToken(rows[0].access_token) }));
await pool.end();
