import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../drizzle/schema";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, schema });

async function run() {
  const users = await db.select().from(schema.users).limit(1);
  if (!users[0]) { console.log("No users"); pool.end(); return; }
  const userId = users[0].id;

  // Only create if none exist
  const existing = await db.select().from(schema.alerts).where(eq(schema.alerts.userId, userId)).limit(1);
  if (existing.length > 0) { console.log("Alerts already exist, skipping"); pool.end(); return; }

  const products = await db.select().from(schema.products).where(eq(schema.products.userId, userId));
  if (products.length < 3) { console.log("Not enough products"); pool.end(); return; }

  const alerts = [
    { productId: products[0].id, alertType: "price_drop" as const, severity: "critical" as const, title: "Critical Price Drop Detected", message: `${products[0].title.slice(0,80)} price dropped 15% — immediate attention required.`, triggerPrice: "110.49", triggerCondition: "below" as const, isRead: false, isResolved: false, isNotified: false },
    { productId: products[1].id, alertType: "competitor_change" as const, severity: "high" as const, title: "Competitor Price Change", message: `Walmart changed price for ${products[1].title.slice(0,60)} — review recommended.`, isRead: false, isResolved: false, isNotified: false },
    { productId: products[2].id, alertType: "threshold" as const, severity: "medium" as const, title: "Price Threshold Exceeded", message: `${products[2].title.slice(0,60)} crossed your 10% threshold setting.`, triggerPrice: "314.99", triggerCondition: "below" as const, isRead: false, isResolved: false, isNotified: false },
    { productId: products[3]?.id || products[0].id, alertType: "price_increase" as const, severity: "low" as const, title: "Minor Price Increase", message: `${(products[3] || products[0]).title.slice(0,60)} price increased 3% on Best Buy.`, isRead: true, isResolved: false, isNotified: false },
    { productId: products[4]?.id || products[0].id, alertType: "price_drop" as const, severity: "medium" as const, title: "Opportunity: Competitor Price Drop", message: `Amazon dropped price for ${(products[4] || products[0]).title.slice(0,60)} — consider matching.`, isRead: false, isResolved: true, isNotified: false },
  ];

  for (const a of alerts) {
    await db.insert(schema.alerts).values({ ...a, userId });
  }
  console.log(`Created ${alerts.length} alerts`);
  pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
