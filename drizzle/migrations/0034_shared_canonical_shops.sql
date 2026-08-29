-- Shared canonical shops with account-owned connections.
-- This migration preserves the legacy shopify_stores data while moving
-- credentials and sync state onto account_shop_connections.

CREATE TABLE "shops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "canonical_domain" varchar(255) NOT NULL,
  "normalized_domain" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "platform" varchar(64),
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shops_normalized_domain_idx" ON "shops" USING btree ("normalized_domain");
--> statement-breakpoint
CREATE INDEX "shops_canonical_domain_idx" ON "shops" USING btree ("canonical_domain");
--> statement-breakpoint
CREATE TABLE "account_shop_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "shop_id" uuid NOT NULL,
  "connection_status" varchar(32) DEFAULT 'active' NOT NULL,
  "access_token" text,
  "scopes" text DEFAULT 'read_products' NOT NULL,
  "connection_settings" jsonb,
  "sync_settings" jsonb,
  "store_name" varchar(255),
  "store_email" varchar(320),
  "currency" varchar(3) DEFAULT 'USD',
  "timezone" varchar(64),
  "is_active" boolean DEFAULT true NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_shop_connections_user_shop_idx" ON "account_shop_connections" USING btree ("user_id","shop_id");
--> statement-breakpoint
CREATE INDEX "account_shop_connections_user_active_idx" ON "account_shop_connections" USING btree ("user_id","is_active");
--> statement-breakpoint
CREATE INDEX "account_shop_connections_shop_active_idx" ON "account_shop_connections" USING btree ("shop_id","is_active");
--> statement-breakpoint
ALTER TABLE "account_shop_connections" ADD CONSTRAINT "account_shop_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_shop_connections" ADD CONSTRAINT "account_shop_connections_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "account_competitor_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "competitor_id" uuid NOT NULL,
  "connection_settings" jsonb,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_competitor_connections_user_competitor_idx" ON "account_competitor_connections" USING btree ("user_id","competitor_id");
--> statement-breakpoint
CREATE INDEX "account_competitor_connections_user_active_idx" ON "account_competitor_connections" USING btree ("user_id","is_active");
--> statement-breakpoint
CREATE INDEX "account_competitor_connections_competitor_idx" ON "account_competitor_connections" USING btree ("competitor_id");
--> statement-breakpoint

-- Build one canonical Shop for each legacy normalized domain.
CREATE TEMP TABLE "_legacy_shop_rows" ON COMMIT DROP AS
SELECT
  s.id AS legacy_store_id,
  s.user_id,
  s.shop_domain,
  s.access_token,
  s.scopes,
  s.store_name,
  s.store_email,
  s.currency,
  s.timezone,
  s.is_active,
  s.last_synced_at,
  s.created_at,
  s.updated_at,
  lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(trim(s.shop_domain), '^https?://', '', 'i'),
          '/.*$', ''
        ),
        '^www\\.', ''
      ),
      '\\.$', ''
    )
  ) AS normalized_domain
FROM "shopify_stores" s;
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_shop_keys" ON COMMIT DROP AS
SELECT DISTINCT ON (r.normalized_domain)
  gen_random_uuid() AS shop_id,
  r.normalized_domain,
  r.store_name,
  r.created_at,
  r.updated_at
FROM "_legacy_shop_rows" r
WHERE r.normalized_domain <> ''
ORDER BY r.normalized_domain, r.is_active DESC, r.updated_at DESC NULLS LAST, r.legacy_store_id;
--> statement-breakpoint
INSERT INTO "shops" ("id", "canonical_domain", "normalized_domain", "name", "platform", "created_at", "updated_at")
SELECT
  k.shop_id,
  k.normalized_domain,
  k.normalized_domain,
  COALESCE(NULLIF(k.store_name, ''), k.normalized_domain),
  CASE WHEN k.normalized_domain LIKE '%.myshopify.com' THEN 'shopify' ELSE NULL END,
  COALESCE(k.created_at, now()),
  COALESCE(k.updated_at, now())
FROM "_legacy_shop_keys" k;
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_store_shop_map" ON COMMIT DROP AS
SELECT r.legacy_store_id, r.user_id, k.shop_id
FROM "_legacy_shop_rows" r
JOIN "_legacy_shop_keys" k ON k.normalized_domain = r.normalized_domain;
--> statement-breakpoint

-- Keep one connection per legacy account/shop pair, selecting the most useful
-- legacy row when old data contains duplicate rows for that pair.
CREATE TEMP TABLE "_legacy_connection_keys" ON COMMIT DROP AS
SELECT DISTINCT ON (m.user_id, m.shop_id)
  gen_random_uuid() AS connection_id,
  m.user_id,
  m.shop_id,
  r.access_token,
  r.scopes,
  r.store_name,
  r.store_email,
  r.currency,
  r.timezone,
  r.is_active,
  r.last_synced_at,
  r.created_at,
  r.updated_at
FROM "_legacy_store_shop_map" m
JOIN "_legacy_shop_rows" r ON r.legacy_store_id = m.legacy_store_id
ORDER BY m.user_id, m.shop_id, r.is_active DESC, r.updated_at DESC NULLS LAST, r.legacy_store_id;
--> statement-breakpoint
INSERT INTO "account_shop_connections" (
  "id", "user_id", "shop_id", "connection_status", "access_token", "scopes",
  "store_name", "store_email", "currency", "timezone", "is_active",
  "last_synced_at", "created_at", "updated_at"
)
SELECT
  c.connection_id,
  c.user_id,
  c.shop_id,
  CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END,
  c.access_token,
  COALESCE(c.scopes, 'read_products'),
  c.store_name,
  c.store_email,
  c.currency,
  c.timezone,
  c.is_active,
  c.last_synced_at,
  COALESCE(c.created_at, now()),
  COALESCE(c.updated_at, now())
FROM "_legacy_connection_keys" c;
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_store_connection_map" ON COMMIT DROP AS
SELECT m.legacy_store_id, c.connection_id
FROM "_legacy_store_shop_map" m
JOIN "_legacy_connection_keys" c
  ON c.user_id = m.user_id AND c.shop_id = m.shop_id;
--> statement-breakpoint

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_store_id_shopify_stores_id_fk";
--> statement-breakpoint
UPDATE "products" p
SET "store_id" = m.connection_id
FROM "_legacy_store_connection_map" m
WHERE p."store_id" = m.legacy_store_id;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_account_shop_connections_id_fk"
  FOREIGN KEY ("store_id") REFERENCES "public"."account_shop_connections"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
DROP TABLE "shopify_stores";
--> statement-breakpoint

-- Canonicalize legacy account-owned competitors by normalized domain.
CREATE TEMP TABLE "_legacy_competitor_rows" ON COMMIT DROP AS
SELECT
  c.id AS legacy_competitor_id,
  c.user_id,
  c.name,
  c.domain,
  c.logo_url,
  c.description,
  c.status,
  c.created_at,
  c.updated_at,
  lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(trim(c.domain), '^https?://', '', 'i'),
          '/.*$', ''
        ),
        '^www\\.', ''
      ),
      '\\.$', ''
    )
  ) AS normalized_domain
FROM "competitors" c;
--> statement-breakpoint
INSERT INTO "shops" ("canonical_domain", "normalized_domain", "name", "platform", "created_at", "updated_at")
SELECT DISTINCT ON (r.normalized_domain)
  r.normalized_domain,
  r.normalized_domain,
  COALESCE(NULLIF(r.name, ''), r.normalized_domain),
  CASE WHEN r.normalized_domain LIKE '%.myshopify.com' THEN 'shopify' ELSE NULL END,
  COALESCE(r.created_at, now()),
  COALESCE(r.updated_at, now())
FROM "_legacy_competitor_rows" r
WHERE r.normalized_domain <> ''
ORDER BY r.normalized_domain, r.updated_at DESC NULLS LAST, r.legacy_competitor_id
ON CONFLICT ("normalized_domain") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "shop_id" uuid;
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_competitor_keys" ON COMMIT DROP AS
SELECT DISTINCT ON (r.normalized_domain)
  r.legacy_competitor_id AS competitor_id,
  r.normalized_domain,
  r.name,
  r.logo_url,
  r.description,
  r.status,
  r.created_at,
  r.updated_at,
  s.id AS shop_id
FROM "_legacy_competitor_rows" r
JOIN "shops" s ON s.normalized_domain = r.normalized_domain
WHERE r.normalized_domain <> ''
ORDER BY r.normalized_domain, r.updated_at DESC NULLS LAST, r.legacy_competitor_id;
--> statement-breakpoint
UPDATE "competitors" c
SET
  "shop_id" = k.shop_id,
  "domain" = k.normalized_domain
FROM "_legacy_competitor_keys" k
WHERE c.id = k.competitor_id;
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_competitor_map" ON COMMIT DROP AS
SELECT r.legacy_competitor_id, k.competitor_id AS canonical_competitor_id, r.user_id
FROM "_legacy_competitor_rows" r
JOIN "_legacy_competitor_keys" k ON k.normalized_domain = r.normalized_domain;
--> statement-breakpoint

-- Repoint dependent records before removing the legacy competitor rows.
DROP INDEX IF EXISTS "competitor_products_unique_idx";
--> statement-breakpoint
UPDATE "competitor_products" cp
SET "competitor_id" = m.canonical_competitor_id
FROM "_legacy_competitor_map" m
WHERE cp."competitor_id" = m.legacy_competitor_id;
--> statement-breakpoint
UPDATE "scrape_jobs" sj
SET "competitor_id" = m.canonical_competitor_id
FROM "_legacy_competitor_map" m
WHERE sj."competitor_id" = m.legacy_competitor_id;
--> statement-breakpoint
UPDATE "ai_extractions" ae
SET "competitor_id" = m.canonical_competitor_id
FROM "_legacy_competitor_map" m
WHERE ae."competitor_id" = m.legacy_competitor_id;
--> statement-breakpoint
UPDATE "scrape_logs" sl
SET "competitor_id" = m.canonical_competitor_id
FROM "_legacy_competitor_map" m
WHERE sl."competitor_id" = m.legacy_competitor_id;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.price_radar_sources') IS NOT NULL THEN
    EXECUTE '
      UPDATE "price_radar_sources" prs
      SET "competitor_id" = m.canonical_competitor_id
      FROM "_legacy_competitor_map" m
      WHERE prs."competitor_id" = m.legacy_competitor_id
    ';
  END IF;
END $$;
--> statement-breakpoint
DELETE FROM "competitors" c
USING "_legacy_competitor_map" m
WHERE c.id = m.legacy_competitor_id
  AND c.id <> m.canonical_competitor_id;
--> statement-breakpoint
CREATE TEMP TABLE "_duplicate_competitor_products" ON COMMIT DROP AS
SELECT loser.id AS duplicate_id, MIN(winner.id::text)::uuid AS keep_id
FROM "competitor_products" loser
JOIN "competitor_products" winner
  ON winner.competitor_id = loser.competitor_id
 AND winner.product_id = loser.product_id
 AND winner.id < loser.id
GROUP BY loser.id;
--> statement-breakpoint
UPDATE "price_history" ph SET "competitor_product_id" = d.keep_id
FROM "_duplicate_competitor_products" d WHERE ph."competitor_product_id" = d.duplicate_id;
--> statement-breakpoint
UPDATE "alerts" a SET "competitor_product_id" = d.keep_id
FROM "_duplicate_competitor_products" d WHERE a."competitor_product_id" = d.duplicate_id;
--> statement-breakpoint
UPDATE "price_snapshots" ps SET "competitor_product_id" = d.keep_id
FROM "_duplicate_competitor_products" d WHERE ps."competitor_product_id" = d.duplicate_id;
--> statement-breakpoint
UPDATE "price_changes" pc SET "competitor_product_id" = d.keep_id
FROM "_duplicate_competitor_products" d WHERE pc."competitor_product_id" = d.duplicate_id;
--> statement-breakpoint
UPDATE "scrape_logs" sl SET "competitor_product_id" = d.keep_id
FROM "_duplicate_competitor_products" d WHERE sl."competitor_product_id" = d.duplicate_id;
--> statement-breakpoint
DELETE FROM "competitor_products" cp
USING "_duplicate_competitor_products" d
WHERE cp.id = d.duplicate_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_products_unique_idx" ON "competitor_products" USING btree ("competitor_id","product_id");
--> statement-breakpoint

INSERT INTO "account_competitor_connections" (
  "user_id", "competitor_id", "is_active", "created_at", "updated_at"
)
SELECT
  m.user_id,
  m.canonical_competitor_id,
  bool_or(r.status = 'active'),
  now(),
  now()
FROM "_legacy_competitor_map" m
JOIN "_legacy_competitor_rows" r
  ON r.legacy_competitor_id = m.legacy_competitor_id
GROUP BY m.user_id, m.canonical_competitor_id
ON CONFLICT ("user_id", "competitor_id") DO UPDATE
SET "is_active" = "account_competitor_connections"."is_active" OR EXCLUDED."is_active",
    "updated_at" = now();
--> statement-breakpoint
UPDATE "competitors" c
SET "shop_id" = k.shop_id
FROM "_legacy_competitor_keys" k
WHERE c.id = k.competitor_id;
--> statement-breakpoint
DROP INDEX IF EXISTS "competitors_user_id_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "competitors_user_normalized_name_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "competitors_user_created_idx";
--> statement-breakpoint
ALTER TABLE "competitors" ALTER COLUMN "shop_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "competitors" DROP CONSTRAINT IF EXISTS "competitors_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN "user_id";
--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_shop_id_shops_id_fk"
  FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_shop_id_idx" ON "competitors" USING btree ("shop_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "competitors_created_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "competitors_normalized_name_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "competitors_domain_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "competitors_status_idx";
--> statement-breakpoint
CREATE INDEX "competitors_created_idx" ON "competitors" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "competitors_normalized_name_idx" ON "competitors" USING btree ("normalized_name");
--> statement-breakpoint
CREATE INDEX "competitors_domain_idx" ON "competitors" USING btree ("domain");
--> statement-breakpoint
CREATE INDEX "competitors_status_idx" ON "competitors" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "account_competitor_connections" ADD CONSTRAINT "account_competitor_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_competitor_connections" ADD CONSTRAINT "account_competitor_connections_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;
