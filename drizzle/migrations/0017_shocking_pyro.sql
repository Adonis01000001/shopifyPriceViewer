CREATE TYPE "public"."billing_event_status" AS ENUM('processing', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" varchar(255) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"status" "billing_event_status" DEFAULT 'processing' NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"payload" jsonb,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_stripe_event_id_idx" ON "billing_events" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "billing_events_status_idx" ON "billing_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "billing_events_created_at_idx" ON "billing_events" USING btree ("created_at");