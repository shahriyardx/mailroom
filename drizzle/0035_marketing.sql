-- Everything a campaign needs to be measured, targeted, repeated and automated.
-- A member who has asked to join a double opt-in list but has not confirmed.
ALTER TYPE "list_member_status" ADD VALUE IF NOT EXISTS 'pending';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "automation_status" AS ENUM('draft', 'active', 'paused');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "automation_run_status" AS ENUM('active', 'done', 'stopped');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- The physical address bulk mail is required to carry.
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "postal_address" text;
--> statement-breakpoint
-- How people get onto a list.
ALTER TABLE "mailing_list" ADD COLUMN IF NOT EXISTS "double_opt_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mailing_list" ADD COLUMN IF NOT EXISTS "public_signup" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "list_member" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone;
--> statement-breakpoint
-- Saved questions about a list, run at send time.
CREATE TABLE IF NOT EXISTS "segment" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "list_id" text NOT NULL REFERENCES "mailing_list"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "match_all" boolean DEFAULT true NOT NULL,
  "rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segment_list_idx" ON "segment" ("list_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segment_org_idx" ON "segment" ("organization_id");
--> statement-breakpoint
-- Who a campaign goes to, and what it is testing.
ALTER TABLE "broadcast" ADD COLUMN IF NOT EXISTS "segment_id" text REFERENCES "segment"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "broadcast" ADD COLUMN IF NOT EXISTS "resend_of_id" text REFERENCES "broadcast"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "broadcast" ADD COLUMN IF NOT EXISTS "subject_b" text;
--> statement-breakpoint
-- What each copy did.
ALTER TABLE "broadcast_recipient" ADD COLUMN IF NOT EXISTS "clicked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "broadcast_recipient" ADD COLUMN IF NOT EXISTS "unsubscribed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "broadcast_recipient" ADD COLUMN IF NOT EXISTS "variant" text DEFAULT 'a' NOT NULL;
--> statement-breakpoint
-- One link, in one campaign, clicked by one person.
CREATE TABLE IF NOT EXISTS "broadcast_click" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "broadcast_id" text NOT NULL REFERENCES "broadcast"("id") ON DELETE cascade,
  "recipient_id" text NOT NULL REFERENCES "broadcast_recipient"("id") ON DELETE cascade,
  "url" text NOT NULL,
  "clicks" integer DEFAULT 1 NOT NULL,
  "first_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_click_unique_idx" ON "broadcast_click" ("recipient_id", "url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_click_broadcast_idx" ON "broadcast_click" ("broadcast_id");
--> statement-breakpoint
-- A series of emails sent on a clock rather than on a chosen day.
CREATE TABLE IF NOT EXISTS "automation" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "list_id" text NOT NULL REFERENCES "mailing_list"("id") ON DELETE cascade,
  "mailbox_id" text NOT NULL REFERENCES "mailbox"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "trigger" text DEFAULT 'subscribed' NOT NULL,
  "status" "automation_status" DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_org_idx" ON "automation" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_list_idx" ON "automation" ("list_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_step" (
  "id" text PRIMARY KEY NOT NULL,
  "automation_id" text NOT NULL REFERENCES "automation"("id") ON DELETE cascade,
  "position" integer NOT NULL,
  "delay_minutes" integer DEFAULT 0 NOT NULL,
  "subject" text NOT NULL,
  "html" text,
  "text" text,
  "design" jsonb
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_step_order_idx" ON "automation_step" ("automation_id", "position");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_run" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "automation_id" text NOT NULL REFERENCES "automation"("id") ON DELETE cascade,
  "list_member_id" text NOT NULL REFERENCES "list_member"("id") ON DELETE cascade,
  "step" integer DEFAULT 0 NOT NULL,
  "status" "automation_run_status" DEFAULT 'active' NOT NULL,
  "next_at" timestamp with time zone NOT NULL,
  "last_sent_at" timestamp with time zone,
  "stopped_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_run_unique_idx" ON "automation_run" ("automation_id", "list_member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_run_due_idx" ON "automation_run" ("status", "next_at");
