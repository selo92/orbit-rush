/**
 * D1 access for Orbit Ärger rooms.
 * One row per room: JSON state + version + timestamps.
 * Optimistic concurrency is `UPDATE ... WHERE version = ?`.
 * Not used for Rush/Mirror scores. Table SQL lives in shared/schema.js.
 */

function changesOf(result) {
  const n = result?.meta?.changes ?? result?.changes ?? 0;
  return Number(n) || 0;
}

function parseRoom(row) {
  if (!row) return null;
  let state = row.state;
  if (typeof state === 'string') {
    try {
      state = JSON.parse(state);
    } catch {
      return null;
    }
  }
  if (!state || typeof state !== 'object') return null;
  return {
    code: row.code,
    version: Number(row.version),
    state,
    updatedAt: Number(row.updated_at),
    createdAt: Number(row.created_at),
  };
}

export function createD1AergerStore(db) {
  return {
    async get(code) {
      const row = await db
        .prepare(
          `SELECT code, version, state, updated_at, created_at FROM aerger_rooms WHERE code = ?`
        )
        .bind(code)
        .first();
      return parseRoom(row);
    },

    async insert(room) {
      try {
        const result = await db
          .prepare(
            `INSERT INTO aerger_rooms (code, version, state, updated_at, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(room.code, room.version, JSON.stringify(room.state), room.updatedAt, room.createdAt)
          .run();
        return changesOf(result) > 0;
      } catch (err) {
        const msg = String(err?.message || err);
        if (/unique|constraint/i.test(msg)) return false;
        throw err;
      }
    },

    async cas(code, expectedVersion, state, now) {
      const result = await db
        .prepare(
          `UPDATE aerger_rooms
           SET state = ?, version = ?, updated_at = ?
           WHERE code = ? AND version = ?`
        )
        .bind(JSON.stringify(state), expectedVersion + 1, now, code, expectedVersion)
        .run();
      return changesOf(result) > 0;
    },

    async remove(code) {
      await db.prepare(`DELETE FROM aerger_rooms WHERE code = ?`).bind(code).run();
    },

    async deleteExpired(cutoff) {
      await db
        .prepare(
          `DELETE FROM aerger_rooms WHERE code IN (
             SELECT code FROM aerger_rooms WHERE updated_at < ? LIMIT 4
           )`
        )
        .bind(cutoff)
        .run();
    },
  };
}
