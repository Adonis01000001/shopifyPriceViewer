CREATE TABLE "scoop_search_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"product_name" varchar(500) NOT NULL,
	"brand" varchar(255),
	"model" varchar(255),
	"price" text,
	"currency" varchar(10),
	"availability" varchar(64),
	"seller" varchar(255),
	"condition" varchar(32),
	"shipping" text,
	"product_url" text NOT NULL,
	"image_url" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"published_date" text,
	"confidence_score" double precision NOT NULL,
	"extraction_method" varchar(64) NOT NULL,
	"discovered_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoop_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"ranking" varchar(32) NOT NULL,
	"summary" text NOT NULL,
	"confidence_score" double precision DEFAULT 0 NOT NULL,
	"status" varchar(16) NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scoop_search_results" ADD CONSTRAINT "scoop_search_results_search_id_scoop_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."scoop_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoop_search_results" ADD CONSTRAINT "scoop_search_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoop_searches" ADD CONSTRAINT "scoop_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scoop_search_results_search_id_idx" ON "scoop_search_results" USING btree ("search_id");--> statement-breakpoint
CREATE INDEX "scoop_search_results_user_id_idx" ON "scoop_search_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scoop_search_results_product_url_idx" ON "scoop_search_results" USING btree ("product_url");--> statement-breakpoint
CREATE INDEX "scoop_searches_user_id_idx" ON "scoop_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scoop_searches_created_at_idx" ON "scoop_searches" USING btree ("created_at");