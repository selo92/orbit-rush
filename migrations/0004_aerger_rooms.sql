-- Orbit Ärger rooms. Separate from scores so Rush/Mirror leaderboards stay untouched.
-- One row per room. `state` is the JSON blob. `version` is the optimistic-concurrency token.
-- Clients poll GET /api/aerger/room/:code. Unchanged polls use If-None-Match (304)
-- or ?since=version (tiny JSON). Idle rooms are deleted on access after a few hours.
CREATE TABLE IF NOT EXISTS aerger_rooms (
  code TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aerger_rooms_updated ON aerger_rooms (updated_at);
