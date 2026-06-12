ALTER TABLE "shopify_stores" ALTER COLUMN "access_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "open_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" varchar(255);