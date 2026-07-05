import {
  boolean,
  decimal,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// =============================================================================
// Enums
// =============================================================================

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const alertTypeEnum = pgEnum("alert_type", [
  "price_drop",
  "price_increase",
  "competitor_change",
  "threshold",
]);
export const alertSeverityEnum = pgEnum("alert_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);
export const competitorStatusEnum = pgEnum("competitor_status", [
  "active",
  "inactive",
  "error",
]);
export const productStatusEnum = pgEnum("product_status", [
  "optimal",
  "underpriced",
  "overpriced",
  "alert",
]);
export const recommendationStatusEnum = pgEnum("recommendation_status", [
  "pending",
  "implemented",
  "dismissed",
]);
export const scrapeStatusEnum = pgEnum("scrape_status", [
  "pending",
  "running",
  "success",
  "failed",
]);
export const notificationFrequencyEnum = pgEnum("notification_frequency", [
  "realtime",
  "hourly",
  "daily",
  "weekly",
]);

// =============================================================================
// Users
// =============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    openId: varchar("open_id", { length: 64 }).unique(),
    email: varchar("email", { length: 320 }),
    // Password hash for direct SaaS authentication (bcrypt).
    // Null for users who only authenticate via OAuth portal.
    passwordHash: varchar("password_hash", { length: 255 }),
    name: text("name"),
    loginMethod: varchar("login_method", { length: 64 }),
    role: userRoleEnum("role").default("user").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSignedIn: timestamp("last_signed_in", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    openIdIdx: uniqueIndex("users_open_id_idx").on(t.openId),
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// =============================================================================
// Email Configuration
// =============================================================================

export const emailConfigs = pgTable(
  "email_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    smtpServer: varchar("smtp_server", { length: 255 }).notNull(),
    smtpPort: integer("smtp_port").notNull().default(587),
    smtpUsername: varchar("smtp_username", { length: 255 }).notNull(),
    // AES-256-CBC encrypted. Use encryptToken() before storing, decryptToken() after reading. Never store plaintext.
    smtpPassword: text("smtp_password").notNull(),
    fromEmail: varchar("from_email", { length: 255 }).notNull(),
    fromName: varchar("from_name", { length: 255 }).notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: uniqueIndex("email_configs_user_id_idx").on(t.userId),
  })
);

export type EmailConfig = typeof emailConfigs.$inferSelect;
export type InsertEmailConfig = typeof emailConfigs.$inferInsert;

// =============================================================================
// Notification Preferences
// =============================================================================

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emailNotifications: boolean("email_notifications").default(true).notNull(),
    inAppNotifications: boolean("in_app_notifications").default(true).notNull(),
    frequency: notificationFrequencyEnum("frequency")
      .default("daily")
      .notNull(),
    priceDropThreshold: decimal("price_drop_threshold", {
      precision: 5,
      scale: 2,
    }).default("5.00"),
    priceIncreaseThreshold: decimal("price_increase_threshold", {
      precision: 5,
      scale: 2,
    }).default("5.00"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: uniqueIndex("notification_prefs_user_id_idx").on(t.userId),
  })
);

export type NotificationPreference =
  typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference =
  typeof notificationPreferences.$inferInsert;

// =============================================================================
// Shopify Stores
// =============================================================================

export const shopifyStores = pgTable(
  "shopify_stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shopDomain: varchar("shop_domain", { length: 255 }).notNull(),
    // AES-256-CBC encrypted Shopify access token. Decrypt via sdk.decryptToken().
    accessToken: text("access_token"),
    scopes: text("scopes").notNull(),
    storeName: varchar("store_name", { length: 255 }),
    storeEmail: varchar("store_email", { length: 320 }),
    currency: varchar("currency", { length: 3 }).default("USD"),
    timezone: varchar("timezone", { length: 64 }),
    isActive: boolean("is_active").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: index("shopify_stores_user_id_idx").on(t.userId),
    shopDomainIdx: uniqueIndex("shopify_stores_shop_domain_idx").on(
      t.shopDomain
    ),
  })
);

export type ShopifyStore = typeof shopifyStores.$inferSelect;
export type InsertShopifyStore = typeof shopifyStores.$inferInsert;

// =============================================================================
// Products
// =============================================================================

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => shopifyStores.id, {
      onDelete: "set null",
    }),
    shopifyProductId: varchar("shopify_product_id", { length: 64 }),
    shopifyVariantId: varchar("shopify_variant_id", { length: 64 }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    sku: varchar("sku", { length: 128 }),
    barcode: varchar("barcode", { length: 128 }),
    vendor: varchar("vendor", { length: 255 }),
    productType: varchar("product_type", { length: 255 }),
    category: varchar("category", { length: 255 }),
    tags: text("tags"),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    compareAtPrice: decimal("compare_at_price", { precision: 10, scale: 2 }),
    costPrice: decimal("cost_price", { precision: 10, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("USD"),
    imageUrl: text("image_url"),
    status: productStatusEnum("status").default("optimal").notNull(),
    isTracked: boolean("is_tracked").default(true).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: index("products_user_id_idx").on(t.userId),
    storeIdIdx: index("products_store_id_idx").on(t.storeId),
    skuIdx: index("products_sku_idx").on(t.sku),
    userSkuUniqueIdx: uniqueIndex("products_user_sku_unique_idx").on(
      t.userId,
      t.sku
    ),
    categoryIdx: index("products_category_idx").on(t.category),
    statusIdx: index("products_status_idx").on(t.status),
    shopifyProductIdIdx: index("products_shopify_product_id_idx").on(
      t.shopifyProductId
    ),
  })
);

export type Product = typeof products.$inferSelect;
export type InsertProduct = typeof products.$inferInsert;

// =============================================================================
// Product Embeddings (for AI matching)
// =============================================================================

export const productEmbeddings = pgTable(
  "product_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    embedding: jsonb("embedding").notNull(), // Store vector as JSON array
    model: varchar("model", { length: 128 }).default("text-embedding-3-small"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    productIdIdx: uniqueIndex("product_embeddings_product_id_idx").on(
      t.productId
    ),
  })
);

export type ProductEmbedding = typeof productEmbeddings.$inferSelect;
export type InsertProductEmbedding = typeof productEmbeddings.$inferInsert;

// =============================================================================
// Competitors
// =============================================================================

export const competitors = pgTable(
  "competitors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    domain: varchar("domain", { length: 255 }).notNull(),
    logoUrl: text("logo_url"),
    description: text("description"),
    status: competitorStatusEnum("status").default("active").notNull(),
    productsTracked: integer("products_tracked").default(0).notNull(),
    avgPriceDiff: decimal("avg_price_diff", { precision: 5, scale: 2 }).default(
      "0.00"
    ),
    priceIndex: decimal("price_index", { precision: 5, scale: 2 }).default(
      "100.00"
    ),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    scrapeStatus: scrapeStatusEnum("scrape_status").default("pending"),
    scrapeError: text("scrape_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: index("competitors_user_id_idx").on(t.userId),
    domainIdx: index("competitors_domain_idx").on(t.domain),
    statusIdx: index("competitors_status_idx").on(t.status),
  })
);

export type Competitor = typeof competitors.$inferSelect;
export type InsertCompetitor = typeof competitors.$inferInsert;

// =============================================================================
// Competitor Products (matched products)
// =============================================================================

export const competitorProducts = pgTable(
  "competitor_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competitorProductUrl: text("competitor_product_url"),
    competitorProductTitle: varchar("competitor_product_title", {
      length: 500,
    }),
    competitorSku: varchar("competitor_sku", { length: 128 }),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("USD"),
    matchScore: doublePrecision("match_score").default(0).notNull(),
    matchMethod: varchar("match_method", { length: 64 }).default("manual"),
    isVerified: boolean("is_verified").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    previousPrice: decimal("previous_price", { precision: 10, scale: 2 }),
    lastPriceUpdate: timestamp("last_price_update", { withTimezone: true }),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    competitorIdIdx: index("competitor_products_competitor_id_idx").on(
      t.competitorId
    ),
    productIdIdx: index("competitor_products_product_id_idx").on(t.productId),
    matchScoreIdx: index("competitor_products_match_score_idx").on(
      t.matchScore
    ),
    uniqueMatchIdx: uniqueIndex("competitor_products_unique_idx").on(
      t.competitorId,
      t.productId
    ),
  })
);

export type CompetitorProduct = typeof competitorProducts.$inferSelect;
export type InsertCompetitorProduct = typeof competitorProducts.$inferInsert;

// =============================================================================
// Price History
// =============================================================================

export const priceHistory = pgTable(
  "price_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competitorProductId: uuid("competitor_product_id").references(
      () => competitorProducts.id,
      { onDelete: "set null" }
    ),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("USD"),
    source: varchar("source", { length: 64 }).notNull(), // "shopify", "competitor", "manual"
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    productIdIdx: index("price_history_product_id_idx").on(t.productId),
    competitorProductIdIdx: index("price_history_competitor_product_id_idx").on(
      t.competitorProductId
    ),
    recordedAtIdx: index("price_history_recorded_at_idx").on(t.recordedAt),
    productRecordedIdx: index("price_history_product_recorded_idx").on(
      t.productId,
      t.recordedAt
    ),
  })
);

export type PriceHistory = typeof priceHistory.$inferSelect;
export type InsertPriceHistory = typeof priceHistory.$inferInsert;

// =============================================================================
// Alerts
// =============================================================================

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competitorProductId: uuid("competitor_product_id").references(
      () => competitorProducts.id,
      { onDelete: "set null" }
    ),
    alertType: alertTypeEnum("alert_type").notNull(),
    severity: alertSeverityEnum("severity").default("medium").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    triggerPrice: decimal("trigger_price", { precision: 10, scale: 2 }),
    triggerCondition: varchar("trigger_condition", { length: 32 }), // "below", "above", "equals"
    isRead: boolean("is_read").default(false).notNull(),
    isResolved: boolean("is_resolved").default(false).notNull(),
    isNotified: boolean("is_notified").default(false).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: index("alerts_user_id_idx").on(t.userId),
    productIdIdx: index("alerts_product_id_idx").on(t.productId),
    severityIdx: index("alerts_severity_idx").on(t.severity),
    isReadIdx: index("alerts_is_read_idx").on(t.isRead),
    isResolvedIdx: index("alerts_is_resolved_idx").on(t.isResolved),
    createdAtIdx: index("alerts_created_at_idx").on(t.createdAt),
    userUnreadIdx: index("alerts_user_unread_idx").on(t.userId, t.isRead),
  })
);

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// =============================================================================
// Recommendations
// =============================================================================

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    currentPrice: decimal("current_price", {
      precision: 10,
      scale: 2,
    }).notNull(),
    recommendedPrice: decimal("recommended_price", {
      precision: 10,
      scale: 2,
    }).notNull(),
    priceChange: decimal("price_change", { precision: 10, scale: 2 }).notNull(),
    priceChangePercent: decimal("price_change_percent", {
      precision: 5,
      scale: 2,
    }).notNull(),
    confidenceScore: doublePrecision("confidence_score").notNull(), // 0.0 to 1.0
    reason: text("reason").notNull(),
    factors: jsonb("factors"), // JSON object with analysis details
    status: recommendationStatusEnum("status").default("pending").notNull(),
    implementedAt: timestamp("implemented_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    potentialSavings: decimal("potential_savings", { precision: 12, scale: 2 }),
    marginProtectionApplied: boolean("margin_protection_applied")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: index("recommendations_user_id_idx").on(t.userId),
    productIdIdx: index("recommendations_product_id_idx").on(t.productId),
    statusIdx: index("recommendations_status_idx").on(t.status),
    confidenceIdx: index("recommendations_confidence_idx").on(
      t.confidenceScore
    ),
    createdAtIdx: index("recommendations_created_at_idx").on(t.createdAt),
  })
);

export type Recommendation = typeof recommendations.$inferSelect;
export type InsertRecommendation = typeof recommendations.$inferInsert;

// =============================================================================
// Scrape Jobs (for tracking competitor scraping)
// =============================================================================

export const scrapeJobs = pgTable(
  "scrape_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    status: scrapeStatusEnum("status").default("pending").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    productsScraped: integer("products_scraped").default(0),
    productsUpdated: integer("products_updated").default(0),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    competitorIdIdx: index("scrape_jobs_competitor_id_idx").on(t.competitorId),
    statusIdx: index("scrape_jobs_status_idx").on(t.status),
    createdAtIdx: index("scrape_jobs_created_at_idx").on(t.createdAt),
  })
);

export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type InsertScrapeJob = typeof scrapeJobs.$inferInsert;

// =============================================================================
// Refresh Tokens (database-backed, hashed)
// =============================================================================

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(), // SHA-256 hex of the raw token
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  t => ({
    tokenHashIdx: uniqueIndex("refresh_tokens_token_hash_idx").on(t.tokenHash),
    userIdIdx: index("refresh_tokens_user_id_idx").on(t.userId),
    expiresAtIdx: index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  })
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type InsertRefreshToken = typeof refreshTokens.$inferInsert;

// =============================================================================
// Activity Log (for dashboard recent activity)
// =============================================================================

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 128 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }), // "product", "competitor", "alert", etc.
    entityId: uuid("entity_id"),
    detail: text("detail"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: index("activity_logs_user_id_idx").on(t.userId),
    createdAtIdx: index("activity_logs_created_at_idx").on(t.createdAt),
    entityIdx: index("activity_logs_entity_idx").on(t.entityType, t.entityId),
  })
);

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

// =============================================================================
// Price Snapshots (immutable price records for monitoring)
// =============================================================================

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    competitorProductId: uuid("competitor_product_id")
      .notNull()
      .references(() => competitorProducts.id, { onDelete: "cascade" }),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("USD"),
    salePrice: decimal("sale_price", { precision: 10, scale: 2 }),
    originalPrice: decimal("original_price", { precision: 10, scale: 2 }),
    availability: varchar("availability", { length: 32 }).default("in_stock"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    scrapeMethod: varchar("scrape_method", { length: 32 }).default("firecrawl"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    cpIdIdx: index("price_snapshots_cp_id_idx").on(t.competitorProductId),
    scrapedAtIdx: index("price_snapshots_scraped_at_idx").on(t.scrapedAt),
    cpScrapedIdx: index("price_snapshots_cp_scraped_idx").on(
      t.competitorProductId,
      t.scrapedAt
    ),
  })
);

export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type InsertPriceSnapshot = typeof priceSnapshots.$inferInsert;

// =============================================================================
// Price Changes (detected change events)
// =============================================================================

export const priceChanges = pgTable(
  "price_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    competitorProductId: uuid("competitor_product_id")
      .notNull()
      .references(() => competitorProducts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    changeType: varchar("change_type", { length: 32 }).notNull(),
    previousPrice: decimal("previous_price", { precision: 10, scale: 2 }),
    newPrice: decimal("new_price", { precision: 10, scale: 2 }),
    previousAvailability: varchar("previous_availability", { length: 32 }),
    newAvailability: varchar("new_availability", { length: 32 }),
    priceDiff: decimal("price_diff", { precision: 10, scale: 2 }),
    priceDiffPercent: decimal("price_diff_percent", { precision: 5, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("USD"),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    isNotified: boolean("is_notified").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    cpIdIdx: index("price_changes_cp_id_idx").on(t.competitorProductId),
    productIdIdx: index("price_changes_product_id_idx").on(t.productId),
    detectedAtIdx: index("price_changes_detected_at_idx").on(t.detectedAt),
    changeTypeIdx: index("price_changes_change_type_idx").on(t.changeType),
    productDetectedIdx: index("price_changes_product_detected_idx").on(
      t.productId,
      t.detectedAt
    ),
  })
);

export type PriceChange = typeof priceChanges.$inferSelect;
export type InsertPriceChange = typeof priceChanges.$inferInsert;

// =============================================================================
// AI Extractions (raw AI validation + extraction results)
// =============================================================================

export const aiExtractions = pgTable(
  "ai_extractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    isMatch: boolean("is_match").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    matchConfidence: doublePrecision("match_confidence"),
    skuMatchConfidence: doublePrecision("sku_match_confidence"),
    titleSimilarity: doublePrecision("title_similarity"),
    variantSimilarity: doublePrecision("variant_similarity"),
    extractedPrice: decimal("extracted_price", { precision: 10, scale: 2 }),
    extractedCurrency: varchar("extracted_currency", { length: 3 }),
    extractedSalePrice: decimal("extracted_sale_price", {
      precision: 10,
      scale: 2,
    }),
    extractedOriginalPrice: decimal("extracted_original_price", {
      precision: 10,
      scale: 2,
    }),
    extractedTitle: varchar("extracted_title", { length: 500 }),
    extractedDescription: text("extracted_description"),
    extractedFeatures: jsonb("extracted_features"),
    reasoning: text("reasoning"),
    modelUsed: varchar("model_used", { length: 128 }),
    tokensUsed: integer("tokens_used"),
    rawResponse: jsonb("raw_response"),
    extractedAt: timestamp("extracted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    productIdIdx: index("ai_extractions_product_id_idx").on(t.productId),
    competitorIdIdx: index("ai_extractions_competitor_id_idx").on(
      t.competitorId
    ),
    confidenceIdx: index("ai_extractions_confidence_idx").on(t.confidence),
    isMatchIdx: index("ai_extractions_is_match_idx").on(t.isMatch),
    extractedAtIdx: index("ai_extractions_extracted_at_idx").on(t.extractedAt),
    productConfidenceIdx: index("ai_extractions_product_confidence_idx").on(
      t.productId,
      t.confidence
    ),
  })
);

export type AiExtraction = typeof aiExtractions.$inferSelect;
export type InsertAiExtraction = typeof aiExtractions.$inferInsert;

// =============================================================================
// Competitor Discoveries (search results from automated discovery)
// =============================================================================

export const competitorDiscoveries = pgTable(
  "competitor_discoveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    searchQuery: text("search_query").notNull(),
    searchEngine: varchar("search_engine", { length: 32 }).default("google"),
    country: varchar("country", { length: 2 }).default("US"),
    language: varchar("language", { length: 5 }).default("en"),
    candidateUrl: text("candidate_url").notNull(),
    candidateDomain: varchar("candidate_domain", { length: 255 }).notNull(),
    candidateTitle: varchar("candidate_title", { length: 500 }),
    searchPosition: integer("search_position"),
    confidence: doublePrecision("confidence").default(0).notNull(),
    status: varchar("status", { length: 32 }).default("pending"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: index("competitor_discoveries_user_id_idx").on(t.userId),
    productIdIdx: index("competitor_discoveries_product_id_idx").on(
      t.productId
    ),
    statusIdx: index("competitor_discoveries_status_idx").on(t.status),
    domainIdx: index("competitor_discoveries_domain_idx").on(t.candidateDomain),
    confidenceIdx: index("competitor_discoveries_confidence_idx").on(
      t.confidence
    ),
    productStatusIdx: index("competitor_discoveries_product_status_idx").on(
      t.productId,
      t.status
    ),
  })
);

export type CompetitorDiscovery = typeof competitorDiscoveries.$inferSelect;
export type InsertCompetitorDiscovery =
  typeof competitorDiscoveries.$inferInsert;

// =============================================================================
// Cron Runs (monitoring job tracking)
// =============================================================================

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobType: varchar("job_type", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).default("running"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    productsProcessed: integer("products_processed").default(0),
    productsUpdated: integer("products_updated").default(0),
    changesDetected: integer("changes_detected").default(0),
    errorsCount: integer("errors_count").default(0),
    errorDetails: jsonb("error_details"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    jobTypeIdx: index("cron_runs_job_type_idx").on(t.jobType),
    statusIdx: index("cron_runs_status_idx").on(t.status),
    startedAtIdx: index("cron_runs_started_at_idx").on(t.startedAt),
    jobStartedIdx: index("cron_runs_job_started_idx").on(
      t.jobType,
      t.startedAt
    ),
  })
);

export type CronRun = typeof cronRuns.$inferSelect;
export type InsertCronRun = typeof cronRuns.$inferInsert;

// =============================================================================
// Scrape Logs (detailed per-URL scrape attempts)
// =============================================================================

export const scrapeLogs = pgTable(
  "scrape_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    competitorId: uuid("competitor_id").references(() => competitors.id, {
      onDelete: "set null",
    }),
    competitorProductId: uuid("competitor_product_id").references(
      () => competitorProducts.id,
      { onDelete: "set null" }
    ),
    cronRunId: uuid("cron_run_id").references(() => cronRuns.id, {
      onDelete: "set null",
    }),
    url: text("url").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    method: varchar("method", { length: 32 }),
    httpStatus: integer("http_status"),
    responseTimeMs: integer("response_time_ms"),
    errorMessage: text("error_message"),
    htmlSize: integer("html_size"),
    retryCount: integer("retry_count").default(0),
    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    competitorIdIdx: index("scrape_logs_competitor_id_idx").on(t.competitorId),
    cronRunIdIdx: index("scrape_logs_cron_run_id_idx").on(t.cronRunId),
    statusIdx: index("scrape_logs_status_idx").on(t.status),
    scrapedAtIdx: index("scrape_logs_scraped_at_idx").on(t.scrapedAt),
  })
);

export type ScrapeLog = typeof scrapeLogs.$inferSelect;
export type InsertScrapeLog = typeof scrapeLogs.$inferInsert;

// =============================================================================
// SerpAPI Scouts (search results + reviews from SerpAPI batch searches)
// =============================================================================

export const serpApiScouts = pgTable(
  "serp_api_scouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    title: text("title"),
    snippet: text("snippet"),
    url: text("url").notNull(),
    price: text("price"),
    currency: varchar("currency", { length: 10 }).default("USD"),
    source: varchar("source", { length: 64 }),
    position: integer("position"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    productIdIdx: index("serp_api_scouts_product_id_idx").on(t.productId),
    userIdIdx: index("serp_api_scouts_user_id_idx").on(t.userId),
    createdAtIdx: index("serp_api_scouts_created_at_idx").on(t.createdAt),
  })
);

export type SerpApiScout = typeof serpApiScouts.$inferSelect;
export type InsertSerpApiScout = typeof serpApiScouts.$inferInsert;
