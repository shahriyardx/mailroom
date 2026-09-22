CREATE TABLE IF NOT EXISTS "forward_address" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"address" text NOT NULL,
	"destination_id" text,
	"verified_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forward_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"address_id" text NOT NULL,
	"domain_id" text,
	"mailbox_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN IF NOT EXISTS "forward_off" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN IF NOT EXISTS "forward_off" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forward_address" ADD CONSTRAINT "forward_address_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forward_rule" ADD CONSTRAINT "forward_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forward_rule" ADD CONSTRAINT "forward_rule_address_id_forward_address_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."forward_address"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forward_rule" ADD CONSTRAINT "forward_rule_domain_id_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forward_rule" ADD CONSTRAINT "forward_rule_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forward_address_org_idx" ON "forward_address" USING btree ("organization_id","address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forward_address_org_only_idx" ON "forward_address" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forward_rule_org_idx" ON "forward_rule" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forward_rule_domain_idx" ON "forward_rule" USING btree ("domain_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forward_rule_mailbox_idx" ON "forward_rule" USING btree ("mailbox_id");
