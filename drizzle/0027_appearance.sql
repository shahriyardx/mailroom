CREATE TABLE IF NOT EXISTS "preference" (
  "user_id" text PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
  "theme" text NOT NULL DEFAULT 'dark',
  "density" text NOT NULL DEFAULT 'comfortable',
  "reading_layout" text NOT NULL DEFAULT 'split',
  "nav_collapsed" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
