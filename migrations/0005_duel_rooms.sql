-- Orbit Duel rooms. Separate from scores and from aerger_rooms.
-- One row per room. `state` is the JSON blob. `version` is the optimistic-concurrency token.
-- Clients poll GET /api/duel/room/:code. Live rallies always return the projected ball.
-- Idle rooms are deleted on access after a few hours.
CREATE TABLE IF NOT EXISTS duel_rooms (
  code TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_duel_rooms_updated ON duel_rooms (updated_at);
