ALTER TABLE "member" ADD COLUMN IF NOT EXISTS "default_mailbox_id" text;--> statement-breakpoint
-- Left unset on purpose: without a choice of their own, a person falls back
-- to the instance default, which is what they had before.
