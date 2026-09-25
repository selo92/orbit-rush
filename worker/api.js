/**
 * Production /api/scores handler. Persistence is a D1-compatible database
 * (prepare/bind/first/all/run/batch). Same JSON contract as server/index.js.
 */
import { SCHEMA_STATEMENTS } from '../shared/schema.js';
import {
  RATE_MAX,
  RATE_WINDOW_MS,
  MIN_MS_BETWEEN_SUBMITS,
  STORE_CAP,
  validatePostBody,
  validateScoresQuery,
  hashClientKey,
  boardQueryForPost,
  rankOf,
} from '../shared/scores.js';

let schemaReady = false;

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
  const where = [];
  const params = [];
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
  const sql = `SELECT name, score, ts, difficulty, mode, daily_date AS dailyDate
    FROM scores
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
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
         difficulty, mode, daily_date, ts, client_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      key
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

export async function handleApi(request, db) {
  const url = new URL(request.url);
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

  let hits = 0;
  try {
    hits = await bumpRateLimit(db, key, now);
  } catch (err) {
    console.error('rate', err);
    return json({ error: 'Server error' }, 500, request);
  }
  if (hits > RATE_MAX) {
    return json({ error: 'Too many requests' }, 429, request);
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json({ ok: true, service: 'orbit-rush-api', version: '1.3', storage: 'd1' }, 200, request);
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
      },
      200,
      request
    );
  }

  if (request.method === 'POST' && url.pathname === '/api/scores') {
    const len = Number(request.headers.get('content-length') || 0);
    if (len > 8192) return json({ error: 'Payload too large' }, 413, request);
    let body;
    try {
      const text = await request.text();
      if (text.length > 8192) return json({ error: 'Payload too large' }, 413, request);
      body = text ? JSON.parse(text) : {};
    } catch {
      return json({ error: 'Invalid JSON' }, 400, request);
    }

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

    const dup = await findDuplicate(db, value, key, now);
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
}
