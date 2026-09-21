-- A saved subject and body with holes in it, so the wording of a receipt can
-- change without a deploy of whatever service sends it.
CREATE TABLE IF NOT EXISTS "template" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "subject" text DEFAULT '' NOT NULL,
  "html" text,
  "text" text,
  "created_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "template" ADD CONSTRAINT "template_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "template" ADD CONSTRAINT "template_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "template_slug_idx" ON "template" ("organization_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "template_org_idx" ON "template" ("organization_id");
