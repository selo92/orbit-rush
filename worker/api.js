/**
 * Production /api/scores handler. Persistence is a D1-compatible database
 * (prepare/bind/first/all/run/batch). Same JSON contract as server/index.js.
 */
import { CLIENT_ID_INDEX_SQL, GAME_INDEX_SQL, SCHEMA_STATEMENTS } from '../shared/schema.js';
import { handleAerger } from './aerger-api.js';
import { createD1AergerStore } from './aerger-store.js';
import { handleDuel } from './duel-api.js';
import { createD1DuelStore } from './duel-store.js';
import {
  RATE_MAX,
  START_RATE_MAX,
  RATE_WINDOW_MS,
  MIN_MS_BETWEEN_SUBMITS,
  STORE_CAP,
  RUN_MAX_AGE_MS,
  validatePostBody,
  validateScoresQuery,
  normalizeRunRequest,
  hashClientKey,
  boardQueryForPost,
  rankOf,
  normalizeGame,
  evaluateStoredRun,
} from '../shared/scores.js';
import { readEnvRunSecret, signRunToken, verifyRunToken } from '../shared/run-token.js';

let schemaReady = false;
let cachedRunSecret = null;

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  else headers['Access-Control-Allow-Origin'] = '*';
  return headers;
}

function json(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  });
}

function empty(status, request) {
  return new Response(null, { status, headers: corsHeaders(request) });
}

export function clientIpFromRequest(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

function rowsOf(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.results)) return result.results;
  return [];
}

async function ensureClientIdColumn(db) {
  let hasColumn = false;
  try {
    const info = await db.prepare('PRAGMA table_info(scores)').all();
    hasColumn = rowsOf(info).some((row) => row.name === 'client_id');
  } catch (err) {
    console.error('pragma scores', err);
  }
  if (!hasColumn) {
    try {
      await db.prepare('ALTER TABLE scores ADD COLUMN client_id TEXT').run();
    } catch (err) {
      const msg = String(err?.message || err);
      if (!/duplicate column/i.test(msg)) throw err;
    }
  }
  await db.prepare(CLIENT_ID_INDEX_SQL).run();
}

async function ensureGameColumn(db) {
  let hasColumn = false;
  try {
    const info = await db.prepare('PRAGMA table_info(scores)').all();
    hasColumn = rowsOf(info).some((row) => row.name === 'game');
  } catch (err) {
    console.error('pragma scores game', err);
  }
  if (!hasColumn) {
    try {
      await db.prepare("ALTER TABLE scores ADD COLUMN game TEXT NOT NULL DEFAULT 'rush'").run();
    } catch (err) {
      const msg = String(err?.message || err);
      if (!/duplicate column/i.test(msg)) throw err;
    }
  }
  try {
    await db.prepare("UPDATE scores SET game = 'rush' WHERE game IS NULL OR game = ''").run();
  } catch (err) {
    console.error('backfill game', err);
  }
  await db.prepare(GAME_INDEX_SQL).run();
}

async function ensureSchema(db) {
  if (schemaReady) return;
  if (!db?.prepare) throw new Error('D1 binding DB is missing');
  if (typeof db.batch === 'function') {
    await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
  } else {
    for (const sql of SCHEMA_STATEMENTS) {
      await db.prepare(sql).run();
    }
  }
  await ensureClientIdColumn(db);
  await ensureGameColumn(db);
  schemaReady = true;
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    name: row.name,
    score: row.score,
    survivalMs: row.survival_ms,
    orbs: row.orbs,
    comboBonus: row.combo_bonus,
    nearMisses: row.near_misses,
    difficulty: row.difficulty,
    mode: row.mode,
    dailyDate: row.daily_date || null,
    ts: row.ts,
    key: row.client_key,
  };
}

async function bumpRateLimit(db, key, now) {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (client_key, last_submit_ts, window_start, hit_count)
       VALUES (?, 0, ?, 1)
       ON CONFLICT(client_key) DO UPDATE SET
         window_start = CASE
           WHEN rate_limits.window_start <= ? - ${RATE_WINDOW_MS} THEN ?
           ELSE rate_limits.window_start
         END,
         hit_count = CASE
           WHEN rate_limits.window_start <= ? - ${RATE_WINDOW_MS} THEN 1
           ELSE rate_limits.hit_count + 1
         END
       RETURNING hit_count`
    )
    .bind(key, now, now, now, now)
    .first();
  const hits = Number(row?.hit_count ?? row?.results?.[0]?.hit_count ?? 0);
  return hits;
}

async function listBoard(db, query) {
  const where = [`COALESCE(game, 'rush') = ?`];
  const params = [normalizeGame(query.game)];
  if (query.mode === 'daily') {
    where.push(`mode = 'daily'`);
    if (query.dailyDate) {
      where.push('daily_date = ?');
      params.push(query.dailyDate);
    }
  } else if (query.mode === 'normal' || query.difficulty) {
    where.push(`mode != 'daily'`);
    if (query.difficulty) {
      where.push('difficulty = ?');
      params.push(query.difficulty);
    }
  }
  const sql = `SELECT name, score, ts, difficulty, mode, daily_date AS dailyDate, client_id AS clientId, game
    FROM scores
    WHERE ${where.join(' AND ')}
    ORDER BY score DESC, ts ASC
    LIMIT 50`;
  const result = await db.prepare(sql).bind(...params).all();
  const rows = result?.results || [];
  return rows.map((e, i) => ({
    rank: i + 1,
    name: e.name,
    score: e.score,
    ts: e.ts,
    difficulty: e.difficulty,
    mode: e.mode === 'daily' ? 'daily' : 'normal',
    dailyDate: e.dailyDate || null,
    clientId: e.clientId || e.client_id || null,
    game: normalizeGame(e.game),
  }));
}

async function findDuplicate(db, value, key, now) {
  const row = await db
    .prepare(
      `SELECT name, score, ts, difficulty, mode, daily_date AS dailyDate, client_key
       FROM scores
       WHERE name = ?
         AND score = ?
         AND client_key = ?
         AND difficulty = ?
         AND mode = ?
         AND (
           (? IS NULL AND daily_date IS NULL) OR daily_date = ?
         )
         AND COALESCE(game, 'rush') = ?
         AND ts > ?
       ORDER BY ts DESC
       LIMIT 1`
    )
    .bind(
      value.name,
      value.score,
      key,
      value.difficulty,
      value.mode,
      value.dailyDate,
      value.dailyDate,
      normalizeGame(value.game),
      now - 10_000
    )
    .first();
  if (!row) return null;
  return {
    name: row.name,
    score: row.score,
    ts: row.ts,
    difficulty: row.difficulty,
    mode: row.mode,
    dailyDate: row.dailyDate || null,
    key: row.client_key,
  };
}

async function insertAndTrim(db, value, key, now) {
  const insert = db
    .prepare(
      `INSERT INTO scores (
         name, score, survival_ms, orbs, combo_bonus, near_misses,
         difficulty, mode, daily_date, ts, client_key, client_id, game
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      value.name,
      value.score,
      value.survivalMs,
      value.orbs,
      value.comboBonus,
      value.nearMisses,
      value.difficulty,
      value.mode,
      value.dailyDate,
      now,
      key,
      value.clientId || null,
      normalizeGame(value.game)
    );
  const trim = db.prepare(
    `DELETE FROM scores WHERE id NOT IN (
       SELECT id FROM scores ORDER BY score DESC, ts ASC LIMIT ${STORE_CAP}
     )`
  );
  if (typeof db.batch === 'function') {
    await db.batch([insert, trim]);
  } else {
    await insert.run();
    await trim.run();
  }
}

async function touchSubmit(db, key, now) {
  await db.prepare(`UPDATE rate_limits SET last_submit_ts = ? WHERE client_key = ?`).bind(now, key).run();
}

function changesOf(result) {
  const n = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function runSecret(db, env) {
  const fromEnv = readEnvRunSecret(env);
  if (!fromEnv.ok) {
    const err = new Error(fromEnv.error);
    err.status = 500;
    throw err;
  }
  if (fromEnv.secret) return fromEnv.secret;
  if (cachedRunSecret) return cachedRunSecret;
  const existing = await db.prepare(`SELECT value FROM app_secrets WHERE id = ?`).bind('run_hmac').first();
  if (existing?.value) {
    cachedRunSecret = String(existing.value);
    return cachedRunSecret;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO app_secrets (id, value, created_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .bind('run_hmac', value, now)
    .run();
  const row = await db.prepare(`SELECT value FROM app_secrets WHERE id = ?`).bind('run_hmac').first();
  if (!row?.value) throw new Error('run secret missing');
  cachedRunSecret = String(row.value);
  return cachedRunSecret;
}

function mapRunRow(row) {
  if (!row) return null;
  return {
    game: row.game,
    difficulty: row.difficulty,
    mode: row.mode,
    dailyDate: row.daily_date || null,
    startedAt: Number(row.started_at),
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at == null ? null : Number(row.consumed_at),
    fingerprint: row.fingerprint || null,
  };
}

async function loadRun(db, runId) {
  const row = await db
    .prepare(
      `SELECT game, difficulty, mode, daily_date, started_at, expires_at, consumed_at, fingerprint
       FROM runs WHERE run_id = ?`
    )
    .bind(runId)
    .first();
  return mapRunRow(row);
}

async function consumeRun(db, runId, now, fingerprint) {
  const result = await db
    .prepare(
      `UPDATE runs SET consumed_at = ?, fingerprint = ?
       WHERE run_id = ? AND consumed_at IS NULL`
    )
    .bind(now, fingerprint, runId)
    .run();
  return changesOf(result) > 0;
}

async function readJsonBody(request, limit = 8192) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > limit) return { ok: false, status: 413, error: 'Payload too large' };
  try {
    const text = await request.text();
    if (text.length > limit) return { ok: false, status: 413, error: 'Payload too large' };
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON' };
  }
}

export async function handleApi(request, db, env = {}) {
  const url = new URL(request.url);

  // Orbit Ärger polls often. Keep it off the score rate-limit row so a
  // 2s poll does not trip the 30/min leaderboard budget or write D1.
  if (url.pathname.startsWith('/api/aerger')) {
    if (request.method !== 'OPTIONS') {
      try {
        await ensureSchema(db);
      } catch (err) {
        console.error('schema', err);
        return json({ error: 'Database not configured' }, 500, request);
      }
    }
    return handleAerger(request, createD1AergerStore(db));
  }

  // Orbit Duel polls during a rally. Same idea as Ärger: not the score limiter.
  if (url.pathname.startsWith('/api/duel')) {
    if (request.method !== 'OPTIONS') {
      try {
        await ensureSchema(db);
      } catch (err) {
        console.error('schema', err);
        return json({ error: 'Database not configured' }, 500, request);
      }
    }
    return handleDuel(request, createD1DuelStore(db));
  }

  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return empty(204, request);
  }

  try {
    await ensureSchema(db);
  } catch (err) {
    console.error('schema', err);
    return json({ error: 'Database not configured' }, 500, request);
  }

  const ip = clientIpFromRequest(request);
  const key = await hashClientKey(ip);
  const now = Date.now();
  const isRunStart = request.method === 'POST' && url.pathname === '/api/run/start';

  let hits = 0;
  try {
    hits = await bumpRateLimit(db, isRunStart ? `s:${key}` : key, now);
  } catch (err) {
    console.error('rate', err);
    return json({ error: 'Server error' }, 500, request);
  }
  if (hits > (isRunStart ? START_RATE_MAX : RATE_MAX)) {
    return json({ error: 'Too many requests' }, 429, request);
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json({ ok: true, service: 'orbit-rush-api', version: '1.5', storage: 'd1' }, 200, request);
  }

  if (request.method === 'GET' && url.pathname === '/api/scores') {
    const parsed = validateScoresQuery(url.searchParams);
    if (!parsed.ok) return json({ error: parsed.error }, parsed.status, request);
    const scores = await listBoard(db, parsed);
    return json(
      {
        scores,
        difficulty: parsed.difficulty || 'all',
        mode: parsed.mode || 'all',
        dailyDate: parsed.dailyDate || null,
        game: parsed.game || 'rush',
      },
      200,
      request
    );
  }

  if (isRunStart) {
    const incoming = await readJsonBody(request, 2048);
    if (!incoming.ok) return json({ error: incoming.error }, incoming.status, request);
    const parsed = normalizeRunRequest(incoming.body);
    if (!parsed.ok) return json({ error: parsed.error }, parsed.status, request);
    let secret;
    try {
      secret = await runSecret(db, env);
    } catch (err) {
      console.error('run secret', err);
      return json({ error: 'Run signing unavailable' }, 500, request);
    }
    const runId = crypto.randomUUID();
    const { game, difficulty, mode, dailyDate } = parsed.value;
    try {
      await db.prepare(`DELETE FROM runs WHERE expires_at < ?`).bind(now).run();
      await db
        .prepare(
          `INSERT INTO runs (
             run_id, game, difficulty, mode, daily_date, started_at, expires_at, consumed_at, fingerprint
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
        )
        .bind(runId, game, difficulty, mode, dailyDate, now, now + RUN_MAX_AGE_MS)
        .run();
    } catch (err) {
      console.error('run start', err);
      return json({ error: 'Server error' }, 500, request);
    }
    const token = await signRunToken(secret, {
      id: runId,
      game,
      difficulty,
      mode,
      dailyDate,
      startedAt: now,
    });
    return json({ ok: true, runId, token, game, difficulty, mode, dailyDate, startedAt: now }, 200, request);
  }

  if (request.method === 'POST' && url.pathname === '/api/scores') {
    const incoming = await readJsonBody(request);
    if (!incoming.ok) return json({ error: incoming.error }, incoming.status, request);
    const body = incoming.body;

    const parsed = validatePostBody(body);
    if (!parsed.ok) return json({ error: parsed.error }, parsed.status, request);
    const value = parsed.value;

    const limitRow = await db
      .prepare(`SELECT last_submit_ts FROM rate_limits WHERE client_key = ?`)
      .bind(key)
      .first();
    const last = Number(limitRow?.last_submit_ts || 0);
    if (now - last < MIN_MS_BETWEEN_SUBMITS) {
      return json({ error: 'Slow down' }, 429, request);
    }

    let secret;
    try {
      secret = await runSecret(db, env);
    } catch (err) {
      console.error('run secret', err);
      return json({ error: 'Run signing unavailable' }, 500, request);
    }
    const verified = await verifyRunToken(secret, body.runToken);
    if (!verified.ok) return json({ error: verified.error }, 400, request);
    let stored = await loadRun(db, verified.claims.id);
    let verdict = evaluateStoredRun(stored, verified.claims, value, now);
    if (!verdict.ok) return json({ error: verdict.error }, verdict.status, request);
    if (!verdict.duplicate) {
      const won = await consumeRun(db, verified.claims.id, now, verdict.fingerprint);
      if (!won) {
        stored = await loadRun(db, verified.claims.id);
        verdict = evaluateStoredRun(stored, verified.claims, value, now);
        if (!verdict.ok || !verdict.duplicate) {
          return json({ error: verdict.error || 'Run already submitted' }, 400, request);
        }
      }
    }

    const dup = verdict.duplicate ? { ts: stored?.consumedAt || now } : await findDuplicate(db, value, key, now);
    const board = boardQueryForPost(value);
    if (dup) {
      await touchSubmit(db, key, now);
      const scores = await listBoard(db, board);
      return json(
        {
          ok: true,
          duplicate: true,
          rank: rankOf(scores, { name: value.name, score: value.score, ts: dup.ts }),
          scores,
        },
        200,
        request
      );
    }

    await insertAndTrim(db, value, key, now);
    await touchSubmit(db, key, now);
    const scores = await listBoard(db, board);
    return json(
      {
        ok: true,
        rank: rankOf(scores, { name: value.name, score: value.score, ts: now }),
        scores,
      },
      200,
      request
    );
  }

  return json({ error: 'Not found' }, 404, request);
}

/** Test helper: schema flag is per-isolate; reset between memory databases. */
export function resetSchemaForTests() {
  schemaReady = false;
  cachedRunSecret = null;
}
