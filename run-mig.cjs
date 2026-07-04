require("dotenv").config();
const fs = require("fs");
const { Client } = require("pg");
const client = new Client({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "devpassword",
  database: "shopify_price_intelligence",
});
client
  .connect()
  .then(async () => {
    const sql = fs.readFileSync(
      "drizzle/migrations/0005_serp_api_scouts.sql",
      "utf8"
    );
    await client.query(sql);
    console.log("migration applied");
    client.end();
  })
  .catch(e => {
    console.error(e.message);
    client.end();
  });
