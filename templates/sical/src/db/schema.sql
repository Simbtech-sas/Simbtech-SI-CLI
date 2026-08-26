-- The whole schema, applied on first run. Migrations are numbered files in
-- src/db/migrations and applied in order; this is migration 0000.
--
-- No tenant_id and no RLS: there is one user, on one machine, with no server.
-- Row-level security exists to constrain a shared server, and there isn't one.

CREATE TABLE IF NOT EXISTS notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_updated_idx ON notes (updated_at DESC);
