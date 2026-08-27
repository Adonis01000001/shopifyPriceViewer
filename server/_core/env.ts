function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === "production";
const databaseUrl = process.env.DATABASE_URL ?? "";
const encryptionKeySalt = process.env.ENCRYPTION_KEY_SALT ?? "";
const shopifyApiKey = process.env.SHOPIFY_API_KEY ?? "";
const shopifyApiSecret = process.env.SHOPIFY_API_SECRET ?? "";
const shopifyAppUrl = process.env.SHOPIFY_APP_URL ?? "http://localhost:3000";
const appUrl = process.env.APP_URL ?? shopifyAppUrl;
const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
const googleRedirectUri =
  process.env.GOOGLE_REDIRECT_URI ??
  `${appUrl.replace(/\/$/, "")}/api/oauth/google/callback`;
const smtpPort = Number(process.env.SMTP_PORT ?? "587");
const smtpServer = process.env.SMTP_SERVER ?? "";
const smtpUsername = process.env.SMTP_USERNAME ?? "";
const smtpPassword = process.env.SMTP_PASSWORD ?? "";
const smtpFromEmail = process.env.SMTP_FROM_EMAIL ?? "";
const smtpFromName = process.env.SMTP_FROM_NAME ?? "Price Intelligence";
const monitoringIntervalHours = Number(
  process.env.MONITORING_INTERVAL_HOURS ?? "1"
);
const matchConfidenceThreshold = Number(
  process.env.MATCH_CONFIDENCE_THRESHOLD ?? "0.85"
);
const maxConcurrentScrapes = Number(process.env.MAX_CONCURRENT_SCRAPES ?? "5");
const databasePoolMax = Number(process.env.DATABASE_POOL_MAX ?? "10");
const billingRequired = process.env.BILLING_REQUIRED === "true";
const redisUrl = process.env.REDIS_URL ?? "";
const queueMode = process.env.QUEUE_MODE ?? (redisUrl ? "redis" : "inline");
const workerConcurrency = Number(process.env.WORKER_CONCURRENCY ?? "4");
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

if (isProduction) {
  if (!databaseUrl) {
    throw new Error("FATAL: DATABASE_URL must be set in production");
  }
  if (!/^[a-f0-9]{32,}$/i.test(encryptionKeySalt)) {
    throw new Error(
      "FATAL: ENCRYPTION_KEY_SALT must be a hexadecimal value of at least 32 characters in production"
    );
  }
  if (!shopifyApiKey || !shopifyApiSecret) {
    throw new Error(
      "FATAL: SHOPIFY_API_KEY and SHOPIFY_API_SECRET must be set in production"
    );
  }
  if (
    (googleClientId && !googleClientSecret) ||
    (!googleClientId && googleClientSecret)
  ) {
    throw new Error(
      "FATAL: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together"
    );
  }
  if (!redisUrl || queueMode !== "redis") {
    throw new Error(
      "FATAL: REDIS_URL and QUEUE_MODE=redis are required in production"
    );
  }
  if (allowedOrigins.length === 0 || allowedOrigins.includes("*")) {
    throw new Error(
      "FATAL: ALLOWED_ORIGINS must contain one or more explicit HTTPS origins in production"
    );
  }
  for (const origin of allowedOrigins) {
    try {
      if (new URL(origin).protocol !== "https:") {
        throw new Error("origin must use HTTPS");
      }
    } catch {
      throw new Error(
        "FATAL: every ALLOWED_ORIGINS value must be a valid HTTPS origin in production"
      );
    }
  }
  if (
    billingRequired &&
    (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)
  ) {
    throw new Error(
      "FATAL: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set when BILLING_REQUIRED=true"
    );
  }
  if (
    billingRequired &&
    (!process.env.STRIPE_PRICE_STARTER ||
      !process.env.STRIPE_PRICE_PRO ||
      !process.env.STRIPE_PRICE_SCALE)
  ) {
    throw new Error(
      "FATAL: all STRIPE_PRICE_* variables must be set when BILLING_REQUIRED=true"
    );
  }
  try {
    if (new URL(shopifyAppUrl).protocol !== "https:") {
      throw new Error("SHOPIFY_APP_URL must use HTTPS in production");
    }
  } catch {
    throw new Error(
      "FATAL: SHOPIFY_APP_URL must be a valid HTTPS URL in production"
    );
  }
  try {
    if (new URL(appUrl).protocol !== "https:") {
      throw new Error("APP_URL must use HTTPS in production");
    }
  } catch {
    throw new Error("FATAL: APP_URL must be a valid HTTPS URL in production");
  }
  if (googleClientId) {
    try {
      if (new URL(googleRedirectUri).protocol !== "https:") {
        throw new Error("GOOGLE_REDIRECT_URI must use HTTPS in production");
      }
    } catch {
      throw new Error(
        "FATAL: GOOGLE_REDIRECT_URI must be a valid HTTPS URL in production"
      );
    }
  }
}

if (!Number.isFinite(monitoringIntervalHours) || monitoringIntervalHours <= 0) {
  throw new Error("MONITORING_INTERVAL_HOURS must be a positive number");
}
if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
  throw new Error("SMTP_PORT must be an integer between 1 and 65535");
}
if (
  !Number.isFinite(matchConfidenceThreshold) ||
  matchConfidenceThreshold < 0 ||
  matchConfidenceThreshold > 1
) {
  throw new Error("MATCH_CONFIDENCE_THRESHOLD must be between 0 and 1");
}
if (
  !Number.isInteger(maxConcurrentScrapes) ||
  maxConcurrentScrapes < 1 ||
  maxConcurrentScrapes > 100
) {
  throw new Error(
    "MAX_CONCURRENT_SCRAPES must be an integer between 1 and 100"
  );
}
if (
  !Number.isInteger(databasePoolMax) ||
  databasePoolMax < 1 ||
  databasePoolMax > 100
) {
  throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 100");
}

export const ENV = {
  // JWT Authentication — MUST be set in production; throws if missing.
  jwtSecret: (() => {
    const s = process.env.JWT_SECRET ?? "change-me-in-production";
    if (isProduction && s === "change-me-in-production") {
      throw new Error(
        "FATAL: JWT_SECRET must be set to a secure value in production"
      );
    }
    if (queueMode !== "inline" && queueMode !== "redis") {
      throw new Error("QUEUE_MODE must be either inline or redis");
    }
    if (
      !Number.isInteger(workerConcurrency) ||
      workerConcurrency < 1 ||
      workerConcurrency > 50
    ) {
      throw new Error("WORKER_CONCURRENCY must be an integer between 1 and 50");
    }
    if (isProduction && s.length < 32) {
      throw new Error(
        "FATAL: JWT_SECRET must be at least 32 characters in production"
      );
    }
    return s;
  })(),

  // Database
  databaseUrl,

  // Shopify App
  shopifyApiKey,
  shopifyApiSecret,
  shopifyAppUrl,
  appUrl,
  googleClientId,
  googleClientSecret,
  googleRedirectUri,
  shopifyScopes: process.env.SHOPIFY_SCOPES ?? "read_products",
  allowedOrigins,

  // Platform SMTP is used for account recovery emails. User-configured SMTP
  // remains separate and is used for merchant report delivery.
  smtpServer,
  smtpPort,
  smtpUsername,
  smtpPassword,
  smtpFromEmail,
  smtpFromName,

  // Application
  isProduction,
  bypassAuth: process.env.VITE_BYPASS_AUTH === "true",

  // Firecrawl — web scraping API (primary scraper, falls back to Playwright)
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY ?? "",
  firecrawlBaseUrl:
    process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev",

  // Encryption key salt for PBKDF2 — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  encryptionKeySalt,

  // SerpAPI — competitor discovery search
  serpApiKey: process.env.SERP_API_KEY ?? "",

  // Serper - cheaper Google search provider. Preferred over SerpApi when set.
  serperApiKey: process.env.SERPER_API_KEY ?? "",

  // Ordered fallback list of models. Free models share an upstream pool and
  // 429 frequently, so the pipeline rotates through these.
  openrouterModels: (process.env.OPENROUTER_MODELS ?? "")
    .split(",")
    .map(m => m.trim())
    .filter(Boolean),

  // OpenAI — AI validation + extraction
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",

  // OpenRouter — alternative LLM provider (OpenAI-compatible, free models available)
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openrouterBaseUrl:
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  openrouterModel:
    process.env.OPENROUTER_MODEL ?? "mistralai/mistral-7b-instruct:free",

  // Price Monitoring
  monitoringIntervalHours,
  matchConfidenceThreshold,
  maxConcurrentScrapes,
  databasePoolMax,
  redisUrl,
  queueMode,
  workerConcurrency,

  // Stripe Billing. Price IDs are configuration, never application constants.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePriceIds: {
    starter: process.env.STRIPE_PRICE_STARTER ?? "",
    pro: process.env.STRIPE_PRICE_PRO ?? "",
    scale: process.env.STRIPE_PRICE_SCALE ?? "",
  },
  billingRequired,
};

export const ENCRYPTION_KEY_SALT = ENV.encryptionKeySalt;
