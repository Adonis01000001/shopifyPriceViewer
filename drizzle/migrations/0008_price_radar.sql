CREATE TABLE "price_radar_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "competitor_id" uuid REFERENCES "competitors"("id") ON DELETE SET NULL,
  "name" varchar(255) NOT NULL,
  "domain" varchar(255) NOT NULL,
  "base_url" text NOT NULL,
  "status" varchar(32) DEFAULT 'active' NOT NULL,
  "crawl_delay_ms" integer DEFAULT 300 NOT NULL,
  "robots_txt" text,
  "last_crawled_at" timestamptz,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "price_radar_sources_user_id_idx" ON "price_radar_sources" ("user_id");
CREATE INDEX "price_radar_sources_competitor_id_idx" ON "price_radar_sources" ("competitor_id");
CREATE UNIQUE INDEX "price_radar_sources_user_domain_idx" ON "price_radar_sources" ("user_id","domain");
CREATE INDEX "price_radar_sources_active_idx" ON "price_radar_sources" ("user_id","is_active");

CREATE TABLE "price_radar_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_id" uuid NOT NULL REFERENCES "price_radar_sources"("id") ON DELETE CASCADE,
  "root_url" text NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "config" jsonb NOT NULL,
  "pages_queued" integer DEFAULT 0 NOT NULL,
  "pages_visited" integer DEFAULT 0 NOT NULL,
  "pages_succeeded" integer DEFAULT 0 NOT NULL,
  "pages_failed" integer DEFAULT 0 NOT NULL,
  "products_extracted" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "price_radar_jobs_user_id_idx" ON "price_radar_jobs" ("user_id");
CREATE INDEX "price_radar_jobs_source_id_idx" ON "price_radar_jobs" ("source_id");
CREATE INDEX "price_radar_jobs_status_idx" ON "price_radar_jobs" ("status");
CREATE INDEX "price_radar_jobs_created_at_idx" ON "price_radar_jobs" ("created_at");
CREATE INDEX "price_radar_jobs_user_created_idx" ON "price_radar_jobs" ("user_id","created_at");

CREATE TABLE "price_radar_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_id" uuid NOT NULL REFERENCES "price_radar_sources"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL REFERENCES "price_radar_jobs"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "url_hash" varchar(64) NOT NULL,
  "referrer_url" text,
  "depth" integer DEFAULT 0 NOT NULL,
  "page_kind" varchar(32) DEFAULT 'other' NOT NULL,
  "status" varchar(32) NOT NULL,
  "http_status" integer,
  "content_type" varchar(255),
  "render_mode" varchar(32),
  "title" varchar(500),
  "response_time_ms" integer,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "content_bytes" integer,
  "metadata" jsonb,
  "fetched_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "price_radar_pages_job_id_idx" ON "price_radar_pages" ("job_id");
CREATE INDEX "price_radar_pages_source_id_idx" ON "price_radar_pages" ("source_id");
CREATE INDEX "price_radar_pages_user_id_idx" ON "price_radar_pages" ("user_id");
CREATE INDEX "price_radar_pages_status_idx" ON "price_radar_pages" ("status");
CREATE UNIQUE INDEX "price_radar_pages_job_url_idx" ON "price_radar_pages" ("job_id","url_hash");

CREATE TABLE "price_radar_products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source_id" uuid NOT NULL REFERENCES "price_radar_sources"("id") ON DELETE CASCADE,
  "page_id" uuid REFERENCES "price_radar_pages"("id") ON DELETE SET NULL,
  "product_url" text NOT NULL,
  "product_url_hash" varchar(64) NOT NULL,
  "name" varchar(500) NOT NULL,
  "brand" varchar(255),
  "price" numeric(12,2),
  "currency" varchar(3),
  "previous_price" numeric(12,2),
  "discount_percent" numeric(7,2),
  "image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "availability" varchar(32) DEFAULT 'unknown' NOT NULL,
  "sku" varchar(128),
  "barcode" varchar(128),
  "gtin" varchar(128),
  "category" varchar(255),
  "rating" double precision,
  "review_count" integer,
  "seller" varchar(255),
  "structured_metadata" jsonb,
  "json_ld" jsonb,
  "extraction_method" varchar(128),
  "extraction_confidence" double precision DEFAULT 0 NOT NULL,
  "first_seen_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "price_radar_products_user_id_idx" ON "price_radar_products" ("user_id");
CREATE INDEX "price_radar_products_source_id_idx" ON "price_radar_products" ("source_id");
CREATE INDEX "price_radar_products_sku_idx" ON "price_radar_products" ("sku");
CREATE INDEX "price_radar_products_gtin_idx" ON "price_radar_products" ("gtin");
CREATE UNIQUE INDEX "price_radar_products_source_url_idx" ON "price_radar_products" ("source_id","product_url_hash");

CREATE TABLE "price_radar_product_attributes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "price_radar_products"("id") ON DELETE CASCADE,
  "name" varchar(128) NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "price_radar_attributes_product_id_idx" ON "price_radar_product_attributes" ("product_id");
CREATE UNIQUE INDEX "price_radar_attributes_product_name_idx" ON "price_radar_product_attributes" ("product_id","name");

CREATE TABLE "price_radar_price_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL REFERENCES "price_radar_products"("id") ON DELETE CASCADE,
  "job_id" uuid REFERENCES "price_radar_jobs"("id") ON DELETE SET NULL,
  "price" numeric(12,2),
  "previous_price" numeric(12,2),
  "currency" varchar(3),
  "availability" varchar(32),
  "captured_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "price_radar_snapshots_product_id_idx" ON "price_radar_price_snapshots" ("product_id");
CREATE INDEX "price_radar_snapshots_captured_at_idx" ON "price_radar_price_snapshots" ("captured_at");

CREATE TABLE "price_radar_extraction_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL REFERENCES "price_radar_jobs"("id") ON DELETE CASCADE,
  "page_id" uuid REFERENCES "price_radar_pages"("id") ON DELETE SET NULL,
  "product_id" uuid REFERENCES "price_radar_products"("id") ON DELETE SET NULL,
  "methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "confidence" double precision DEFAULT 0 NOT NULL,
  "duration_ms" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "price_radar_extraction_logs_job_id_idx" ON "price_radar_extraction_logs" ("job_id");
CREATE INDEX "price_radar_extraction_logs_page_id_idx" ON "price_radar_extraction_logs" ("page_id");
CREATE INDEX "price_radar_extraction_logs_user_id_idx" ON "price_radar_extraction_logs" ("user_id");

CREATE TABLE "price_radar_crawl_errors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "job_id" uuid NOT NULL REFERENCES "price_radar_jobs"("id") ON DELETE CASCADE,
  "page_id" uuid REFERENCES "price_radar_pages"("id") ON DELETE SET NULL,
  "url" text NOT NULL,
  "stage" varchar(64) NOT NULL,
  "code" varchar(64),
  "message" text NOT NULL,
  "retryable" boolean DEFAULT false NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "price_radar_crawl_errors_job_id_idx" ON "price_radar_crawl_errors" ("job_id");
CREATE INDEX "price_radar_crawl_errors_user_id_idx" ON "price_radar_crawl_errors" ("user_id");
CREATE INDEX "price_radar_crawl_errors_stage_idx" ON "price_radar_crawl_errors" ("stage");
