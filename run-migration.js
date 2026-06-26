const fs = require("fs");
const pg = require("pg");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync("drizzle/migrations/0005_serp_api_scouts.sql", "utf8");

pool
  .query(sql)
  .then(() => {
    console.log("migration applied");
    return pool.end();
  })
  .catch((e) => {
    console.error(e);
    return pool.end();
  });
