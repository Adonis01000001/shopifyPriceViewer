CREATE TABLE "extraction_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"failure_key" varchar(64) NOT NULL,
	"product_id" uuid,
	"competitor_id" uuid,
	"domain" varchar(255) NOT NULL,
	"source_url" text,
	"content_hash" varchar(64) NOT NULL,
	"extractor_version" varchar(32) NOT NULL,
	"resolution_state" varchar(16) NOT NULL,
	"failure_reasons" jsonb NOT NULL,
	"platform" varchar(32) NOT NULL,
	"marker_fingerprint" varchar(64) NOT NULL,
	"markers" jsonb NOT NULL,
	"product_evidence" jsonb NOT NULL,
	"variant_evidence" jsonb NOT NULL,
	"price_evidence" jsonb NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"confidence" double precision,
	"score_breakdown" jsonb NOT NULL,
	"reduced_content" text,
	"deterministic_decision" jsonb NOT NULL,
	"ai_decision" jsonb,
	"expected_result" jsonb,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractor_improvement_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_key" varchar(64) NOT NULL,
	"cluster_key" varchar(64) NOT NULL,
	"extractor_version" varchar(32) NOT NULL,
	"title" varchar(255) NOT NULL,
	"platform" varchar(32) NOT NULL,
	"failure_reason" varchar(64) NOT NULL,
	"affected_failure_count" integer NOT NULL,
	"confidence" double precision NOT NULL,
	"proposal" jsonb NOT NULL,
	"evaluation" jsonb,
	"report" text,
	"status" varchar(32) DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extraction_failures" ADD CONSTRAINT "extraction_failures_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_failures" ADD CONSTRAINT "extraction_failures_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_failures_key_idx" ON "extraction_failures" USING btree ("failure_key");--> statement-breakpoint
CREATE INDEX "extraction_failures_status_observed_idx" ON "extraction_failures" USING btree ("status","last_observed_at");--> statement-breakpoint
CREATE INDEX "extraction_failures_cluster_idx" ON "extraction_failures" USING btree ("domain","platform","extractor_version");--> statement-breakpoint
CREATE INDEX "extraction_failures_product_idx" ON "extraction_failures" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "extraction_failures_competitor_idx" ON "extraction_failures" USING btree ("competitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extractor_proposals_key_idx" ON "extractor_improvement_proposals" USING btree ("proposal_key");--> statement-breakpoint
CREATE INDEX "extractor_proposals_status_idx" ON "extractor_improvement_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "extractor_proposals_cluster_idx" ON "extractor_improvement_proposals" USING btree ("cluster_key","extractor_version");