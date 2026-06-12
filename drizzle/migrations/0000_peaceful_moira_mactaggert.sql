CREATE TYPE "public"."alert_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('price_drop', 'price_increase', 'competitor_change', 'threshold');--> statement-breakpoint
CREATE TYPE "public"."competitor_status" AS ENUM('active', 'inactive', 'error');--> statement-breakpoint
CREATE TYPE "public"."notification_frequency" AS ENUM('realtime', 'hourly', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('optimal', 'underpriced', 'overpriced', 'alert');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('pending', 'implemented', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."scrape_status" AS ENUM('pending', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" varchar(128) NOT NULL,
	"entity_type" varchar(64),
	"entity_id" uuid,
	"detail" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"competitor_product_id" uuid,
	"alert_type" "alert_type" NOT NULL,
	"severity" "alert_severity" DEFAULT 'medium' NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"trigger_price" numeric(10, 2),
	"trigger_condition" varchar(32),
	"is_read" boolean DEFAULT false NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"is_notified" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"competitor_product_url" text,
	"competitor_product_title" varchar(500),
	"competitor_sku" varchar(128),
	"price" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"match_score" double precision DEFAULT 0 NOT NULL,
	"match_method" varchar(64) DEFAULT 'manual',
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"domain" varchar(255) NOT NULL,
	"logo_url" text,
	"description" text,
	"status" "competitor_status" DEFAULT 'active' NOT NULL,
	"products_tracked" integer DEFAULT 0 NOT NULL,
	"avg_price_diff" numeric(5, 2) DEFAULT '0.00',
	"price_index" numeric(5, 2) DEFAULT '100.00',
	"last_scraped_at" timestamp with time zone,
	"scrape_status" "scrape_status" DEFAULT 'pending',
	"scrape_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"smtp_server" varchar(255) NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_username" varchar(255) NOT NULL,
	"smtp_password" text NOT NULL,
	"from_email" varchar(255) NOT NULL,
	"from_name" varchar(255) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_notifications" boolean DEFAULT true NOT NULL,
	"in_app_notifications" boolean DEFAULT true NOT NULL,
	"frequency" "notification_frequency" DEFAULT 'daily' NOT NULL,
	"price_drop_threshold" numeric(5, 2) DEFAULT '5.00',
	"price_increase_threshold" numeric(5, 2) DEFAULT '5.00',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"competitor_product_id" uuid,
	"price" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"source" varchar(64) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"embedding" jsonb NOT NULL,
	"model" varchar(128) DEFAULT 'text-embedding-3-small',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"shopify_product_id" varchar(64),
	"shopify_variant_id" varchar(64),
	"title" varchar(500) NOT NULL,
	"description" text,
	"sku" varchar(128),
	"barcode" varchar(128),
	"vendor" varchar(255),
	"product_type" varchar(255),
	"category" varchar(255),
	"tags" text,
	"price" numeric(10, 2) NOT NULL,
	"compare_at_price" numeric(10, 2),
	"cost_price" numeric(10, 2),
	"currency" varchar(3) DEFAULT 'USD',
	"image_url" text,
	"status" "product_status" DEFAULT 'optimal' NOT NULL,
	"is_tracked" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"current_price" numeric(10, 2) NOT NULL,
	"recommended_price" numeric(10, 2) NOT NULL,
	"price_change" numeric(10, 2) NOT NULL,
	"price_change_percent" numeric(5, 2) NOT NULL,
	"confidence_score" double precision NOT NULL,
	"reason" text NOT NULL,
	"factors" jsonb,
	"status" "recommendation_status" DEFAULT 'pending' NOT NULL,
	"implemented_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"potential_savings" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"status" "scrape_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"products_scraped" integer DEFAULT 0,
	"products_updated" integer DEFAULT 0,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_domain" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"scopes" text NOT NULL,
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"open_id" varchar(64) NOT NULL,
	"email" varchar(320),
	"name" text,
	"login_method" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_signed_in" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_competitor_product_id_competitor_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."competitor_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD CONSTRAINT "competitor_products_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD CONSTRAINT "competitor_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_configs" ADD CONSTRAINT "email_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_competitor_product_id_competitor_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."competitor_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_entity_idx" ON "activity_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "alerts_user_id_idx" ON "alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alerts_product_id_idx" ON "alerts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "alerts_severity_idx" ON "alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "alerts_is_read_idx" ON "alerts" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "alerts_is_resolved_idx" ON "alerts" USING btree ("is_resolved");--> statement-breakpoint
CREATE INDEX "alerts_created_at_idx" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alerts_user_unread_idx" ON "alerts" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "competitor_products_competitor_id_idx" ON "competitor_products" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "competitor_products_product_id_idx" ON "competitor_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "competitor_products_match_score_idx" ON "competitor_products" USING btree ("match_score");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_products_unique_idx" ON "competitor_products" USING btree ("competitor_id","product_id");--> statement-breakpoint
CREATE INDEX "competitors_user_id_idx" ON "competitors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "competitors_domain_idx" ON "competitors" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "competitors_status_idx" ON "competitors" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "email_configs_user_id_idx" ON "email_configs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_user_id_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_history_product_id_idx" ON "price_history" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "price_history_competitor_product_id_idx" ON "price_history" USING btree ("competitor_product_id");--> statement-breakpoint
CREATE INDEX "price_history_recorded_at_idx" ON "price_history" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "price_history_product_recorded_idx" ON "price_history" USING btree ("product_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_embeddings_product_id_idx" ON "product_embeddings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_user_id_idx" ON "products" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "products_store_id_idx" ON "products" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "products_sku_idx" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_shopify_product_id_idx" ON "products" USING btree ("shopify_product_id");--> statement-breakpoint
CREATE INDEX "recommendations_user_id_idx" ON "recommendations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recommendations_product_id_idx" ON "recommendations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "recommendations_status_idx" ON "recommendations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recommendations_confidence_idx" ON "recommendations" USING btree ("confidence_score");--> statement-breakpoint
CREATE INDEX "recommendations_created_at_idx" ON "recommendations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scrape_jobs_competitor_id_idx" ON "scrape_jobs" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "scrape_jobs_status_idx" ON "scrape_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scrape_jobs_created_at_idx" ON "scrape_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "shopify_stores_user_id_idx" ON "shopify_stores" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_stores_shop_domain_idx" ON "shopify_stores" USING btree ("shop_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "users_open_id_idx" ON "users" USING btree ("open_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");