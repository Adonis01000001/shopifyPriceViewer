CREATE TABLE "path_of_wisdom_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"output" jsonb NOT NULL,
	"product_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "path_of_wisdom_results" ADD CONSTRAINT "path_of_wisdom_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "path_of_wisdom_results_user_id_idx" ON "path_of_wisdom_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "path_of_wisdom_results_updated_at_idx" ON "path_of_wisdom_results" USING btree ("updated_at");