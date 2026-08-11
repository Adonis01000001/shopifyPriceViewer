ALTER TABLE "competitor_products" ADD COLUMN "normalized_price" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "normalized_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "normalization_method" varchar(64);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "shipping_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "tax_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "discount_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "condition" varchar(32);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "quantity" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "unit" varchar(32);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "variant" varchar(255);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gtin" varchar(128);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "mpn" varchar(128);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "model_number" varchar(128);