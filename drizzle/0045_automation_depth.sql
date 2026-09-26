ALTER TYPE "automation_node_kind" ADD VALUE IF NOT EXISTS 'split';
--> statement-breakpoint
ALTER TYPE "automation_node_kind" ADD VALUE IF NOT EXISTS 'await';
--> statement-breakpoint
ALTER TYPE "automation_node_kind" ADD VALUE IF NOT EXISTS 'webhook';
--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "send_window" jsonb;
--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "webhook_secret" text;
--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN IF NOT EXISTS "parked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_run_node_idx" ON "automation_run" USING btree ("node_id","status");
