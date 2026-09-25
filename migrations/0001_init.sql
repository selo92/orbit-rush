CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  survival_ms INTEGER NOT NULL DEFAULT 0,
  orbs INTEGER NOT NULL DEFAULT 0,
  combo_bonus INTEGER NOT NULL DEFAULT 0,
  near_misses INTEGER NOT NULL DEFAULT 0,
  difficulty TEXT NOT NULL,
  mode TEXT NOT NULL,
  daily_date TEXT,
  ts INTEGER NOT NULL,
  client_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC, ts ASC);

CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (mode, difficulty, daily_date, score DESC, ts ASC);

CREATE TABLE IF NOT EXISTS rate_limits (
  client_key TEXT PRIMARY KEY,
  last_submit_ts INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0
);
