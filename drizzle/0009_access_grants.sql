CREATE TABLE IF NOT EXISTS "access_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"can_read" boolean DEFAULT true NOT NULL,
	"can_send" boolean DEFAULT false NOT NULL,
	"can_manage" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "access_grant_idx" ON "access_grant" ("subject_type","subject_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_grant_org_idx" ON "access_grant" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_grant_subject_idx" ON "access_grant" ("subject_type","subject_id");
--> statement-breakpoint
-- Columns better-auth's organisation plugin keeps for itself.
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "active_organization_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "active_team_id" text;--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "member_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "team_member" ADD COLUMN IF NOT EXISTS "membership_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_member_membership_key_idx" ON "team_member" ("membership_key");--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Keep the count honest for teams that already have people in them.
UPDATE "team" t SET "member_count" = (SELECT count(*) FROM "team_member" tm WHERE tm."team_id" = t."id");
