ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "open_count" integer DEFAULT 0 NOT NULL;
