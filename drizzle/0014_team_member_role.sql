ALTER TABLE "team_member" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'member' NOT NULL;
