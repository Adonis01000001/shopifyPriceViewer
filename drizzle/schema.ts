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
export const subscriptionPlanEnum = pgEnum("subscription_plan", [
  "free",
  "starter",
  "pro",
  "scale",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
]);
export const billingEventStatusEnum = pgEnum("billing_event_status", [
  "processing",
  "processed",
  "failed",
]);
export const reportTypeEnum = pgEnum("report_type", [
  "daily_summary",
  "weekly_competitors",
  "pricing_opportunities",
]);
export const reportStatusEnum = pgEnum("report_status", [
  "queued",
  "sending",
  "sent",
  "failed",
]);
export const deliveryChannelEnum = pgEnum("delivery_channel", [
  "email",
  "in_app",
]);
export const deliveryStatusEnum = pgEnum("delivery_status", [
  "queued",
  "sending",
  "sent",
  "failed",
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
    // The two rules every suggested price is built from: aim this far under
    // the competitor average, but never below cost plus this margin. Stored
    // as percentages because that is how they are set and explained.
    undercutPercent: decimal("undercut_percent", { precision: 5, scale: 2 })
      .default("5.00")
      .notNull(),
    minMarginPercent: decimal("min_margin_percent", { precision: 5, scale: 2 })
      .default("10.00")
      .notNull(),
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

// Password recovery tokens are stored as SHA-256 hashes only. The raw token
// is sent to the account email and is never persisted in the database.
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    tokenHashIdx: uniqueIndex("password_reset_tokens_token_hash_idx").on(
      t.tokenHash
    ),
    userIdIdx: index("password_reset_tokens_user_id_idx").on(t.userId),
    expiresAtIdx: index("password_reset_tokens_expires_at_idx").on(t.expiresAt),
  })
);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// Billing-provider-neutral subscription state. Provider identifiers are kept
// server-side and are intentionally excluded from account DTOs.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: subscriptionPlanEnum("plan").default("free").notNull(),
    status: subscriptionStatusEnum("status").default("trialing").notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodEndsAt: timestamp("current_period_ends_at", {
      withTimezone: true,
    }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    provider: varchar("provider", { length: 32 }),
    providerCustomerId: varchar("provider_customer_id", { length: 255 }),
    providerSubscriptionId: varchar("provider_subscription_id", {
      length: 255,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userIdIdx: uniqueIndex("subscriptions_user_id_idx").on(t.userId),
    providerCustomerIdx: index("subscriptions_provider_customer_idx").on(
      t.providerCustomerId
    ),
    providerSubscriptionIdx: index(
      "subscriptions_provider_subscription_idx"
    ).on(t.providerSubscriptionId),
  })
);

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// Durable Stripe event ledger. Stripe retries delivery, so this table is the
// source of truth for idempotency and operational replay decisions.
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stripeEventId: varchar("stripe_event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    status: billingEventStatusEnum("status").default("processing").notNull(),
    livemode: boolean("livemode").default(false).notNull(),
    payload: jsonb("payload"),
    errorMessage: text("error_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    stripeEventIdx: uniqueIndex("billing_events_stripe_event_id_idx").on(
      t.stripeEventId
    ),
    statusIdx: index("billing_events_status_idx").on(t.status),
    createdAtIdx: index("billing_events_created_at_idx").on(t.createdAt),
  })
);

export type BillingEvent = typeof billingEvents.$inferSelect;
export type InsertBillingEvent = typeof billingEvents.$inferInsert;

// The unique user key makes replacement atomic and prevents duplicate result
// rows when a user runs the analysis from multiple sessions.

export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportType: reportTypeEnum("report_type").notNull(),
    status: reportStatusEnum("status").default("queued").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    summary: jsonb("summary"),
    errorMessage: text("error_message"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userCreatedIdx: index("report_runs_user_created_idx").on(
      t.userId,
      t.createdAt
    ),
    userTypePeriodIdx: index("report_runs_user_type_period_idx").on(
      t.userId,
      t.reportType,
      t.periodStart
    ),
    statusIdx: index("report_runs_status_idx").on(t.status),
  })
);

export type ReportRun = typeof reportRuns.$inferSelect;
export type InsertReportRun = typeof reportRuns.$inferInsert;

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportRunId: uuid("report_run_id").references(() => reportRuns.id, {
      onDelete: "set null",
    }),
    channel: deliveryChannelEnum("channel").notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    status: deliveryStatusEnum("status").default("queued").notNull(),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    reportChannelIdx: uniqueIndex(
      "notification_deliveries_report_channel_idx"
    ).on(t.reportRunId, t.channel),
    userCreatedIdx: index("notification_deliveries_user_created_idx").on(
      t.userId,
      t.createdAt
    ),
    statusIdx: index("notification_deliveries_status_idx").on(t.status),
  })
);

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type InsertNotificationDelivery =
  typeof notificationDeliveries.$inferInsert;

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
// Canonical shops and account-specific connections
// =============================================================================

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalDomain: varchar("canonical_domain", { length: 255 }).notNull(),
    normalizedDomain: varchar("normalized_domain", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 64 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    normalizedDomainIdx: uniqueIndex("shops_normalized_domain_idx").on(
      t.normalizedDomain
    ),
    canonicalDomainIdx: index("shops_canonical_domain_idx").on(
      t.canonicalDomain
    ),
  })
);

export type Shop = typeof shops.$inferSelect;
export type InsertShop = typeof shops.$inferInsert;

export const accountShopConnections = pgTable(
  "account_shop_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    connectionStatus: varchar("connection_status", { length: 32 })
      .default("active")
      .notNull(),
    // AES-256-CBC encrypted Shopify access token. Decrypt only server-side.
    accessToken: text("access_token"),
    scopes: text("scopes").default("read_products").notNull(),
    connectionSettings: jsonb("connection_settings"),
    syncSettings: jsonb("sync_settings"),
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
    userActiveIdx: index("account_shop_connections_user_active_idx").on(
      t.userId,
      t.isActive
    ),
    shopActiveIdx: index("account_shop_connections_shop_active_idx").on(
      t.shopId,
      t.isActive
    ),
    userShopIdx: uniqueIndex("account_shop_connections_user_shop_idx").on(
      t.userId,
      t.shopId
    ),
  })
);

export type AccountShopConnection = typeof accountShopConnections.$inferSelect;
export type InsertAccountShopConnection =
  typeof accountShopConnections.$inferInsert;

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
    storeId: uuid("store_id").references(() => accountShopConnections.id, {
      onDelete: "set null",
    }),
    shopifyProductId: varchar("shopify_product_id", { length: 64 }),
    shopifyVariantId: varchar("shopify_variant_id", { length: 64 }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    sku: varchar("sku", { length: 128 }),
    barcode: varchar("barcode", { length: 128 }),
    gtin: varchar("gtin", { length: 128 }),
    mpn: varchar("mpn", { length: 128 }),
    modelNumber: varchar("model_number", { length: 128 }),
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
    userActiveUpdatedIdx: index("products_user_active_updated_idx").on(
      t.userId,
      t.isActive,
      t.updatedAt
    ),
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
    storeShopifyProductUniqueIdx: uniqueIndex(
      "products_store_shopify_product_unique_idx"
    ).on(t.storeId, t.shopifyProductId),
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
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 255 }),
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
    shopIdIdx: uniqueIndex("competitors_shop_id_idx").on(t.shopId),
    domainIdx: index("competitors_domain_idx").on(t.domain),
    statusIdx: index("competitors_status_idx").on(t.status),
  })
);

export type Competitor = typeof competitors.$inferSelect;
export type InsertCompetitor = typeof competitors.$inferInsert;

export const accountCompetitorConnections = pgTable(
  "account_competitor_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    competitorId: uuid("competitor_id")
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    connectionSettings: jsonb("connection_settings"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userCompetitorIdx: uniqueIndex(
      "account_competitor_connections_user_competitor_idx"
    ).on(t.userId, t.competitorId),
    userActiveIdx: index("account_competitor_connections_user_active_idx").on(
      t.userId,
      t.isActive
    ),
    competitorIdx: index("account_competitor_connections_competitor_idx").on(
      t.competitorId
    ),
  })
);

export type AccountCompetitorConnection =
  typeof accountCompetitorConnections.$inferSelect;
export type InsertAccountCompetitorConnection =
  typeof accountCompetitorConnections.$inferInsert;

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
    basePrice: decimal("base_price", { precision: 10, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("USD"),
    normalizedPrice: decimal("normalized_price", { precision: 12, scale: 4 }),
    normalizedCurrency: varchar("normalized_currency", { length: 3 }),
    normalizationMethod: varchar("normalization_method", { length: 64 }),
    imageUrl: text("image_url"),
    availability: varchar("availability", { length: 32 }),
    salePrice: decimal("sale_price", { precision: 10, scale: 2 }),
    originalPrice: decimal("original_price", { precision: 10, scale: 2 }),
    couponAmount: decimal("coupon_amount", { precision: 10, scale: 2 }),
    couponCode: varchar("coupon_code", { length: 64 }),
    membershipPrice: decimal("membership_price", { precision: 10, scale: 2 }),
    priceType: varchar("price_type", { length: 32 }),
    shippingPrice: decimal("shipping_price", { precision: 10, scale: 2 }),
    taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }),
    discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }),
    condition: varchar("condition", { length: 32 }),
    quantity: decimal("quantity", { precision: 10, scale: 3 }),
    unit: varchar("unit", { length: 32 }),
    variant: varchar("variant", { length: 255 }),
    metadata: jsonb("metadata"),
    matchType: varchar("match_type", { length: 16 }),
    matchScore: doublePrecision("match_score").default(0).notNull(),
    matchMethod: varchar("match_method", { length: 64 }).default("manual"),
    sourceType: varchar("source_type", { length: 32 }),
    sourceProductId: uuid("source_product_id"),
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
    productActiveIdx: index("competitor_products_product_active_idx").on(
      t.productId,
      t.isActive
    ),
    competitorActiveIdx: index("competitor_products_competitor_active_idx").on(
      t.competitorId,
      t.isActive
    ),
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

// The source product remains in its source catalog so future price updates
// stay available without recreating a deleted match in the UI.

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
    userReadCreatedIdx: index("alerts_user_read_created_idx").on(
      t.userId,
      t.isRead,
      t.createdAt
    ),
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
    userCreatedIdx: index("recommendations_user_created_idx").on(
      t.userId,
      t.createdAt
    ),
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
    competitorCreatedIdx: index("scrape_jobs_competitor_created_idx").on(
      t.competitorId,
      t.createdAt
    ),
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
    basePrice: decimal("base_price", { precision: 10, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("USD"),
    salePrice: decimal("sale_price", { precision: 10, scale: 2 }),
    originalPrice: decimal("original_price", { precision: 10, scale: 2 }),
    couponAmount: decimal("coupon_amount", { precision: 10, scale: 2 }),
    couponCode: varchar("coupon_code", { length: 64 }),
    membershipPrice: decimal("membership_price", { precision: 10, scale: 2 }),
    priceType: varchar("price_type", { length: 32 }),
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
// Extraction Learning (sanitized failures + human-reviewed proposals)
// =============================================================================

export const extractionFailures = pgTable(
  "extraction_failures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    failureKey: varchar("failure_key", { length: 64 }).notNull(),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    competitorId: uuid("competitor_id").references(() => competitors.id, {
      onDelete: "set null",
    }),
    domain: varchar("domain", { length: 255 }).notNull(),
    sourceUrl: text("source_url"),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    extractorVersion: varchar("extractor_version", { length: 32 }).notNull(),
    resolutionState: varchar("resolution_state", { length: 16 }).notNull(),
    failureReasons: jsonb("failure_reasons").notNull(),
    platform: varchar("platform", { length: 32 }).notNull(),
    markerFingerprint: varchar("marker_fingerprint", { length: 64 }).notNull(),
    markers: jsonb("markers").notNull(),
    productEvidence: jsonb("product_evidence").notNull(),
    variantEvidence: jsonb("variant_evidence").notNull(),
    priceEvidence: jsonb("price_evidence").notNull(),
    candidateCount: integer("candidate_count").default(0).notNull(),
    confidence: doublePrecision("confidence"),
    scoreBreakdown: jsonb("score_breakdown").notNull(),
    reducedContent: text("reduced_content"),
    deterministicDecision: jsonb("deterministic_decision").notNull(),
    aiDecision: jsonb("ai_decision"),
    expectedResult: jsonb("expected_result"),
    occurrenceCount: integer("occurrence_count").default(1).notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    failureKeyIdx: uniqueIndex("extraction_failures_key_idx").on(t.failureKey),
    statusObservedIdx: index("extraction_failures_status_observed_idx").on(
      t.status,
      t.lastObservedAt
    ),
    clusterIdx: index("extraction_failures_cluster_idx").on(
      t.domain,
      t.platform,
      t.extractorVersion
    ),
    productIdx: index("extraction_failures_product_idx").on(t.productId),
    competitorIdx: index("extraction_failures_competitor_idx").on(
      t.competitorId
    ),
  })
);

export type ExtractionFailure = typeof extractionFailures.$inferSelect;
export type InsertExtractionFailure = typeof extractionFailures.$inferInsert;

export const extractorImprovementProposals = pgTable(
  "extractor_improvement_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposalKey: varchar("proposal_key", { length: 64 }).notNull(),
    clusterKey: varchar("cluster_key", { length: 64 }).notNull(),
    extractorVersion: varchar("extractor_version", { length: 32 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull(),
    failureReason: varchar("failure_reason", { length: 64 }).notNull(),
    affectedFailureCount: integer("affected_failure_count").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    proposal: jsonb("proposal").notNull(),
    evaluation: jsonb("evaluation"),
    report: text("report"),
    status: varchar("status", { length: 32 })
      .default("pending_review")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    proposalKeyIdx: uniqueIndex("extractor_proposals_key_idx").on(
      t.proposalKey
    ),
    statusIdx: index("extractor_proposals_status_idx").on(t.status),
    clusterIdx: index("extractor_proposals_cluster_idx").on(
      t.clusterKey,
      t.extractorVersion
    ),
  })
);

export type ExtractorImprovementProposal =
  typeof extractorImprovementProposals.$inferSelect;
export type InsertExtractorImprovementProposal =
  typeof extractorImprovementProposals.$inferInsert;

// =============================================================================
// Competitor Discoveries (search results from automated discovery)
// =============================================================================

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

// Cross-worker lease preventing overlapping discovery runs for one product.

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

// =============================================================================
// =============================================================================

// =============================================================================
// =============================================================================

/**
 * First-party product analytics. Keep this table intentionally small and
 * property-based: event names are allow-listed at the API boundary and
 * properties must never contain credentials, catalog contents, or free-form
 * personal data.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventName: varchar("event_name", { length: 64 }).notNull(),
    sessionId: varchar("session_id", { length: 128 }),
    properties: jsonb("properties")
      .$type<Record<string, string | number | boolean | null>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    userEventCreatedIdx: index("analytics_events_user_event_created_idx").on(
      t.userId,
      t.eventName,
      t.createdAt
    ),
    createdAtIdx: index("analytics_events_created_at_idx").on(t.createdAt),
  })
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
