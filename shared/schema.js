/**
 * D1 / SQLite statements.
 * migrations/0001_init.sql is the original table (no client_id, no game).
 * migrations/0002_client_id.sql adds nullable scores.client_id.
 * migrations/0003_game.sql adds scores.game, default 'rush' for existing rows.
 * CREATE below is the full fresh schema. worker/api.js ALTERs legacy tables.
 */

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS scores (
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
    client_key TEXT NOT NULL,
    client_id TEXT,
    game TEXT NOT NULL DEFAULT 'rush'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (score DESC, ts ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (mode, difficulty, daily_date, score DESC, ts ASC)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    client_key TEXT PRIMARY KEY,
    last_submit_ts INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL DEFAULT 0,
    hit_count INTEGER NOT NULL DEFAULT 0
  )`,
];

/** Applied after legacy tables gain client_id. Safe to run more than once. */
export const CLIENT_ID_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_scores_client_id ON scores (client_id)';

/** Applied after legacy tables gain game. Safe to run more than once. */
export const GAME_INDEX_SQL =
  'CREATE INDEX IF NOT EXISTS idx_scores_game_board ON scores (game, mode, difficulty, daily_date, score DESC, ts ASC)';
