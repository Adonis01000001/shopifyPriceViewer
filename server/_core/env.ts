function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const ENV = {
  // JWT Authentication — MUST be set in production; throws if missing.
  jwtSecret: (() => {
    const s = process.env.JWT_SECRET ?? "change-me-in-production";
    if (process.env.NODE_ENV === "production" && s === "change-me-in-production") {
      throw new Error("FATAL: JWT_SECRET must be set to a secure value in production");
    }
    if (process.env.NODE_ENV === "production" && s.length < 32) {
      throw new Error("FATAL: JWT_SECRET must be at least 32 characters in production");
    }
    return s;
  })(),

  // Database
  databaseUrl: process.env.DATABASE_URL ?? "",

  // Shopify App
  shopifyApiKey: process.env.SHOPIFY_API_KEY ?? "",
  shopifyApiSecret: process.env.SHOPIFY_API_SECRET ?? "",
  shopifyAppUrl: process.env.SHOPIFY_APP_URL ?? "http://localhost:3000",
  shopifyScopes: process.env.SHOPIFY_SCOPES ?? "read_products,read_orders,write_products",

  // Application
  isProduction: process.env.NODE_ENV === "production",

  // Legacy — TODO: remove after full migration off OAuth portal
  appId: process.env.VITE_APP_ID ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  bypassAuth: process.env.VITE_BYPASS_AUTH === "true",

  // Firecrawl — web scraping API (primary scraper, falls back to Playwright)
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY ?? "",
  firecrawlBaseUrl: process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev",

  // Encryption key salt for PBKDF2 — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  encryptionKeySalt: process.env.ENCRYPTION_KEY_SALT ?? "",

  // SerpAPI — competitor discovery search
  serpApiKey: process.env.SERP_API_KEY ?? "",

  // Exa — neural web search for product pricing
  exaApiKey: process.env.EXA_API_KEY ?? "",

  // OpenAI — AI validation + extraction
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",

  // Price Monitoring
  monitoringIntervalHours: parseInt(process.env.MONITORING_INTERVAL_HOURS ?? "1", 10),
  matchConfidenceThreshold: parseFloat(process.env.MATCH_CONFIDENCE_THRESHOLD ?? "0.85"),
  maxConcurrentScrapes: parseInt(process.env.MAX_CONCURRENT_SCRAPES ?? "5", 10),
};

export const ENCRYPTION_KEY_SALT = ENV.encryptionKeySalt;
