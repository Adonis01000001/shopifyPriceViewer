import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const sql = `
    CREATE TABLE IF NOT EXISTS "ai_extractions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "product_id" uuid NOT NULL,
      "competitor_id" uuid NOT NULL,
      "source_url" text NOT NULL,
      "is_match" boolean NOT NULL,
      "confidence" double precision NOT NULL,
      "match_confidence" double precision,
      "sku_match_confidence" double precision,
      "title_similarity" double precision,
      "variant_similarity" double precision,
      "extracted_price" numeric(10, 2),
      "extracted_currency" varchar(3),
      "extracted_sale_price" numeric(10, 2),
      "extracted_original_price" numeric(10, 2),
      "extracted_title" varchar(500),
      "extracted_description" text,
      "extracted_features" jsonb,
      "reasoning" text,
      "model_used" varchar(128),
      "tokens_used" integer,
      "raw_response" jsonb,
      "extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "competitor_discoveries" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL,
      "product_id" uuid NOT NULL,
      "search_query" text NOT NULL,
      "search_engine" varchar(32) DEFAULT 'google',
      "country" varchar(2) DEFAULT 'US',
      "language" varchar(5) DEFAULT 'en',
      "candidate_url" text NOT NULL,
      "candidate_domain" varchar(255) NOT NULL,
      "candidate_title" varchar(500),
      "search_position" integer,
      "confidence" double precision DEFAULT 0 NOT NULL,
      "status" varchar(32) DEFAULT 'pending',
      "discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "cron_runs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "job_type" varchar(64) NOT NULL,
      "status" varchar(32) DEFAULT 'running',
      "started_at" timestamp with time zone DEFAULT now() NOT NULL,
      "completed_at" timestamp with time zone,
      "products_processed" integer DEFAULT 0,
      "products_updated" integer DEFAULT 0,
      "changes_detected" integer DEFAULT 0,
      "errors_count" integer DEFAULT 0,
      "error_details" jsonb,
      "metadata" jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "price_changes" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "competitor_product_id" uuid NOT NULL,
      "product_id" uuid NOT NULL,
      "change_type" varchar(32) NOT NULL,
      "previous_price" numeric(10, 2),
      "new_price" numeric(10, 2),
      "previous_availability" varchar(32),
      "new_availability" varchar(32),
      "price_diff" numeric(10, 2),
      "price_diff_percent" numeric(5, 2),
      "currency" varchar(3) DEFAULT 'USD',
      "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
      "is_notified" boolean DEFAULT false NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "price_snapshots" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "competitor_product_id" uuid NOT NULL,
      "price" numeric(10, 2) NOT NULL,
      "currency" varchar(3) DEFAULT 'USD',
      "sale_price" numeric(10, 2),
      "original_price" numeric(10, 2),
      "availability" varchar(32) DEFAULT 'in_stock',
      "scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
      "scrape_method" varchar(32) DEFAULT 'firecrawl',
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "scrape_logs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "competitor_id" uuid,
      "competitor_product_id" uuid,
      "cron_run_id" uuid,
      "url" text NOT NULL,
      "status" varchar(32) NOT NULL,
      "method" varchar(32),
      "http_status" integer,
      "response_time_ms" integer,
      "error_message" text,
      "html_size" integer,
      "retry_count" integer DEFAULT 0,
      "scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ae_product_id_fk' AND table_name = 'ai_extractions') THEN
        ALTER TABLE "ai_extractions" ADD CONSTRAINT "ae_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ae_competitor_id_fk' AND table_name = 'ai_extractions') THEN
        ALTER TABLE "ai_extractions" ADD CONSTRAINT "ae_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'cd_user_id_fk' AND table_name = 'competitor_discoveries') THEN
        ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "cd_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'cd_product_id_fk' AND table_name = 'competitor_discoveries') THEN
        ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "cd_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pc_cp_id_fk' AND table_name = 'price_changes') THEN
        ALTER TABLE "price_changes" ADD CONSTRAINT "pc_cp_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "competitor_products"("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'pc_product_id_fk' AND table_name = 'price_changes') THEN
        ALTER TABLE "price_changes" ADD CONSTRAINT "pc_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ps_cp_id_fk' AND table_name = 'price_snapshots') THEN
        ALTER TABLE "price_snapshots" ADD CONSTRAINT "ps_cp_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "competitor_products"("id") ON DELETE cascade;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sl_competitor_id_fk' AND table_name = 'scrape_logs') THEN
        ALTER TABLE "scrape_logs" ADD CONSTRAINT "sl_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE set null;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sl_cp_id_fk' AND table_name = 'scrape_logs') THEN
        ALTER TABLE "scrape_logs" ADD CONSTRAINT "sl_cp_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "competitor_products"("id") ON DELETE set null;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sl_cron_run_id_fk' AND table_name = 'scrape_logs') THEN
        ALTER TABLE "scrape_logs" ADD CONSTRAINT "sl_cron_run_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "cron_runs"("id") ON DELETE set null;
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS "ae_product_id_idx" ON "ai_extractions" ("product_id");
    CREATE INDEX IF NOT EXISTS "ae_competitor_id_idx" ON "ai_extractions" ("competitor_id");
    CREATE INDEX IF NOT EXISTS "ae_confidence_idx" ON "ai_extractions" ("confidence");
    CREATE INDEX IF NOT EXISTS "ae_is_match_idx" ON "ai_extractions" ("is_match");
    CREATE INDEX IF NOT EXISTS "ae_extracted_at_idx" ON "ai_extractions" ("extracted_at");
    CREATE INDEX IF NOT EXISTS "cd_user_id_idx" ON "competitor_discoveries" ("user_id");
    CREATE INDEX IF NOT EXISTS "cd_product_id_idx" ON "competitor_discoveries" ("product_id");
    CREATE INDEX IF NOT EXISTS "cd_status_idx" ON "competitor_discoveries" ("status");
    CREATE INDEX IF NOT EXISTS "cd_domain_idx" ON "competitor_discoveries" ("candidate_domain");
    CREATE INDEX IF NOT EXISTS "cd_confidence_idx" ON "competitor_discoveries" ("confidence");
    CREATE INDEX IF NOT EXISTS "cr_job_type_idx" ON "cron_runs" ("job_type");
    CREATE INDEX IF NOT EXISTS "cr_status_idx" ON "cron_runs" ("status");
    CREATE INDEX IF NOT EXISTS "cr_started_at_idx" ON "cron_runs" ("started_at");
    CREATE INDEX IF NOT EXISTS "pc_cp_id_idx" ON "price_changes" ("competitor_product_id");
    CREATE INDEX IF NOT EXISTS "pc_product_id_idx" ON "price_changes" ("product_id");
    CREATE INDEX IF NOT EXISTS "pc_detected_at_idx" ON "price_changes" ("detected_at");
    CREATE INDEX IF NOT EXISTS "pc_change_type_idx" ON "price_changes" ("change_type");
    CREATE INDEX IF NOT EXISTS "ps_cp_id_idx" ON "price_snapshots" ("competitor_product_id");
    CREATE INDEX IF NOT EXISTS "ps_scraped_at_idx" ON "price_snapshots" ("scraped_at");
    CREATE INDEX IF NOT EXISTS "sl_competitor_id_idx" ON "scrape_logs" ("competitor_id");
    CREATE INDEX IF NOT EXISTS "sl_cron_run_id_idx" ON "scrape_logs" ("cron_run_id");
    CREATE INDEX IF NOT EXISTS "sl_status_idx" ON "scrape_logs" ("status");
    CREATE INDEX IF NOT EXISTS "sl_scraped_at_idx" ON "scrape_logs" ("scraped_at");
  `;

  try {
    await pool.query(sql);
    console.log("✅ All 6 new tables created successfully");
    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
    );
    console.log("\nAll tables in database:");
    tables.rows.forEach((r: any) => console.log(`  ${r.table_name}`));
  } catch (err: any) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
