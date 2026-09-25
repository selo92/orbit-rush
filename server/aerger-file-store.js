/**
 * JSON-file room store for the local Express API.
 * Same optimistic version check as D1. One process, one file.
 */
import fs from 'fs';
import path from 'path';

export function createFileAergerStore(filePath) {
  const file = filePath;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let rooms = {};
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      rooms = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      rooms = {};
    }
  }

  let queue = Promise.resolve();
  function lock(fn) {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  function persist() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rooms));
    fs.renameSync(tmp, file);
  }

  return {
    async get(code) {
      const room = rooms[code];
      return room ? structuredClone(room) : null;
    },

    async insert(room) {
      return lock(() => {
        if (rooms[room.code]) return false;
        rooms[room.code] = structuredClone(room);
        persist();
        return true;
      });
    },

    async cas(code, expectedVersion, state, now) {
      return lock(() => {
        const room = rooms[code];
        if (!room || room.version !== expectedVersion) return false;
        rooms[code] = {
          ...room,
          version: expectedVersion + 1,
          state: structuredClone(state),
          updatedAt: now,
        };
        persist();
        return true;
      });
    },

    async remove(code) {
      return lock(() => {
        if (!rooms[code]) return;
        delete rooms[code];
        persist();
      });
    },

    async deleteExpired(cutoff) {
      return lock(() => {
        let removed = 0;
        for (const [code, room] of Object.entries(rooms)) {
          if (room.updatedAt < cutoff) {
            delete rooms[code];
            removed += 1;
            if (removed >= 4) break;
          }
        }
        if (removed) persist();
      });
    },
  };
}
