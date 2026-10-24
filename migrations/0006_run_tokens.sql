-- Server-issued score runs. Does not read or change existing score rows.
CREATE TABLE IF NOT EXISTS app_secrets (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  mode TEXT NOT NULL,
  daily_date TEXT,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_expires ON runs (expires_at);
