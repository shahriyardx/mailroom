ALTER TABLE "list_member" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_member_tags_idx" ON "list_member" USING gin ("tags");
--> statement-breakpoint
ALTER TYPE "automation_node_kind" ADD VALUE IF NOT EXISTS 'tag';
--> statement-breakpoint
ALTER TYPE "automation_node_kind" ADD VALUE IF NOT EXISTS 'move';
