ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "mailed_by" text;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "signed_by" text;
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "tls" text;
