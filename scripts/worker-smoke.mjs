/**
 * Contract test for the D1 leaderboard handler (no Cloudflare account required).
 * Uses an in-memory SQLite database with the same SQL the Worker runs.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMemoryDb } from '../worker/memory-db.js';
import { handleApi, resetSchemaForTests } from '../worker/api.js';
import { selectBoard } from '../shared/scores.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function computeScore(survivalMs, orbs, comboBonus = 0, nearMisses = 0) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  return t * 10 + o * 100 + cb + nm * 75;
}

resetSchemaForTests();
const db = createMemoryDb();

const migration = fs.readFileSync(path.join(root, 'migrations', '0001_init.sql'), 'utf8');
for (const table of ['scores', 'rate_limits', 'client_key', 'daily_date']) {
  assert(migration.includes(table), `migration mentions ${table}`);
}

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const url = `http://127.0.0.1${req.url}`;
    const method = req.method || 'GET';
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      if (k === 'content-length' || k === 'transfer-encoding') continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && raw.length > 0;
    const request = new Request(url, {
      method,
      headers,
      body: hasBody ? raw : undefined,
    });
    const response = await handleApi(request, db);
    const buf = Buffer.from(await response.arrayBuffer());
    const outHeaders = {};
    response.headers.forEach((value, key) => {
      outHeaders[key] = value;
    });
    res.writeHead(response.status, outHeaders);
    res.end(buf);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function api(pathname, { method = 'GET', body, ip = '203.0.113.10' } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      'CF-Connecting-IP': ip,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

try {
  const health = await api('/api/health');
  assert(health.status === 200, 'health status');
  assert(health.data.version === '1.3', 'health version');
  assert(health.data.storage === 'd1', 'health storage');

  const survivalMs = 32000;
  const orbs = 2;
  const comboBonus = 50;
  const nearMisses = 1;
  const score = computeScore(survivalMs, orbs, comboBonus, nearMisses);

  const post = await api('/api/scores', {
    method: 'POST',
    body: {
      name: '<b>Smoke Bot</b>',
      score,
      survivalMs,
      orbs,
      comboBonus,
      nearMisses,
      difficulty: 'schwer',
      mode: 'normal',
    },
  });
  assert(post.status === 200, `post failed ${post.status} ${JSON.stringify(post.data)}`);
  assert(post.data.scores.some((s) => s.name === 'bSmoke Botb' && s.difficulty === 'schwer'), 'sanitized name');

  const again = await api('/api/scores', {
    method: 'POST',
    body: {
      name: 'Smoke Bot',
      score,
      survivalMs,
      orbs,
      comboBonus,
      nearMisses,
      difficulty: 'schwer',
    },
  });
  assert(again.status === 429, `expected slow-down, got ${again.status}`);
  assert(again.data.error === 'Slow down', 'slow down message');

  const badDiff = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.11',
    body: { name: 'HaxDiff', score: 10, survivalMs: 1000, orbs: 0, difficulty: 'nightmare' },
  });
  assert(badDiff.status === 400, 'invalid difficulty rejected');

  const bad = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.12',
    body: { name: 'Hax', score: 9999999, survivalMs: 1000, orbs: 0 },
  });
  assert(bad.status === 400, 'absurd score rejected');

  const badCombo = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.13',
    body: {
      name: 'Hax2',
      score: 5000,
      survivalMs: 1000,
      orbs: 1,
      comboBonus: 0,
      nearMisses: 0,
      difficulty: 'baba',
    },
  });
  assert(badCombo.status === 400, 'inconsistent score rejected');

  const babaScore = computeScore(15000, 1, 0, 0);
  const babaPost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.14',
    body: {
      name: 'BabaPilot',
      score: babaScore,
      survivalMs: 15000,
      orbs: 1,
      comboBonus: 0,
      nearMisses: 0,
      difficulty: 'baba',
      mode: 'normal',
    },
  });
  assert(babaPost.status === 200, `baba post ${JSON.stringify(babaPost.data)}`);

  const dailyScore = computeScore(20000, 2, 0, 1);
  const dailyDate = '2026-09-22';
  const dailyPost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.15',
    body: {
      name: 'DailyPilot',
      score: dailyScore,
      survivalMs: 20000,
      orbs: 2,
      comboBonus: 0,
      nearMisses: 1,
      difficulty: 'einfach',
      mode: 'daily',
      dailyDate,
    },
  });
  assert(dailyPost.status === 200, `daily post ${JSON.stringify(dailyPost.data)}`);
  assert(
    dailyPost.data.scores.every((s) => s.mode === 'daily' && s.difficulty === 'schwer'),
    'daily stored as schwer'
  );

  const getAll = await api('/api/scores');
  assert(getAll.data.scores.length >= 3, 'leaderboard non-empty');

  const getBaba = await api('/api/scores?difficulty=baba');
  assert(getBaba.data.scores.every((s) => s.difficulty === 'baba'), 'baba filter');
  assert(getBaba.data.scores.every((s) => s.mode !== 'daily'), 'baba excludes daily');
  assert(getBaba.data.scores.some((s) => s.name === 'BabaPilot'), 'baba pilot listed');

  const getDaily = await api(`/api/scores?mode=daily&dailyDate=${dailyDate}`);
  assert(getDaily.data.scores.every((s) => s.mode === 'daily' && s.dailyDate === dailyDate), 'daily filter');
  assert(getDaily.data.scores.some((s) => s.name === 'DailyPilot'), 'daily pilot listed');

  const badDaily = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.16',
    body: { name: 'NoDate', score: 10, survivalMs: 1000, orbs: 0, mode: 'daily' },
  });
  assert(badDaily.status === 400, 'daily without date rejected');

  const getBadFilter = await api('/api/scores?difficulty=ultra');
  assert(getBadFilter.status === 400, 'bad filter rejected');

  const preflight = await fetch(`${base}/api/scores`, { method: 'OPTIONS', headers: { Origin: 'https://example.com' } });
  const preflightBody = await preflight.text();
  assert(preflight.status === 204, `preflight ${preflight.status} ${preflightBody}`);
  assert(preflight.headers.get('access-control-allow-origin') === 'https://example.com', 'cors origin');

  // Parity with the shared in-memory ranker, including tie-break (earlier ts wins).
  const seeded = [
    { name: 'A', score: 100, ts: 2, difficulty: 'mittel', mode: 'normal', dailyDate: null },
    { name: 'B', score: 100, ts: 1, difficulty: 'mittel', mode: 'normal', dailyDate: null },
    { name: 'C', score: 50, ts: 3, difficulty: 'mittel', mode: 'daily', dailyDate: '2026-09-22' },
  ];
  for (const row of seeded) {
    db._sqlite
      .prepare(
        `INSERT INTO scores (name, score, survival_ms, orbs, combo_bonus, near_misses, difficulty, mode, daily_date, ts, client_key)
         VALUES (?, ?, 0, 0, 0, 0, ?, ?, ?, ?, 'seed')`
      )
      .run(row.name, row.score, row.difficulty, row.mode, row.dailyDate, row.ts);
  }
  const listed = await api('/api/scores?difficulty=mittel');
  const expected = selectBoard(
    [
      ...getAll.data.scores.map((s) => ({ ...s, key: 'x' })),
      ...seeded,
    ],
    { mode: null, difficulty: 'mittel' }
  );
  // GET difficulty=mittel excludes daily. Seeded A/B plus any normal mittel from earlier posts (none).
  assert(listed.data.scores[0].name === 'B', `tie-break earlier ts first, got ${listed.data.scores[0]?.name}`);
  assert(listed.data.scores.some((s) => s.name === 'A') && !listed.data.scores.some((s) => s.name === 'C'), 'daily excluded');
  assert(expected[0].name === 'B', 'shared ranker agrees');

  // Global cap keeps the highest 500; a new top score evicts the lowest.
  const insertLow = db._sqlite.prepare(
    `INSERT INTO scores (name, score, survival_ms, orbs, combo_bonus, near_misses, difficulty, mode, daily_date, ts, client_key)
     VALUES (?, ?, 0, 0, 0, 0, 'einfach', 'normal', NULL, ?, 'cap')`
  );
  for (let i = 0; i < 500; i += 1) insertLow.run(`L${i}`, 1, 10_000 + i);
  const before = db._sqlite.prepare('SELECT COUNT(*) AS n FROM scores').get().n;
  assert(before > 500, 'seeded over cap');
  const capScore = computeScore(1000, 0, 0, 0);
  const capPost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.40',
    body: { name: 'CapPilot', score: capScore, survivalMs: 1000, orbs: 0, difficulty: 'einfach' },
  });
  assert(capPost.status === 200, `cap post ${JSON.stringify(capPost.data)}`);
  const after = db._sqlite.prepare('SELECT COUNT(*) AS n FROM scores').get().n;
  assert(after === 500, `store capped at 500, got ${after}`);
  const stillTop = db._sqlite.prepare(`SELECT name FROM scores WHERE name = 'CapPilot'`).get();
  assert(stillTop, 'new high score kept');
  const einfach = await api('/api/scores?difficulty=einfach');
  assert(einfach.data.scores.length === 50, `top 50 einfach, got ${einfach.data.scores.length}`);
  assert(einfach.data.scores[0].name === 'CapPilot', 'highest einfach score ranks first');

  // 31st request in the window is rejected.
  let limited = 0;
  for (let i = 0; i < 40; i += 1) {
    const r = await api('/api/health', { ip: '198.51.100.8' });
    if (r.status === 429) {
      limited = i + 1;
      break;
    }
  }
  assert(limited === 31, `expected 31st hit to 429, got ${limited}`);

  console.log('WORKER SMOKE OK', {
    formula: score,
    top: getAll.data.scores[0]?.name,
    capped: after,
  });
} finally {
  server.close();
}
