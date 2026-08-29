import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../drizzle/schema";
import bcrypt from "bcrypt";
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./_core/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  logger.fatal("DATABASE_URL is not set — cannot run seed");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const db = drizzle({ client: pool, schema });

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

/** Parse a CSV line handling quoted fields with embedded commas */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/** Clean price strings like "₹399" or "₹1,099" → 399.0 */
function parsePrice(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₹,]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Clean discount_percentage like "64%" → "64.0" */
function parseDiscount(raw: string): string {
  if (!raw) return "0";
  return raw.replace("%", "").trim() || "0";
}

/** Map the Amazon category string to a readable category label.
 *  Uses the full hierarchical path (e.g. "Electronics|HomeTheater|Televisions|SmartTV")
 *  truncated to 255 chars to fit the DB column. Falls back to top-level only if empty.
 */
function simplifyCategory(category: string): string {
  if (!category) return "Other";
  const cleaned = category.trim();
  if (!cleaned) return "Other";
  // Use the full path — it's more informative and fits in varchar(255)
  return cleaned.length > 255 ? cleaned.slice(0, 255) : cleaned;
}

/** Assign a status based on rating and discount */
function assignStatus(
  rating: number,
  discountPct: number
): "optimal" | "underpriced" | "overpriced" | "alert" {
  if (rating < 3.0) return "alert";
  if (discountPct > 70) return "underpriced";
  if (discountPct < 20) return "overpriced";
  return "optimal";
}

async function seed() {
  logger.info("Starting database seed...");

  try {
    // 1. Create a default admin user if none exists
    const existingUsers = await db.select().from(schema.users).limit(1);
    let userId: string;

    if (existingUsers.length === 0) {
      const seedAdminEmail = process.env.SEED_ADMIN_EMAIL;
      const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD;
      if (!seedAdminEmail || !seedAdminPassword) {
        throw new Error(
          "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required when creating the first seed user"
        );
      }
      logger.info("👤 Creating default admin user...");
      const passwordHash = await bcrypt.hash(seedAdminPassword, 12);
      const [user] = await db
        .insert(schema.users)
        .values({
          openId: "local_admin_001",
          email: seedAdminEmail,
          passwordHash,
          name: "Admin User",
          loginMethod: "email",
          role: "admin",
        })
        .returning();
      userId = user.id;
      logger.info(`✅ Created admin user: ${user.email}`);
    } else {
      userId = existingUsers[0].id;
      logger.info(`ℹ️ Using existing user: ${existingUsers[0].email}`);
    }

    // 2. Create a shopify store for the user
    logger.info("🏪 Creating mock Shopify store...");
    const [canonicalShop] = await db
      .insert(schema.shops)
      .values({
        canonicalDomain: "pricevision-demo.myshopify.com",
        normalizedDomain: "pricevision-demo.myshopify.com",
        name: "PriceVision Demo Store",
        platform: "shopify",
      })
      .onConflictDoUpdate({
        target: schema.shops.normalizedDomain,
        set: { updatedAt: new Date() },
      })
      .returning();
    const [store] = await db
      .insert(schema.accountShopConnections)
      .values({
        userId,
        shopId: canonicalShop.id,
        storeName: "PriceVision Demo Store",
        currency: "USD",
        isActive: true,
        scopes: "read_products",
      })
      .onConflictDoUpdate({
        target: [schema.accountShopConnections.userId, schema.accountShopConnections.shopId],
        set: { updatedAt: new Date(), isActive: true },
      })
      .returning();
    logger.info(`✅ Store created/updated: pricevision-demo.myshopify.com`);

    // 3. Create competitors
    logger.info("🏢 Creating competitors...");
    const competitorData = [
      { name: "Amazon", domain: "amazon.com" },
      { name: "Walmart", domain: "walmart.com" },
      { name: "Best Buy", domain: "bestbuy.com" },
    ];

    const competitors = [];
    for (const comp of competitorData) {
      const [competitorShop] = await db
        .insert(schema.shops)
        .values({
          canonicalDomain: comp.domain,
          normalizedDomain: comp.domain,
          name: comp.name,
        })
        .onConflictDoUpdate({
          target: schema.shops.normalizedDomain,
          set: { updatedAt: new Date() },
        })
        .returning();
      const [inserted] = await db
        .insert(schema.competitors)
        .values({
          shopId: competitorShop.id,
          name: comp.name,
          domain: comp.domain,
          status: "active",
        })
        .returning();
      await db.insert(schema.accountCompetitorConnections).values({
        userId,
        competitorId: inserted.id,
        isActive: true,
      }).onConflictDoNothing();
      competitors.push(inserted);
    }
    logger.info(`✅ Created ${competitors.length} competitors`);

    // 4. Product data — products are seeded from the Amazon CSV in step 5.
    // No hardcoded products: the CSV filter keeps only Electronics, capped at 10.

    // 5. Load Amazon sales CSV dataset
    logger.info("📂 Loading Amazon sales CSV dataset...");
    const csvPath = resolve(process.cwd(), "data", "amazon.csv");
    const csvRaw = readFileSync(csvPath, "utf-8");
    const csvLines = csvRaw.split("\n").filter(l => l.trim().length > 0);
    const csvHeaders = parseCSVLine(csvLines[0]);
    logger.info(`   CSV columns: ${csvHeaders.join(", ")}`);

    // Map column names → index
    const ci = (name: string) => csvHeaders.indexOf(name);
    const colProductId = ci("product_id");
    const colName = ci("product_name");
    const colCategory = ci("category");
    const colDiscounted = ci("discounted_price");
    const colActual = ci("actual_price");
    const colDiscount = ci("discount_percentage");
    const colRating = ci("rating");
    const colAbout = ci("about_product");
    const colImgLink = ci("img_link");

    let amazonCount = 0;
    const BATCH = 100;
    const batch: (typeof schema.products.$inferInsert)[] = [];
    const MAX_AMAZON_PRODUCTS = 10; // Cap seeded Amazon products to limit monitoring load
    const ELECTRONICS_CATEGORY = "Electronics";

    for (let i = 1; i < csvLines.length; i++) {
      if (amazonCount >= MAX_AMAZON_PRODUCTS) break;

      const fields = parseCSVLine(csvLines[i]);
      if (fields.length < 5) continue;

      // Only seed Electronics category products
      const rawCategory = (fields[colCategory] || "").trim();
      const topLevelCategory = rawCategory.split("|")[0]?.trim() || "";
      if (topLevelCategory !== ELECTRONICS_CATEGORY) continue;

      const rawDiscounted = parsePrice(fields[colDiscounted] || "");
      const rawActual = parsePrice(fields[colActual] || "");
      if (rawDiscounted === null || rawActual === null) continue;

      const discountPct = parseDiscount(fields[colDiscount] || "0");
      const rating = parseFloat(fields[colRating] || "0") || 0;
      const title = (
        fields[colName] || `Amazon Product ${fields[colProductId] || i}`
      ).slice(0, 500);
      const category = simplifyCategory(rawCategory);
      const status = assignStatus(rating, parseFloat(discountPct));

      batch.push({
        userId,
        storeId: store.id,
        shopifyProductId: fields[colProductId] || null,
        title,
        description: fields[colAbout] || null,
        category,
        price: rawDiscounted.toFixed(2),
        compareAtPrice: rawActual.toFixed(2),
        currency: "INR",
        imageUrl: fields[colImgLink] || null,
        status,
        isTracked: true,
        isActive: true,
      });

      if (batch.length >= BATCH && amazonCount < MAX_AMAZON_PRODUCTS) {
        const remaining = MAX_AMAZON_PRODUCTS - amazonCount;
        const toInsert = batch.slice(0, remaining);
        const inserted = await db
          .insert(schema.products)
          .values(toInsert)
          .returning();
        amazonCount += inserted.length;
        batch.length = 0;
        process.stdout.write(
          `\r   Inserted ${amazonCount} / ${MAX_AMAZON_PRODUCTS} Amazon products...`
        );
      }
    }

    // Flush final batch
    if (batch.length > 0 && amazonCount < MAX_AMAZON_PRODUCTS) {
      const remaining = MAX_AMAZON_PRODUCTS - amazonCount;
      const inserted = await db
        .insert(schema.products)
        .values(batch.slice(0, remaining))
        .returning();
      amazonCount += inserted.length;
    }

    logger.info(
      `\n✅ Seeded ${amazonCount} Amazon products from CSV (Electronics only, capped at ${MAX_AMAZON_PRODUCTS})`
    );

    // 6. Create notification preferences for the user
    logger.info("🔔 Creating notification preferences...");
    await db
      .insert(schema.notificationPreferences)
      .values({
        userId,
        emailNotifications: true,
        inAppNotifications: true,
        frequency: "realtime",
        priceDropThreshold: "5.00",
        priceIncreaseThreshold: "5.00",
      })
      .onConflictDoUpdate({
        target: schema.notificationPreferences.userId,
        set: { updatedAt: new Date() },
      });
    logger.info("✅ Notification preferences created");

    // 7. Create sample alerts
    logger.info("🚨 Creating sample alerts...");
    const allProducts = await db
      .select()
      .from(schema.products)
      .where(eq(schema.products.userId, userId));
    const sampleAlerts = [
      {
        userId,
        productId: allProducts[0]?.id ?? "",
        alertType: "price_drop" as const,
        severity: "critical" as const,
        title: "Critical Price Drop Detected",
        message: `${allProducts[0]?.title ?? "Product"} price dropped 15% on Amazon — immediate attention required.`,
        triggerPrice: "110.49",
        triggerCondition: "below",
        isRead: false,
        isResolved: false,
        isNotified: false,
      },
      {
        userId,
        productId: allProducts[1]?.id ?? "",
        alertType: "competitor_change" as const,
        severity: "high" as const,
        title: "Competitor Price Change",
        message: `Walmart changed price for ${allProducts[1]?.title ?? "Product"} — review recommended.`,
        isRead: false,
        isResolved: false,
        isNotified: false,
      },
      {
        userId,
        productId: allProducts[2]?.id ?? "",
        alertType: "threshold" as const,
        severity: "medium" as const,
        title: "Price Threshold Exceeded",
        message: `${allProducts[2]?.title ?? "Product"} crossed your 10% threshold setting.`,
        triggerPrice: "314.99",
        triggerCondition: "below",
        isRead: false,
        isResolved: false,
        isNotified: false,
      },
      {
        userId,
        productId: allProducts[3]?.id ?? "",
        alertType: "price_increase" as const,
        severity: "low" as const,
        title: "Minor Price Increase",
        message: `${allProducts[3]?.title ?? "Product"} price increased 3% on Best Buy.`,
        isRead: true,
        isResolved: false,
        isNotified: false,
      },
      {
        userId,
        productId: allProducts[4]?.id ?? "",
        alertType: "price_drop" as const,
        severity: "medium" as const,
        title: "Opportunity: Competitor Price Drop",
        message: `Amazon dropped price for ${allProducts[4]?.title ?? "Product"} — consider matching.`,
        isRead: false,
        isResolved: true,
        isNotified: false,
        resolvedAt: new Date(),
      },
    ];

    for (const alert of sampleAlerts) {
      if (alert.productId) {
        await db.insert(schema.alerts).values(alert);
      }
    }
    logger.info(`✅ Created ${sampleAlerts.length} sample alerts`);

    // 8. Create sample recommendations
    logger.info("💡 Creating sample recommendations...");
    const sampleRecommendations = [
      {
        userId,
        productId: allProducts[0]?.id ?? "",
        currentPrice: "129.99",
        recommendedPrice: "119.99",
        priceChange: "-10.00",
        priceChangePercent: "-7.69",
        confidenceScore: 0.92,
        reason:
          "Amazon is pricing 8% lower. Matching their price could increase conversion by ~12%.",
        factors: JSON.stringify({
          competitorAvg: 119.5,
          demandTrend: "rising",
          marginImpact: "minimal",
        }),
        status: "pending" as const,
        potentialSavings: "500.00",
      },
      {
        userId,
        productId: allProducts[1]?.id ?? "",
        currentPrice: "79.99",
        recommendedPrice: "74.99",
        priceChange: "-5.00",
        priceChangePercent: "-6.25",
        confidenceScore: 0.85,
        reason:
          "Walmart undercut by $5. Price elasticity analysis suggests 15% volume increase at lower price.",
        factors: JSON.stringify({
          competitorAvg: 75.0,
          demandTrend: "stable",
          marginImpact: "low",
        }),
        status: "pending" as const,
        potentialSavings: "250.00",
      },
      {
        userId,
        productId: allProducts[2]?.id ?? "",
        currentPrice: "349.99",
        recommendedPrice: "369.99",
        priceChange: "20.00",
        priceChangePercent: "5.71",
        confidenceScore: 0.78,
        reason:
          "You are underpriced vs market average of $365. Raising price could improve margin without volume loss.",
        factors: JSON.stringify({
          competitorAvg: 365.0,
          demandTrend: "rising",
          marginImpact: "positive",
        }),
        status: "pending" as const,
        potentialSavings: "1200.00",
      },
    ];

    for (const rec of sampleRecommendations) {
      if (rec.productId) {
        await db.insert(schema.recommendations).values(rec);
      }
    }
    logger.info(
      `✅ Created ${sampleRecommendations.length} sample recommendations`
    );

    // 9. Create activity logs
    logger.info("📋 Creating activity logs...");
    const sampleActivities = [
      {
        action: "product.created",
        entityType: "product",
        entityId: allProducts[0]?.id,
        detail: `Created product: ${allProducts[0]?.title}`,
      },
      {
        action: "competitor.added",
        entityType: "competitor",
        entityId: competitors[0]?.id,
        detail: `Added competitor: ${competitors[0]?.name}`,
      },
      {
        action: "alert.triggered",
        entityType: "alert",
        entityId: null,
        detail: "Price drop alert triggered for Mechanical Keyboard RGB",
      },
      {
        action: "product.imported",
        entityType: "product",
        entityId: null,
        detail: `Imported ${amazonCount} products from Amazon CSV`,
      },
      {
        action: "store.connected",
        entityType: "shopify_store",
        entityId: store.id,
        detail: `Connected Shopify store: ${store.storeName}`,
      },
    ];

    for (const activity of sampleActivities) {
      if (activity.entityId) {
        await db.insert(schema.activityLogs).values({
          userId,
          action: activity.action,
          entityType: activity.entityType,
          entityId: activity.entityId,
          detail: activity.detail,
        });
      }
    }
    logger.info(`✅ Created ${sampleActivities.length} activity logs`);

    logger.info("✨ Seeding completed successfully!");
  } catch (error) {
    logger.error({ err: error }, "❌ Seeding failed");
    if (error instanceof Error) {
      logger.error(
        { message: error.message, stack: error.stack },
        "Error details"
      );
    }
  } finally {
    await pool.end();
  }
}

seed();
