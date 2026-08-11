ALTER TABLE "competitor_products" ADD COLUMN "base_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "coupon_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "coupon_code" varchar(64);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "membership_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "price_type" varchar(32);--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "base_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "coupon_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "coupon_code" varchar(64);--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "membership_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "price_type" varchar(32);