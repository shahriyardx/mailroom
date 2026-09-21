ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "scope_mailbox_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "scope_domain_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- A key locked to one mailbox now says so in the list. The old column stays
-- so a rollback still finds what it expects.
UPDATE "api_key"
   SET "scope_mailbox_ids" = ARRAY["mailbox_id"]
 WHERE "mailbox_id" IS NOT NULL
   AND coalesce(array_length("scope_mailbox_ids", 1), 0) = 0;
