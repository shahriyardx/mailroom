CREATE TABLE IF NOT EXISTS "workspace" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"inbox_enabled" boolean DEFAULT true NOT NULL,
	"campaigns_enabled" boolean DEFAULT false NOT NULL,
	"brand_name" text,
	"brand_logo" text,
	"brand_accent" text,
	"setup_completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- An instance upgrading has already been set up by hand, so it must not be
-- sent back to the wizard. A fresh install has no organisation yet and so
-- gets no row here, which is what makes the wizard appear for it alone.
INSERT INTO "workspace" ("organization_id", "setup_completed_at")
SELECT "id", now() FROM "organization"
ON CONFLICT ("organization_id") DO NOTHING;
