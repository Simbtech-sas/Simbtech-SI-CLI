-- Postgres, for a LAN deployment where several machines share one dataset.
-- SQLite over a network share corrupts: its locking assumes a local filesystem.

CREATE TABLE IF NOT EXISTS records (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  synced_at   timestamptz
);

CREATE INDEX IF NOT EXISTS records_unsynced ON records (updated_at) WHERE synced_at IS NULL;

-- ── cloud-sync ──────────────────────────────────────────────────────────────
-- Same tables as the SQLite build. Present on every deployment mode, because a
-- schema that varies with the mode means a machine cannot be switched to
-- cloud-sync without a migration it has never run.
CREATE TABLE IF NOT EXISTS sync_outbox (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  payload     JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Written when the change is QUEUED, not when it is sent: a retried push
  -- replays the same key and the server deduplicates it.
  batch_key   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_outbox_batch ON sync_outbox (batch_key, id);

CREATE TABLE IF NOT EXISTS sync_versions (
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  version    BIGINT NOT NULL,
  PRIMARY KEY (entity, entity_id)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sync_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  cursor       BIGINT NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  last_error   TEXT
);
INSERT INTO sync_state (id, cursor) VALUES (1, 0) ON CONFLICT DO NOTHING;
