CREATE TABLE "scoop_competitor_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competitor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"product_name" varchar(500) NOT NULL,
	"brand" varchar(255),
	"model" varchar(255),
	"image_url" text,
	"price" text,
	"currency" varchar(10),
	"rating" double precision,
	"review_count" integer,
	"availability" varchar(64),
	"seller" varchar(255),
	"condition" varchar(32),
	"shipping" text,
	"product_url" text NOT NULL,
	"marketplace" varchar(128),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latest_search_id" uuid,
	"confidence_score" double precision DEFAULT 0 NOT NULL,
	"extraction_method" varchar(64) NOT NULL,
	"discovered_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "normalized_name" varchar(255);--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "scoop_search_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "last_scoop_search_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scoop_search_results" ADD COLUMN "competitor_id" uuid;--> statement-breakpoint
ALTER TABLE "scoop_search_results" ADD COLUMN "rating" double precision;--> statement-breakpoint
ALTER TABLE "scoop_search_results" ADD COLUMN "review_count" integer;--> statement-breakpoint
ALTER TABLE "scoop_search_results" ADD COLUMN "marketplace" varchar(128);--> statement-breakpoint
ALTER TABLE "scoop_competitor_products" ADD CONSTRAINT "scoop_competitor_products_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoop_competitor_products" ADD CONSTRAINT "scoop_competitor_products_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoop_competitor_products" ADD CONSTRAINT "scoop_competitor_products_latest_search_id_scoop_searches_id_fk" FOREIGN KEY ("latest_search_id") REFERENCES "public"."scoop_searches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scoop_competitor_products_competitor_id_idx" ON "scoop_competitor_products" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "scoop_competitor_products_user_id_idx" ON "scoop_competitor_products" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scoop_competitor_products_last_seen_at_idx" ON "scoop_competitor_products" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scoop_competitor_products_competitor_url_idx" ON "scoop_competitor_products" USING btree ("competitor_id","product_url");--> statement-breakpoint
ALTER TABLE "scoop_search_results" ADD CONSTRAINT "scoop_search_results_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitors_user_normalized_name_idx" ON "competitors" USING btree ("user_id","normalized_name");--> statement-breakpoint
CREATE INDEX "scoop_search_results_competitor_id_idx" ON "scoop_search_results" USING btree ("competitor_id");