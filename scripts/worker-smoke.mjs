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
import { isOwnRow } from '../src/identity.js';
import { selfCheck } from '../shared/aerger.js';
import { DatabaseSync } from 'node:sqlite';

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
const migrationClient = fs.readFileSync(path.join(root, 'migrations', '0002_client_id.sql'), 'utf8');
assert(migrationClient.includes('client_id'), 'client id migration');
const migrationGame = fs.readFileSync(path.join(root, 'migrations', '0003_game.sql'), 'utf8');
assert(migrationGame.includes('game'), 'game migration adds column');
assert(migrationGame.includes("'rush'"), 'game migration defaults existing rows to rush');
const migrationAerger = fs.readFileSync(path.join(root, 'migrations', '0004_aerger_rooms.sql'), 'utf8');
assert(migrationAerger.includes('CREATE TABLE IF NOT EXISTS aerger_rooms'), 'aerger migration');
assert(migrationAerger.includes('version'), 'aerger version column');
assert(!/ALTER TABLE scores/i.test(migrationAerger), 'aerger migration leaves scores alone');
selfCheck();
{
  const fresh = new DatabaseSync(':memory:');
  for (const file of ['0001_init.sql', '0002_client_id.sql', '0003_game.sql', '0004_aerger_rooms.sql']) {
    fresh.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'));
  }
  const tables = fresh.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  assert(tables.includes('scores') && tables.includes('aerger_rooms'), `migration tables ${tables}`);
  const scoreCols = fresh.prepare('PRAGMA table_info(scores)').all().map((col) => col.name);
  assert(scoreCols.includes('game') && scoreCols.includes('client_id'), 'score columns survive aerger migration');
  const roomCols = fresh.prepare('PRAGMA table_info(aerger_rooms)').all().map((col) => col.name);
  for (const col of ['code', 'version', 'state', 'updated_at', 'created_at']) {
    assert(roomCols.includes(col), `aerger column ${col}`);
  }
  fresh.close();
}
assert(
  isOwnRow(
    { name: 'Other', clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { name: 'Pilot', clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  ),
  'own row matches client id'
);
assert(
  isOwnRow({ name: 'Pilot', clientId: null }, { name: 'Pilot', clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
  'legacy row matches saved name'
);
assert(
  !isOwnRow(
    { name: 'Pilot', clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    { name: 'Pilot', clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
  ),
  'different client id is not you'
);

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

async function api(pathname, { method = 'GET', body, ip = '203.0.113.10', headers = {} } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      'CF-Connecting-IP': ip,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, etag: res.headers.get('etag') };
}

try {
  const health = await api('/api/health');
  assert(health.status === 200, 'health status');
  assert(health.data.version === '1.4', 'health version');
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
  assert(
    post.data.scores.some((s) => s.name === 'bSmoke Botb' && s.clientId == null),
    'post without clientId stays compatible'
  );

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

  const pilotId = 'A1B2C3D4-E5F6-4789-A012-3456789ABCDE';
  const idScore = computeScore(8000, 1, 0, 0);
  const idPost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.60',
    body: {
      name: 'IdPilot',
      score: idScore,
      survivalMs: 8000,
      orbs: 1,
      comboBonus: 0,
      nearMisses: 0,
      difficulty: 'mittel',
      clientId: pilotId,
    },
  });
  assert(idPost.status === 200, `clientId post ${JSON.stringify(idPost.data)}`);
  assert(
    idPost.data.scores.some((s) => s.name === 'IdPilot' && s.clientId === pilotId.toLowerCase()),
    'clientId stored lowercase'
  );

  const badId = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.61',
    body: {
      name: 'BadId',
      score: computeScore(1000, 0, 0, 0),
      survivalMs: 1000,
      orbs: 0,
      clientId: 'not-a-uuid',
    },
  });
  assert(badId.status === 400, 'invalid clientId rejected');
  assert(badId.data.error === 'Invalid clientId', 'invalid clientId message');

  const dupId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const dupBody = {
    name: 'DupPilot',
    score: computeScore(4000, 1, 0, 0),
    survivalMs: 4000,
    orbs: 1,
    comboBonus: 0,
    nearMisses: 0,
    difficulty: 'einfach',
    clientId: dupId,
  };
  const dupFirst = await api('/api/scores', { method: 'POST', ip: '203.0.113.62', body: dupBody });
  assert(dupFirst.status === 200 && !dupFirst.data.duplicate, 'first dup pilot saved');
  await new Promise((r) => setTimeout(r, 2100));
  const dupAgain = await api('/api/scores', { method: 'POST', ip: '203.0.113.62', body: dupBody });
  assert(dupAgain.status === 200 && dupAgain.data.duplicate === true, `duplicate flag ${JSON.stringify(dupAgain.data)}`);

  db._sqlite.exec('DROP INDEX IF EXISTS idx_scores_client_id');
  db._sqlite.exec('ALTER TABLE scores DROP COLUMN client_id');
  resetSchemaForTests();
  const legacyScore = computeScore(2000, 0, 0, 0);
  const legacy = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.77',
    body: {
      name: 'LegacyPilot',
      score: legacyScore,
      survivalMs: 2000,
      orbs: 0,
      clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    },
  });
  assert(legacy.status === 200, `legacy migrate post ${JSON.stringify(legacy.data)}`);
  assert(
    legacy.data.scores.some(
      (s) => s.name === 'LegacyPilot' && s.clientId === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    ),
    'legacy table gained client_id'
  );
  const colNames = db._sqlite.prepare('PRAGMA table_info(scores)').all().map((c) => c.name);
  assert(colNames.includes('client_id'), `client_id column missing: ${colNames.join(',')}`);

  const mirrorScore = computeScore(12000, 2, 50, 1);
  const mirrorBody = {
    name: 'MirrorPilot',
    score: mirrorScore,
    survivalMs: 12000,
    orbs: 2,
    comboBonus: 50,
    nearMisses: 1,
    game: 'mirror',
    clientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  };
  const mirrorPost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.90',
    body: mirrorBody,
  });
  assert(mirrorPost.status === 200, `mirror post ${JSON.stringify(mirrorPost.data)}`);
  assert(mirrorPost.data.scores.every((s) => s.game === 'mirror'), 'mirror response is the mirror board');
  assert(mirrorPost.data.scores.some((s) => s.name === 'MirrorPilot'), 'mirror pilot listed');
  await new Promise((r) => setTimeout(r, 2100));
  const mirrorDup = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.90',
    body: mirrorBody,
  });
  assert(mirrorDup.status === 200 && mirrorDup.data.duplicate === true, 'mirror duplicate is per game');

  const rushBoard = await api('/api/scores?game=rush', { ip: '203.0.113.91' });
  assert(rushBoard.status === 200, 'rush board');
  assert(rushBoard.data.scores.every((s) => s.game === 'rush'), 'rush filter');
  assert(!rushBoard.data.scores.some((s) => s.name === 'MirrorPilot'), 'mirror score stays off rush');
  const defaultBoard = await api('/api/scores', { ip: '203.0.113.91' });
  assert(!defaultBoard.data.scores.some((s) => s.name === 'MirrorPilot'), 'omitted game defaults to rush');
  const mirrorBoard = await api('/api/scores?game=mirror', { ip: '203.0.113.91' });
  assert(mirrorBoard.data.scores.some((s) => s.name === 'MirrorPilot'), 'mirror filter');
  assert(mirrorBoard.data.game === 'mirror', 'response names the board');
  const badGame = await api('/api/scores?game=puzzle', { ip: '203.0.113.91' });
  assert(badGame.status === 400, 'invalid game filter rejected');
  const badGamePost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.92',
    body: { name: 'BadGame', score: computeScore(1000, 0, 0, 0), survivalMs: 1000, orbs: 0, game: 'puzzle' },
  });
  assert(badGamePost.status === 400 && badGamePost.data.error === 'Invalid game (rush|mirror|drift|pulse)', 'invalid game post');

  const driftScore = computeScore(8000, 3, 100, 2);
  const driftPost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.96',
    body: {
      name: 'DriftPilot',
      score: driftScore,
      survivalMs: 8000,
      orbs: 3,
      comboBonus: 100,
      nearMisses: 2,
      game: 'drift',
      clientId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    },
  });
  assert(driftPost.status === 200, `drift post ${JSON.stringify(driftPost.data)}`);
  assert(driftPost.data.scores.every((s) => s.game === 'drift'), 'drift response is the drift board');
  assert(driftPost.data.scores.some((s) => s.name === 'DriftPilot'), 'drift pilot listed');
  const driftBoard = await api('/api/scores?game=drift', { ip: '203.0.113.97' });
  assert(driftBoard.status === 200 && driftBoard.data.game === 'drift', 'drift filter names the board');
  assert(driftBoard.data.scores.some((s) => s.name === 'DriftPilot'), 'drift filter lists the pilot');
  const rushAfterDrift = await api('/api/scores?game=rush', { ip: '203.0.113.97' });
  assert(!rushAfterDrift.data.scores.some((s) => s.name === 'DriftPilot'), 'drift score stays off rush');
  const mirrorAfterDrift = await api('/api/scores?game=mirror', { ip: '203.0.113.97' });
  assert(!mirrorAfterDrift.data.scores.some((s) => s.name === 'DriftPilot'), 'drift score stays off mirror');
  assert(
    driftBoard.data.scores.some((s) => s.name === 'DriftPilot' && s.difficulty === 'mittel'),
    'drift default difficulty stays mittel'
  );
  const driftMittel = await api('/api/scores?game=drift&difficulty=mittel', { ip: '203.0.113.97' });
  assert(driftMittel.data.scores.some((s) => s.name === 'DriftPilot'), 'drift difficulty filter includes mittel');
  const driftSchwer = await api('/api/scores?game=drift&difficulty=schwer', { ip: '203.0.113.97' });
  assert(!driftSchwer.data.scores.some((s) => s.name === 'DriftPilot'), 'drift difficulty filter excludes other grades');
  const rushMittel = await api('/api/scores?difficulty=mittel', { ip: '203.0.113.97' });
  assert(!rushMittel.data.scores.some((s) => s.name === 'DriftPilot'), 'drift difficulty filter does not leak onto rush');

  const pulseScore = computeScore(9000, 4, 100, 1);
  const pulsePost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.110',
    body: {
      name: 'PulsePilot',
      score: pulseScore,
      survivalMs: 9000,
      orbs: 4,
      comboBonus: 100,
      nearMisses: 1,
      difficulty: 'baba',
      game: 'pulse',
      clientId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    },
  });
  assert(pulsePost.status === 200, `pulse post ${JSON.stringify(pulsePost.data)}`);
  assert(pulsePost.data.scores.every((s) => s.game === 'pulse'), 'pulse response is the pulse board');
  assert(pulsePost.data.scores.some((s) => s.name === 'PulsePilot'), 'pulse pilot listed');
  const pulseBoard = await api('/api/scores?game=pulse&difficulty=baba', { ip: '203.0.113.111' });
  assert(pulseBoard.status === 200 && pulseBoard.data.game === 'pulse', 'pulse filter names the board');
  assert(pulseBoard.data.scores.some((s) => s.name === 'PulsePilot'), 'pulse difficulty filter includes baba');
  const pulseEasy = await api('/api/scores?game=pulse&difficulty=einfach', { ip: '203.0.113.111' });
  assert(!pulseEasy.data.scores.some((s) => s.name === 'PulsePilot'), 'pulse difficulty filter excludes other grades');
  const rushAfterPulse = await api('/api/scores?game=rush', { ip: '203.0.113.111' });
  assert(!rushAfterPulse.data.scores.some((s) => s.name === 'PulsePilot'), 'pulse score stays off rush');

  const pulseDailyDate = '2026-09-26';
  const pulseDailyScore = computeScore(5000, 2, 0, 1);
  const pulseDailyPost = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.112',
    body: {
      name: 'PulseDaily',
      score: pulseDailyScore,
      survivalMs: 5000,
      orbs: 2,
      comboBonus: 0,
      nearMisses: 1,
      game: 'pulse',
      mode: 'daily',
      dailyDate: pulseDailyDate,
    },
  });
  assert(pulseDailyPost.status === 200, `pulse daily post ${JSON.stringify(pulseDailyPost.data)}`);
  assert(
    pulseDailyPost.data.scores.some((s) => s.name === 'PulseDaily' && s.mode === 'daily'),
    'worker pulse daily board'
  );
  const pulseDailyGet = await api(
    `/api/scores?game=pulse&mode=daily&dailyDate=${pulseDailyDate}`,
    { ip: '203.0.113.113' }
  );
  assert(pulseDailyGet.status === 200 && pulseDailyGet.data.game === 'pulse', 'GET pulse daily names the board');
  assert(pulseDailyGet.data.scores.some((s) => s.name === 'PulseDaily'), 'GET pulse daily lists the run');
  assert(!pulseDailyGet.data.scores.some((s) => s.name === 'PulsePilot'), 'pulse daily list hides normal runs');

  const notAScore = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.95',
    body: { name: 'Aerger', score: computeScore(1000, 0, 0, 0), survivalMs: 1000, orbs: 0, game: 'aerger' },
  });
  assert(notAScore.status === 400, 'aerger is not a leaderboard game');

  const created = await api('/api/aerger/create', {
    method: 'POST',
    ip: '203.0.113.120',
    body: { name: 'Ada' },
  });
  assert(created.status === 200 && created.data.code.length === 6, `d1 create ${JSON.stringify(created.data)}`);
  assert(created.data.state?.seats?.[0]?.you === true, 'd1 host seat');
  const roomCode = created.data.code;
  const peek = await api(`/api/aerger/room/${roomCode}`, { ip: '203.0.113.121' });
  assert(peek.status === 200 && peek.data.version === 1, 'd1 room read');
  const notModified = await api(`/api/aerger/room/${roomCode}`, {
    ip: '203.0.113.121',
    headers: { 'If-None-Match': peek.etag },
  });
  assert(notModified.status === 304, `d1 304 ${notModified.status}`);
  const tiny = await api(`/api/aerger/room/${roomCode}?since=${peek.data.version}`, { ip: '203.0.113.121' });
  assert(tiny.status === 200 && tiny.data.unchanged === true, 'd1 since version');
  assert(JSON.stringify(tiny.data).length < 120, 'd1 unchanged poll stays small');
  const joined = await api('/api/aerger/join', {
    method: 'POST',
    ip: '203.0.113.122',
    body: { code: roomCode, name: 'Bea', version: peek.data.version },
  });
  assert(joined.status === 200, `d1 join ${JSON.stringify(joined.data)}`);
  const started = await api('/api/aerger/start', {
    method: 'POST',
    ip: '203.0.113.120',
    body: { code: roomCode, secret: created.data.secret, version: joined.data.version },
  });
  assert(started.status === 200 && started.data.state.status === 'playing', 'd1 start');
  const [rollA, rollB] = await Promise.all([
    api('/api/aerger/roll', {
      method: 'POST',
      ip: '203.0.113.120',
      body: { code: roomCode, secret: created.data.secret, version: started.data.version },
    }),
    api('/api/aerger/roll', {
      method: 'POST',
      ip: '203.0.113.120',
      body: { code: roomCode, secret: created.data.secret, version: started.data.version },
    }),
  ]);
  const race = [rollA.status, rollB.status].sort();
  assert(race[0] === 200 && race[1] === 409, `d1 roll race ${race}`);
  let cursor = rollA.status === 200 ? rollA.data : rollB.data;
  const secrets = [created.data.secret, joined.data.secret];
  let moved = false;
  for (let i = 0; i < 60 && !moved; i += 1) {
    const seat = cursor.state.turn;
    if (cursor.state.phase !== 'move') {
      const roll = await api('/api/aerger/roll', {
        method: 'POST',
        ip: '203.0.113.123',
        body: { code: roomCode, secret: secrets[seat], version: cursor.version },
      });
      assert(roll.status === 200, `d1 roll ${JSON.stringify(roll.data)}`);
      cursor = roll.data;
    }
    if (cursor.state.phase === 'move') {
      const token = cursor.state.legal[0].token;
      const move = await api('/api/aerger/move', {
        method: 'POST',
        ip: '203.0.113.123',
        body: { code: roomCode, secret: secrets[seat], version: cursor.version, token },
      });
      assert(move.status === 200, `d1 move ${JSON.stringify(move.data)}`);
      const stale = await api('/api/aerger/move', {
        method: 'POST',
        ip: '203.0.113.123',
        body: { code: roomCode, secret: secrets[seat], version: cursor.version, token },
      });
      assert(stale.status === 409 && stale.data.error === 'stale', 'd1 stale move');
      moved = true;
    }
  }
  assert(moved, 'd1 played a legal move');
  const scoreRows = db._sqlite.prepare('SELECT COUNT(*) AS n FROM scores').get().n;
  const roomRows = db._sqlite.prepare('SELECT COUNT(*) AS n FROM aerger_rooms').get().n;
  assert(roomRows >= 1, 'room row stored');
  assert(scoreRows > 0, 'scores table still populated');

  db._sqlite.exec('DROP INDEX IF EXISTS idx_scores_game_board');
  db._sqlite.exec('ALTER TABLE scores DROP COLUMN game');
  resetSchemaForTests();
  const healed = await api('/api/scores?game=rush', { ip: '203.0.113.93' });
  assert(healed.status === 200, `game column heal ${JSON.stringify(healed.data)}`);
  assert(healed.data.scores.every((s) => s.game === 'rush'), 'legacy rows default to rush');
  const healedCols = db._sqlite.prepare('PRAGMA table_info(scores)').all().map((c) => c.name);
  assert(healedCols.includes('game'), `game column missing after heal: ${healedCols.join(',')}`);
  const mirrorAfter = await api('/api/scores', {
    method: 'POST',
    ip: '203.0.113.94',
    body: {
      name: 'MirrorAfter',
      score: computeScore(3000, 1, 0, 0),
      survivalMs: 3000,
      orbs: 1,
      comboBonus: 0,
      nearMisses: 0,
      game: 'mirror',
    },
  });
  assert(mirrorAfter.status === 200, `mirror after heal ${JSON.stringify(mirrorAfter.data)}`);
  assert(mirrorAfter.data.scores.every((s) => s.game === 'mirror'), 'healed table still splits boards');
  assert(!mirrorAfter.data.scores.some((s) => s.game === 'rush'), 'mirror post does not return rush rows');

  console.log('WORKER SMOKE OK', {
    formula: score,
    top: getAll.data.scores[0]?.name,
    capped: after,
  });
} finally {
  server.close();
}
