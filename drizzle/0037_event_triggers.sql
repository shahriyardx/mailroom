ALTER TABLE "automation" ALTER COLUMN "list_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "trigger" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "trigger" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "event_name" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_event_idx" ON "automation" ("organization_id","event_name","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_event" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "description" text,
  "declared" boolean DEFAULT true NOT NULL,
  "seen_count" integer DEFAULT 0 NOT NULL,
  "last_seen_at" timestamp with time zone,
  "last_payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_event_name_idx" ON "custom_event" ("organization_id","name");
