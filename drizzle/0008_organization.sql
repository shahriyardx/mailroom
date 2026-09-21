-- One company owns the instance. Everything that belonged to the first user
-- becomes the company's, and that user becomes its owner.

CREATE TABLE IF NOT EXISTS "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_org_user_idx" ON "member" ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_user_idx" ON "member" ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"email" text NOT NULL,
	"role" text,
	"team_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "invitation" ("email");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
	"is_root" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_org_idx" ON "team" ("organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL REFERENCES "team"("id") ON DELETE cascade,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_member_idx" ON "team_member" ("team_id","user_id");--> statement-breakpoint

-- The company, named after whoever set the instance up.
INSERT INTO "organization" ("id", "name", "slug")
SELECT 'org_bootstrap', COALESCE(NULLIF(u."name", ''), 'Mailroom'), 'mailroom'
FROM "user" u ORDER BY u."created_at" LIMIT 1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "team" ("id", "name", "organization_id", "is_root")
SELECT 'team_root', 'Root', o."id", true FROM "organization" o LIMIT 1
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "member" ("id", "organization_id", "user_id", "role")
SELECT 'mem_' || u."id", o."id", u."id", 'owner'
FROM "user" u CROSS JOIN "organization" o
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "team_member" ("id", "team_id", "user_id")
SELECT 'tmem_' || u."id", t."id", u."id"
FROM "user" u CROSS JOIN "team" t WHERE t."is_root"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
UPDATE "domain" SET "organization_id" = (SELECT "id" FROM "organization" LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "domain" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "domain" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "domain" DROP CONSTRAINT IF EXISTS "domain_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "domain" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "domain" ADD CONSTRAINT "domain_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
UPDATE "mailbox" SET "organization_id" = (SELECT "id" FROM "organization" LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "mailbox" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" DROP CONSTRAINT IF EXISTS "mailbox_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "mailbox" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
UPDATE "label" SET "organization_id" = (SELECT "id" FROM "organization" LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "label" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "label" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "label" DROP CONSTRAINT IF EXISTS "label_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "label" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
UPDATE "contact" SET "organization_id" = (SELECT "id" FROM "organization" LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "contact" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "contact" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" DROP CONSTRAINT IF EXISTS "contact_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "suppression" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
UPDATE "suppression" SET "organization_id" = (SELECT "id" FROM "organization" LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "suppression" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "suppression" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "suppression" DROP CONSTRAINT IF EXISTS "suppression_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "suppression" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "integration" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
UPDATE "integration" SET "organization_id" = (SELECT "id" FROM "organization" LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "integration" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "integration" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integration" DROP CONSTRAINT IF EXISTS "integration_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "integration" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "integration" ADD CONSTRAINT "integration_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
UPDATE "api_key" SET "organization_id" = (SELECT "id" FROM "organization" LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "api_key" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" DROP CONSTRAINT IF EXISTS "api_key_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "api_key" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "filter_rule" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
UPDATE "filter_rule" SET "organization_id" = (SELECT "id" FROM "organization" LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
DELETE FROM "filter_rule" WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "filter_rule" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "filter_rule" DROP CONSTRAINT IF EXISTS "filter_rule_user_id_user_id_fk";--> statement-breakpoint
ALTER TABLE "filter_rule" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "filter_rule" ADD CONSTRAINT "filter_rule_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
