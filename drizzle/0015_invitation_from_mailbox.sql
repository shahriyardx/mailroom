ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "from_mailbox_id" text;--> statement-breakpoint
-- Which address the invitation was sent from, so resending it comes from the
-- same place. Null means whatever the instance default is at the time.
