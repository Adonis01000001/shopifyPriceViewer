ALTER TABLE "competitor_discoveries" ADD COLUMN "extracted_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD COLUMN "extracted_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD COLUMN "match_type" varchar(16);--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD COLUMN "competitor_product_id" uuid;--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "availability" varchar(32);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "sale_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "original_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "match_type" varchar(16);--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "competitor_discoveries_competitor_product_id_competitor_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."competitor_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_discoveries_competitor_product_idx" ON "competitor_discoveries" USING btree ("competitor_product_id");--> statement-breakpoint
CREATE INDEX "competitor_discoveries_checked_at_idx" ON "competitor_discoveries" USING btree ("checked_at");