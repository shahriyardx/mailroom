DO $$ BEGIN
 CREATE TYPE "public"."list_member_status" AS ENUM('subscribed', 'unsubscribed', 'bounced', 'complained');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."broadcast_recipient_status" AS ENUM('pending', 'sent', 'failed', 'skipped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mailing_list" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "list_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"list_id" text NOT NULL,
	"address" text NOT NULL,
	"name" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "list_member_status" DEFAULT 'subscribed' NOT NULL,
	"consent_source" text,
	"consent_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcast" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"list_id" text NOT NULL,
	"mailbox_id" text NOT NULL,
	"subject" text NOT NULL,
	"html" text,
	"text" text,
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "broadcast_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"broadcast_id" text NOT NULL,
	"list_member_id" text NOT NULL,
	"address" text NOT NULL,
	"status" "broadcast_recipient_status" DEFAULT 'pending' NOT NULL,
	"message_id" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"opened_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mailing_list" ADD CONSTRAINT "mailing_list_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "list_member" ADD CONSTRAINT "list_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "list_member" ADD CONSTRAINT "list_member_list_id_mailing_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."mailing_list"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "broadcast" ADD CONSTRAINT "broadcast_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "broadcast" ADD CONSTRAINT "broadcast_list_id_mailing_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."mailing_list"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "broadcast" ADD CONSTRAINT "broadcast_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "broadcast_recipient" ADD CONSTRAINT "broadcast_recipient_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "broadcast_recipient" ADD CONSTRAINT "broadcast_recipient_broadcast_id_broadcast_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcast"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "broadcast_recipient" ADD CONSTRAINT "broadcast_recipient_list_member_id_list_member_id_fk" FOREIGN KEY ("list_member_id") REFERENCES "public"."list_member"("id") ON DELETE cascade ON UPDATE no action;
 ALTER TABLE "broadcast_recipient" ADD CONSTRAINT "broadcast_recipient_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailing_list_org_idx" ON "mailing_list" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "list_member_list_address_idx" ON "list_member" USING btree ("list_id","address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_member_org_idx" ON "list_member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_member_sendable_idx" ON "list_member" USING btree ("list_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_org_idx" ON "broadcast" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_due_idx" ON "broadcast" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_recipient_unique_idx" ON "broadcast_recipient" USING btree ("broadcast_id","list_member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_recipient_pending_idx" ON "broadcast_recipient" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "broadcast_recipient_org_idx" ON "broadcast_recipient" USING btree ("organization_id");
