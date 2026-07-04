ALTER TABLE "products" DROP CONSTRAINT "products_store_id_shopify_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "store_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_shopify_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_user_sku_unique_idx" ON "products" USING btree ("user_id","sku");