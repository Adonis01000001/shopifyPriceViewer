CREATE INDEX "alerts_user_read_created_idx" ON "alerts" USING btree ("user_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX "competitor_products_product_active_idx" ON "competitor_products" USING btree ("product_id","is_active");--> statement-breakpoint
CREATE INDEX "competitor_products_competitor_active_idx" ON "competitor_products" USING btree ("competitor_id","is_active");--> statement-breakpoint
CREATE INDEX "competitors_user_created_idx" ON "competitors" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "price_radar_products_user_active_seen_idx" ON "price_radar_products" USING btree ("user_id","is_active","last_seen_at");--> statement-breakpoint
CREATE INDEX "products_user_active_updated_idx" ON "products" USING btree ("user_id","is_active","updated_at");--> statement-breakpoint
CREATE INDEX "recommendations_user_created_idx" ON "recommendations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "scrape_jobs_competitor_created_idx" ON "scrape_jobs" USING btree ("competitor_id","created_at");