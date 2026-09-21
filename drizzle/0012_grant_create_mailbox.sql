ALTER TABLE "access_grant" ADD COLUMN IF NOT EXISTS "can_create_mailbox" boolean DEFAULT false NOT NULL;
