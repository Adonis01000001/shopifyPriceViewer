CREATE TABLE IF NOT EXISTS "serp_api_scouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "query" text NOT NULL,
  "title" text,
  "snippet" text,
  "url" text NOT NULL,
  "price" text,
  "currency" varchar(10) DEFAULT 'USD',
  "source" varchar(64),
  "position" integer,
  "scraped_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "serp_api_scouts_product_id_idx" ON "serp_api_scouts" ("product_id");
CREATE INDEX IF NOT EXISTS "serp_api_scouts_user_id_idx" ON "serp_api_scouts" ("user_id");
CREATE INDEX IF NOT EXISTS "serp_api_scouts_created_at_idx" ON "serp_api_scouts" ("created_at");
