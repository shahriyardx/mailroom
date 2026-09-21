-- A message that exists and has not gone out yet: one SES could not take,
-- or one that is not due until later.
DO $$ BEGIN
  CREATE TYPE "send_job_status" AS ENUM ('pending', 'sending', 'sent', 'failed', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "send_job" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "message_id" text NOT NULL,
  "mailbox_id" text NOT NULL,
  "from_address" text NOT NULL,
  "recipients" text[] DEFAULT '{}'::text[] NOT NULL,
  "raw_mime" text NOT NULL,
  "status" "send_job_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 8 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "send_job" ADD CONSTRAINT "send_job_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "send_job" ADD CONSTRAINT "send_job_message_id_message_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "send_job" ADD CONSTRAINT "send_job_mailbox_id_mailbox_id_fk"
    FOREIGN KEY ("mailbox_id") REFERENCES "mailbox"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "send_job_due_idx" ON "send_job" ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "send_job_message_idx" ON "send_job" ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "send_job_org_idx" ON "send_job" ("organization_id");
