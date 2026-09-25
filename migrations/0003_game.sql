-- Split Orbit Rush and Orbit Mirror leaderboards.
-- Existing rows are Rush. SQLite fills the default on ADD COLUMN.
ALTER TABLE scores ADD COLUMN game TEXT NOT NULL DEFAULT 'rush';

CREATE INDEX IF NOT EXISTS idx_scores_game_board
  ON scores (game, mode, difficulty, daily_date, score DESC, ts ASC);
