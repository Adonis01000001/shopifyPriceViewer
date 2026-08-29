const publicRelease = process.argv.includes("--public");
const failures = [];
const warnings = [];

function pass(name, detail) {
  console.log(`PASS ${name}: ${detail}`);
}

function fail(name, detail) {
  failures.push({ name, detail });
  console.error(`FAIL ${name}: ${detail}`);
}

function warn(name, detail) {
  warnings.push({ name, detail });
  console.warn(`WARN ${name}: ${detail}`);
}

function required(name) {
  if (process.env[name]) {
    pass(name, "configured");
    return true;
  }
  fail(name, "missing from the deployment environment");
  return false;
}

function requireHttps(name) {
  const value = process.env[name];
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error("not HTTPS");
    pass(name, "valid HTTPS URL");
    return true;
  } catch {
    fail(name, "must be a valid HTTPS URL");
    return false;
  }
}

console.log(
  `Version 1.0 release preflight (${publicRelease ? "public" : "production"})`
);

const nodeMajor = Number.parseInt(
  process.versions.node.split(".")[0] ?? "0",
  10
);
if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
  fail("node", `Node 22 or newer is required; found ${process.versions.node}`);
} else {
  pass("node", process.versions.node);
}

if (process.env.NODE_ENV !== "production") {
  fail("NODE_ENV", "must be set to production for a release deployment");
} else {
  pass("NODE_ENV", "production");
}

for (const name of [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "ENCRYPTION_KEY_SALT",
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "APP_URL",
  "ALLOWED_ORIGINS",
]) {
  required(name);
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  fail("JWT_SECRET", "must contain at least 32 characters");
}
if (
  process.env.ENCRYPTION_KEY_SALT &&
  !/^[a-f0-9]{32,}$/i.test(process.env.ENCRYPTION_KEY_SALT)
) {
  fail("ENCRYPTION_KEY_SALT", "must be hexadecimal and at least 32 characters");
}

requireHttps("SHOPIFY_APP_URL");
requireHttps("APP_URL");

const origins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);
if (origins.length === 0 || origins.includes("*")) {
  fail(
    "ALLOWED_ORIGINS",
    "must contain explicit HTTPS origins; wildcard is forbidden"
  );
} else {
  for (const origin of origins) {
    try {
      if (new URL(origin).protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      fail("ALLOWED_ORIGINS", `${origin} is not a valid HTTPS origin`);
    }
  }
  if (!failures.some(check => check.name === "ALLOWED_ORIGINS")) {
    pass("ALLOWED_ORIGINS", `${origins.length} explicit origin(s)`);
  }
}

if (process.env.VITE_BYPASS_AUTH === "true") {
  fail("VITE_BYPASS_AUTH", "must not be enabled in a release deployment");
}

const scopes = (process.env.SHOPIFY_SCOPES ?? "read_products")
  .split(",")
  .map(scope => scope.trim())
  .filter(Boolean);
const disallowedScopes = scopes.filter(scope =>
  ["read_orders", "write_orders", "write_products"].includes(scope)
);
if (!scopes.includes("read_products")) {
  fail(
    "SHOPIFY_SCOPES",
    "read_products is required for product synchronization"
  );
} else if (disallowedScopes.length > 0) {
  fail(
    "SHOPIFY_SCOPES",
    `unnecessary elevated scopes present: ${disallowedScopes.join(", ")}`
  );
} else {
  pass("SHOPIFY_SCOPES", scopes.join(", "));
}

if (process.env.QUEUE_MODE !== "redis") {
  fail("QUEUE_MODE", "must be redis for a multi-process production deployment");
} else {
  pass("QUEUE_MODE", "redis");
}

if (publicRelease) {
  if (process.env.BILLING_REQUIRED !== "true") {
    fail(
      "BILLING_REQUIRED",
      "must be true before enabling public paid traffic"
    );
  } else {
    pass("BILLING_REQUIRED", "true");
  }
  if (process.env.BILLING_PROVIDER !== "shopify") {
    fail(
      "BILLING_PROVIDER",
      "must be shopify for public Shopify App Store distribution"
    );
  } else {
    pass("BILLING_PROVIDER", "shopify");
  }
  if (process.env.SHOPIFY_BILLING_READY !== "true") {
    fail(
      "SHOPIFY_BILLING_READY",
      "must be explicitly confirmed after Shopify App Pricing/Billing API staging tests"
    );
  } else {
    pass("SHOPIFY_BILLING_READY", "confirmed");
  }
} else if (process.env.BILLING_REQUIRED !== "true") {
  warn(
    "BILLING_REQUIRED",
    "disabled; do not use this deployment for paid traffic"
  );
}

if (failures.length > 0) {
  console.error(`Preflight failed with ${failures.length} blocking check(s).`);
  process.exit(1);
}

console.log(`Preflight passed with ${warnings.length} warning(s).`);
