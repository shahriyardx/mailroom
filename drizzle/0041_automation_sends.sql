ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "exit_segment_id" text;
--> statement-breakpoint
ALTER TABLE "automation" ADD COLUMN IF NOT EXISTS "exit_event_name" text;
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_exit_segment_id_segment_id_fk" FOREIGN KEY ("exit_segment_id") REFERENCES "segment"("id") ON DELETE set null;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_send" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "automation_id" text NOT NULL REFERENCES "automation"("id") ON DELETE cascade,
  "node_id" text REFERENCES "automation_node"("id") ON DELETE set null,
  "list_member_id" text NOT NULL REFERENCES "list_member"("id") ON DELETE cascade,
  "message_id" text REFERENCES "message"("id") ON DELETE set null,
  "address" text NOT NULL,
  "subject" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "opened_at" timestamp with time zone,
  "clicked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_send_person_idx" ON "automation_send" ("automation_id","list_member_id","sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_send_node_idx" ON "automation_send" ("node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_send_message_idx" ON "automation_send" ("message_id");
