ALTER TABLE "competitors" DROP CONSTRAINT IF EXISTS "competitors_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "competitors_user_id_idx";--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN IF EXISTS "user_id";
