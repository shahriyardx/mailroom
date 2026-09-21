ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "token_hash" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_token_idx" ON "invitation" ("token_hash");
