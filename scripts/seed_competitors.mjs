import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../drizzle/schema";
import "dotenv/config";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle({ client: pool, schema });

const USER_ID = "aee26b7b-24d1-4529-95b5-bb25ae2e2003";

const competitorData = [
  {
    productId: "b2ae5744-c726-4be2-9b32-5bc8e3d207a8",
    competitors: [
      { name: "Samsung", domain: "samsung.com", title: "Samsung 50-inch 4K Smart TV UA50TU8000", price: 34999.00 },
      { name: "LG", domain: "lg.com", title: "LG 50-inch 4K Smart TV 50UP7500", price: 31999.00 },
      { name: "Sony", domain: "sony.com", title: "Sony 50-inch 4K Smart TV X80J", price: 42999.00 },
      { name: "TCL", domain: "tcl.com", title: "TCL 50-inch 4K Smart TV 50P725", price: 27999.00 },
    ],
  },
  {
    productId: "544e3376-4c27-467e-99ed-622d98728109",
    competitors: [
      { name: "Samsung", domain: "samsung.com", title: "Samsung 32-inch HD Ready TV UA32T4340", price: 16499.00 },
      { name: "LG", domain: "lg.com", title: "LG 32-inch HD Ready TV 32LM563B", price: 13490.00 },
      { name: "Xiaomi", domain: "mi.com", title: "Mi 32-inch HD Ready TV 5A L32M7", price: 13999.00 },
    ],
  },
  {
    productId: "3c60bae2-b175-43d6-959c-fba94df9d00a",
    competitors: [
      { name: "Samsung", domain: "samsung.com", title: "Samsung 43-inch Full HD TV UA43T5300", price: 27999.00 },
      { name: "LG", domain: "lg.com", title: "LG 43-inch Full HD TV 43LM5700", price: 25999.00 },
      { name: "Sony", domain: "sony.com", title: "Sony 43-inch Full HD TV W800G", price: 34999.00 },
    ],
  },
];

async function seed() {
  for (const entry of competitorData) {
    console.log(`\nSeeding competitors for product ${entry.productId}...`);

    for (const comp of entry.competitors) {
      let competitorId;

      // Check if competitor exists
      const existing = await db
        .select()
        .from(schema.competitors)
        .where(
          and(
            eq(schema.competitors.userId, USER_ID),
            eq(schema.competitors.name, comp.name)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        competitorId = existing[0].id;
        console.log(`  Competitor "${comp.name}" already exists (${competitorId})`);
      } else {
        const newComp = await db
          .insert(schema.competitors)
          .values({
            userId: USER_ID,
            name: comp.name,
            domain: comp.domain,
            status: "active",
            productsTracked: 0,
          })
          .returning();
        competitorId = newComp[0].id;
        console.log(`  Created competitor "${comp.name}" (${competitorId})`);
      }

      // Check if competitor_product link exists
      const existingCp = await db
        .select()
        .from(schema.competitorProducts)
        .where(
          and(
            eq(schema.competitorProducts.competitorId, competitorId),
            eq(schema.competitorProducts.productId, entry.productId)
          )
        )
        .limit(1);

      if (existingCp.length > 0) {
        console.log(`    Already linked to product`);
        continue;
      }

      const cp = await db
        .insert(schema.competitorProducts)
        .values({
          competitorId,
          productId: entry.productId,
          competitorProductTitle: comp.title,
          price: comp.price.toFixed(2),
          matchScore: 0.5,
          matchMethod: "manual",
          isActive: true,
        })
        .returning();
      console.log(`    Created competitor_product "${comp.title}" at $${comp.price}`);

      await db.insert(schema.priceHistory).values({
        productId: entry.productId,
        competitorProductId: cp[0].id,
        price: comp.price.toFixed(2),
        source: "competitor",
      });

      await db
        .update(schema.competitors)
        .set({
          productsTracked: sql`products_tracked + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.competitors.id, competitorId));
    }
  }

  console.log("\nSeeding complete!");
  await pool.end();
}

seed().catch(err => {
  console.error("Seed failed:", err);
  pool.end();
  process.exit(1);
});
