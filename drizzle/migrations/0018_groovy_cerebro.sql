CREATE TYPE "public"."delivery_channel" AS ENUM('email', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."report_type" AS ENUM('daily_summary', 'weekly_competitors', 'pricing_opportunities');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_run_id" uuid,
	"channel" "delivery_channel" NOT NULL,
	"category" varchar(64) NOT NULL,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" varchar(255),
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_type" "report_type" NOT NULL,
	"status" "report_status" DEFAULT 'queued' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"summary" jsonb,
	"error_message" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_report_run_id_report_runs_id_fk" FOREIGN KEY ("report_run_id") REFERENCES "public"."report_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_report_channel_idx" ON "notification_deliveries" USING btree ("report_run_id","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_created_idx" ON "notification_deliveries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_runs_user_created_idx" ON "report_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "report_runs_user_type_period_idx" ON "report_runs" USING btree ("user_id","report_type","period_start");--> statement-breakpoint
CREATE INDEX "report_runs_status_idx" ON "report_runs" USING btree ("status");