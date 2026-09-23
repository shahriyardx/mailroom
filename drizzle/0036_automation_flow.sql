-- An automation becomes a canvas: nodes and edges rather than an ordered list.
DO $$ BEGIN
  CREATE TYPE "automation_node_kind" AS ENUM('email', 'wait', 'condition', 'field', 'unsubscribe');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_node" (
  "id" text PRIMARY KEY NOT NULL,
  "automation_id" text NOT NULL REFERENCES "automation"("id") ON DELETE cascade,
  "kind" "automation_node_kind" NOT NULL,
  "subject" text,
  "html" text,
  "text" text,
  "design" jsonb,
  "delay_minutes" integer DEFAULT 0 NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "next" text REFERENCES "automation_node"("id") ON DELETE set null,
  "next_else" text REFERENCES "automation_node"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_node_automation_idx" ON "automation_node" ("automation_id");
--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "entry_node_id" text;
--> statement-breakpoint
-- A run points at a node. A branch has no index, which is the whole point of one.
ALTER TABLE "automation_run" ADD COLUMN IF NOT EXISTS "node_id" text;
--> statement-breakpoint
ALTER TABLE "automation_run" DROP COLUMN IF EXISTS "step";
--> statement-breakpoint
DROP TABLE IF EXISTS "automation_step";
