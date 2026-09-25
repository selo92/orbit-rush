/**
 * Headless smoke: score formula, sanitize, difficulty enum, daily seed, API health + submit + reject.
 * v1.3: mode/dailyDate fields
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = 8799;
const NEAR_MISS_POINTS = 75;
const DIFFICULTY_ENUM = ['einfach', 'mittel', 'schwer', 'baba'];

function computeScore(survivalMs, orbs, comboBonus = 0, nearMisses = 0) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  return t * 10 + o * 100 + cb + nm * NEAR_MISS_POINTS;
}

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[<>&"'`\\/]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 16);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitHealth(url, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('API health timeout');
}

// Unit checks
assert(computeScore(45000, 3) === 450 + 300, 'base score formula');
assert(computeScore(32000, 2, 50, 1) === 320 + 200 + 50 + 75, 'combo + near-miss formula');
assert(sanitizeName('<script>x</script>') === 'scriptxscript', 'sanitize strips tags-ish');
assert(sanitizeName('  HELLO WORLD TOOLONGNAME!!! ').length <= 16, 'name max 16');
assert(DIFFICULTY_ENUM.includes('baba') && DIFFICULTY_ENUM.includes('mittel'), 'difficulty enum');

const diffMod = await import(path.join(root, 'src', 'difficulty.js'));
assert(diffMod.normalizeDifficulty('BABA') === 'baba', 'normalize baba');
assert(diffMod.normalizeDifficulty('nope') === 'mittel', 'normalize default');
assert(diffMod.DIFFICULTIES.baba.astRate > diffMod.DIFFICULTIES.schwer.astRate, 'baba harder than schwer');
assert(diffMod.DIFFICULTIES.einfach.orbInterval < diffMod.DIFFICULTIES.mittel.orbInterval, 'einfach more orbs');

const rngMod = await import(path.join(root, 'src', 'rng.js'));
const r1 = rngMod.dailyRng('2026-09-22');
const r2 = rngMod.dailyRng('2026-09-22');
const a = [r1(), r1(), r1()];
const b = [r2(), r2(), r2()];
assert(JSON.stringify(a) === JSON.stringify(b), 'daily seed deterministic');
const r3 = rngMod.dailyRng('2026-09-23');
assert(r3() !== a[0] || r3() !== a[1], 'different dates diverge (soft)');
assert(rngMod.isValidDailyDate('2026-09-22'), 'valid daily date');
assert(!rngMod.isValidDailyDate('2026-13-40'), 'invalid daily date');
assert(rngMod.utcDateString(new Date(Date.UTC(2026, 8, 22))).startsWith('2026-09-22'), 'utc date string');

const achMod = await import(path.join(root, 'src', 'achievements.js'));
assert(achMod.ACHIEVEMENTS.length >= 6, 'at least 6 achievements');
assert(achMod.ACHIEVEMENTS.some((x) => x.id === 'daily_win'), 'daily achievement present');

const skinMod = await import(path.join(root, 'src', 'skins.js'));
assert((skinMod.SKIN_IDS || skinMod.SKIN_IDS).length >= 3, 'at least 3 skins');
assert((skinMod.DEFAULT_SKIN || skinMod.DEFAULT_SKIN) === 'cyan', 'default cyan skin');

const env = { ...process.env, PORT: String(PORT) };
const scoresPath = path.join(root, 'data', 'scores.json');
const backup = fs.existsSync(scoresPath) ? fs.readFileSync(scoresPath, 'utf8') : '[]';

const child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  env,
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
child.stdout.on('data', (d) => {
  out += d;
});
child.stderr.on('data', (d) => {
  out += d;
});

try {
  await waitHealth(`http://127.0.0.1:${PORT}/api/health`);
  const health = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json());
  assert(health.version === '1.3' || health.version === '1.3.0', 'api version 1.3');

  const survivalMs = 32000;
  const orbs = 2;
  const comboBonus = 50;
  const nearMisses = 1;
  const score = computeScore(survivalMs, orbs, comboBonus, nearMisses);

  const post = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'SmokeBot',
      score,
      survivalMs,
      orbs,
      comboBonus,
      nearMisses,
      difficulty: 'schwer',
      mode: 'normal',
    }),
  });
  const body = await post.json();
  assert(post.ok, `post failed: ${JSON.stringify(body)}`);
  assert(Array.isArray(body.scores), 'scores array');
  assert(body.scores.some((s) => s.difficulty === 'schwer'), 'posted difficulty on list');

  await new Promise((r) => setTimeout(r, 2100));
  const badDiff = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'HaxDiff',
      score: 10,
      survivalMs: 1000,
      orbs: 0,
      difficulty: 'nightmare',
    }),
  });
  assert(badDiff.status === 400, 'invalid difficulty rejected');

  const post2 = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'SmokeBot',
      score,
      survivalMs,
      orbs,
      comboBonus,
      nearMisses,
      difficulty: 'schwer',
      mode: 'normal',
    }),
  });
  assert(post2.status === 429 || post2.ok, 'double submit handled');

  await new Promise((r) => setTimeout(r, 2100));
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Hax', score: 9999999, survivalMs: 1000, orbs: 0 }),
  });
  assert(bad.status === 400, 'absurd score rejected');

  await new Promise((r) => setTimeout(r, 2100));
  const badCombo = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Hax2',
      score: 5000,
      survivalMs: 1000,
      orbs: 1,
      comboBonus: 0,
      nearMisses: 0,
      difficulty: 'baba',
    }),
  });
  assert(badCombo.status === 400, 'inconsistent score rejected');

  await new Promise((r) => setTimeout(r, 2100));
  const babaScore = computeScore(15000, 1, 0, 0);
  const babaPost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'BabaPilot',
      score: babaScore,
      survivalMs: 15000,
      orbs: 1,
      comboBonus: 0,
      nearMisses: 0,
      difficulty: 'baba',
      mode: 'normal',
      clientId: 'D4E5F6A7-B8C9-4D01-8ABC-DEF012345678',
    }),
  });
  const babaBody = await babaPost.json();
  assert(babaPost.ok, `baba post failed: ${JSON.stringify(babaBody)}`);
  assert(
    babaBody.scores.some(
      (s) => s.name === 'BabaPilot' && s.clientId === 'd4e5f6a7-b8c9-4d01-8abc-def012345678'
    ),
    'express stores clientId'
  );

  // Daily submit
  await new Promise((r) => setTimeout(r, 2100));
  const dailyScore = computeScore(20000, 2, 0, 1);
  const dailyDate = '2026-09-22';
  const dailyPost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'DailyPilot',
      score: dailyScore,
      survivalMs: 20000,
      orbs: 2,
      comboBonus: 0,
      nearMisses: 1,
      difficulty: 'schwer',
      mode: 'daily',
      dailyDate,
    }),
  });
  const dailyBody = await dailyPost.json();
  assert(dailyPost.ok, `daily post failed: ${JSON.stringify(dailyBody)}`);
  assert(
    dailyBody.scores.some((s) => s.mode === 'daily' && s.dailyDate === dailyDate),
    'daily fields on list'
  );

  const getAll = await fetch(`http://127.0.0.1:${PORT}/api/scores`);
  const listAll = await getAll.json();
  assert(listAll.scores.length >= 1, 'leaderboard non-empty');

  const getBaba = await fetch(`http://127.0.0.1:${PORT}/api/scores?difficulty=baba`);
  const listBaba = await getBaba.json();
  assert(listBaba.scores.every((s) => s.difficulty === 'baba'), 'baba filter');
  assert(listBaba.scores.every((s) => (s.mode || 'normal') !== 'daily'), 'baba excludes daily');
  assert(listBaba.scores.some((s) => s.name === 'BabaPilot'), 'baba pilot listed');

  const getDaily = await fetch(
    `http://127.0.0.1:${PORT}/api/scores?mode=daily&dailyDate=${dailyDate}`
  );
  const listDaily = await getDaily.json();
  assert(listDaily.scores.every((s) => s.mode === 'daily'), 'daily filter mode');
  assert(listDaily.scores.every((s) => s.dailyDate === dailyDate), 'daily filter date');
  assert(listDaily.scores.some((s) => s.name === 'DailyPilot'), 'daily pilot listed');

  const badDaily = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'NoDate',
      score: 10,
      survivalMs: 1000,
      orbs: 0,
      mode: 'daily',
    }),
  });
  // may be rate-limited; accept 400 or 429
  assert(badDaily.status === 400 || badDaily.status === 429, 'daily without date rejected');

  const getBadFilter = await fetch(`http://127.0.0.1:${PORT}/api/scores?difficulty=ultra`);
  assert(getBadFilter.status === 400, 'bad filter rejected');

  console.log('SMOKE OK', {
    formula: score,
    top: listAll.scores[0]?.name,
    babaTop: listBaba.scores[0]?.name,
    dailyTop: listDaily.scores[0]?.name,
    apiOut: out.trim().slice(0, 80),
  });
} finally {
  child.kill('SIGTERM');
  void backup;
}
