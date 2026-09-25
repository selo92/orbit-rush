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

const aergerMod = await import(path.join(root, 'shared', 'aerger.js'));
aergerMod.selfCheck();
const diceMod = await import(path.join(root, 'src', 'aerger-dice.js'));
assert(diceMod.tumbleHoldMs(0, 100, false) === diceMod.MIN_LOCAL_TUMBLE_MS - 100, 'tumble bridges a fast POST');
assert(diceMod.tumbleHoldMs(0, 5000, false) === 0, 'a slow POST does not add extra wait');
assert(diceMod.tumbleHoldMs(0, 0, true) === 0, 'reduced motion skips the tumble hold');
assert(
  diceMod.isFreshRoll(
    { phase: 'roll', turn: 0, dice: null, rollSeq: 0 },
    { phase: 'move', turn: 0, dice: 6, rollSeq: 1 }
  ),
  'rollSeq bump is a fresh roll'
);
assert(
  diceMod.isFreshRoll(
    { phase: 'roll', turn: 0, dice: 6, rollSeq: 1 },
    { phase: 'move', turn: 0, dice: 6, rollSeq: 2 }
  ),
  'the same face still counts as a new roll'
);
assert(
  !diceMod.isFreshRoll(
    { phase: 'move', turn: 0, dice: 6, rollSeq: 2 },
    { phase: 'roll', turn: 0, dice: 6, rollSeq: 2 }
  ),
  'a move does not look like a roll'
);
assert(
  diceMod.isFreshRoll(
    { phase: 'roll', turn: 0, dice: null },
    { phase: 'move', turn: 0, dice: 4 }
  ),
  'legacy rooms still detect a roll from the phase change'
);
assert(!diceMod.isFreshRoll(null, { dice: 3, rollSeq: 1 }), 'the first snapshot does not animate');
const aergerMigration = fs.readFileSync(path.join(root, 'migrations', '0004_aerger_rooms.sql'), 'utf8');
assert(aergerMigration.includes('aerger_rooms'), 'aerger migration creates rooms');
assert(aergerMigration.includes('version'), 'aerger migration has version');
assert(!/ALTER TABLE scores/i.test(aergerMigration), 'aerger migration does not alter scores');

const achMod = await import(path.join(root, 'src', 'achievements.js'));
assert(achMod.ACHIEVEMENTS.length >= 6, 'at least 6 achievements');
assert(achMod.ACHIEVEMENTS.some((x) => x.id === 'daily_win'), 'daily achievement present');

const skinMod = await import(path.join(root, 'src', 'skins.js'));
assert((skinMod.SKIN_IDS || skinMod.SKIN_IDS).length >= 3, 'at least 3 skins');
assert((skinMod.DEFAULT_SKIN || skinMod.DEFAULT_SKIN) === 'cyan', 'default cyan skin');

// Radius steering: snappy keyboard, 1:1 drag, difficulty spans unchanged.
{
  const listeners = {};
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
  };
  const gameMod = await import(path.join(root, 'src', 'game.js'));
  const audio = new Proxy({}, { get: () => () => {} });

  function makeGame(w, h) {
    const canvas = {
      width: w,
      height: h,
      style: {},
      parentElement: {
        getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
      },
      getContext() {
        return { setTransform() {} };
      },
      addEventListener(type, fn) {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener() {},
      setPointerCapture() {},
    };
    const g = new gameMod.Game(canvas, {
      audio,
      onGameOver() {},
      onHud() {},
    });
    g.setDifficulty('mittel');
    g.resize();
    g.spawnOrbTimer = 999;
    g.spawnAstTimer = 999;
    g.spawnPowerTimer = 999;
    return g;
  }

  function hold(g, dir, seconds) {
    g.input.left = dir === 'left';
    g.input.right = dir === 'right';
    g.input.pointerId = null;
    const dt = 1 / 60;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) g.update(dt);
  }

  const desktop = makeGame(1280, 800);
  const span = desktop.rMax - desktop.rMin;
  const inner = desktop.radius;
  assert(Math.abs(inner - desktop.rMin) < 0.01, 'resize clamps start radius into the band');
  hold(desktop, 'right', 0.45);
  assert(
    desktop.radius > desktop.rMin + span * 0.95,
    `keyboard crosses the radius band in under half a second (got ${(desktop.radius - desktop.rMin) / span})`
  );

  const cruise = makeGame(1280, 800);
  hold(cruise, 'right', 0.12);
  cruise.input.right = false;
  const gapAtRelease = Math.abs(cruise.rTarget - cruise.radius);
  for (let i = 0; i < 4; i++) cruise.update(1 / 60);
  const gapAfter = Math.abs(cruise.rTarget - cruise.radius);
  assert(gapAtRelease < span * 0.06, 'keyboard follow stays close to the target while held');
  assert(gapAfter < span * 0.02, 'radius catches the target within ~67ms of key release');

  const phone = makeGame(390, 700);
  phone.bindInput();
  const phoneSpan = phone.rMax - phone.rMin;
  const dragPx = Math.min(phone.w, phone.h) * 0.38;
  assert(dragPx > 120 && dragPx < 220, 'phone drag distance stays thumb-sized');
  phone.radius = phone.rMin;
  phone.rTarget = phone.rMin;
  listeners.pointerdown.at(-1)({ pointerId: 7, clientX: 40 });
  listeners.pointermove.at(-1)({ pointerId: 7, clientX: 40 + dragPx });
  phone.update(1 / 60);
  assert(Math.abs(phone.radius - phone.rTarget) < 0.001, 'drag sets radius on the same frame');
  assert(phone.radius > phone.rMin + phoneSpan * 0.95, 'one short-side drag covers the radius band');

  const wide = makeGame(1440, 900);
  const wideTravel = Math.min(wide.w, wide.h) * 0.38;
  const oldWideTravel = wide.w * 0.55;
  assert(wideTravel < oldWideTravel * 0.55, 'wide screens no longer need a long mouse sweep');

  const easy = makeGame(800, 800);
  easy.setDifficulty('einfach');
  easy.resize();
  const baba = makeGame(800, 800);
  baba.setDifficulty('baba');
  baba.resize();
  assert(easy.rMax - easy.rMin > baba.rMax - baba.rMin, 'difficulty radius spans still differ');
}

const scoresMod = await import(path.join(root, 'shared', 'scores.js'));
assert(scoresMod.normalizeGame('Mirror') === 'mirror', 'normalize mirror');
assert(scoresMod.normalizeGame('nope') === 'rush', 'unknown game defaults to rush');
{
  const mixed = [
    { name: 'R', score: 10, ts: 1, difficulty: 'mittel', mode: 'normal' },
    { name: 'M', score: 50, ts: 2, difficulty: 'mittel', mode: 'normal', game: 'mirror' },
  ];
  const onlyM = scoresMod.selectBoard(mixed, { game: 'mirror' });
  assert(onlyM.length === 1 && onlyM[0].name === 'M' && onlyM[0].game === 'mirror', 'mirror board');
  const onlyR = scoresMod.selectBoard(mixed, {});
  assert(onlyR.length === 1 && onlyR[0].name === 'R' && onlyR[0].game === 'rush', 'default board is rush');
  const badGame = scoresMod.validatePostBody({
    name: 'A',
    score: 10,
    survivalMs: 1000,
    orbs: 0,
    comboBonus: 0,
    nearMisses: 0,
    game: 'nope',
  });
  assert(!badGame.ok && badGame.error === 'Invalid game (rush|mirror)', 'reject bad game');
  const okGame = scoresMod.validatePostBody({
    name: 'A',
    score: 10,
    survivalMs: 1000,
    orbs: 0,
    comboBonus: 0,
    nearMisses: 0,
  });
  assert(okGame.ok && okGame.value.game === 'rush', 'post defaults to rush');
  const qMirror = scoresMod.validateScoresQuery(new URLSearchParams('game=mirror'));
  assert(qMirror.ok && qMirror.game === 'mirror', 'query mirror');
  const qBad = scoresMod.validateScoresQuery(new URLSearchParams('game=both'));
  assert(!qBad.ok, 'query bad game');
}

{
  const listeners = {};
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener() {},
  };
  const { MirrorGame, mirrorRadius } = await import(path.join(root, 'src', 'mirror.js'));
  const audio = new Proxy({}, { get: () => () => {} });
  function makeMirror(w, h) {
    const canvas = {
      width: w,
      height: h,
      style: {},
      parentElement: {
        getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
      },
      getContext() {
        return { setTransform() {} };
      },
      addEventListener(type, fn) {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener() {},
      setPointerCapture() {},
    };
    const m = new MirrorGame(canvas, { audio, onGameOver() {}, onHud() {} });
    m.resize();
    const mid = (m.rMin + m.rMax) / 2;
    m.intent = mid;
    m.intentTarget = mid;
    m.radius = mirrorRadius(mid, m.rMin, m.rMax);
    m.alive = true;
    return m;
  }

  const m = makeMirror(390, 844);
  const start = m.radius;
  const span = m.rMax - m.rMin;
  m.input.left = true;
  m.update(0.2);
  assert(m.radius > start + span * 0.35, 'left input moves the ship outward');
  assert(m.intent < start - span * 0.35, 'left input moves the reflex ghost inward');
  assert(
    m.score === computeScore(m.survivalMs, m.orbsCollected, m.comboBonus, m.nearMisses),
    'mirror score matches the shared formula'
  );

  const drag = makeMirror(390, 844);
  drag.bindInput();
  const dragStart = drag.radius;
  listeners.pointerdown.at(-1)({ pointerId: 3, clientX: 40 });
  listeners.pointermove.at(-1)({ pointerId: 3, clientX: 40 + 90 });
  assert(drag.radius < dragStart - 15, 'drag right moves the ship inward');

  const threat = makeMirror(390, 844);
  threat.ramp = 0.1;
  let placed = false;
  for (let i = 0; i < 8 && !placed; i++) placed = threat.spawnShard();
  assert(placed, 'a fair shard can spawn from mid orbit');
  const shard = threat.shards.at(-1);
  assert(Math.abs(threat.radius - shard.r) < shard.hitR - 1, 'shard covers the current ship radius');
  assert(Math.abs(shard.safeR - shard.r) >= shard.hitR, 'shard leaves a safe pocket');
}

const env = { ...process.env, PORT: String(PORT), AERGER_FILE: path.join(root, 'data', `aerger-smoke-${PORT}.json`) };
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
  assert(health.version === '1.4' || health.version === '1.4.0', 'api version 1.4');

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
  assert(body.scores.every((s) => s.game === 'rush'), 'omitted game stays on the rush board');

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

  await new Promise((r) => setTimeout(r, 2100));
  const mirrorScore = computeScore(12000, 2, 50, 1);
  const mirrorPost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'MirrorPilot',
      score: mirrorScore,
      survivalMs: 12000,
      orbs: 2,
      comboBonus: 50,
      nearMisses: 1,
      game: 'mirror',
      clientId: 'd4e5f6a7-b8c9-4d01-8abc-def012345678',
    }),
  });
  const mirrorBody = await mirrorPost.json();
  assert(mirrorPost.ok, `mirror post failed: ${JSON.stringify(mirrorBody)}`);
  assert(mirrorBody.scores.every((s) => s.game === 'mirror'), 'express mirror board');
  assert(mirrorBody.scores.some((s) => s.name === 'MirrorPilot'), 'express mirror pilot');

  const rushBoard = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=rush`).then((r) => r.json());
  assert(rushBoard.scores.every((s) => s.game === 'rush'), 'express rush filter');
  assert(!rushBoard.scores.some((s) => s.name === 'MirrorPilot'), 'express keeps mirror off rush');
  const defaultBoard = await fetch(`http://127.0.0.1:${PORT}/api/scores`).then((r) => r.json());
  assert(!defaultBoard.scores.some((s) => s.name === 'MirrorPilot'), 'express default game is rush');
  const mirrorBoard = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=mirror`).then((r) => r.json());
  assert(mirrorBoard.scores.some((s) => s.name === 'MirrorPilot'), 'express mirror filter');
  const badGame = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=puzzle`);
  assert(badGame.status === 400, 'express rejects bad game filter');

  const aergerBase = `http://127.0.0.1:${PORT}`;
  const created = await fetch(`${aergerBase}/api/aerger/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ada' }),
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
  assert(created.status === 200 && created.data.code?.length === 6, 'aerger create');
  assert(created.data.state.seats[0].you === true, 'host is you');
  assert(!JSON.stringify(created.data.state).includes(created.data.secret), 'secret stays off the public state');
  const roomCode = created.data.code;
  const peekRes = await fetch(`${aergerBase}/api/aerger/room/${roomCode}`);
  const peek = await peekRes.json();
  assert(peekRes.status === 200 && peek.version === 1, 'aerger peek');
  const etag = peekRes.headers.get('etag');
  const cached = await fetch(`${aergerBase}/api/aerger/room/${roomCode}`, { headers: { 'If-None-Match': etag } });
  assert(cached.status === 304, 'aerger unchanged poll is 304');
  const tiny = await fetch(`${aergerBase}/api/aerger/room/${roomCode}?since=1`).then((res) => res.json());
  assert(tiny.unchanged === true && tiny.version === 1, 'aerger since=version is a tiny payload');
  const joined = await fetch(`${aergerBase}/api/aerger/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: roomCode, name: 'Bea', version: 1 }),
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
  assert(joined.status === 200, `aerger join ${JSON.stringify(joined.data)}`);
  const started = await fetch(`${aergerBase}/api/aerger/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: roomCode, secret: created.data.secret, version: joined.data.version }),
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
  assert(started.status === 200 && started.data.state.status === 'playing', 'aerger start');
  const version = started.data.version;
  const [rollA, rollB] = await Promise.all([
    fetch(`${aergerBase}/api/aerger/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, secret: created.data.secret, version }),
    }).then(async (res) => ({ status: res.status, data: await res.json() })),
    fetch(`${aergerBase}/api/aerger/roll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, secret: created.data.secret, version }),
    }).then(async (res) => ({ status: res.status, data: await res.json() })),
  ]);
  const race = [rollA.status, rollB.status].sort();
  assert(race[0] === 200 && race[1] === 409, `aerger roll race ${race}`);
  let cursor = rollA.status === 200 ? rollA.data : rollB.data;
  const secrets = [created.data.secret, joined.data.secret];
  let moved = false;
  for (let i = 0; i < 60 && !moved; i += 1) {
    const seat = cursor.state.turn;
    if (cursor.state.phase !== 'move') {
      const roll = await fetch(`${aergerBase}/api/aerger/roll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: roomCode, secret: secrets[seat], version: cursor.version }),
      }).then(async (res) => ({ status: res.status, data: await res.json() }));
      assert(roll.status === 200, `aerger roll ${JSON.stringify(roll.data)}`);
      cursor = roll.data;
    }
    if (cursor.state.phase === 'move') {
      const token = cursor.state.legal[0].token;
      const move = await fetch(`${aergerBase}/api/aerger/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: roomCode, secret: secrets[seat], version: cursor.version, token }),
      }).then(async (res) => ({ status: res.status, data: await res.json() }));
      assert(move.status === 200, `aerger move ${JSON.stringify(move.data)}`);
      const stale = await fetch(`${aergerBase}/api/aerger/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: roomCode, secret: secrets[seat], version: cursor.version, token }),
      });
      assert(stale.status === 409, 'aerger stale move rejected');
      moved = true;
    }
  }
  assert(moved, 'aerger played a legal move');
  const solo = await fetch(`${aergerBase}/api/aerger/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Solo' }),
  }).then((res) => res.json());
  const tooSoon = await fetch(`${aergerBase}/api/aerger/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: solo.code, secret: solo.secret, version: solo.version }),
  });
  assert(tooSoon.status === 409, 'aerger needs two players');

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
  fs.rmSync(path.join(root, 'data', `aerger-smoke-${PORT}.json`), { force: true });
}
