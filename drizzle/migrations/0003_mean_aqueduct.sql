CREATE TABLE "ai_extractions" (
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
--> statement-breakpoint
CREATE TABLE "competitor_discoveries" (
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
--> statement-breakpoint
CREATE TABLE "cron_runs" (
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
--> statement-breakpoint
CREATE TABLE "price_changes" (
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
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
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
--> statement-breakpoint
CREATE TABLE "scrape_logs" (
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
--> statement-breakpoint
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "competitor_discoveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "competitor_discoveries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_competitor_product_id_competitor_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."competitor_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_competitor_product_id_competitor_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."competitor_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_logs" ADD CONSTRAINT "scrape_logs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_logs" ADD CONSTRAINT "scrape_logs_competitor_product_id_competitor_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."competitor_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_logs" ADD CONSTRAINT "scrape_logs_cron_run_id_cron_runs_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "public"."cron_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_extractions_product_id_idx" ON "ai_extractions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ai_extractions_competitor_id_idx" ON "ai_extractions" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "ai_extractions_confidence_idx" ON "ai_extractions" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "ai_extractions_is_match_idx" ON "ai_extractions" USING btree ("is_match");--> statement-breakpoint
CREATE INDEX "ai_extractions_extracted_at_idx" ON "ai_extractions" USING btree ("extracted_at");--> statement-breakpoint
CREATE INDEX "ai_extractions_product_confidence_idx" ON "ai_extractions" USING btree ("product_id","confidence");--> statement-breakpoint
CREATE INDEX "competitor_discoveries_user_id_idx" ON "competitor_discoveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "competitor_discoveries_product_id_idx" ON "competitor_discoveries" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "competitor_discoveries_status_idx" ON "competitor_discoveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "competitor_discoveries_domain_idx" ON "competitor_discoveries" USING btree ("candidate_domain");--> statement-breakpoint
CREATE INDEX "competitor_discoveries_confidence_idx" ON "competitor_discoveries" USING btree ("confidence");--> statement-breakpoint
CREATE INDEX "competitor_discoveries_product_status_idx" ON "competitor_discoveries" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "cron_runs_job_type_idx" ON "cron_runs" USING btree ("job_type");--> statement-breakpoint
CREATE INDEX "cron_runs_status_idx" ON "cron_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cron_runs_started_at_idx" ON "cron_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "cron_runs_job_started_idx" ON "cron_runs" USING btree ("job_type","started_at");--> statement-breakpoint
CREATE INDEX "price_changes_cp_id_idx" ON "price_changes" USING btree ("competitor_product_id");--> statement-breakpoint
CREATE INDEX "price_changes_product_id_idx" ON "price_changes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "price_changes_detected_at_idx" ON "price_changes" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "price_changes_change_type_idx" ON "price_changes" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "price_changes_product_detected_idx" ON "price_changes" USING btree ("product_id","detected_at");--> statement-breakpoint
CREATE INDEX "price_snapshots_cp_id_idx" ON "price_snapshots" USING btree ("competitor_product_id");--> statement-breakpoint
CREATE INDEX "price_snapshots_scraped_at_idx" ON "price_snapshots" USING btree ("scraped_at");--> statement-breakpoint
CREATE INDEX "price_snapshots_cp_scraped_idx" ON "price_snapshots" USING btree ("competitor_product_id","scraped_at");--> statement-breakpoint
CREATE INDEX "scrape_logs_competitor_id_idx" ON "scrape_logs" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "scrape_logs_cron_run_id_idx" ON "scrape_logs" USING btree ("cron_run_id");--> statement-breakpoint
CREATE INDEX "scrape_logs_status_idx" ON "scrape_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scrape_logs_scraped_at_idx" ON "scrape_logs" USING btree ("scraped_at");