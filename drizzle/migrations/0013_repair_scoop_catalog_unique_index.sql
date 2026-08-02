CREATE UNIQUE INDEX IF NOT EXISTS "scoop_competitor_products_competitor_url_idx"
  ON "scoop_competitor_products" USING btree ("competitor_id", "product_url");
