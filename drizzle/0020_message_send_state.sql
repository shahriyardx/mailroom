-- A scheduled message is one that exists and is not due yet, and a test one
-- never had anywhere to go. Both are states the message row has to carry.
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_scheduled_idx" ON "message" ("scheduled_at");--> statement-breakpoint
-- A scheduled send that was called off is not a failure, and saying it failed
-- would put it in every report of things that went wrong.
ALTER TYPE "delivery_status" ADD VALUE IF NOT EXISTS 'canceled';
