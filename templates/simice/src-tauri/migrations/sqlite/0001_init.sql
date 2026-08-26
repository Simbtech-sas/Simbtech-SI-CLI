-- SQLite. ACID, with WAL journaling for concurrent readers alongside a writer.
--
-- These pragmas are not optional: the defaults are DELETE journaling and
-- synchronous=FULL, which is slower and blocks readers during a write. WAL plus
-- synchronous=NORMAL keeps durability against process crashes (only a machine
-- power-loss can lose the last commit) and is the standard desktop setting.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS records (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- Outbox for cloud-sync builds. Unused in standalone, and costing nothing.
  synced_at   TEXT
);

CREATE INDEX IF NOT EXISTS records_unsynced ON records (updated_at) WHERE synced_at IS NULL;

-- ── cloud-sync ──────────────────────────────────────────────────────────────
-- Present on every build. The tables cost nothing when the mode is standalone,
-- and a schema that changes with the deployment mode means a machine cannot be
-- switched to cloud-sync without a migration it has never run.

-- Local changes waiting to go up.
--
-- `batch_key` is written HERE, when the change is queued — never when it is
-- sent. That is the whole idempotency guarantee: a push that times out is
-- retried with the same key and the server returns the original result instead
-- of applying the batch twice.
CREATE TABLE IF NOT EXISTS sync_outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  payload     TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  batch_key   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_outbox_batch ON sync_outbox (batch_key, id);

-- The version this install last saw for each record.
--
-- Without it every push claims `baseVersion: 0` — "I believe this is new" — and
-- the server reads a genuine edit as a create. This table IS the conflict
-- detector's memory.
CREATE TABLE IF NOT EXISTS sync_versions (
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  PRIMARY KEY (entity, entity_id)
);

-- Conflicts the server parked for a person. Surfaced in the UI; a queue nobody
-- reads is deletion, only slower.
CREATE TABLE IF NOT EXISTS sync_conflicts (
  conflict_id TEXT PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- One row. The cursor advances only from the server's reply: the server skips
-- this install's own writes, so the sequence has holes and counting locally
-- would step straight over another machine's change.
CREATE TABLE IF NOT EXISTS sync_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  cursor       INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT,
  last_error   TEXT
);
INSERT OR IGNORE INTO sync_state (id, cursor) VALUES (1, 0);
