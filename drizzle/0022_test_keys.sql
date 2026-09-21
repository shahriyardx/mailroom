-- A key that runs the whole send path and stops short of SES, so a receiver
-- can be pointed at a real send that never leaves the building.
ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'live' NOT NULL;
