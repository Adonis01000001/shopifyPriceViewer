CREATE TABLE "competitor_product_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"source_product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_product_dismissals" ADD CONSTRAINT "competitor_product_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_product_dismissals" ADD CONSTRAINT "competitor_product_dismissals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_product_dismissals" ADD CONSTRAINT "competitor_product_dismissals_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_product_dismissals_user_product_idx" ON "competitor_product_dismissals" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "competitor_product_dismissals_source_idx" ON "competitor_product_dismissals" USING btree ("source_type","source_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_product_dismissals_unique_idx" ON "competitor_product_dismissals" USING btree ("user_id","product_id","competitor_id","source_type","source_product_id");