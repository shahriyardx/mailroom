-- Moving ownership to the organisation dropped user_id, and with it the unique
-- indexes that were defined on it. Every upsert that names those constraints
-- has been failing since: recording a contact, importing a domain, creating a
-- label, suppressing a bounced address, and saving the Cloudflare token.
--
-- Duplicates are removed first, keeping the earliest of each, since rows could
-- have been written while nothing enforced uniqueness.

DELETE FROM "contact" a USING "contact" b
 WHERE a."organization_id" = b."organization_id"
   AND a."address" = b."address"
   AND a."ctid" > b."ctid";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_org_address_idx"
    ON "contact" ("organization_id","address");
--> statement-breakpoint

DELETE FROM "domain" a USING "domain" b
 WHERE a."organization_id" = b."organization_id"
   AND a."name" = b."name"
   AND a."ctid" > b."ctid";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "domain_org_name_idx"
    ON "domain" ("organization_id","name");
--> statement-breakpoint

DELETE FROM "label" a USING "label" b
 WHERE a."organization_id" = b."organization_id"
   AND a."name" = b."name"
   AND a."ctid" > b."ctid";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "label_org_name_idx"
    ON "label" ("organization_id","name");
--> statement-breakpoint

DELETE FROM "suppression" a USING "suppression" b
 WHERE a."organization_id" = b."organization_id"
   AND a."address" = b."address"
   AND a."ctid" > b."ctid";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppression_org_address_idx"
    ON "suppression" ("organization_id","address");
--> statement-breakpoint

DELETE FROM "integration" a USING "integration" b
 WHERE a."organization_id" = b."organization_id"
   AND a."provider" = b."provider"
   AND a."ctid" > b."ctid";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_org_provider_idx"
    ON "integration" ("organization_id","provider");
--> statement-breakpoint

-- Non-unique indexes that went the same way.
CREATE INDEX IF NOT EXISTS "domain_org_idx" ON "domain" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mailbox_org_idx" ON "mailbox" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_org_idx" ON "api_key" ("organization_id");
