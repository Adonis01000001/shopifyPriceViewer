CREATE TABLE "competitor_discovery_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"owner_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_discovery_locks" ADD CONSTRAINT "competitor_discovery_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_discovery_locks" ADD CONSTRAINT "competitor_discovery_locks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_discovery_locks_user_product_idx" ON "competitor_discovery_locks" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "competitor_discovery_locks_lease_until_idx" ON "competitor_discovery_locks" USING btree ("lease_until");