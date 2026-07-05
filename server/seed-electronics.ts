import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../drizzle/schema";
import "dotenv/config";
import { logger } from "./_core/logger";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";

if (!DATABASE_URL) {
  logger.fatal("DATABASE_URL is not set — cannot run seed");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle({ client: pool, schema });

const CATEGORY_TV = "Electronics|HomeTheater,TV&Video|Televisions|SmartTelevisions";
const CATEGORY_CABLE = "Electronics|HomeTheater,TV&Video|Accessories|Cables|HDMICables";

const products = [
  {
    title: "AmazonBasics Flexible Premium HDMI Cable (Black, 4K@60Hz, 18Gbps), 3-Foot",
    category: CATEGORY_CABLE,
    price: "219.00",
    status: "optimal" as const,
  },
  {
    title: "MI 80 cm (32 inches) 5A Series HD Ready Smart Android LED TV L32M7-5AIN (Black)",
    category: CATEGORY_TV,
    price: "13999.00",
    status: "optimal" as const,
  },
  {
    title: "LG 80 cm (32 inches) HD Ready Smart LED TV 32LM563BPTC (Dark Iron Gray)",
    category: CATEGORY_TV,
    price: "13490.00",
    status: "optimal" as const,
  },
  {
    title:
      "tizum HDMI to VGA Adapter Cable 1080P for Projector, Computer, Laptop, TV, Projectors & TV",
    category: CATEGORY_CABLE,
    price: "279.00",
    status: "optimal" as const,
  },
  {
    title:
      "Samsung 80 cm (32 Inches) Wondertainment Series HD Ready LED Smart TV UA32T4340BKXXL (Glossy Black)",
    category: CATEGORY_TV,
    price: "13490.00",
    status: "optimal" as const,
  },
  {
    title: "Acer 80 cm (32 inches) I Series HD Ready Android Smart LED TV AR32AR2841HDFL (Black)",
    category: CATEGORY_TV,
    price: "11499.00",
    status: "optimal" as const,
  },
  {
    title:
      "Tizum High Speed HDMI Cable with Ethernet | Supports 3D 4K | for All HDMI Devices Laptop Computer Gaming Console TV Set Top Box (1.5 Meter/ 5 Feet)",
    category: CATEGORY_CABLE,
    price: "199.00",
    status: "underpriced" as const,
  },
  {
    title: "OnePlus 80 cm (32 inches) Y Series HD Ready LED Smart Android TV 32Y1 (Black)",
    category: CATEGORY_TV,
    price: "14999.00",
    status: "optimal" as const,
  },
  {
    title:
      "OnePlus 126 cm (50 inches) Y Series 4K Ultra HD Smart Android LED TV 50Y1S Pro (Black)",
    category: CATEGORY_TV,
    price: "32999.00",
    status: "optimal" as const,
  },
  {
    title: "Mi 108 cm (43 inches) Full HD Android LED TV 4C | L43M6-INC (Black)",
    category: CATEGORY_TV,
    price: "19999.00",
    status: "optimal" as const,
  },
];

async function main() {
  const [admin] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, ADMIN_EMAIL))
    .limit(1);

  if (!admin) {
    logger.fatal(`No user found with email ${ADMIN_EMAIL}`);
    process.exit(1);
  }

  logger.info(`Seeding ${products.length} products for user ${admin.id} (${admin.email})`);

  for (const p of products) {
    await db.insert(schema.products).values({
      userId: admin.id,
      title: p.title,
      category: p.category,
      price: p.price,
      currency: "USD",
      status: p.status,
    });
    logger.info(`Inserted: ${p.title}`);
  }

  logger.info("Done.");
  await pool.end();
}

main().catch(err => {
  logger.error("Seed failed", err);
  process.exit(1);
});
