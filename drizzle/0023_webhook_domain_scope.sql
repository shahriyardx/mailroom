-- A webhook could be pinned to one mailbox or left open to the whole account,
-- with nothing in between. An account sending for several domains had to make
-- one endpoint per mailbox to hear about a single domain.
ALTER TABLE "webhook" ADD COLUMN IF NOT EXISTS "domain_id" text
  REFERENCES "domain"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "webhook_domain_idx" ON "webhook" ("domain_id");
