ALTER TABLE "competitor_discoveries" ADD COLUMN "normalized_price" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD COLUMN "normalized_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "competitor_discoveries" ADD COLUMN "normalization_method" varchar(64);