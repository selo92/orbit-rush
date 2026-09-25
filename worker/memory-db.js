/**
 * D1-shaped wrapper around node:sqlite for local contract tests.
 * Not imported by the Worker bundle.
 */
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_STATEMENTS } from '../shared/schema.js';

export function createMemoryDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of SCHEMA_STATEMENTS) sqlite.exec(sql);

  function wrap(sql) {
    return {
      bind(...params) {
        const stmt = sqlite.prepare(sql);
        return {
          async all() {
            return { results: stmt.all(...params) };
          },
          async first() {
            return stmt.get(...params) ?? null;
          },
          async run() {
            const info = stmt.run(...params);
            return { success: true, meta: { changes: info.changes } };
          },
        };
      },
      async run() {
        const info = sqlite.prepare(sql).run();
        return { success: true, meta: { changes: info.changes } };
      },
    };
  }

  return {
    prepare: wrap,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const statement of statements) {
          out.push(await statement.run());
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    _sqlite: sqlite,
  };
}
