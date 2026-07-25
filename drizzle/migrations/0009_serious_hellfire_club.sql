CREATE TABLE "price_radar_crawl_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"page_id" uuid,
	"url" text NOT NULL,
	"stage" varchar(64) NOT NULL,
	"code" varchar(64),
	"message" text NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_radar_extraction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"page_id" uuid,
	"product_id" uuid,
	"methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_radar_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"root_url" text NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"config" jsonb NOT NULL,
	"pages_queued" integer DEFAULT 0 NOT NULL,
	"pages_visited" integer DEFAULT 0 NOT NULL,
	"pages_succeeded" integer DEFAULT 0 NOT NULL,
	"pages_failed" integer DEFAULT 0 NOT NULL,
	"products_extracted" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_radar_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
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
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_radar_price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"job_id" uuid,
	"price" numeric(12, 2),
	"previous_price" numeric(12, 2),
	"currency" varchar(3),
	"availability" varchar(32),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_radar_product_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_radar_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"page_id" uuid,
	"product_url" text NOT NULL,
	"product_url_hash" varchar(64) NOT NULL,
	"name" varchar(500) NOT NULL,
	"brand" varchar(255),
	"price" numeric(12, 2),
	"currency" varchar(3),
	"previous_price" numeric(12, 2),
	"discount_percent" numeric(7, 2),
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
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_radar_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"competitor_id" uuid,
	"name" varchar(255) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"base_url" text NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"crawl_delay_ms" integer DEFAULT 300 NOT NULL,
	"robots_txt" text,
	"last_crawled_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_radar_crawl_errors" ADD CONSTRAINT "price_radar_crawl_errors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_crawl_errors" ADD CONSTRAINT "price_radar_crawl_errors_job_id_price_radar_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."price_radar_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_crawl_errors" ADD CONSTRAINT "price_radar_crawl_errors_page_id_price_radar_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."price_radar_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_extraction_logs" ADD CONSTRAINT "price_radar_extraction_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_extraction_logs" ADD CONSTRAINT "price_radar_extraction_logs_job_id_price_radar_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."price_radar_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_extraction_logs" ADD CONSTRAINT "price_radar_extraction_logs_page_id_price_radar_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."price_radar_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_extraction_logs" ADD CONSTRAINT "price_radar_extraction_logs_product_id_price_radar_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."price_radar_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_jobs" ADD CONSTRAINT "price_radar_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_jobs" ADD CONSTRAINT "price_radar_jobs_source_id_price_radar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."price_radar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_pages" ADD CONSTRAINT "price_radar_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_pages" ADD CONSTRAINT "price_radar_pages_source_id_price_radar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."price_radar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_pages" ADD CONSTRAINT "price_radar_pages_job_id_price_radar_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."price_radar_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_price_snapshots" ADD CONSTRAINT "price_radar_price_snapshots_product_id_price_radar_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."price_radar_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_price_snapshots" ADD CONSTRAINT "price_radar_price_snapshots_job_id_price_radar_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."price_radar_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_product_attributes" ADD CONSTRAINT "price_radar_product_attributes_product_id_price_radar_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."price_radar_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_products" ADD CONSTRAINT "price_radar_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_products" ADD CONSTRAINT "price_radar_products_source_id_price_radar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."price_radar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_products" ADD CONSTRAINT "price_radar_products_page_id_price_radar_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."price_radar_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_sources" ADD CONSTRAINT "price_radar_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_radar_sources" ADD CONSTRAINT "price_radar_sources_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_radar_crawl_errors_job_id_idx" ON "price_radar_crawl_errors" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "price_radar_crawl_errors_user_id_idx" ON "price_radar_crawl_errors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_radar_crawl_errors_stage_idx" ON "price_radar_crawl_errors" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "price_radar_extraction_logs_job_id_idx" ON "price_radar_extraction_logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "price_radar_extraction_logs_page_id_idx" ON "price_radar_extraction_logs" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "price_radar_extraction_logs_user_id_idx" ON "price_radar_extraction_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_radar_jobs_user_id_idx" ON "price_radar_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_radar_jobs_source_id_idx" ON "price_radar_jobs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "price_radar_jobs_status_idx" ON "price_radar_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "price_radar_jobs_created_at_idx" ON "price_radar_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "price_radar_jobs_user_created_idx" ON "price_radar_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "price_radar_pages_job_id_idx" ON "price_radar_pages" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "price_radar_pages_source_id_idx" ON "price_radar_pages" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "price_radar_pages_user_id_idx" ON "price_radar_pages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_radar_pages_status_idx" ON "price_radar_pages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "price_radar_pages_job_url_idx" ON "price_radar_pages" USING btree ("job_id","url_hash");--> statement-breakpoint
CREATE INDEX "price_radar_snapshots_product_id_idx" ON "price_radar_price_snapshots" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "price_radar_snapshots_captured_at_idx" ON "price_radar_price_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "price_radar_attributes_product_id_idx" ON "price_radar_product_attributes" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_radar_attributes_product_name_idx" ON "price_radar_product_attributes" USING btree ("product_id","name");--> statement-breakpoint
CREATE INDEX "price_radar_products_user_id_idx" ON "price_radar_products" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_radar_products_source_id_idx" ON "price_radar_products" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "price_radar_products_sku_idx" ON "price_radar_products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "price_radar_products_gtin_idx" ON "price_radar_products" USING btree ("gtin");--> statement-breakpoint
CREATE UNIQUE INDEX "price_radar_products_source_url_idx" ON "price_radar_products" USING btree ("source_id","product_url_hash");--> statement-breakpoint
CREATE INDEX "price_radar_sources_user_id_idx" ON "price_radar_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_radar_sources_competitor_id_idx" ON "price_radar_sources" USING btree ("competitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_radar_sources_user_domain_idx" ON "price_radar_sources" USING btree ("user_id","domain");--> statement-breakpoint
CREATE INDEX "price_radar_sources_active_idx" ON "price_radar_sources" USING btree ("user_id","is_active");