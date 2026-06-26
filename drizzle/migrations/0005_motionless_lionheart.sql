CREATE TABLE "serp_api_scouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"title" text,
	"snippet" text,
	"url" text NOT NULL,
	"price" text,
	"currency" varchar(10) DEFAULT 'USD',
	"source" varchar(64),
	"position" integer,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "margin_protection_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "serp_api_scouts" ADD CONSTRAINT "serp_api_scouts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serp_api_scouts" ADD CONSTRAINT "serp_api_scouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serp_api_scouts_product_id_idx" ON "serp_api_scouts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "serp_api_scouts_user_id_idx" ON "serp_api_scouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "serp_api_scouts_created_at_idx" ON "serp_api_scouts" USING btree ("created_at");