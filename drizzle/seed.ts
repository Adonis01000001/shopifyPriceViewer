/**
 * @deprecated This file is deprecated — it has hardcoded credentials.
 * Use `server/seed.ts` instead (run via `pnpm db:seed`).
 * This file is kept only for reference and should be removed.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "priceviewer",
  password: "devpassword",
  database: "shopify_price_intelligence",
});

const db = drizzle({ client: pool, schema });

// ── helpers ──────────────────────────────────────────────────────────────
const uid = () => crypto.randomUUID();
const now = () => new Date();
const daysAgo = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x;
};
const rnd = (min: number, max: number) =>
  Math.round((Math.random() * (max - min) + min) * 100) / 100;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ── main ─────────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Seeding database...\n");

  // Clear existing seed data (order matters for FK constraints)
  console.log("🧹 Clearing existing data...");
  await db.delete(schema.activityLogs);
  await db.delete(schema.scrapeJobs);
  await db.delete(schema.priceHistory);
  await db.delete(schema.competitorProducts);
  await db.delete(schema.competitors);
  await db.delete(schema.recommendations);
  await db.delete(schema.alerts);
  await db.delete(schema.productEmbeddings);
  await db.delete(schema.products);
  await db.delete(schema.shopifyStores);
  await db.delete(schema.emailConfigs);
  await db.delete(schema.notificationPreferences);
  await db.delete(schema.users);
  console.log("✅ Cleared\n");

  // ── 1. User ──────────────────────────────────────────────────────────
  const userId = uid();
  await db.insert(schema.users).values({
    id: userId,
    openId: "dev-user-001",
    email: "demo@priceintelligence.com",
    name: "Alex Demo",
    loginMethod: "email",
    role: "user",
    avatarUrl: null,
    createdAt: daysAgo(90),
    updatedAt: now(),
    lastSignedIn: daysAgo(0),
  });
  console.log("✅ User:", userId);

  // ── 2. Notification Preferences ──────────────────────────────────────
  await db.insert(schema.notificationPreferences).values({
    id: uid(),
    userId,
    emailNotifications: true,
    inAppNotifications: true,
    frequency: "daily",
    priceDropThreshold: "5.00",
    priceIncreaseThreshold: "5.00",
    createdAt: daysAgo(90),
    updatedAt: now(),
  });

  // ── 3. Email Config ──────────────────────────────────────────────────
  await db.insert(schema.emailConfigs).values({
    id: uid(),
    userId,
    smtpServer: "smtp.gmail.com",
    smtpPort: 587,
    smtpUsername: "demo@priceintelligence.com",
    smtpPassword: "app-password-placeholder",
    fromEmail: "noreply@priceintelligence.com",
    fromName: "Price Intelligence",
    isEnabled: true,
    createdAt: daysAgo(90),
    updatedAt: now(),
  });

  // ── 4. Shopify Store ─────────────────────────────────────────────────
  const storeId = uid();
  await db.insert(schema.shopifyStores).values({
    id: storeId,
    userId,
    shopDomain: "demo-store.myshopify.com",
    accessToken: "shpat_demo_access_token_xxxxxxxx",
    scopes: "read_products,read_orders,write_products",
    storeName: "Demo Electronics Store",
    storeEmail: "admin@demostore.com",
    currency: "USD",
    timezone: "America/New_York",
    isActive: true,
    lastSyncedAt: daysAgo(1),
    createdAt: daysAgo(90),
    updatedAt: now(),
  });
  console.log("✅ Store:", storeId);

  // ── 5. Products ──────────────────────────────────────────────────────
  const productData: {
    title: string;
    sku: string;
    category: string;
    vendor: string;
    price: string;
    compareAtPrice: string;
    costPrice: string;
    status: "optimal" | "underpriced" | "overpriced" | "alert";
    shopifyProductId: string;
  }[] = [
    // Electronics
    { title: "Sony WH-1000XM5 Wireless Headphones", sku: "ELEC-HP-001", category: "Electronics", vendor: "Sony", price: "349.99", compareAtPrice: "399.99", costPrice: "210.00", status: "optimal", shopifyProductId: "gid://shopify/Product/1001" },
    { title: "Apple AirPods Pro 2nd Gen", sku: "ELEC-HP-002", category: "Electronics", vendor: "Apple", price: "249.00", compareAtPrice: "279.00", costPrice: "150.00", status: "optimal", shopifyProductId: "gid://shopify/Product/1002" },
    { title: "Samsung Galaxy Watch 6 Classic", sku: "ELEC-WT-001", category: "Electronics", vendor: "Samsung", price: "329.99", compareAtPrice: "369.99", costPrice: "198.00", status: "underpriced", shopifyProductId: "gid://shopify/Product/1003" },
    { title: "Bose QuietComfort Ultra Earbuds", sku: "ELEC-HP-003", category: "Electronics", vendor: "Bose", price: "299.00", compareAtPrice: "299.00", costPrice: "180.00", status: "optimal", shopifyProductId: "gid://shopify/Product/1004" },
    { title: "JBL Charge 5 Bluetooth Speaker", sku: "ELEC-SP-001", category: "Electronics", vendor: "JBL", price: "179.99", compareAtPrice: "199.99", costPrice: "90.00", status: "optimal", shopifyProductId: "gid://shopify/Product/1005" },
    // Clothing
    { title: "Nike Air Max 270 Running Shoes", sku: "CLO-SH-001", category: "Clothing", vendor: "Nike", price: "150.00", compareAtPrice: "170.00", costPrice: "60.00", status: "optimal", shopifyProductId: "gid://shopify/Product/2001" },
    { title: "Levi's 501 Original Fit Jeans", sku: "CLO-JN-001", category: "Clothing", vendor: "Levi's", price: "69.50", compareAtPrice: "89.50", costPrice: "22.00", status: "overpriced", shopifyProductId: "gid://shopify/Product/2002" },
    { title: "Patagonia Better Sweater Fleece Jacket", sku: "CLO-JK-001", category: "Clothing", vendor: "Patagonia", price: "139.00", compareAtPrice: "159.00", costPrice: "48.00", status: "optimal", shopifyProductId: "gid://shopify/Product/2003" },
    { title: "Adidas Ultraboost 23 Running Shoes", sku: "CLO-SH-002", category: "Clothing", vendor: "Adidas", price: "190.00", compareAtPrice: "190.00", costPrice: "76.00", status: "alert", shopifyProductId: "gid://shopify/Product/2004" },
    { title: "The North Face Puffer Jacket", sku: "CLO-JK-002", category: "Clothing", vendor: "The North Face", price: "229.00", compareAtPrice: "279.00", costPrice: "92.00", status: "optimal", shopifyProductId: "gid://shopify/Product/2005" },
    // Home & Garden
    { title: "Dyson V15 Detect Vacuum", sku: "HOM-VC-001", category: "Home & Garden", vendor: "Dyson", price: "749.99", compareAtPrice: "799.99", costPrice: "450.00", status: "underpriced", shopifyProductId: "gid://shopify/Product/3001" },
    { title: "iRobot Roomba j9+ Robot Vacuum", sku: "HOM-VC-002", category: "Home & Garden", vendor: "iRobot", price: "899.99", compareAtPrice: "999.99", costPrice: "540.00", status: "optimal", shopifyProductId: "gid://shopify/Product/3002" },
    { title: "Philips Hue Starter Kit (4 bulbs)", sku: "HOM-LT-001", category: "Home & Garden", vendor: "Philips", price: "199.99", compareAtPrice: "229.99", costPrice: "100.00", status: "optimal", shopifyProductId: "gid://shopify/Product/3003" },
    { title: "Ninja Foodi 9-in-1 Air Fryer Oven", sku: "HOM-AP-001", category: "Home & Garden", vendor: "Ninja", price: "249.99", compareAtPrice: "279.99", costPrice: "137.00", status: "overpriced", shopifyProductId: "gid://shopify/Product/3004" },
    // Sports
    { title: "Yeti Rambler 30oz Tumbler", sku: "SPT-DK-001", category: "Sports", vendor: "Yeti", price: "38.00", compareAtPrice: "38.00", costPrice: "12.00", status: "optimal", shopifyProductId: "gid://shopify/Product/4001" },
    { title: "Hydro Flask 32oz Water Bottle", sku: "SPT-DK-002", category: "Sports", vendor: "Hydro Flask", price: "44.95", compareAtPrice: "49.95", costPrice: "14.00", status: "optimal", shopifyProductId: "gid://shopify/Product/4002" },
    { title: "Garmin Forerunner 965 GPS Watch", sku: "SPT-WT-001", category: "Sports", vendor: "Garmin", price: "499.99", compareAtPrice: "549.99", costPrice: "300.00", status: "alert", shopifyProductId: "gid://shopify/Product/4003" },
    { title: "Peloton Bike+ Indoor Cycle", sku: "SPT-FN-001", category: "Sports", vendor: "Peloton", price: "2495.00", compareAtPrice: "2495.00", costPrice: "1500.00", status: "optimal", shopifyProductId: "gid://shopify/Product/4004" },
  ];

  const productIds: string[] = [];
  for (const p of productData) {
    const id = uid();
    productIds.push(id);
    await db.insert(schema.products).values({
      id,
      userId,
      storeId,
      shopifyProductId: p.shopifyProductId,
      shopifyVariantId: null,
      title: p.title,
      description: `High-quality ${p.title.toLowerCase()} from ${p.vendor}.`,
      sku: p.sku,
      barcode: null,
      vendor: p.vendor,
      productType: p.category,
      category: p.category,
      tags: `${p.category},${p.vendor},bestseller`,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      costPrice: p.costPrice,
      currency: "USD",
      imageUrl: null,
      status: p.status,
      isTracked: true,
      isActive: true,
      lastSyncedAt: daysAgo(1),
      createdAt: daysAgo(rnd(30, 85)),
      updatedAt: daysAgo(rnd(0, 7)),
    });
  }
  console.log(`✅ ${productIds.length} Products`);

  // ── 6. Competitors ───────────────────────────────────────────────────
  const competitorData: {
    name: string;
    domain: string;
    status: "active" | "inactive" | "error";
    priceIndex: string;
    avgPriceDiff: string;
    productsTracked: number;
    scrapeStatus: "pending" | "running" | "success" | "failed";
  }[] = [
    { name: "TechHaven", domain: "techhaven.com", status: "active", priceIndex: "97.50", avgPriceDiff: "-2.50", productsTracked: 8, scrapeStatus: "success" },
    { name: "FashionForward", domain: "fashionforward.com", status: "active", priceIndex: "103.20", avgPriceDiff: "3.20", productsTracked: 5, scrapeStatus: "success" },
    { name: "HomeEssentials", domain: "homeessentials.com", status: "active", priceIndex: "99.80", avgPriceDiff: "-0.20", productsTracked: 4, scrapeStatus: "success" },
    { name: "SportZone", domain: "sportzone.com", status: "active", priceIndex: "105.40", avgPriceDiff: "5.40", productsTracked: 3, scrapeStatus: "success" },
    { name: "MegaMart", domain: "megamart.com", status: "inactive", priceIndex: "94.10", avgPriceDiff: "-5.90", productsTracked: 0, scrapeStatus: "pending" },
    { name: "QuickBuy", domain: "quickbuy.com", status: "error", priceIndex: "101.00", avgPriceDiff: "1.00", productsTracked: 2, scrapeStatus: "failed" },
  ];

  const competitorIds: string[] = [];
  for (const c of competitorData) {
    const id = uid();
    competitorIds.push(id);
    await db.insert(schema.competitors).values({
      id,
      userId,
      name: c.name,
      domain: c.domain,
      logoUrl: null,
      description: `${c.name} - competitor store`,
      status: c.status,
      productsTracked: c.productsTracked,
      avgPriceDiff: c.avgPriceDiff,
      priceIndex: c.priceIndex,
      lastScrapedAt: c.status === "active" ? daysAgo(Math.floor(Math.random() * 3)) : null,
      scrapeStatus: c.scrapeStatus,
      scrapeError: c.status === "error" ? "Connection timeout after 30s" : null,
      createdAt: daysAgo(rnd(60, 90)),
      updatedAt: daysAgo(rnd(0, 2)),
    });
  }
  console.log(`✅ ${competitorIds.length} Competitors`);

  // ── 7. Competitor Products (matched products) ────────────────────────
  // Match first 4 competitors to various products
  const activeCompetitors = competitorIds.slice(0, 4);
  const matchMethods = ["ai_embedding", "sku_match", "title_match", "manual"];
  let matchCount = 0;

  for (let ci = 0; ci < activeCompetitors.length; ci++) {
    const compId = activeCompetitors[ci];
    // Each competitor matches 2-4 random products
    const numMatches = 2 + Math.floor(Math.random() * 3);
    const shuffled = [...productIds].sort(() => Math.random() - 0.5);
    const matched = shuffled.slice(0, numMatches);

    for (const prodId of matched) {
      const origPrice = Number(productData[productIds.indexOf(prodId)].price);
      // Competitor price varies from -8% to +12% of our price
      const compPrice = Math.round(origPrice * (1 + rnd(-0.08, 0.12)) * 100) / 100;
      await db.insert(schema.competitorProducts).values({
        id: uid(),
        competitorId: compId,
        productId: prodId,
        competitorProductUrl: `https://${competitorData[ci].domain}/products/${prodId.slice(0, 8)}`,
        competitorProductTitle: productData[productIds.indexOf(prodId)].title,
        competitorSku: `COMP-${(ci + 1)}-${matched.indexOf(prodId) + 1}`,
        price: String(compPrice),
        currency: "USD",
        matchScore: rnd(0.72, 0.99),
        matchMethod: pick(matchMethods),
        isVerified: Math.random() > 0.3,
        isActive: true,
        lastScrapedAt: daysAgo(Math.floor(Math.random() * 5)),
        createdAt: daysAgo(rnd(10, 60)),
        updatedAt: daysAgo(rnd(0, 3)),
      });
      matchCount++;
    }
  }
  console.log(`✅ ${matchCount} Competitor Products`);

  // ── 8. Price History (90 days of data for tracked products) ──────────
  let priceHistoryCount = 0;
  for (let i = 0; i < productIds.length; i++) {
    const prodId = productIds[i];
    const basePrice = Number(productData[i].price);
    const costPrice = Number(productData[i].costPrice);

    // Generate 60-90 days of price history (every 2-3 days)
    for (let day = 90; day >= 0; day -= 2 + Math.floor(Math.random() * 2)) {
      // Price fluctuates slightly around the current price
      const variation = rnd(-0.05, 0.05);
      const historicalPrice = Math.round(basePrice * (1 + variation) * 100) / 100;

      await db.insert(schema.priceHistory).values({
        id: uid(),
        productId: prodId,
        competitorProductId: null,
        price: String(historicalPrice),
        currency: "USD",
        source: "shopify",
        recordedAt: daysAgo(day),
        createdAt: daysAgo(day),
      });
      priceHistoryCount++;
    }

    // Also add some competitor price history for matched products
    const compMatch = await db
      .select()
      .from(schema.competitorProducts)
      .where(eq(schema.competitorProducts.productId, prodId))
      .limit(1);

    if (compMatch.length > 0) {
      for (let day = 30; day >= 0; day -= 5) {
        const compVariation = rnd(-0.03, 0.08);
        const compPrice = Math.round(basePrice * (1 + compVariation) * 100) / 100;
        await db.insert(schema.priceHistory).values({
          id: uid(),
          productId: prodId,
          competitorProductId: compMatch[0].id,
          price: String(compPrice),
          currency: "USD",
          source: "competitor",
          recordedAt: daysAgo(day),
          createdAt: daysAgo(day),
        });
        priceHistoryCount++;
      }
    }
  }
  console.log(`✅ ${priceHistoryCount} Price History records`);

  // ── 9. Alerts ────────────────────────────────────────────────────────
  const alertData: {
    title: string;
    message: string;
    alertType: "price_drop" | "price_increase" | "competitor_change" | "threshold";
    severity: "low" | "medium" | "high" | "critical";
    isRead: boolean;
    isResolved: boolean;
    triggerPrice: string;
    triggerCondition: string;
  }[] = [
    { title: "Sony WH-1000XM5 price dropped 12%", message: "TechHaven dropped Sony WH-1000XM5 from $349.99 to $307.99. Consider matching or beating this price.", alertType: "price_drop", severity: "high", isRead: false, isResolved: false, triggerPrice: "307.99", triggerCondition: "below" },
    { title: "Levi's 501 Jeans overpriced vs market", message: "Our price ($69.50) is 15% higher than FashionForward ($59.99). Risk of losing sales.", alertType: "competitor_change", severity: "medium", isRead: true, isResolved: false, triggerPrice: "59.99", triggerCondition: "below" },
    { title: "Adidas Ultraboost 23 - critical alert", message: "SportZone is selling Adidas Ultraboost 23 for $159.99, 15% below our $190.00. Immediate action recommended.", alertType: "price_drop", severity: "critical", isRead: false, isResolved: false, triggerPrice: "159.99", triggerCondition: "below" },
    { title: "Garmin Forerunner 965 price threshold breached", message: "Garmin Forerunner 965 dropped below $450 threshold at SportZone ($429.99).", alertType: "threshold", severity: "high", isRead: false, isResolved: false, triggerPrice: "429.99", triggerCondition: "below" },
    { title: "Dyson V15 underpriced opportunity", message: "Our Dyson V15 ($749.99) is priced below HomeEssentials ($799.99). Room to increase margin.", alertType: "competitor_change", severity: "low", isRead: true, isResolved: true, triggerPrice: "799.99", triggerCondition: "above" },
    { title: "Nike Air Max 270 competitor price increase", message: "FashionForward raised Nike Air Max 270 from $145.00 to $160.00. Our $150.00 is now competitive.", alertType: "price_increase", severity: "low", isRead: true, isResolved: true, triggerPrice: "160.00", triggerCondition: "above" },
    { title: "Samsung Galaxy Watch 6 underpriced", message: "Samsung Galaxy Watch 6 Classic is priced $40 below market average. Consider raising to $369.99.", alertType: "competitor_change", severity: "medium", isRead: false, isResolved: false, triggerPrice: "369.99", triggerCondition: "above" },
    { title: "Ninja Foodi overpriced vs HomeEssentials", message: "HomeEssentials sells Ninja Foodi for $219.99 vs our $249.99. 12% price gap detected.", alertType: "competitor_change", severity: "medium", isRead: true, isResolved: false, triggerPrice: "219.99", triggerCondition: "below" },
    { title: "Peloton Bike+ price match opportunity", message: "SportZone has Peloton Bike+ at $2,395.00 vs our $2,495.00. Consider matching.", alertType: "price_drop", severity: "low", isRead: false, isResolved: false, triggerPrice: "2395.00", triggerCondition: "below" },
    { title: "QuickBuy scrape failed", message: "Failed to scrape QuickBuy after 3 retries. Last error: Connection timeout after 30s.", alertType: "competitor_change", severity: "high", isRead: false, isResolved: false, triggerPrice: null, triggerCondition: null },
  ];

  let alertIdx = 0;
  for (const a of alertData) {
    // Assign alerts to relevant products
    const prodId = productIds[alertIdx % productIds.length];
    await db.insert(schema.alerts).values({
      id: uid(),
      userId,
      productId: prodId,
      competitorProductId: null,
      alertType: a.alertType,
      severity: a.severity,
      title: a.title,
      message: a.message,
      triggerPrice: a.triggerPrice,
      triggerCondition: a.triggerCondition,
      isRead: a.isRead,
      isResolved: a.isResolved,
      isNotified: a.isRead,
      resolvedAt: a.isResolved ? daysAgo(rnd(1, 14)) : null,
      createdAt: daysAgo(rnd(0, 30)),
      updatedAt: daysAgo(rnd(0, 7)),
    });
    alertIdx++;
  }
  console.log(`✅ ${alertData.length} Alerts`);

  // ── 10. Recommendations ──────────────────────────────────────────────
  const recData: {
    title: string;
    currentPrice: string;
    recommendedPrice: string;
    priceChange: string;
    priceChangePercent: string;
    confidenceScore: number;
    status: "pending" | "implemented" | "dismissed";
    reason: string;
  }[] = [
    { title: "Sony WH-1000XM5", currentPrice: "349.99", recommendedPrice: "319.99", priceChange: "-30.00", priceChangePercent: "-8.57", confidenceScore: 0.92, status: "pending", reason: "TechHaven dropped price to $307.99. Recommend matching at $319.99 to stay competitive while preserving margin." },
    { title: "Levi's 501 Jeans", currentPrice: "69.50", recommendedPrice: "59.99", priceChange: "-9.51", priceChangePercent: "-13.68", confidenceScore: 0.88, status: "pending", reason: "FashionForward sells at $59.99. Our 15% premium is causing lost sales. Recommend matching." },
    { title: "Samsung Galaxy Watch 6", currentPrice: "329.99", recommendedPrice: "359.99", priceChange: "30.00", priceChangePercent: "9.09", confidenceScore: 0.85, status: "pending", reason: "We are underpriced by $40 vs market. Competitors average $369.99. Room to increase." },
    { title: "Adidas Ultraboost 23", currentPrice: "190.00", recommendedPrice: "164.99", priceChange: "-25.01", priceChangePercent: "-13.16", confidenceScore: 0.95, status: "pending", reason: "SportZone at $159.99. Critical price gap. Recommend $164.99 to undercut while maintaining margin." },
    { title: "Dyson V15 Detect", currentPrice: "749.99", recommendedPrice: "779.99", priceChange: "30.00", priceChangePercent: "4.00", confidenceScore: 0.78, status: "implemented", reason: "HomeEssentials at $799.99. We can increase to $779.99 and still be competitive." },
    { title: "Ninja Foodi Air Fryer", currentPrice: "249.99", recommendedPrice: "229.99", priceChange: "-20.00", priceChangePercent: "-8.00", confidenceScore: 0.82, status: "pending", reason: "HomeEssentials at $219.99. Recommend $229.99 to be competitive." },
    { title: "Garmin Forerunner 965", currentPrice: "499.99", recommendedPrice: "449.99", priceChange: "-50.00", priceChangePercent: "-10.00", confidenceScore: 0.90, status: "pending", reason: "SportZone at $429.99. Recommend $449.99 to match market." },
    { title: "Nike Air Max 270", currentPrice: "150.00", recommendedPrice: "155.00", priceChange: "5.00", priceChangePercent: "3.33", confidenceScore: 0.65, status: "dismissed", reason: "FashionForward raised to $160.00. Our $150.00 is already competitive. No action needed." },
    { title: "Peloton Bike+", currentPrice: "2495.00", recommendedPrice: "2449.00", priceChange: "-46.00", priceChangePercent: "-1.84", confidenceScore: 0.71, status: "pending", reason: "SportZone at $2,395.00. Small gap, but recommend $2,449.00 to stay competitive." },
    { title: "Bose QC Ultra Earbuds", currentPrice: "299.00", recommendedPrice: "289.00", priceChange: "-10.00", priceChangePercent: "-3.34", confidenceScore: 0.55, status: "dismissed", reason: "Low confidence match. Competitor data may not be for exact same SKU. Skipping." },
  ];

  let recIdx = 0;
  for (const r of recData) {
    const prodId = productIds[recIdx % productIds.length];
    await db.insert(schema.recommendations).values({
      id: uid(),
      userId,
      productId: prodId,
      currentPrice: r.currentPrice,
      recommendedPrice: r.recommendedPrice,
      priceChange: r.priceChange,
      priceChangePercent: r.priceChangePercent,
      confidenceScore: r.confidenceScore,
      reason: r.reason,
      factors: {
        competitorCount: 2 + Math.floor(Math.random() * 3),
        avgCompetitorPrice: rnd(0.9, 1.15) * Number(r.currentPrice),
        dataPoints: 10 + Math.floor(Math.random() * 20),
      },
      status: r.status,
      implementedAt: r.status === "implemented" ? daysAgo(rnd(1, 10)) : null,
      dismissedAt: r.status === "dismissed" ? daysAgo(rnd(1, 7)) : null,
      potentialSavings: r.status === "implemented" ? String(Math.abs(Number(r.priceChange)) * rnd(5, 25)) : null,
      createdAt: daysAgo(rnd(0, 20)),
      updatedAt: daysAgo(rnd(0, 5)),
    });
    recIdx++;
  }
  console.log(`✅ ${recData.length} Recommendations`);

  // ── 11. Scrape Jobs ──────────────────────────────────────────────────
  for (const compId of competitorIds) {
    const comp = competitorData[competitorIds.indexOf(compId)];
    const numJobs = 3 + Math.floor(Math.random() * 5);
    for (let j = 0; j < numJobs; j++) {
      const status = j === 0 && comp.status === "active" ? "success" : pick(["success", "success", "success", "failed"]);
      const startedAt = daysAgo(j * 3 + Math.floor(Math.random() * 2));
      const completedAt = new Date(startedAt.getTime() + rnd(5, 45) * 1000);
      await db.insert(schema.scrapeJobs).values({
        id: uid(),
        competitorId: compId,
        status,
        startedAt,
        completedAt,
        productsScraped: status === "success" ? Math.floor(rnd(5, 50)) : 0,
        productsUpdated: status === "success" ? Math.floor(rnd(3, 30)) : 0,
        errorMessage: status === "failed" ? pick(["Connection timeout", "HTTP 429 rate limited", "Parse error: selector not found", "DNS resolution failed"]) : null,
        metadata: { durationMs: completedAt.getTime() - startedAt.getTime() },
        createdAt: startedAt,
      });
    }
  }
  console.log("✅ Scrape Jobs");

  // ── 12. Activity Logs ────────────────────────────────────────────────
  const activityData: { action: string; entityType: string; detail: string }[] = [
    { action: "Product synced from Shopify", entityType: "product", detail: "Sony WH-1000XM5 - price updated to $349.99" },
    { action: "Competitor price detected", entityType: "competitor", detail: "TechHaven: Sony WH-1000XM5 at $307.99 (-12%)" },
    { action: "Alert created", entityType: "alert", detail: "Critical: Adidas Ultraboost 23 price gap detected" },
    { action: "Recommendation generated", entityType: "recommendation", detail: "Samsung Galaxy Watch 6: suggest $359.99 (+9.09%)" },
    { action: "Scrape completed", entityType: "competitor", detail: "FashionForward: 28 products scraped, 19 updated" },
    { action: "Price recommendation implemented", entityType: "recommendation", detail: "Dyson V15 price changed from $749.99 to $779.99" },
    { action: "Alert resolved", entityType: "alert", detail: "Nike Air Max 270 competitor price increase - resolved" },
    { action: "New competitor added", entityType: "competitor", detail: "SportZone (sportzone.com) added for monitoring" },
    { action: "Product tracking enabled", entityType: "product", detail: "Garmin Forerunner 965 added to tracking" },
    { action: "Scrape failed", entityType: "competitor", detail: "QuickBuy: Connection timeout after 30s" },
    { action: "Bulk price sync completed", entityType: "product", detail: "18 products synced from Shopify store" },
    { action: "Recommendation dismissed", entityType: "recommendation", detail: "Bose QC Ultra Earbuds - low confidence match" },
    { action: "Alert created", entityType: "alert", detail: "High: Levi's 501 Jeans overpriced vs FashionForward" },
    { action: "Competitor scrape started", entityType: "competitor", detail: "HomeEssentials: scraping 42 product pages" },
    { action: "Product created", entityType: "product", detail: "Peloton Bike+ added at $2,495.00" },
  ];

  for (const a of activityData) {
    await db.insert(schema.activityLogs).values({
      id: uid(),
      userId,
      action: a.action,
      entityType: a.entityType,
      entityId: pick(productIds),
      detail: a.detail,
      metadata: null,
      createdAt: daysAgo(rnd(0, 14)),
    });
  }
  console.log(`✅ ${activityData.length} Activity Logs`);

  // ── 13. Product Embeddings (sample) ──────────────────────────────────
  for (let i = 0; i < Math.min(5, productIds.length); i++) {
    // Generate a fake 1536-dimension embedding vector (OpenAI text-embedding-3-small)
    const embedding = Array.from({ length: 1536 }, () => rnd(-0.1, 0.1));
    await db.insert(schema.productEmbeddings).values({
      id: uid(),
      productId: productIds[i],
      embedding: embedding as any,
      model: "text-embedding-3-small",
      createdAt: daysAgo(rnd(10, 30)),
    });
  }
  console.log("✅ Product Embeddings");

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉 Seed complete! Summary:");
  console.log("   1 user (demo@priceintelligence.com)");
  console.log("   1 Shopify store");
  console.log(`   ${productIds.length} products (Electronics, Clothing, Home & Garden, Sports)`);
  console.log(`   ${competitorIds.length} competitors`);
  console.log(`   ${matchCount} competitor product matches`);
  console.log(`   ${priceHistoryCount} price history records`);
  console.log(`   ${alertData.length} alerts (critical, high, medium, low)`);
  console.log(`   ${recData.length} recommendations`);
  console.log("   Multiple scrape jobs");
  console.log(`   ${activityData.length} activity log entries`);
  console.log("   5 product embeddings");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await pool.end();
}

seed().catch((e) => {
  console.error("❌ Seed failed:", e);
  pool.end();
  process.exit(1);
});
