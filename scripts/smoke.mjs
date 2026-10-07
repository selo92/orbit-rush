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
const paintMod = await import(path.join(root, 'src', 'paint.js'));
assert(paintMod.selfCheck() === true, 'orbit paint rules');
assert(paintMod.PICTURES.length >= 20 && paintMod.PICTURES.length <= 24, 'paint gallery size');
const paintCats = new Set(paintMod.PICTURES.map((picture) => picture.category));
assert(
  paintCats.has('mandala') && paintCats.has('manga') && paintCats.has('maerchen') && paintCats.has('fee'),
  'paint categories'
);
assert(paintMod.PICTURES.filter((picture) => picture.category === 'fee').length >= 7, 'princess category');
assert(paintMod.CATEGORIES[0]?.id === 'fee', 'princess category leads the gallery');
for (const picture of paintMod.PICTURES) {
  const json = JSON.parse(fs.readFileSync(path.join(root, 'public', 'paint', `${picture.id}.json`), 'utf8'));
  const minRegions = picture.category === 'mandala' ? 80 : 150;
  assert(json.regions.length === picture.regionCount, `${picture.id} region count`);
  assert(json.regions.length >= minRegions && json.regions.length <= 450, `${picture.id} region range`);
  assert(json.colors.length === picture.colorCount, `${picture.id} colors`);
  const thumb = String(picture.thumb || `/paint/thumbs/${picture.id}.svg`).replace(/^\//, '');
  assert(fs.existsSync(path.join(root, 'public', thumb.replace(/^public\//, ''))), `${picture.id} thumb`);
  if (picture.category !== 'mandala') {
    assert(picture.reveal && picture.ink, `${picture.id} reveal`);
    const revealPath = path.join(root, 'public', String(picture.reveal).replace(/^\//, ''));
    assert(fs.existsSync(revealPath), `${picture.id} reveal file`);
    const revealSize = fs.statSync(revealPath).size;
    assert(revealSize >= 90_000 && revealSize <= 210_000, `${picture.id} reveal size ${revealSize}`);
  }
}
const paintHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(paintHtml.includes('btn-hub-paint') && paintHtml.includes('id="screen-paint"'), 'paint is on the hub');
assert(paintHtml.includes('id="paint-svg"'), 'paint board is svg');
const duelMod = await import(path.join(root, 'shared', 'duel.js'));
duelMod.selfCheck();
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
const duelMigration = fs.readFileSync(path.join(root, 'migrations', '0005_duel_rooms.sql'), 'utf8');
assert(duelMigration.includes('duel_rooms'), 'duel migration creates rooms');
assert(duelMigration.includes('version'), 'duel migration has version');
assert(!/ALTER TABLE scores/i.test(duelMigration), 'duel migration does not alter scores');

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
  assert(scoresMod.normalizeGame('Drift') === 'drift', 'normalize drift');
  assert(scoresMod.normalizeGame('Pulse') === 'pulse', 'normalize pulse');
  assert(scoresMod.normalizeGame('Jet') === 'jet', 'normalize jet');
  assert(scoresMod.normalizeGame('Dash') === 'dash', 'normalize dash');
  assert(scoresMod.normalizeGame('Hunt') === 'hunt', 'normalize hunt');
  assert(scoresMod.normalizeGame('nope') === 'rush', 'unknown game defaults to rush');
{
  const mixed = [
    { name: 'R', score: 10, ts: 1, difficulty: 'mittel', mode: 'normal' },
    { name: 'M', score: 50, ts: 2, difficulty: 'mittel', mode: 'normal', game: 'mirror' },
    { name: 'D', score: 80, ts: 3, difficulty: 'mittel', mode: 'normal', game: 'drift' },
    { name: 'J', score: 60, ts: 6, difficulty: 'mittel', mode: 'normal', game: 'jet' },
    { name: 'S', score: 40, ts: 7, difficulty: 'einfach', mode: 'normal', game: 'dash' },
    { name: 'P', score: 90, ts: 4, difficulty: 'schwer', mode: 'normal', game: 'pulse' },
    {
      name: 'PD',
      score: 70,
      ts: 5,
      difficulty: 'schwer',
      mode: 'daily',
      dailyDate: '2026-09-26',
      game: 'pulse',
    },
  ];
  const onlyM = scoresMod.selectBoard(mixed, { game: 'mirror' });
  assert(onlyM.length === 1 && onlyM[0].name === 'M' && onlyM[0].game === 'mirror', 'mirror board');
  const onlyD = scoresMod.selectBoard(mixed, { game: 'drift' });
  assert(onlyD.length === 1 && onlyD[0].name === 'D' && onlyD[0].game === 'drift', 'drift board');
  const onlyJ = scoresMod.selectBoard(mixed, { game: 'jet' });
  assert(onlyJ.length === 1 && onlyJ[0].name === 'J' && onlyJ[0].game === 'jet', 'jet board');
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
  assert(!badGame.ok && badGame.error === 'Invalid game (rush|mirror|drift|pulse|jet|dash|hunt)', 'reject bad game');
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
  const qDrift = scoresMod.validateScoresQuery(new URLSearchParams('game=drift'));
  assert(qDrift.ok && qDrift.game === 'drift', 'query drift');
  const driftBody = scoresMod.validatePostBody({
    name: 'A',
    score: computeScore(2000, 1, 0, 1),
    survivalMs: 2000,
    orbs: 1,
    comboBonus: 0,
    nearMisses: 1,
    game: 'drift',
  });
  assert(driftBody.ok && driftBody.value.game === 'drift', 'post drift');
  const jetBody = scoresMod.validatePostBody({
    name: 'JetPilot',
    score: 210,
    survivalMs: 1000,
    orbs: 2,
    comboBonus: 0,
    nearMisses: 0,
    game: 'jet',
    difficulty: 'schwer',
  });
  assert(jetBody.ok && jetBody.value.game === 'jet' && jetBody.value.difficulty === 'schwer', 'post jet');
  const onlyS = scoresMod.selectBoard(mixed, { game: 'dash' });
  assert(onlyS.length === 1 && onlyS[0].name === 'S' && onlyS[0].game === 'dash', 'dash board');
  const qDash = scoresMod.validateScoresQuery(new URLSearchParams('game=dash&difficulty=einfach'));
  assert(qDash.ok && qDash.game === 'dash' && qDash.difficulty === 'einfach', 'query dash');
  const dashBody = scoresMod.validatePostBody({
    name: 'DashPilot',
    score: computeScore(4000, 2, 50, 1),
    survivalMs: 4000,
    orbs: 2,
    comboBonus: 50,
    nearMisses: 1,
    game: 'dash',
    difficulty: 'einfach',
  });
  assert(dashBody.ok && dashBody.value.game === 'dash' && dashBody.value.difficulty === 'einfach', 'post dash');
  const onlyP = scoresMod.selectBoard(mixed, { game: 'pulse' });
  assert(onlyP.length === 2 && onlyP.every((row) => row.game === 'pulse'), 'pulse board includes its rows');
  const pulseDaily = scoresMod.selectBoard(mixed, {
    game: 'pulse',
    mode: 'daily',
    dailyDate: '2026-09-26',
  });
  assert(pulseDaily.length === 1 && pulseDaily[0].name === 'PD', 'pulse daily board');
  const pulseSchwer = scoresMod.selectBoard(mixed, { game: 'pulse', difficulty: 'schwer' });
  assert(pulseSchwer.length === 1 && pulseSchwer[0].name === 'P', 'pulse difficulty board skips daily');
  const qPulse = scoresMod.validateScoresQuery(
    new URLSearchParams('game=pulse&mode=daily&dailyDate=2026-09-26')
  );
  assert(qPulse.ok && qPulse.game === 'pulse' && qPulse.mode === 'daily', 'query pulse daily');
  const pulseBody = scoresMod.validatePostBody({
    name: 'A',
    score: computeScore(3000, 2, 50, 1),
    survivalMs: 3000,
    orbs: 2,
    comboBonus: 50,
    nearMisses: 1,
    game: 'pulse',
    difficulty: 'baba',
  });
  assert(pulseBody.ok && pulseBody.value.game === 'pulse' && pulseBody.value.difficulty === 'baba', 'post pulse');
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

  const { DriftGame } = await import(path.join(root, 'src', 'drift.js'));
  function makeDrift(w, h) {
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
    const d = new DriftGame(canvas, { audio, onGameOver() {}, onHud() {} });
    d.resize();
    d.alive = true;
    return d;
  }

  const steered = makeDrift(390, 844);
  steered.grace = 5;
  const x0 = steered.x;
  steered.input.left = true;
  steered.update(0.25);
  assert(steered.x < x0 - 0.08, 'left input steers toward the left wall');
  assert(
    steered.score === computeScore(steered.survivalMs, steered.orbsCollected, steered.comboBonus, steered.nearMisses),
    'drift score matches the shared formula'
  );

  const dragD = makeDrift(390, 844);
  dragD.bindInput();
  const dragX0 = dragD.x;
  dragD.running = true;
  listeners.pointerdown.at(-1)({ pointerId: 9, clientX: 40 });
  listeners.pointermove.at(-1)({ pointerId: 9, clientX: 40 + 80 });
  assert(dragD.x > dragX0 + 0.4, 'drag right steers right');

  const wideLane = [
    { z: 0, center: 0, half: 1, gate: false },
    { z: 4, center: 0, half: 1, gate: true },
    { z: 400, center: 0, half: 1, gate: false },
  ];
  const ringRun = makeDrift(390, 844);
  ringRun.grace = 5;
  ringRun.samples = wideLane.map((s) => ({ ...s, gate: false }));
  ringRun.cursorZ = 1000;
  ringRun.rings = [{ z: 5, x: 0, taken: false }];
  ringRun.playerZ = 0;
  ringRun.x = 0;
  ringRun.vx = 0;
  ringRun.update(0.3);
  assert(ringRun.orbsCollected === 1, 'a ring in the lane is collected');
  assert(
    ringRun.score === computeScore(ringRun.survivalMs, ringRun.orbsCollected, ringRun.comboBonus, ringRun.nearMisses),
    'ring score stays on the shared formula'
  );

  const graze = makeDrift(390, 844);
  graze.grace = 0;
  graze.samples = wideLane.map((s) => ({ ...s }));
  graze.cursorZ = 1000;
  graze.rings = [];
  graze.playerZ = 0;
  graze.x = 0.88;
  graze.vx = 0;
  graze.update(0.5);
  assert(graze.nearMisses === 1, 'tight clearance counts as a near miss');
  assert(graze.hull === 3, 'a near miss does not cost hull');

  const walls = makeDrift(390, 844);
  walls.grace = 0;
  walls.invuln = 0;
  walls.samples = [
    { z: 0, center: 0, half: 0.6, gate: false },
    { z: 200, center: 0, half: 0.6, gate: false },
    { z: 400, center: 0, half: 0.6, gate: false },
  ];
  walls.cursorZ = 1000;
  walls.rings = [];
  walls.playerZ = 100;
  walls.x = 2;
  walls.vx = 0;
  walls.update(1 / 60);
  assert(walls.hull === 2 && walls.alive, 'leaving the lane costs one hull');
  walls.invuln = 0;
  walls.x = 2;
  walls.update(1 / 60);
  walls.invuln = 0;
  walls.x = 2;
  walls.update(1 / 60);
  assert(walls.hull === 0 && walls.alive === false, 'the third wall hit ends the run');

  const pace = makeDrift(390, 844);
  pace.setDifficulty('einfach');
  const easySpeed = pace.speedAt(0);
  pace.setDifficulty('mittel');
  const midSpeed = pace.speedAt(0);
  pace.setDifficulty('schwer');
  const hardSpeed = pace.speedAt(0);
  pace.setDifficulty('baba');
  const babaSpeed = pace.speedAt(0);
  assert(easySpeed < 24, 'einfach starts slower than the old tunnel');
  assert(midSpeed > 24, 'mittel starts faster than the old tunnel');
  assert(easySpeed < midSpeed && midSpeed < hardSpeed && hardSpeed < babaSpeed, 'speed climbs with difficulty');
  assert(pace.speedAt(2000) > babaSpeed, 'baba ramps above its base speed');

  for (const id of ['einfach', 'mittel', 'schwer', 'baba']) {
    const d = makeDrift(390, 844);
    d.setDifficulty(id);
    const cfg = d.diff;
    const cap = cfg.speedBase + cfg.speedGain + cfg.speedLate;
    const far = cfg.speedDist * 4;
    assert(d.speedAt(0, 0) === cfg.speedBase, `${id} opens at its base speed`);
    assert(d.speedAt(0, 4) - cfg.speedBase < 0.4, `${id} time ramp stays gentle for the first seconds`);
    assert(d.speedAt(far, 0) === cfg.speedBase + cfg.speedGain, `${id} distance ramp still plateaus without the time ramp`);
    const mid = d.speedAt(far, cfg.speedRampSec * 0.5);
    const full = d.speedAt(far, cfg.speedRampSec);
    const later = d.speedAt(far, cfg.speedRampSec + 30);
    assert(d.speedAt(far, 0) < mid && mid < full, `${id} keeps accelerating after the distance plateau`);
    assert(Math.abs(full - cap) < 1e-9 && Math.abs(later - cap) < 1e-9, `${id} speed caps at base + gain + late`);
  }

  const early = makeDrift(390, 844);
  early.setDifficulty('mittel');
  early.resetState();
  early.grace = 999;
  early.alive = true;
  for (let i = 0; i < 180; i++) early.update(1 / 60);
  const lived = early.speedAt(early.playerZ, early.survivalMs / 1000);
  const distOnly = early.speedAt(early.playerZ, 0);
  assert(early.alive && early.survivalMs > 2500, 'a short mittel run survives the opening');
  assert(lived > distOnly && lived - distOnly < 0.5, 'three seconds add only a small time-ramp bump');

  function laneHalf(id, z) {
    const d = makeDrift(390, 844);
    d.setDifficulty(id);
    d.resetState();
    d.playerZ = z;
    d.ensureTrack();
    return d.sampleAt(z).half;
  }
  assert(laneHalf('mittel', 700) < laneHalf('einfach', 700), 'mittel lane is narrower than einfach');
  assert(laneHalf('baba', 700) < laneHalf('schwer', 700), 'baba lane is narrower than schwer');

  const graded = makeDrift(390, 844);
  graded.setDifficulty('schwer');
  const gradedResult = graded.buildResult();
  assert(gradedResult.game === 'drift' && gradedResult.difficulty === 'schwer', 'drift score keeps the chosen difficulty');

  for (const id of ['einfach', 'mittel', 'schwer', 'baba']) {
    const d = makeDrift(390, 844);
    d.setDifficulty(id);
    const half = d.diff.halfMin;
    d.obstacles = [];
    for (let i = 0; i < 24; i++) d.spawnObstacle(80 + i * 20, 0, half, 1);
    assert(d.obstacles.length > 0, `${id} spawns obstacles`);
    for (const obs of d.obstacles) {
      if (obs.kind === 'barrier') {
        assert(2 * half - obs.cover >= d.diff.minGap - 0.001, `${id} barrier leaves a gap`);
      } else if (obs.kind === 'spike') {
        assert(half - obs.depth >= d.diff.minGap - 0.001, `${id} spike leaves a gap`);
      } else {
        const near = half - Math.abs(obs.x) - obs.radius;
        assert(near >= d.diff.minGap - 0.02, `${id} debris leaves a gap`);
      }
    }
  }

  const wide = [
    { z: 0, center: 0, half: 1.4, gate: false },
    { z: 400, center: 0, half: 1.4, gate: false },
  ];
  const crash = makeDrift(390, 844);
  crash.grace = 0;
  crash.invuln = 0;
  crash.samples = wide.map((s) => ({ ...s }));
  crash.cursorZ = 2000;
  crash.rings = [];
  crash.obstacles = [{ z: 8, kind: 'debris', x: 0, radius: 0.45, side: 1, resolved: false }];
  crash.playerZ = 0;
  crash.x = 0;
  crash.vx = 0;
  crash.update(0.4);
  assert(crash.hull === 2 && crash.alive, 'debris in the lane costs one hull');

  const dodge = makeDrift(390, 844);
  dodge.grace = 0;
  dodge.invuln = 0;
  dodge.samples = wide.map((s) => ({ ...s }));
  dodge.cursorZ = 2000;
  dodge.rings = [];
  dodge.obstacles = [{ z: 8, kind: 'debris', x: -0.9, radius: 0.2, side: -1, resolved: false }];
  dodge.playerZ = 0;
  dodge.x = 0.8;
  dodge.vx = 0;
  dodge.update(0.4);
  assert(dodge.hull === 3, 'a clear line past debris keeps the hull');

  const bar = makeDrift(390, 844);
  bar.grace = 0;
  bar.invuln = 0;
  bar.samples = wide.map((s) => ({ ...s }));
  bar.cursorZ = 2000;
  bar.rings = [];
  bar.obstacles = [{ z: 8, kind: 'barrier', side: 1, cover: 0.9, resolved: false }];
  bar.playerZ = 0;
  bar.x = 1;
  bar.vx = 0;
  bar.update(0.4);
  assert(bar.hull === 2, 'a barrier on your side costs hull');

  const slip = makeDrift(390, 844);
  slip.grace = 0;
  slip.invuln = 0;
  slip.samples = wide.map((s) => ({ ...s }));
  slip.cursorZ = 2000;
  slip.rings = [];
  slip.obstacles = [{ z: 8, kind: 'barrier', side: 1, cover: 0.9, resolved: false }];
  slip.playerZ = 0;
  slip.x = -0.6;
  slip.vx = 0;
  slip.update(0.4);
  assert(slip.hull === 3, 'the open side of a barrier is safe');

  const spike = makeDrift(390, 844);
  spike.grace = 0;
  spike.invuln = 0;
  spike.hull = 1;
  spike.samples = wide.map((s) => ({ ...s }));
  spike.cursorZ = 2000;
  spike.rings = [];
  spike.obstacles = [{ z: 8, kind: 'spike', side: -1, depth: 0.7, resolved: false }];
  spike.playerZ = 0;
  spike.x = -1.0;
  spike.vx = 0;
  spike.update(0.4);
  assert(spike.hull === 0 && spike.alive === false, 'a third spike hit ends the run');

  const { JetGame, JET_STAGES, JET_BOSS_HP_SCALE, getJetDifficulty, formatJetFormula, CARRIER_LASER, TITAN_PILLAR, WYRM_BEAM, JET_HIT_LINES, JET_ATTACK_TIPS } = await import(path.join(root, 'src', 'jet.js'));
  function makeJet(w, h) {
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
    const jet = new JetGame(canvas, { audio, onGameOver() {}, onHud() {} });
    jet.resize();
    jet.alive = true;
    return jet;
  }

  assert(JET_STAGES.length >= 4, 'jet has four stages');
  assert(new Set(JET_STAGES.map((s) => s.boss)).size === JET_STAGES.length, 'each jet stage has its own boss');
  assert(JET_STAGES.map((s) => s.name).join('|') === 'Neon City|Desert Dusk|Ice Orbit|Storm Nebula', 'stage names');
  assert(JET_BOSS_HP_SCALE === 0.6, 'bosses share a 40% HP cut');
  const bossHpMittel = { carrier: 138, wyrm: 150, frost: 144, titan: 174 };
  for (let i = 0; i < JET_STAGES.length; i++) {
    const fight = makeJet(390, 844);
    fight.stageIndex = i;
    fight.beginBoss();
    const stage = JET_STAGES[i];
    assert(
      fight.boss.hp === bossHpMittel[stage.boss] && fight.boss.maxHp === fight.boss.hp,
      `${stage.bossName} starts at the reduced mittel HP`
    );
  }
  const looped = makeJet(390, 844);
  looped.cycle = 1;
  looped.beginBoss();
  assert(looped.boss.hp === 177, 'later loops still scale the reduced boss HP');
  const plain = makeJet(390, 844).spawnEnemy('scout', 10, 10);
  assert(plain.hp === 3, 'regular enemies keep their HP');
  assert(getJetDifficulty('einfach').speed < getJetDifficulty('mittel').speed, 'einfach is slower');
  assert(getJetDifficulty('mittel').speed < getJetDifficulty('schwer').speed, 'schwer is faster than mittel');
  assert(getJetDifficulty('schwer').speed < getJetDifficulty('baba').speed, 'baba is the fastest jet');
  assert(getJetDifficulty('einfach').lives === 4 && getJetDifficulty('baba').lives === 2, 'lives follow the grade');

  const armed = makeJet(390, 844);
  armed.weapon = 4;
  armed.lives = 3;
  armed.invuln = 0;
  armed.hurt();
  assert(armed.weapon === 3 && armed.lives === 2 && armed.alive, 'a hit drops one weapon tier and one life');
  armed.invuln = 0;
  armed.shield = 2;
  armed.hurt();
  assert(armed.weapon === 3 && armed.shield === 1 && armed.lives === 2, 'shield absorbs the hit');
  armed.invuln = 0;
  armed.shield = 0;
  armed.weapon = 1;
  armed.hurt();
  assert(armed.weapon === 1 && armed.lives === 1, 'weapon tier stays at single');

  const guns = makeJet(390, 844);
  guns.weapon = 1;
  guns.grantPickup('weapon');
  guns.grantPickup('weapon');
  guns.grantPickup('weapon');
  guns.grantPickup('weapon');
  guns.grantPickup('weapon');
  assert(guns.weapon === 5, 'weapon pickups climb to laser and stop');
  guns.grantPickup('shield');
  guns.grantPickup('slow');
  guns.grantPickup('bomb');
  guns.grantPickup('magnet');
  guns.grantPickup('overdrive');
  guns.grantPickup('drone');
  assert(guns.shield === 2 && guns.slowT > 0 && guns.bombs === 1, 'special pickups arm shield, slow-mo, and a bomb');
  assert(guns.magnetT > 0 && guns.overT > 0 && guns.droneT > 0, 'magnet, overdrive, and drone are timed');

  const cleared = makeJet(390, 844);
  cleared.running = true;
  cleared.paused = false;
  const stray = cleared.spawnEBullet(40, 40, 0, 40);
  cleared.bombs = 1;
  assert(cleared.fireBomb() === true && stray.alive === false, 'bomb clears enemy bullets');

  const jetGraze = makeJet(390, 844);
  jetGraze.px = 120;
  jetGraze.py = 200;
  jetGraze.invuln = 0;
  jetGraze.spawnEBullet(120, 226, 0, 0);
  jetGraze.collide();
  assert(jetGraze.nearMisses === 1 && jetGraze.lives === getJetDifficulty('mittel').lives, 'a close bullet is a graze');

  const kill = makeJet(390, 844);
  const scout = kill.spawnEnemy('scout', 180, 300);
  scout.hp = 1;
  scout.x = 180;
  scout.y = 300;
  kill.spawnPBullet(180, 300, 0, 0, 4, 0);
  kill.collide();
  assert(scout.alive === false && kill.orbsCollected >= 1, 'a bullet kill scores a target');
  assert(
    kill.score === computeScore(kill.survivalMs, kill.orbsCollected, kill.comboBonus, kill.nearMisses),
    'jet score matches the shared formula'
  );

  const follow = makeJet(390, 844);
  follow.running = true;
  follow.paused = false;
  follow.spawnCd = 30;
  follow.obsCd = 30;
  follow.pickupCd = 30;
  follow.bindInput();
  listeners.pointerdown.at(-1)({ pointerId: 11, clientX: 330, clientY: 700 });
  const jetBefore = follow.px;
  follow.update(0.45);
  assert(follow.px > jetBefore + 60, 'pointer follow moves the jet');

  const steer = makeJet(390, 844);
  steer.spawnCd = 30;
  steer.obsCd = 30;
  steer.pickupCd = 30;
  steer.aiming = false;
  steer.keys.left = true;
  const jetX0 = steer.px;
  steer.update(0.2);
  assert(steer.px < jetX0 - 20, 'left key steers the jet');

  const bosses = makeJet(390, 844);
  bosses.stageIndex = 0;
  bosses.beginBoss();
  bosses.introT = 0;
  bosses.boss.attackT = 2.5;
  bosses.px = 30;
  bosses.stepBoss(0.08);
  assert(bosses.boss.kind === 'carrier', 'neon city boss is the carrier');
  assert(bosses.enemies.some((e) => e.alive && e.kind === 'drone'), 'carrier deploys drones');
  bosses.boss.attackT = 1.2;
  bosses.stepBoss(0.05);
  assert(bosses.boss.laser === 'hot', 'carrier sweeps a laser');

  assert(CARRIER_LASER.warn >= 0.8 && CARRIER_LASER.warn <= 1.2, 'carrier telegraph lasts about a second');
  assert(TITAN_PILLAR.warn >= 0.8 && TITAN_PILLAR.warn <= 1.2, 'titan pillar telegraph lasts about a second');
  const fair = makeJet(390, 844);
  fair.beginBoss();
  fair.introT = 1.1;
  fair.boss.attackT = 3;
  fair.stepBoss(0.05);
  assert(fair.boss.laser === 'off' && fair.boss.attackT === 0, 'the laser waits until the boss title clears');
  fair.introT = 0;
  fair.boss.attackT = CARRIER_LASER.warn * 0.55;
  fair.stepBoss(0);
  assert(fair.boss.laser === 'warn', 'carrier laser telegraphs before it burns');
  fair.px = fair.boss.laserX;
  fair.invuln = 0;
  fair.shield = 2;
  const warnLives = fair.lives;
  const warnShield = fair.shield;
  fair.stepBoss(0.02);
  assert(
    fair.boss.laser === 'warn' && fair.lives === warnLives && fair.shield === warnShield,
    'the telegraph does not spend a life or a shield'
  );
  fair.boss.laserDir = 1;
  fair.boss.attackT = CARRIER_LASER.warn + CARRIER_LASER.sweep * 0.5;
  fair.stepBoss(0);
  assert(fair.boss.laser === 'hot', 'the beam is hot while it crosses');
  const gapL = fair.boss.laserX - fair.boss.laserW * 0.5;
  const gapR = fair.w - (fair.boss.laserX + fair.boss.laserW * 0.5);
  assert(fair.boss.laserW / fair.w <= 0.18, 'carrier laser stays under 18% of the play width');
  assert(gapL > fair.w * 0.3 && gapR > fair.w * 0.3, 'mid-sweep leaves a safe lane on both sides');
  const xEarly = (() => {
    fair.boss.attackT = CARRIER_LASER.warn + 0.04;
    fair.stepBoss(0);
    return fair.boss.laserX;
  })();
  fair.boss.attackT = CARRIER_LASER.warn + CARRIER_LASER.sweep * 0.7;
  fair.stepBoss(0);
  assert(fair.boss.laserX > xEarly + fair.w * 0.25, 'the hot beam sweeps across the field');
  fair.px = fair.boss.laserX + fair.boss.laserW * 0.5 + 2;
  fair.invuln = 0;
  fair.shield = 0;
  const beside = fair.lives;
  fair.stepBoss(0);
  assert(fair.lives === beside, 'the hitbox stops at the drawn beam');
  fair.px = fair.boss.laserX;
  fair.shield = 2;
  fair.weapon = 4;
  fair.invuln = 0;
  const shieldedLives = fair.lives;
  fair.stepBoss(0);
  assert(
    fair.shield === 1 && fair.lives === shieldedLives && fair.weapon === 4,
    'Schild absorbs the carrier laser'
  );
  fair.px = fair.boss.laserX;
  fair.shield = 0;
  fair.invuln = 0;
  const openLives = fair.lives;
  fair.stepBoss(0);
  assert(fair.lives === openLives - 1, 'without a shield the carrier laser costs a life');
  assert(fair.hitText === JET_HIT_LINES.laser, 'a carrier laser hit names the beam');
  fair.boss.attackT = CARRIER_LASER.warn + CARRIER_LASER.sweep + 0.04;
  fair.stepBoss(0);
  assert(fair.boss.laser === 'off', 'the beam switches off instead of holding the lane');
  fair.boss.laserDir = 1;
  fair.boss.attackT = CARRIER_LASER.cycle;
  fair.stepBoss(0);
  assert(fair.boss.laserDir === -1, 'the next sweep comes from the other side');

  const pocket = makeJet(390, 844);
  pocket.beginBoss();
  pocket.introT = 0;
  pocket.boss.laserDir = 1;
  pocket.px = 36;
  pocket.invuln = 0;
  pocket.shield = 0;
  pocket.boss.attackT = CARRIER_LASER.warn;
  const leftLives = pocket.lives;
  const sweepSteps = 36;
  const sweepDt = (CARRIER_LASER.sweep + 0.08) / sweepSteps;
  for (let i = 0; i < sweepSteps; i++) pocket.stepBoss(sweepDt);
  assert(pocket.lives === leftLives && pocket.boss.laser === 'off', 'the left pocket stays safe for a full left-to-right sweep');
  pocket.boss.laserDir = 1;
  pocket.boss.attackT = CARRIER_LASER.warn;
  pocket.px = pocket.w - 36;
  pocket.invuln = 0;
  pocket.shield = 0;
  const rightLives = pocket.lives;
  for (let i = 0; i < sweepSteps; i++) pocket.stepBoss(sweepDt);
  assert(pocket.lives === rightLives, 'the right pocket stays safe so the beam cannot pin the jet');

  bosses.stageIndex = 1;
  bosses.beginBoss();
  bosses.introT = 0;
  bosses.boss.state = 'emerge';
  bosses.boss.stateT = 0;
  bosses.boss.attackT = WYRM_BEAM.idle + 0.1;
  bosses.px = 40;
  bosses.stepBoss(0.05);
  assert(bosses.boss.kind === 'wyrm', 'desert boss is the sand wyrm');
  assert(bosses.boss.beam === 'warn', 'sand beam telegraphs before it hits');
  assert(bosses.sandstorm === 0, 'the sand storm no longer blinds the field');
  assert(WYRM_BEAM.warn >= 0.8 && WYRM_BEAM.warn <= 1.2, 'sand beam telegraph lasts about a second');
  bosses.boss.state = 'emerge';
  bosses.boss.stateT = WYRM_BEAM.surface + 0.05;
  bosses.boss.attackT = 0;
  bosses.stepBoss(0.05);
  assert(bosses.boss.state === 'burrow' && bosses.boss.visible === false, 'sand wyrm burrows');

  const sand = makeJet(390, 844);
  sand.stageIndex = 1;
  sand.beginBoss();
  sand.introT = 1.1;
  sand.boss.attackT = 4;
  sand.stepBoss(0.05);
  assert(sand.boss.beam === 'off' && sand.boss.attackT === 0, 'the sand beam waits until the boss title clears');
  sand.introT = 0;
  sand.boss.state = 'emerge';
  sand.boss.stateT = 0;
  sand.px = 36;
  sand.boss.attackT = WYRM_BEAM.idle + WYRM_BEAM.warn * 0.4;
  sand.boss.beamLocked = false;
  sand.invuln = 0;
  sand.shield = 0;
  const sandStray = sand.spawnEBullet(sand.px, sand.py, 0, 0);
  const sandWarnLives = sand.lives;
  sand.stepBoss(0.02);
  assert(sandStray.alive === false, 'the sand warning clears shots already in the air');
  assert(sand.boss.beam === 'warn' && sand.boss.beamSide === -1, 'the sand column locks onto the side you occupy');
  assert(sand.lives === sandWarnLives && sand.shield === 0, 'the sand telegraph does not spend a life');
  assert(sand.tipText === JET_ATTACK_TIPS.sand, 'the first sand beam shows a dodge tip');
  sand.px = sand.w - 30;
  sand.stepBoss(0.05);
  assert(sand.boss.beamSide === -1, 'the sand column does not chase you during the warning');
  assert(sand.boss.beamW / sand.w <= 0.46, 'the sand column stays under half the field');
  assert(sand.w - sand.boss.beamW >= sand.w * 0.5, 'the open side is at least half the field');
  sand.tipText = '';
  sand.boss.attackT = WYRM_BEAM.idle + 0.05;
  sand.boss.beamLocked = false;
  sand.stepBoss(0);
  assert(sand.tipText === '' && sand.attackSeen.sand === true, 'the sand tip shows once per run');
  sand.boss.beamLocked = true;
  sand.boss.beamSide = -1;
  sand.boss.beamW = sand.wyrmBeamWidth();
  sand.boss.attackT = WYRM_BEAM.idle + WYRM_BEAM.warn;
  sand.px = sand.w - 28;
  sand.invuln = 0;
  sand.shield = 0;
  const sandSafeLives = sand.lives;
  const sandHotSteps = 24;
  const sandHotDt = (WYRM_BEAM.hot - 0.08) / sandHotSteps;
  for (let i = 0; i < sandHotSteps; i++) sand.stepBoss(sandHotDt);
  assert(sand.lives === sandSafeLives && sand.boss.beam === 'hot', 'the open side stays safe for the whole sand beam');
  sand.boss.beamLocked = true;
  sand.boss.beamSide = -1;
  sand.boss.attackT = WYRM_BEAM.idle + WYRM_BEAM.warn + 0.04;
  sand.px = 18;
  sand.invuln = 0;
  sand.shield = 2;
  const sandShieldLives = sand.lives;
  sand.stepBoss(0);
  assert(sand.shield === 1 && sand.lives === sandShieldLives, 'Schild absorbs the sand beam');
  assert(sand.hitText === JET_HIT_LINES.sand, 'a sand hit names the beam');
  sand.px = 18;
  sand.invuln = 0;
  sand.shield = 0;
  const sandOpenLives = sand.lives;
  sand.stepBoss(0);
  assert(sand.lives === sandOpenLives - 1, 'without a shield the sand beam costs a life');
  sand.boss.state = 'burrow';
  sand.boss.stateT = 0.2;
  sand.boss.nextX = sand.px;
  sand.boss.visible = false;
  sand.invuln = 0;
  sand.shield = 0;
  const burrowLives = sand.lives;
  sand.stepBoss(0.2);
  assert(sand.boss.state === 'burrow' && sand.boss.beam === 'off', 'burrow keeps the beam off');
  assert(sand.lives === burrowLives, 'the burrow marker is not a hidden hitbox');

  const reasons = makeJet(390, 844);
  reasons.lives = 6;
  reasons.px = 120;
  reasons.py = 400;
  reasons.invuln = 0;
  reasons.spawnEBullet(120, 400, 0, 0);
  reasons.collide();
  assert(reasons.hitText === JET_HIT_LINES.bullet && reasons.hitT > 1 && reasons.hitT <= 2, 'a colliding shot is a Gegnerschuss');
  const rock = reasons.spawnObstacle();
  reasons.alive = true;
  reasons.lives = 6;
  reasons.invuln = 0;
  rock.x = reasons.px;
  rock.y = reasons.py;
  rock.r = 20;
  rock.alive = true;
  reasons.collide();
  assert(reasons.hitText === JET_HIT_LINES.obstacle, 'a colliding rock is a Hindernis');
  reasons.invuln = 0;
  reasons.hurt('boss');
  assert(reasons.hitText === JET_HIT_LINES.boss, 'a boss hit names itself');
  reasons.invuln = 0;
  reasons.hurt('enemy');
  assert(reasons.hitText === JET_HIT_LINES.enemy, 'a ram names the enemy');
  const named = reasons.buildResult();
  assert(named.hitReason === JET_HIT_LINES.enemy, 'the run result keeps the last hit reason');

  bosses.stageIndex = 2;
  bosses.beginBoss();
  bosses.boss.laneCd = 0.01;
  bosses.stepBoss(0.05);
  assert(bosses.boss.kind === 'frost' && bosses.boss.lanes.length >= 1, 'frost core freezes a lane');

  bosses.stageIndex = 3;
  bosses.beginBoss();
  bosses.px = bosses.w * 0.5;
  bosses.boss.pillarCd = 0.01;
  bosses.stepBoss(0.05);
  assert(bosses.boss.kind === 'titan' && bosses.boss.pillars.length >= 1, 'storm titan telegraphs pillars');
  const pillar = bosses.boss.pillars[0];
  assert(pillar.warn >= 0.8 && pillar.warn <= 1.2, 'titan pillar warns before it strikes');
  assert(pillar.hot <= 0.55 && pillar.w / bosses.w <= 0.18, 'titan pillar is a short narrow column');
  bosses.px = pillar.x;
  bosses.invuln = 0;
  bosses.shield = 1;
  const titanShieldLives = bosses.lives;
  pillar.age = pillar.warn;
  bosses.stepBoss(0.05);
  assert(bosses.shield === 0 && bosses.lives === titanShieldLives, 'a shield absorbs a titan pillar');
  bosses.px = pillar.x;
  bosses.invuln = 0;
  bosses.shield = 0;
  const livesBefore = bosses.lives;
  pillar.age = pillar.warn;
  bosses.stepBoss(0.05);
  assert(bosses.lives === livesBefore - 1, 'a hot lightning pillar costs a life');
  assert(bosses.hitText === JET_HIT_LINES.boss, 'a titan pillar is a boss attack');

  const next = makeJet(390, 844);
  next.phase = 'banner';
  next.bannerT = 0.01;
  next.stageIndex = 0;
  next.spawnCd = 30;
  next.update(0.08);
  assert(next.stageIndex === 1 && next.phase === 'wave', 'clearing a stage opens the next one');
  next.phase = 'banner';
  next.bannerT = 0.01;
  next.stageIndex = 3;
  next.update(0.08);
  assert(next.stageIndex === 0 && next.cycle === 1, 'after the titan the run loops harder');

  const posted = makeJet(390, 844);
  posted.setDifficulty('schwer');
  posted.awardOrb(6);
  posted.survivalMs = 4000;
  posted.syncScore();
  const result = posted.buildResult();
  assert(result.game === 'jet' && result.difficulty === 'schwer', 'jet result keeps the board and grade');
  assert(result.formula === formatJetFormula(result.survivalMs, result.orbs, result.comboBonus, result.nearMisses, result.score), 'formula matches');
  const accepted = scoresMod.validatePostBody({
    name: 'JetPilot',
    score: result.score,
    survivalMs: result.survivalMs,
    orbs: result.orbs,
    comboBonus: result.comboBonus,
    nearMisses: result.nearMisses,
    difficulty: result.difficulty,
    game: result.game,
  });
  assert(accepted.ok, `jet run passes the server check ${accepted.error || ''}`);
}

{
  const {
    DashGame,
    DASH_LANES,
    DASH_LANES_4,
    DASH_STAGES,
    LANE_PITCH,
    planDashRow,
    dashSpeed,
    dashSpeedKmh,
    dashHitsLane,
    dashLaneWorld,
    dashBlockCount,
    dashJumpClears,
    pickDashKind,
    getDashDifficulty,
    formatDashFormula,
    JUMP_SEC,
  } = await import(path.join(root, 'src', 'dash.js'));

  function makeDash() {
    const canvas = {
      width: 390,
      height: 844,
      style: {},
      getContext() {
        return { setTransform() {} };
      },
      addEventListener() {},
      removeEventListener() {},
      setPointerCapture() {},
    };
    const audio = new Proxy({}, { get: () => () => {} });
    return new DashGame(canvas, { audio, onGameOver() {}, onHud() {} });
  }

  let prev = null;
  let seed = 17;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 240; i++) {
    const two = i % 4 === 0 ? 1 : 0.15;
    const plan = planDashRow(rnd, prev, two);
    assert(plan.blocked.length >= 1 && plan.blocked.length <= 2, 'a row blocks one or two lanes');
    if (two === 1) assert(plan.blocked.length === 2, 'a full double-wall chance blocks two lanes');
    assert(!plan.blocked.includes(plan.safe), 'the safe lane is open');
    assert(DASH_LANES.some((lane) => !plan.blocked.includes(lane)), 'a row never seals every lane');
    if (prev != null) assert(Math.abs(plan.safe - prev) <= 1, 'the open lane stays one swipe away');
    prev = plan.safe;
  }

  let widePrev = null;
  let wideSeed = 91;
  const wideRnd = () => {
    wideSeed = (wideSeed * 16807) % 2147483647;
    return (wideSeed - 1) / 2147483646;
  };
  let sawOne = false;
  let sawThree = false;
  for (let i = 0; i < 240; i++) {
    const plan = planDashRow(wideRnd, widePrev, i / 240, 4);
    assert(plan.blocked.length >= 1 && plan.blocked.length <= 3, 'a 4-lane row blocks one to three lanes');
    assert(plan.blocked.length < DASH_LANES_4.length, 'a 4-lane row never seals every lane');
    assert(!plan.blocked.includes(plan.safe), 'the 4-lane safe lane is open');
    assert(DASH_LANES_4.includes(plan.safe), 'the safe lane is one of the four');
    for (const lane of plan.blocked) assert(DASH_LANES_4.includes(lane), 'blocked lanes stay on the four-lane road');
    if (widePrev != null) assert(Math.abs(plan.safe - widePrev) <= 1, 'the 4-lane opening stays one swipe away');
    if (plan.blocked.length === 1) sawOne = true;
    if (plan.blocked.length === 3) sawThree = true;
    widePrev = plan.safe;
  }
  assert(sawOne && sawThree, '4-lane rows use both a single block and a triple block');
  assert(dashBlockCount(0, () => 0, 4) === 1, 'a calm 4-lane roll blocks one lane');
  assert(dashBlockCount(1, () => 0.99, 4) === 3, 'a dense 4-lane roll blocks three lanes');
  assert(dashBlockCount(1, () => 0, 3) === 2, 'a full 3-lane density still blocks two');

  const einfach = getDashDifficulty('einfach');
  const mittel = getDashDifficulty('mittel');
  const schwer = getDashDifficulty('schwer');
  const baba = getDashDifficulty('baba');
  assert(einfach.lanes === 3 && mittel.lanes === 3, 'einfach and mittel stay on three lanes');
  assert(schwer.lanes === 4 && baba.lanes === 4, 'schwer and baba use four lanes');
  assert(einfach.speedBase === 12 && einfach.speedCap === 20, 'einfach runs 12→20 m/s');
  assert(mittel.speedBase === 18 && mittel.speedCap === 31, 'mittel runs 18→31 m/s');
  assert(schwer.speedBase === 22 && schwer.speedCap === 38, 'schwer runs 22→38 m/s');
  assert(baba.speedBase === 26 && baba.speedCap === 46, 'baba runs 26→46 m/s');
  assert(einfach.speedBase < baba.speedBase, 'baba starts faster than einfach');
  assert(dashSpeed(einfach, 0, 0) === einfach.speedBase, 'opening speed is the preset base');
  assert(dashSpeed(baba, 100000, 100000) === baba.speedCap, 'speed ramp stops at the cap');
  assert(dashSpeed(einfach, 100000, 100000) <= einfach.speedCap, 'einfach cap holds');
  assert(einfach.speedCap < mittel.speedCap && mittel.speedCap < schwer.speedCap && schwer.speedCap < baba.speedCap, 'caps climb with the grade');
  assert(dashSpeedKmh(20) === 72 && dashSpeedKmh(0) === 0, 'HUD speed is km/h');
  assert(DASH_STAGES.map((stage) => stage.name).join('|') === 'Neonstadt|Leerentunnel|Cyber-Gasse', 'stages run city, void, alley');
  assert(pickDashKind(() => 0, DASH_STAGES[1], einfach) === 'low', 'the void tunnel can spawn a low wall');
  assert(pickDashKind(() => 0.999, DASH_STAGES[2], baba) === 'crate', 'the alley can spawn a crate');
  assert(dashJumpClears(JUMP_SEC / 2) === true, 'the jump apex clears a low wall');
  assert(dashJumpClears(0) === false && dashJumpClears(JUMP_SEC) === false, 'standing and takeoff do not clear');
  assert(!dashHitsLane(0, 1), 'a centered runner does not touch the side lane');
  assert(dashHitsLane(0, 0), 'a centered runner hits a center blocker');

  const swipe = makeDash();
  swipe.running = true;
  swipe.alive = true;
  swipe.paused = false;
  assert(swipe.handleSwipe(0, 80) === false && swipe.lane === 0 && swipe.jumpT === 0, 'a downward swipe does nothing');
  assert(swipe.handleSwipe(20, 0) === false && swipe.lane === 0, 'a short swipe is ignored');
  assert(swipe.handleSwipe(40, 12) === true && swipe.lane === 1, 'one horizontal swipe steps one lane');
  assert(swipe.handleSwipe(48, 4) === false && swipe.lane === 1, 'a second swipe at the edge stays put');
  assert(swipe.nudge(-1) === true && swipe.lane === 0, 'A/D style step moves back one lane');
  assert(swipe.nudge(-1) === true && swipe.nudge(-1) === false && swipe.lane === -1, 'two steps reach the far lane and stop');
  assert(swipe.handleSwipe(0, -40) === true && swipe.jumpT > 0, 'an upward swipe jumps');
  assert(swipe.handleSwipe(0, -48) === false, 'a second jump while airborne does nothing');

  const wide = makeDash();
  wide.setDifficulty('schwer');
  wide.resetState();
  wide.running = true;
  wide.alive = true;
  assert(wide.laneList.length === 4 && wide.lane === -0.5, 'schwer starts on a middle lane of four');
  assert(wide.nudge(1) && wide.lane === 0.5, 'one swipe still moves a single lane on four');
  assert(wide.nudge(1) && wide.lane === 1.5 && wide.nudge(1) === false, 'the outer lane is the end of the road');
  wide.stop();

  const crash = makeDash();
  crash.running = true;
  crash.alive = true;
  crash.grace = 0;
  crash.distance = 40;
  crash.lane = 0;
  crash.x = 0;
  crash.nextZ = 1e9;
  crash.rows = [
    {
      id: 1,
      z: 40.3,
      blocked: [0],
      safe: 1,
      kind: 'barrier',
      depth: 1.2,
      ring: false,
      ringTaken: false,
      resolved: false,
    },
  ];
  crash.update(0.02);
  assert(crash.alive === false, 'a blocker in the current lane ends the run');
  crash.stop();

  const hop = makeDash();
  hop.running = true;
  hop.alive = true;
  hop.grace = 0;
  hop.distance = 40;
  hop.lane = 0;
  hop.x = 0;
  hop.jumpT = JUMP_SEC / 2 + 0.02;
  hop.nextZ = 1e9;
  hop.rows = [
    {
      id: 3,
      z: 40.3,
      blocked: [0],
      safe: 1,
      kind: 'low',
      jumpable: true,
      depth: 0.95,
      ring: false,
      ringTaken: false,
      resolved: false,
    },
  ];
  hop.update(0.02);
  assert(hop.alive === true, 'a jump clears a low wall in the current lane');
  hop.stop();

  const stumble = makeDash();
  stumble.running = true;
  stumble.alive = true;
  stumble.grace = 0;
  stumble.distance = 40;
  stumble.lane = 0;
  stumble.x = 0;
  stumble.jumpT = 0;
  stumble.nextZ = 1e9;
  stumble.rows = [
    {
      id: 4,
      z: 40.3,
      blocked: [0],
      safe: 1,
      kind: 'low',
      jumpable: true,
      depth: 0.95,
      ring: false,
      ringTaken: false,
      resolved: false,
    },
  ];
  stumble.update(0.02);
  assert(stumble.alive === false && stumble.hitReason === 'Niedrige Wand', 'a low wall kills a runner who stays down');
  stumble.stop();

  const tall = makeDash();
  tall.running = true;
  tall.alive = true;
  tall.grace = 0;
  tall.distance = 40;
  tall.lane = 0;
  tall.x = 0;
  tall.jumpT = JUMP_SEC / 2 + 0.02;
  tall.nextZ = 1e9;
  tall.rows = [
    {
      id: 5,
      z: 40.3,
      blocked: [0],
      safe: -1,
      kind: 'high',
      jumpable: false,
      depth: 1.25,
      ring: false,
      ringTaken: false,
      resolved: false,
    },
  ];
  tall.update(0.02);
  assert(tall.alive === false && tall.hitReason === 'Hohe Barriere', 'a jump does not clear a high barrier');
  tall.stop();

  const box = makeDash();
  box.running = true;
  box.alive = true;
  box.grace = 0;
  box.distance = 40;
  box.lane = 0;
  box.x = 0;
  box.jumpT = JUMP_SEC / 2 + 0.02;
  box.nextZ = 1e9;
  box.rows = [
    {
      id: 6,
      z: 40.3,
      blocked: [0],
      safe: 1,
      kind: 'crate',
      jumpable: false,
      depth: 1.15,
      ring: false,
      ringTaken: false,
      resolved: false,
    },
  ];
  box.update(0.02);
  assert(box.alive === false && box.hitReason === 'Kiste', 'a jump does not clear a crate');
  box.stop();

  const staged = makeDash();
  staged.setDifficulty('einfach');
  staged.resetState();
  staged.running = true;
  staged.alive = true;
  staged.grace = 30;
  staged.nextZ = 1e9;
  staged.rows = [];
  staged.distance = staged.diff.stageLen - 0.2;
  staged.stageNumber = 1;
  staged.step(0.05);
  assert(staged.stageNumber === 2 && staged.currentStage().id === 'void', 'distance opens the void tunnel');
  assert(staged.bannerT > 1, 'a stage change flashes the German title');
  staged.distance = staged.diff.stageLen * 3 + 5;
  staged.step(0.02);
  assert(staged.stageNumber === 4 && staged.currentStage().id === 'neon', 'stages loop back to the city');
  staged.stop();

  const slip = makeDash();
  slip.running = true;
  slip.alive = true;
  slip.grace = 0;
  slip.distance = 40;
  slip.lane = -1;
  slip.x = -LANE_PITCH;
  slip.nextZ = 1e9;
  slip.rows = [
    {
      id: 2,
      z: 40.3,
      blocked: [0, 1],
      safe: -1,
      kind: 'wall',
      depth: 1.2,
      ring: true,
      ringTaken: false,
      resolved: false,
    },
  ];
  slip.update(0.04);
  assert(slip.alive === true, 'the open lane of a two-lane wall is safe');
  assert(slip.orbsCollected === 1, 'a ring in the open lane scores');
  slip.survivalMs = 3200;
  slip.syncScore();
  const slipResult = slip.buildResult();
  assert(slipResult.game === 'dash' && slipResult.orbs === 1, 'dash result names the board and the ring');
  assert(
    slipResult.score === computeScore(slipResult.survivalMs, slipResult.orbs, slipResult.comboBonus, slipResult.nearMisses),
    'dash score matches the shared formula'
  );
  assert(
    slipResult.formula ===
      formatDashFormula(slipResult.survivalMs, slipResult.orbs, slipResult.comboBonus, slipResult.nearMisses, slipResult.score),
    'dash formula string matches'
  );
  const slipPost = scoresMod.validatePostBody({
    name: 'DashPilot',
    score: slipResult.score,
    survivalMs: slipResult.survivalMs,
    orbs: slipResult.orbs,
    comboBonus: slipResult.comboBonus,
    nearMisses: slipResult.nearMisses,
    difficulty: slipResult.difficulty,
    game: slipResult.game,
  });
  assert(slipPost.ok, `dash run passes the server check ${slipPost.error || ''}`);
  slip.stop();

  for (const id of DIFFICULTY_ENUM) {
    const run = makeDash();
    run.setDifficulty(id);
    run.resetState();
    run.running = true;
    run.alive = true;
    for (let i = 0; i < 280; i++) {
      const reach = run.speed * 0.02 + 0.35;
      const row = run.rows.find((item) => {
        const rel = item.z - run.distance;
        return rel < item.depth + reach && rel > -0.3;
      });
      if (row) {
        run.lane = row.safe;
        run.x = dashLaneWorld(row.safe, run.laneCount);
      }
      run.update(0.02);
      assert(run.speed <= run.diff.speedCap + 1e-6, `${id} speed stays under the cap`);
      if (!run.alive) break;
    }
    assert(run.alive, `${id} survives when each row's open lane is taken`);
    assert(run.distance > 40, `${id} run moves forward`);
    const maxBlocked = run.laneCount >= 4 ? 3 : 2;
    let previous = null;
    for (const row of run.rows) {
      assert(
        !row.blocked.includes(row.safe) && row.blocked.length >= 1 && row.blocked.length <= maxBlocked,
        `${id} row leaves a lane`
      );
      if (previous != null) assert(Math.abs(row.safe - previous) <= 1 + 1e-6, `${id} safe lanes stay adjacent`);
      previous = row.safe;
    }
    run.stop();
  }
}

{
  const {
    HuntGame,
    huntTargetPoints,
    HUNT_MAG,
    HUNT_RELOAD_SEC,
    HUNT_BIRD_MAX_SEC,
    HUNT_LUNGE_SEC,
    formatHuntFormula,
    getHuntDifficulty,
    normalizeHuntDifficulty,
    HUNT_SPECIES,
  } = await import(path.join(root, 'src', 'hunt.js'));

  assert(huntTargetPoints('far') > huntTargetPoints('near'), 'a far puffling outscores a near one');
  assert(huntTargetPoints('gold') > huntTargetPoints('far'), 'the golden puffling is the big prize');
  assert(huntTargetPoints('hidden') === 200, 'the hidden puffling is worth 200');
  assert(huntTargetPoints('sign') === 100, 'the signpost is worth 100');
  assert(huntTargetPoints('near') === 75, 'a near puffling is the small prize');

  function makeHunt(w = 390, h = 780) {
    const canvas = {
      width: w,
      height: h,
      style: {},
      classList: { remove() {}, add() {} },
      getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
      getContext() {
        return { setTransform() {} };
      },
      addEventListener() {},
      removeEventListener() {},
      setPointerCapture() {},
    };
    const audio = new Proxy({}, { get: () => () => {} });
    const game = new HuntGame(canvas, { audio, onGameOver() {}, onHud() {} });
    game.resize();
    return game;
  }

  const hunt = makeHunt();
  hunt.running = true;
  hunt.alive = true;
  const far = hunt.makeBird('far', 240);
  far.y = 150;
  far.vx = 0;
  const near = hunt.makeBird('near', 240);
  near.y = 150;
  near.vx = 0;
  hunt.cam = 0;
  hunt.birds = [far, near];
  const aim = hunt.birdScreen(near);
  hunt.aim = { x: aim.x, y: aim.y };
  assert(hunt.shoot() === true, 'a shot leaves the magazine');
  assert(near.falling === true && far.falling === false, 'the nearer puffling takes the hit');
  assert(hunt.ammo === HUNT_MAG - 1, 'ammo drops by one');
  assert(hunt.orbs === 0 && hunt.nearMisses === 1, 'a near hit is the smaller formula term');

  hunt.birds = [far];
  far.falling = false;
  const farAim = hunt.birdScreen(far);
  hunt.aim = { x: farAim.x, y: farAim.y };
  hunt.shoot();
  assert(far.falling === true, 'a far puffling falls when hit');
  assert(hunt.orbs === 1 && hunt.nearMisses === 2, 'a far hit adds an orb and a near-miss');

  hunt.aim = { x: 4, y: 4 };
  const shotsBefore = hunt.shots;
  const ammoBefore = hunt.ammo;
  while (hunt.ammo > 0) hunt.shoot();
  assert(hunt.ammo === 0, 'the magazine empties');
  assert(hunt.shots === shotsBefore + ammoBefore, 'each remaining cartridge is one shot');
  const dryShots = hunt.shots;
  assert(hunt.shoot() === false && hunt.shots === dryShots, 'a dry click adds no shot');

  assert(hunt.reload() === true, 'reload starts on an empty magazine');
  assert(hunt.reload() === false, 'reload does not stack');
  hunt.update(HUNT_RELOAD_SEC + 0.05);
  assert(hunt.ammo === HUNT_MAG, 'reload fills eight shots');

  const combo = makeHunt();
  combo.award('mid');
  combo.award('mid');
  assert(combo.comboBonus === 50 && combo.orbs === 2, 'a second hit inside the window chains');
  combo.syncScore();
  const beforePenalty = combo.score;
  combo.penalize();
  assert(combo.score === beforePenalty - 100, 'a penalty removes 100 points');
  assert(combo.comboTimer === 0, 'a penalty breaks the chain');

  const posted = makeHunt();
  posted.survivalMs = 90000;
  posted.award('far');
  posted.award('gold');
  posted.award('hidden');
  posted.award('sign');
  posted.penalize();
  const result = posted.buildResult();
  assert(result.game === 'hunt', 'hunt result names its board');
  assert(result.hits === 4 && result.penalties === 1, 'hunt result counts hits and penalties');
  assert(
    result.score === computeScore(result.survivalMs, result.orbs, result.comboBonus, result.nearMisses),
    'hunt score matches the shared formula'
  );
  assert(
    result.formula ===
      formatHuntFormula(result.survivalMs, result.orbs, result.comboBonus, result.nearMisses, result.score),
    'hunt formula string matches'
  );
  const accepted = scoresMod.validatePostBody({
    name: 'HuntPilot',
    score: result.score,
    survivalMs: result.survivalMs,
    orbs: result.orbs,
    comboBonus: result.comboBonus,
    nearMisses: result.nearMisses,
    difficulty: result.difficulty,
    game: result.game,
  });
  assert(accepted.ok, `hunt run passes the server check ${accepted.error || ''}`);

  const pan = makeHunt();
  pan.running = true;
  pan.alive = true;
  pan.pointerKind = 'mouse';
  pan.pointerInside = true;
  pan.aim = { x: 0, y: pan.h * 0.4 };
  pan.cam = 220;
  pan.step(0.3);
  assert(pan.cam < 220, 'the view pans when the crosshair sits on the edge');

  const popIn = makeHunt();
  const planted = popIn.makeBird('mid', 120);
  assert(planted.pop === 1 && planted.entrance === 'live', 'a placed puffling is ready to hit');
  const born = popIn.surpriseBird('near');
  assert(born.pop === 0 && born.entrance !== 'live', 'a spawned puffling pops in');
  assert(
    ['hill', 'hay', 'tree', 'wind', 'drop', 'grass', 'dash', 'peek'].includes(born.entrance),
    'spawn uses a surprise entrance'
  );
  popIn.birds = [born];
  popIn.running = true;
  popIn.alive = true;
  popIn.hitStop = 0;
  popIn.step(0.2);
  assert(born.pop > 0.5, 'the pop-in is snappy');

  const juice = makeHunt();
  juice.running = true;
  juice.alive = true;
  const golden = juice.makeBird('gold', 200);
  golden.y = 180;
  golden.vx = 0;
  juice.cam = 0;
  juice.birds = [golden];
  const goldAim = juice.birdScreen(golden);
  juice.aim = { x: goldAim.x, y: goldAim.y };
  juice.shoot();
  assert(juice.hitStop >= 0.06 && juice.hitStop <= 0.08, 'a hit freezes for a short beat');
  assert(golden.flash === 1 && golden.falling === true, 'a hit flashes the puffling and knocks it down');
  assert(juice.feathers.length >= 18, 'a hit throws a feather burst');
  assert(juice.rings.length >= 1, 'a hit leaves an impact ring');
  assert(juice.sparks.some((s) => s.star), 'a golden hit throws sparkles');
  assert(juice.recoil > 0 && juice.muzzle > 0, 'a shot kicks the crosshair');
  juice.step(0.05);
  assert(juice.hitStop > 0 && golden.y === 180, 'the freeze holds the bird');
  juice.hitStop = 0;
  golden.y = juice.h * 0.7;
  golden.vy = 500;
  golden.falling = true;
  golden.bounces = 0;
  juice.step(0.16);
  assert(golden.bounces >= 1, 'a falling puffling bounces on the ground');

  function armBird(game, kind, sx, sy) {
    const bird = game.makeBird(kind, 0);
    bird.pop = 1;
    bird.bob = 0;
    bird.falling = false;
    bird.leaving = false;
    bird.vx = 0;
    bird.y = sy;
    bird.x = sx + game.cam * bird.depth;
    game.birds = [bird];
    game.ammo = HUNT_MAG;
    game.hitStop = 0;
    game.viewShakeX = 0;
    game.viewShakeY = 0;
    game.pointerKind = '';
    return bird;
  }

  for (const kind of ['near', 'mid', 'far', 'gold']) {
    for (const camFrac of [0, 0.45, 1]) {
      const depthHit = makeHunt();
      depthHit.running = true;
      depthHit.alive = true;
      depthHit.cam = depthHit.maxCam * camFrac;
      const sx = depthHit.w * (0.22 + camFrac * 0.18);
      const sy = depthHit.h * 0.36;
      const bird = armBird(depthHit, kind, sx, sy);
      const screen = depthHit.birdScreen(bird);
      assert(
        Math.abs(screen.x - sx) < 0.02 && Math.abs(screen.y - sy) < 0.02,
        `${kind} keeps its screen position at camera ${camFrac}`
      );
      depthHit.aim = { x: sx, y: sy };
      depthHit.shoot();
      assert(bird.falling === true, `${kind} dies when tapped at camera ${camFrac}`);
    }
  }

  const phone = makeHunt(360, 520);
  phone.running = true;
  phone.alive = true;
  phone.dpr = 3;
  phone.cam = phone.maxCam * 0.63;
  const tiny = armBird(phone, 'far', phone.w * 0.62, phone.h * 0.22);
  phone.pointerKind = 'touch';
  const tinyScreen = phone.birdScreen(tiny);
  phone.aim = { x: tinyScreen.x, y: tinyScreen.y };
  phone.shoot();
  assert(tiny.falling === true, 'a far puffling on a short phone screen still dies');

  const shape = makeHunt();
  shape.running = true;
  shape.alive = true;
  shape.cam = 280;
  const stretched = armBird(shape, 'far', 160, 150);
  stretched.entrance = 'dash';
  stretched.pop = 1;
  const dashScreen = shape.birdScreen(stretched);
  const [dashSx] = shape.popScale(stretched);
  shape.aim = { x: dashScreen.x + stretched.r * 1.14 * dashSx * 0.96, y: dashScreen.y };
  assert(shape.pick(shape.aim.x, shape.aim.y)?.bird === stretched, 'a dash wing is inside the hitbox');
  stretched.entrance = 'hill';
  stretched.pop = 0.75;
  const [, squashSy] = shape.popScale(stretched);
  const squashScreen = shape.birdScreen(stretched);
  const tuftY = squashScreen.y - stretched.r * 1.12 * squashSy * 0.95;
  assert(shape.pick(squashScreen.x, tuftY)?.bird === stretched, 'a stretched tuft is inside the hitbox');
  stretched.pop = 0.16;
  stretched.age = 0;
  assert(!shape.pick(squashScreen.x, squashScreen.y), 'the first blink of a pop-in is not a target');
  stretched.pop = 0.36;
  assert(shape.pick(squashScreen.x, squashScreen.y)?.bird === stretched, 'a popped-in puffling can be hit');
  stretched.pop = 0.1;
  stretched.age = 0.45;
  assert(shape.pick(squashScreen.x, squashScreen.y)?.bird === stretched, 'a stuck pop-in tell becomes hittable');

  const slop = makeHunt();
  slop.running = true;
  slop.alive = true;
  slop.cam = 140;
  const slopBird = armBird(slop, 'mid', 200, 220);
  const slopScreen = slop.birdScreen(slopBird);
  slop.pointerKind = '';
  const mouseBox = slop.birdHitExtents(slopBird);
  slop.pointerKind = 'touch';
  const touchBox = slop.birdHitExtents(slopBird);
  const slopX = slopScreen.x + (mouseBox.hx + touchBox.hx) / 2;
  slop.pointerKind = '';
  assert(!slop.pick(slopX, slopScreen.y), 'the mouse hitbox stays close to the body');
  slop.pointerKind = 'touch';
  assert(slop.pick(slopX, slopScreen.y)?.bird === slopBird, 'a touch hitbox is more generous');

  const shaken = makeHunt();
  shaken.running = true;
  shaken.alive = true;
  shaken.cam = 360;
  const shakenBird = armBird(shaken, 'far', 210, 130);
  const shakenScreen = shaken.birdScreen(shakenBird);
  const shakenBox = shaken.birdHitExtents(shakenBird);
  shaken.viewShakeX = 12;
  shaken.viewShakeY = -8;
  const shakenAim = { x: shakenScreen.x + shakenBox.hx + 2, y: shakenScreen.y - 8 };
  assert(shaken.pick(shakenAim.x, shakenAim.y)?.bird === shakenBird, 'a tap on the shaken sprite still hits');
  shaken.viewShakeX = 0;
  shaken.viewShakeY = 0;
  assert(!shaken.pick(shakenAim.x, shakenAim.y), 'that point misses once the shake offset is gone');

  const scaled = makeHunt();
  scaled.running = true;
  scaled.alive = true;
  scaled.dpr = 2;
  scaled.w = 390;
  scaled.h = 780;
  scaled.canvas.getBoundingClientRect = () => ({ left: 16, top: 40, width: 195, height: 390 });
  const mapped = scaled.localPoint({ clientX: 16 + 195 * 0.4, clientY: 40 + 390 * 0.3 });
  assert(Math.abs(mapped.x - 156) < 0.05 && Math.abs(mapped.y - 234) < 0.05, 'css scale and dpr map into game pixels');
  scaled.cam = 220;
  const scaledBird = armBird(scaled, 'far', mapped.x, mapped.y);
  scaled.aim = mapped;
  scaled.hitStop = 0.07;
  assert(scaled.releasePointer(mapped, 12, 90) === true, 'a tap during hit-stop still fires');
  assert(scaledBird.falling === true, 'a tap during hit-stop still kills the puffling');
  const missed = armBird(scaled, 'mid', 40, 40);
  const panShots = scaled.shots;
  assert(scaled.releasePointer({ x: 8, y: 8 }, 70, 80) === false, 'a short pan does not fire');
  assert(scaled.shots === panShots && missed.falling === false, 'a pan leaves the magazine alone');
  scaled.aim = { x: missed.x - scaled.cam * missed.depth, y: 40 };
  const slip = scaled.birdScreen(missed);
  assert(scaled.releasePointer(slip, 60, 120) === true && missed.falling === true, 'a short slip onto a puffling still hits');
  assert(scaled.releasePointer(slip, 20, 500) === false, 'a long press does not shoot');

  const blocked = makeHunt();
  blocked.running = true;
  blocked.alive = true;
  blocked.cam = Math.min(160, blocked.maxCam);
  const lantern = blocked.props.find((prop) => prop.id === 'lantern');
  const lanternPoint = blocked.penaltyPoint(lantern);
  const covered = armBird(blocked, 'far', lanternPoint.x, lanternPoint.y);
  covered.depth = 0.42;
  covered.x = lanternPoint.x + blocked.cam * covered.depth;
  blocked.penalties = 0;
  blocked.aim = { x: lanternPoint.x, y: lanternPoint.y };
  blocked.shoot();
  assert(covered.falling === true, 'a puffling in front of a prop still dies');
  assert(blocked.penalties === 0, 'the prop does not steal the hit');

  const wind = blocked.props.find((prop) => prop.id === 'wind');
  const perched = blocked.makeBird('mid');
  perched.entrance = 'wind';
  blocked.cam = 240;
  blocked.perchOn(perched, wind);
  const perchedScreen = perched.x - blocked.cam * perched.depth;
  const windScreen = wind.x - blocked.cam * wind.depth + (wind.peekX || 0) * 0.15;
  assert(perched.depth > wind.depth, 'a perched puffling is drawn in front of its prop');
  assert(Math.abs(perchedScreen - windScreen) < 0.02, 'perching keeps the prop parallax');

  const life = makeHunt();
  life.running = true;
  life.alive = true;
  life.seedFlock();
  for (let i = 0; i < (HUNT_BIRD_MAX_SEC + 1) / 0.02; i++) {
    life.step(0.02);
    for (const bird of life.birds) {
      assert(
        (bird.age || 0) <= HUNT_BIRD_MAX_SEC + 1e-6,
        `no bird stays past its max life (${bird.kind} ${bird.entrance} ${bird.age})`
      );
    }
  }
  assert(life.birds.every((bird) => (bird.age || 0) <= HUNT_BIRD_MAX_SEC), 'the flock respects the lifetime cap');

  const frozen = makeHunt();
  frozen.running = true;
  frozen.alive = true;
  frozen.hitStop = 0;
  const peek = frozen.makeBird('mid', frozen.w * 0.45);
  peek.entrance = 'peek';
  peek.peekLife = 0.08;
  peek.pop = 1;
  peek.vx = 0;
  peek.cruise = 0;
  peek.age = 0;
  frozen.birds = [peek];
  for (let i = 0; i < 50; i++) frozen.step(0.02);
  assert(!frozen.birds.includes(peek), 'a peek tell ends instead of freezing the bird');

  const wedged = frozen.makeBird('near', frozen.w * 0.5);
  wedged.entrance = 'peek';
  wedged.peekLife = 99;
  wedged.pop = 1;
  wedged.vx = 0;
  wedged.cruise = 0;
  wedged.age = 0;
  frozen.birds = [wedged];
  frozen.hitStop = 0;
  for (let i = 0; i < 200; i++) frozen.step(0.02);
  assert(!frozen.birds.includes(wedged), 'a peek whose timer never ends is forced out');

  const still = frozen.makeBird('near', frozen.w * 0.5);
  still.entrance = 'hill';
  still.pop = 1;
  still.vx = 0;
  still.cruise = 0;
  still.age = 0;
  const stillX = still.x;
  frozen.birds = [still];
  frozen.step(0.02);
  assert(Math.abs(still.vx) >= 48, 'a bird with no velocity is given an exit speed');
  for (let i = 0; i < 100; i++) frozen.step(0.02);
  assert(!frozen.birds.includes(still) || Math.abs(still.x - stillX) > 100, 'a bird with no velocity cannot hang in place');

  const pinned = frozen.makeBird('far', 120);
  pinned.age = HUNT_BIRD_MAX_SEC - 0.01;
  pinned.pop = 1;
  frozen.birds = [pinned];
  frozen.hitStop = 3;
  frozen.step(0.05);
  assert(!frozen.birds.includes(pinned), 'hit-stop cannot pin a bird past its max life');

  frozen.lastTs = 50;
  frozen.running = true;
  frozen.onAppHidden(true);
  frozen.onAppHidden(false);
  assert(frozen.lastTs === 0, 'returning from a hidden tab restarts the frame clock');

  assert(normalizeHuntDifficulty('Leicht') === 'einfach', 'Leicht maps onto the einfach board');
  assert(normalizeHuntDifficulty('einfach') === 'einfach', 'einfach stays einfach');
  assert(normalizeHuntDifficulty('baba') === 'mittel', 'hunt has no baba grade');
  assert(getHuntDifficulty('einfach').label === 'Leicht', 'the easy grade is labeled Leicht');
  assert(getHuntDifficulty('mittel').label === 'Mittel', 'the middle grade is labeled Mittel');
  assert(getHuntDifficulty('schwer').label === 'Schwer', 'the hard grade is labeled Schwer');
  assert(getHuntDifficulty('einfach').attacker === false, 'Leicht has no attackers');
  assert(getHuntDifficulty('einfach').speed < 1 && getHuntDifficulty('einfach').size > 1, 'Leicht is slower and bigger');
  assert(getHuntDifficulty('einfach').roundSec > 90 && getHuntDifficulty('einfach').mag > HUNT_MAG, 'Leicht lasts longer and holds more shots');
  assert(getHuntDifficulty('mittel').attacker === true && getHuntDifficulty('mittel').attackerWindow === 2, 'Mittel gives about two seconds');
  assert(getHuntDifficulty('mittel').roundSec === 90 && getHuntDifficulty('mittel').mag === HUNT_MAG, 'Mittel keeps the original round');
  const hardCfg = getHuntDifficulty('schwer');
  assert(hardCfg.attackerWindow >= 1.2 && hardCfg.attackerWindow <= 1.5, 'Schwer window is 1.2 to 1.5 seconds');
  assert(hardCfg.roundSec < 90 && hardCfg.mag < HUNT_MAG, 'Schwer is a shorter round or a smaller magazine');
  assert(hardCfg.speed > 1 && hardCfg.surprise > 1, 'Schwer is faster and more surprising');
  assert(hardCfg.attackerFirst < getHuntDifficulty('mittel').attackerFirst, 'Schwer sends attackers sooner');
  assert(HUNT_SPECIES.length >= 5, 'several creature types sit beside the pufflings');

  const huntHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(huntHtml.includes('id="screen-hunt-diff"'), 'hunt has a difficulty screen');
  assert(huntHtml.includes('data-hunt-diff="einfach"') && huntHtml.includes('>Leicht<'), 'Leicht is a hunt chip');
  assert(huntHtml.includes('data-hunt-diff="mittel"') && huntHtml.includes('>Mittel<'), 'Mittel is a hunt chip');
  assert(huntHtml.includes('data-hunt-diff="schwer"') && huntHtml.includes('>Schwer<'), 'Schwer is a hunt chip');

  const picked = makeHunt();
  picked.start('leicht');
  assert(picked.difficultyId === 'einfach' && picked.diff.label === 'Leicht', 'selecting Leicht arms the easy grade');
  assert(picked.mag === getHuntDifficulty('einfach').mag, 'Leicht fills the larger magazine');
  assert(picked.roundMs === getHuntDifficulty('einfach').roundSec * 1000, 'Leicht uses the longer clock');
  picked.attackerT = 0;
  picked.ammo = picked.mag;
  picked.update(1.2);
  assert(picked.attacker == null && picked.caught === false, 'Leicht never spawns an attacker');
  picked.stop();

  picked.start('schwer');
  assert(picked.difficultyId === 'schwer' && picked.mag === hardCfg.mag, 'selecting Schwer arms the hard grade');
  const slowBird = makeHunt();
  slowBird.setDifficulty('einfach');
  const slow = slowBird.makeBird('far', 20);
  slowBird.setDifficulty('schwer');
  const fast = slowBird.makeBird('far', 20);
  assert(Math.abs(fast.vx) > Math.abs(slow.vx), 'Schwer targets move faster than Leicht targets');
  assert(fast.r < slow.r, 'Schwer targets are smaller than Leicht targets');

  const hopper = makeHunt();
  const bunny = hopper.makeBird('mid', 80, 'bunny');
  bunny.pop = 1;
  bunny.falling = false;
  bunny.bob = 0;
  const grounded = hopper.birdScreen(bunny);
  bunny.bob = Math.PI / 2;
  const airborne = hopper.birdScreen(bunny);
  assert(airborne.y < grounded.y - 1, 'a bunny hops');
  const bat = hopper.makeBird('mid', 80, 'bat');
  bat.pop = 1;
  bat.falling = false;
  bat.age = 0;
  const batLow = hopper.birdScreen(bat);
  bat.age = Math.PI / 10;
  const batHigh = hopper.birdScreen(bat);
  assert(Math.abs(batHigh.y - batLow.y) > 1, 'a bat weaves through the air');
  const chick = hopper.makeBird('far', 80, 'chick');
  chick.pop = 1;
  chick.falling = false;
  chick.age = 0;
  const chickA = hopper.birdScreen(chick);
  chick.age = Math.PI / 14;
  const chickB = hopper.birdScreen(chick);
  assert(Math.abs(chickB.y - chickA.y) > 1, 'a chick bobs');
  const ham = hopper.makeBird('near', 40, 'hamster');
  const puff = hopper.makeBird('near', 40, 'puff');
  assert(ham.r > puff.r && ham.species === 'hamster', 'a hamster is a bigger fluffball');
  const mole = hopper.surpriseBird('near', 'mole');
  assert(mole.species === 'mole' && mole.entrance === 'peek' && mole.hideY > hopper.h * 0.5, 'a mole pops out of the ground');
  assert(huntTargetPoints('mole') > huntTargetPoints('bat'), 'a mole outscores a bat');
  assert(huntTargetPoints('bat') > huntTargetPoints('chick'), 'a bat outscores a chick');
  assert(huntTargetPoints('chick') > huntTargetPoints('bunny'), 'a chick outscores a bunny');
  assert(huntTargetPoints('bunny') > huntTargetPoints('hamster'), 'a bunny outscores a hamster');
  assert(huntTargetPoints('attacker') > huntTargetPoints('mole'), 'an attacker is the biggest prize');

  const save = makeHunt();
  let savedOver = null;
  save.onGameOver = (result) => {
    savedOver = result;
  };
  save.running = true;
  save.alive = true;
  save.setDifficulty('mittel');
  save.ammo = HUNT_MAG;
  save.beginAttacker('bunny');
  const firstAttacker = save.attacker;
  save.beginAttacker('bat');
  assert(save.attacker === firstAttacker, 'only one attacker is up at a time');
  save.attacker.pop = 1;
  save.attacker.t = 0.2;
  save.aim = { x: save.attacker.x, y: save.attacker.y };
  assert(save.shoot() === true, 'a shot can hit the attacker');
  assert(save.attacker == null && save.caught === false, 'the attacker dies when it is shot in time');
  assert(save.orbs === 4 && save.hits === 1, 'a killed attacker pays the bonus');
  save.update(0.6);
  assert(savedOver == null && save.alive === true, 'killing the attacker does not end the run');

  const doom = makeHunt();
  let doomed = null;
  doom.onGameOver = (result) => {
    doomed = result;
  };
  doom.running = true;
  doom.alive = true;
  doom.setDifficulty('schwer');
  doom.beginAttacker('hamster');
  assert(doom.attacker && doom.attacker.phase === 'warn', 'the attacker opens with a warning');
  doom.attacker.window = 0.3;
  doom.attacker.t = 0;
  doom.attacker.pop = 1;
  doom.update(0.3 + HUNT_LUNGE_SEC + 0.2);
  assert(doomed && doomed.caught === true, 'an attacker timeout causes game over');
  assert(doomed.endReason === 'caught' && doomed.game === 'hunt', 'the caught run stays on the hunt board');
  assert(doomed.difficulty === 'schwer', 'the caught run keeps its difficulty');
  const caughtPost = scoresMod.validatePostBody({
    name: 'HuntPilot',
    score: doomed.score,
    survivalMs: doomed.survivalMs,
    orbs: doomed.orbs,
    comboBonus: doomed.comboBonus,
    nearMisses: doomed.nearMisses,
    difficulty: doomed.difficulty,
    game: doomed.game,
  });
  assert(caughtPost.ok, `a caught hunt run still passes the server check ${caughtPost.error || ''}`);
}

{
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'pulse-music', 'manifest.json'), 'utf8'));
  const musicDir = path.join(root, 'public', 'pulse-music');
  for (const id of ['einfach', 'mittel', 'schwer', 'baba']) {
    const files = manifest.byDifficulty[id];
    assert(Array.isArray(files) && files.length >= 2, `${id} has a primary and alts`);
    assert(manifest.tracks[files[0]].role === 'primary', `${id} primary is first`);
    for (const file of files) {
      assert(fs.existsSync(path.join(musicDir, file)), `${file} is in the music pack`);
      assert(file.startsWith(`${id}-`), `${file} belongs to ${id}`);
    }
  }
  for (const file of manifest.dailyPool) {
    assert(fs.existsSync(path.join(musicDir, file)), `daily pool file ${file}`);
  }

  const {
    preparePulseRun,
    buildBeatChart,
    judgeHit,
    getPulseDifficulty,
    limitPulseFingers,
    pulseFingersAt,
    pulsePeakFingers,
    PULSE_MAX_FINGERS,
    applyPulseHit,
    pulseShouldFail,
    PulseGame,
    PULSE_AUDIO_OFFSET_SEC,
    PULSE_STRONG_ONSET,
    orderPulsePool,
    shufflePulsePool,
    assignPulseTouches,
    pulseStageConfig,
    primePulseBeatmap,
    pulseTrackTitle,
  } = await import(path.join(root, 'src', 'pulse.js'));
  const { mulberry32 } = await import(path.join(root, 'src', 'rng.js'));

  for (const meta of Object.values(manifest.tracks)) {
    assert(typeof meta.beatmap === 'string' && meta.beatmap.endsWith('.json'), `${meta.file} names a beatmap`);
    const rel = meta.beatmap.replace(/^public\/pulse-music\//, '');
    assert(fs.existsSync(path.join(musicDir, rel)), `${rel} is in the music pack`);
    const beatmap = JSON.parse(fs.readFileSync(path.join(musicDir, rel), 'utf8'));
    assert(beatmap.sourceId === meta.sourceId, `${meta.file} beatmap matches the manifest source`);
    assert(beatmap.track === meta.file.split('/').pop(), `${meta.file} beatmap names its clip`);
  }

  const loadBeatmap = (file) => {
    const rel = manifest.tracks[file].beatmap.replace(/^public\/pulse-music\//, '');
    return JSON.parse(fs.readFileSync(path.join(musicDir, rel), 'utf8'));
  };
  const EPS = 1e-3;
  const onBeat = (time, beatTimes) => beatTimes.some((b) => Math.abs(b - time) <= EPS);
  const onStrongOnset = (time, map) => {
    const times = map.onsetTimes || [];
    const strengths = map.onsetStrengths || [];
    for (let i = 0; i < Math.min(times.length, strengths.length); i++) {
      if (strengths[i] >= PULSE_STRONG_ONSET && Math.abs(times[i] - time) <= EPS) return true;
    }
    return false;
  };

  const fixedRng = () => 0;
  const einfachOrder = shufflePulsePool(manifest, 'einfach', fixedRng);
  const babaOrder = shufflePulsePool(manifest, 'baba', fixedRng);
  assert(
    einfachOrder.join('|') === shufflePulsePool(manifest, 'einfach', fixedRng).join('|'),
    'the same rng replays the same song order'
  );
  assert(
    einfachOrder.length === manifest.byDifficulty.einfach.length &&
      new Set(einfachOrder).size === einfachOrder.length &&
      manifest.byDifficulty.einfach.every((file) => einfachOrder.includes(file)),
    'a shuffle is a permutation of that difficulty pool'
  );
  assert(einfachOrder.every((file) => file.startsWith('einfach-')), 'einfach shuffle stays in the einfach pack');
  for (let i = 1; i < einfachOrder.length; i++) {
    assert(einfachOrder[i] !== einfachOrder[i - 1], 'a run does not repeat the same song back to back');
  }
  const einfachEase = orderPulsePool(manifest, 'einfach');
  assert(einfachEase[0] === 'einfach-4.mp3', 'ease order still lists the sparsest einfach clip first');
  assert(orderPulsePool(manifest, 'baba')[0] === 'baba-3.mp3', 'ease order still lists the sparsest baba clip first');
  const seenOrders = new Set();
  for (let seed = 1; seed <= 16; seed++) {
    seenOrders.add(shufflePulsePool(manifest, 'einfach', mulberry32(seed)).join('|'));
  }
  assert(seenOrders.size >= 2, 'starting the same difficulty twice can play a different song order');
  const duped = shufflePulsePool(
    { byDifficulty: { einfach: ['a.mp3', 'a.mp3', 'b.mp3'] } },
    'einfach',
    mulberry32(4)
  );
  assert(duped.length === 3, 'duplicate pool entries stay in the shuffle');
  assert(duped[0] !== duped[1] && duped[1] !== duped[2], 'adjacent repeats are split when another track exists');
  const einfachRun = preparePulseRun(manifest, { difficulty: 'einfach', order: einfachOrder, stage: 0 });
  const babaRun = preparePulseRun(manifest, { difficulty: 'baba', order: babaOrder, stage: 0 });
  assert(einfachRun.file === einfachOrder[0], 'stage 1 plays the first shuffled track');
  assert(babaRun.file === babaOrder[0] && babaRun.file.startsWith('baba-'), 'baba stage 1 stays in the baba pack');
  assert(einfachRun.url !== babaRun.url, 'difficulty changes the file, not only the speed');
  assert(
    einfachRun.playbackRate >= 1 &&
      einfachRun.playbackRate <= 1.03 &&
      babaRun.playbackRate >= 1 &&
      babaRun.playbackRate <= 1.03,
    'playback rate nudge stays within 3%'
  );
  const schwerOrder = shufflePulsePool(manifest, 'schwer', fixedRng);
  const schwerNext = preparePulseRun(manifest, { difficulty: 'schwer', stage: 1, order: schwerOrder });
  assert(schwerNext.file === schwerOrder[1], 'stage 2 is the next shuffled schwer track');
  assert(schwerNext.file !== schwerOrder[0], 'stage 2 leaves the first track');
  assert(schwerNext.file.startsWith('schwer-'), 'the next stage stays on the difficulty');
  for (const id of ['einfach', 'mittel', 'schwer', 'baba']) {
    const pool = shufflePulsePool(manifest, id, fixedRng);
    assert(pool.length === manifest.byDifficulty[id].length, `${id} stage pool keeps every track`);
    assert(pool.every((file) => file.startsWith(`${id}-`)), `${id} stages do not pull another tier`);
    let prev = pulseStageConfig(id, 0);
    const nextTier = { einfach: 'mittel', mittel: 'schwer', schwer: 'baba' }[id];
    const nextTierCfg = nextTier ? getPulseDifficulty(nextTier) : null;
    for (let stage = 1; stage <= 3; stage++) {
      const cfg = pulseStageConfig(id, stage);
      assert(cfg.perfectMs < prev.perfectMs, `${id} stage ${stage + 1} windows are tighter`);
      assert(cfg.travelSec < prev.travelSec, `${id} stage ${stage + 1} scroll is faster`);
      assert(cfg.missDrain > prev.missDrain, `${id} stage ${stage + 1} miss drain is stricter`);
      if (nextTierCfg) {
        assert(cfg.perfectMs > nextTierCfg.perfectMs, `${id} stage ${stage + 1} stays wider than ${nextTier}`);
        assert(cfg.travelSec > nextTierCfg.travelSec, `${id} stage ${stage + 1} scrolls slower than ${nextTier}`);
        assert(cfg.missDrain < nextTierCfg.missDrain, `${id} stage ${stage + 1} drains less than ${nextTier}`);
      }
      prev = cfg;
    }
  }

  const dailyMap = loadBeatmap(
    preparePulseRun(manifest, { daily: true, dailyDate: '2026-09-26' }).file
  );
  const dailyA = preparePulseRun(manifest, { daily: true, dailyDate: '2026-09-26', beatmap: dailyMap });
  const dailyB = preparePulseRun(manifest, { daily: true, dailyDate: '2026-09-26', beatmap: dailyMap });
  assert(dailyA.file === dailyB.file, 'daily track is stable for a UTC date');
  assert(dailyA.difficulty === 'schwer', 'daily beat charts Schwer');
  assert(manifest.dailyPool.includes(dailyA.file), 'daily track comes from dailyPool');
  assert(dailyA.beatmapUrl.endsWith(`/${dailyA.file.replace(/\.mp3$/, '.json')}`), 'daily run uses that track beatmap');
  assert(dailyA.stageCount === 1 && dailyA.stage === 0, 'daily beat stays a single stage');
  assert(dailyA.chart.notes.length > 0, 'daily chart is built from the beatmap');
  assert(
    JSON.stringify(dailyA.chart.notes) === JSON.stringify(dailyB.chart.notes),
    'daily chart is seeded'
  );
  let otherDaily = null;
  for (let day = 1; day <= 28; day++) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    const picked = preparePulseRun(manifest, { daily: true, dailyDate: date });
    if (picked.file && picked.file !== dailyA.file) {
      otherDaily = picked;
      break;
    }
  }
  assert(otherDaily, 'daily beat rotates across dates');
  const otherDailyMap = loadBeatmap(otherDaily.file);
  const otherDailyRun = preparePulseRun(manifest, {
    daily: true,
    dailyDate: otherDaily.dailyDate,
    beatmap: otherDailyMap,
  });
  assert(otherDailyRun.file === otherDaily.file, 'a later day keeps that date seed');
  assert(
    otherDailyRun.chart.notes.every(
      (n) => onBeat(n.time, otherDailyMap.beatTimes) || onStrongOnset(n.time, otherDailyMap)
    ),
    'that day charts its own beatmap'
  );
  assert(
    dailyA.chart.notes.every(
      (n) => n.time + EPS >= dailyMap.beatTimes[0] && (onBeat(n.time, dailyMap.beatTimes) || onStrongOnset(n.time, dailyMap))
    ),
    'daily notes land on that track beatmap'
  );

  const fixture = loadBeatmap('einfach-1.mp3');
  const chartFor = (difficulty) =>
    buildBeatChart({
      beatTimes: fixture.beatTimes,
      onsetTimes: fixture.onsetTimes,
      onsetStrengths: fixture.onsetStrengths,
      bpm: fixture.bpm,
      durationSec: fixture.durationSec,
      difficulty,
      trackId: 'einfach-1.mp3',
      dailyDate: 'fixed',
    });
  const easyChart = chartFor('einfach');
  const midChart = chartFor('mittel');
  const schwerChart = chartFor('schwer');
  const babaChart = chartFor('baba');
  assert(easyChart.notes.length < midChart.notes.length, 'einfach is less dense than mittel');
  assert(midChart.notes.length < babaChart.notes.length, 'baba is denser than mittel');
  assert(easyChart.lanes === 3 && babaChart.lanes === 4, 'lane count follows difficulty');
  const easyHolds = easyChart.notes.filter((n) => n.hold).length;
  const babaHolds = babaChart.notes.filter((n) => n.hold).length;
  assert(babaHolds > easyHolds, 'baba charts more holds');
  assert(PULSE_MAX_FINGERS === 2, 'the finger budget is two');
  const tapBesideHold = (notes) =>
    notes.some(
      (tap) =>
        !tap.hold &&
        notes.some((hold) => hold.hold && hold.time <= tap.time + 1e-9 && tap.time < hold.endTime - 1e-9)
    );
  assert(tapBesideHold(schwerChart.notes) || tapBesideHold(babaChart.notes), 'a tap still sits beside one hold');
  for (const chart of [easyChart, midChart, schwerChart, babaChart]) {
    assert(pulsePeakFingers(chart.notes) <= PULSE_MAX_FINGERS, 'a chart never needs a third finger');
    assert(chart.notes.some((n) => n.hold), 'holds survive the two-finger cap');
  }
  for (const chart of [easyChart, midChart]) {
    for (const note of chart.notes) {
      assert(note.time + EPS >= fixture.beatTimes[0], 'no note before the first analyzed beat');
      assert(onBeat(note.time, fixture.beatTimes), 'einfach/mittel hits are beatTimes, not a BPM grid');
      if (note.hold) assert(onBeat(note.endTime, fixture.beatTimes) && note.endTime > note.time, 'hold ends on a later beat');
    }
  }
  for (const chart of [schwerChart, babaChart]) {
    for (const note of chart.notes) {
      assert(note.time + EPS >= fixture.beatTimes[0], 'no note before the first analyzed beat');
      assert(
        onBeat(note.time, fixture.beatTimes) || onStrongOnset(note.time, fixture),
        'schwer/baba hits are beats or strong onsets'
      );
      if (note.hold) assert(onBeat(note.endTime, fixture.beatTimes) && note.endTime > note.time, 'hold ends on a later beat');
    }
  }
  const stagedEasy = [0, 1, 2, 3].map((stage) =>
    buildBeatChart({
      beatTimes: fixture.beatTimes,
      onsetTimes: fixture.onsetTimes,
      onsetStrengths: fixture.onsetStrengths,
      bpm: fixture.bpm,
      durationSec: fixture.durationSec,
      difficulty: 'einfach',
      trackId: 'einfach-1.mp3',
      dailyDate: 'fixed',
      stage,
    })
  );
  assert(
    JSON.stringify(stagedEasy[0].notes) === JSON.stringify(easyChart.notes),
    'stage 1 chart matches the tier chart'
  );
  for (let stage = 1; stage < stagedEasy.length; stage++) {
    assert(
      stagedEasy[stage].notes.length > stagedEasy[stage - 1].notes.length,
      `einfach stage ${stage + 1} places more beatmap notes`
    );
    for (const note of stagedEasy[stage].notes) {
      assert(onBeat(note.time, fixture.beatTimes), 'later stages still hit analyzed beats');
      if (note.hold) assert(onBeat(note.endTime, fixture.beatTimes), 'later-stage holds still end on a beat');
    }
    assert(stagedEasy[stage].travelSec < stagedEasy[stage - 1].travelSec, 'later stages scroll faster');
    assert(pulsePeakFingers(stagedEasy[stage].notes) <= PULSE_MAX_FINGERS, 'later stages stay within two fingers');
  }
  for (const id of ['einfach', 'mittel', 'schwer', 'baba']) {
    const files = shufflePulsePool(manifest, id, fixedRng);
    let holds = 0;
    let beside = 0;
    for (let stage = 0; stage < files.length; stage++) {
      const beatmap = loadBeatmap(files[stage]);
      const run = preparePulseRun(manifest, {
        difficulty: id,
        stage,
        order: files,
        beatmap,
      });
      assert(run.file === files[stage], `${id} level ${stage + 1} plays the shuffled song`);
      assert(
        pulsePeakFingers(run.chart.notes) <= PULSE_MAX_FINGERS,
        `${id} level ${stage + 1} never needs a third finger`
      );
      if (run.chart.notes.some((n) => n.hold)) holds += 1;
      if (tapBesideHold(run.chart.notes)) beside += 1;
      for (const note of run.chart.notes) {
        const onThisMap =
          onBeat(note.time, beatmap.beatTimes) ||
          (id === 'schwer' || id === 'baba' ? onStrongOnset(note.time, beatmap) : false);
        assert(onThisMap, `${id} level ${stage + 1} notes follow ${files[stage]}`);
      }
    }
    assert(holds > 0, `${id} shuffle still charts a hold`);
    assert(beside > 0, `${id} shuffle still places a tap beside a hold`);
  }
  assert(
    pulsePeakFingers(dailyA.chart.notes) <= PULSE_MAX_FINGERS,
    'daily beat never needs a third finger'
  );
  assert(dailyA.chart.notes.some((n) => n.hold), 'daily beat still has holds');
  const overlapHold = [
    { time: 0, lane: 0, hold: true, endTime: 4 },
    { time: 1, lane: 1, hold: true, endTime: 3 },
    { time: 2, lane: 2, hold: false, endTime: 2 },
  ];
  const overlapFixed = limitPulseFingers(overlapHold);
  assert(overlapFixed.length === 3, 'a tap during two holds is kept');
  assert(overlapFixed.filter((n) => n.hold).length === 1, 'the second hold becomes a tap');
  assert(pulsePeakFingers(overlapFixed) <= 2, 'two holds plus a tap resolve to two fingers');
  assert(pulseFingersAt(overlapFixed, 2) === 2, 'the kept hold and the later tap use both fingers');
  const quietPair = limitPulseFingers([
    { time: 0, lane: 0, hold: true, endTime: 4 },
    { time: 1, lane: 1, hold: true, endTime: 3 },
  ]);
  assert(quietPair.filter((n) => n.hold).length === 2, 'two holds may overlap when nothing else starts');
  assert(pulsePeakFingers(quietPair) === 2, 'a quiet double hold uses exactly two fingers');
  const beside = limitPulseFingers([
    { time: 0, lane: 0, hold: true, endTime: 4 },
    { time: 1, lane: 1, hold: false, endTime: 1 },
    { time: 2.5, lane: 2, hold: false, endTime: 2.5 },
  ]);
  assert(beside.length === 3 && beside[0].hold, 'taps stay beside a single hold');
  assert(pulsePeakFingers(beside) === 2, 'one hold plus a tap is the two-finger case');
  const chord = limitPulseFingers([
    { time: 1, lane: 0, hold: false, endTime: 1 },
    { time: 1, lane: 1, hold: false, endTime: 1 },
    { time: 1, lane: 2, hold: false, endTime: 1 },
  ]);
  assert(chord.length === 2, 'three taps on one instant drop to two');
  assert(pulsePeakFingers(chord) <= 2, 'a three-note chord stays within two fingers');
  const again = limitPulseFingers(overlapFixed);
  assert(JSON.stringify(again) === JSON.stringify(overlapFixed), 'the finger cap is stable');
  const einfachChain = einfachOrder;
  const chainMap = loadBeatmap(einfachChain[1]);
  const chainRun = preparePulseRun(manifest, {
    difficulty: 'einfach',
    stage: 1,
    order: einfachChain,
    beatmap: chainMap,
  });
  assert(chainRun.file === einfachChain[1], 'preparePulseRun stage 2 uses the next shuffled file');
  assert(chainRun.title === pulseTrackTitle(einfachChain[1], manifest.tracks[einfachChain[1]]), 'stage title comes from the file');
  assert(chainRun.profile.perfectMs < getPulseDifficulty('einfach').perfectMs, 'stage 2 profile is stricter');
  assert(chainRun.chart.notes.length > 0, 'stage 2 chart is built from that track beatmap');
  assert(
    chainRun.chart.notes.every((note) => onBeat(note.time, chainMap.beatTimes)),
    'stage 2 notes sit on the playing song, not another track'
  );

  const invented = buildBeatChart({
    bpm: 120,
    durationSec: 40,
    difficulty: 'baba',
    trackId: 'density',
    dailyDate: 'fixed',
  });
  assert(invented.notes.length === 0, 'bpm alone does not invent a hit grid');
  assert(
    einfachRun.beatmapUrl.endsWith(`/${einfachRun.file.replace(/\.mp3$/, '.json')}`),
    'einfach run points at its beatmap'
  );
  const einfachStageCharts = einfachChain.map((file, stage) =>
    preparePulseRun(manifest, {
      difficulty: 'einfach',
      stage,
      order: einfachChain,
      beatmap: loadBeatmap(file),
    })
  );
  for (let stage = 1; stage < einfachStageCharts.length; stage++) {
    const prev = einfachStageCharts[stage - 1];
    const next = einfachStageCharts[stage];
    const prevMap = loadBeatmap(prev.file);
    const nextMap = loadBeatmap(next.file);
    assert(next.file !== prev.file, 'each einfach stage is a different song');
    assert(
      next.chart.notes.every((note) => onBeat(note.time, nextMap.beatTimes)),
      `einfach level ${stage + 1} uses its own beatmap`
    );
    assert(
      prev.chart.notes.map((note) => note.time).join(',') !== next.chart.notes.map((note) => note.time).join(','),
      'two songs do not share one fake grid'
    );
    assert(
      next.chart.notes.some((note) => !onBeat(note.time, prevMap.beatTimes)) ||
        prev.chart.notes.some((note) => !onBeat(note.time, nextMap.beatTimes)),
      'the chart changes when the song changes'
    );
    assert(next.profile.perfectMs < prev.profile.perfectMs, `einfach level ${stage + 1} windows are tighter`);
    assert(next.profile.travelSec < prev.profile.travelSec, `einfach level ${stage + 1} scrolls faster`);
  }
  assert(getPulseDifficulty('einfach').perfectMs > getPulseDifficulty('baba').perfectMs, 'baba windows are tighter');
  assert(judgeHit(90, 'einfach') === 'perfect', 'einfach treats 90ms as perfect');
  assert(judgeHit(90, 'baba') === 'miss', 'baba treats 90ms as a miss');
  assert(judgeHit(160, 'einfach') === 'good', 'einfach still accepts a wider good window');

  const cfg = getPulseDifficulty('mittel');
  let stats = {
    orbs: 0,
    combo: 0,
    comboBonus: 0,
    nearMisses: 0,
    sync: cfg.syncMax,
    survivalMs: 8000,
    comboPeak: 1,
    perfects: 0,
    goods: 0,
    misses: 0,
  };
  for (let i = 0; i < 12; i++) stats = applyPulseHit(stats, i % 4 === 0 ? 'good' : 'perfect', cfg);
  stats = applyPulseHit(stats, 'miss', cfg);
  assert(stats.combo === 0, 'a miss breaks the combo');
  const posted = scoresMod.validatePostBody({
    name: 'Pulse',
    score: stats.score,
    survivalMs: stats.survivalMs,
    orbs: stats.orbs,
    comboBonus: stats.comboBonus,
    nearMisses: stats.nearMisses,
    game: 'pulse',
    difficulty: 'mittel',
  });
  assert(posted.ok, `pulse hit mapping passes the formula (${posted.error || ''})`);

  const harsh = getPulseDifficulty('baba');
  const missTimes = [1, 1.4, 2];
  assert(
    pulseShouldFail({ sync: harsh.syncMax, missTimes }, 2, harsh),
    'baba fails a short miss burst'
  );
  assert(
    !pulseShouldFail({ sync: getPulseDifficulty('einfach').syncMax, missTimes }, 2, getPulseDifficulty('einfach')),
    'einfach survives the same burst'
  );

  const canvas = {
    width: 390,
    height: 844,
    style: {},
    parentElement: { getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0 }) },
    getContext() {
      return { setTransform() {} };
    },
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
  };
  const audio = new Proxy({}, { get: () => () => {} });
  const live = new PulseGame(canvas, { audio, onGameOver() {}, onHud() {} });
  live.resize();
  live.setDifficulty('mittel');
  live.cfg = getPulseDifficulty('mittel');
  live.notes = midChart.notes.map((n) => ({ ...n, resolved: false, holding: false, judgment: null }));
  const tap = live.notes.find((n) => !n.hold) || live.notes[0];
  live._forcedTime = tap.time;
  live.alive = true;
  live.tryHit(tap.lane);
  if (tap.hold) {
    live._forcedTime = tap.endTime;
    live.tryRelease(tap.lane);
  }
  assert(tap.resolved && live.orbsCollected === 1, 'an on-time tap scores a hit');
  assert(
    live.score === computeScore(live.survivalMs, live.orbsCollected, live.comboBonus, live.nearMisses),
    'live pulse score stays on the shared formula'
  );

  const laneX = (lane) => 100 + lane * 80;
  const chordNotes = [
    { time: 1, lane: 0, hold: false, endTime: 1 },
    { time: 1, lane: 1, hold: false, endTime: 1 },
  ];
  const bothInLeftLane = assignPulseTouches(
    [
      { id: 'left', x: 108 },
      { id: 'right', x: 132 },
    ],
    chordNotes,
    { now: 1, goodSec: 0.18, laneX, laneSpacing: 80 }
  );
  assert(bothInLeftLane.size === 2, 'two nearby touches assign two notes');
  assert(bothInLeftLane.get('left') !== bothInLeftLane.get('right'), 'one note does not take both fingers');
  assert(bothInLeftLane.get('left') === chordNotes[0], 'the closer finger keeps the left note');
  assert(bothInLeftLane.get('right') === chordNotes[1], 'the other finger reaches the adjacent note');
  const lone = assignPulseTouches([{ id: 'only', x: 108 }], chordNotes, {
    now: 1,
    goodSec: 0.18,
    laneX,
    laneSpacing: 80,
  });
  assert(lone.size === 1 && lone.get('only') === chordNotes[0], 'one finger still hits only its own note');
  const farLane = assignPulseTouches([{ id: 'only', x: 100 }], [chordNotes[1]], {
    now: 1,
    goodSec: 0.18,
    laneX,
    laneSpacing: 80,
  });
  assert(farLane.size === 0, 'a lone finger does not reach across into the next lane');

  const fingers = new PulseGame(canvas, { audio, onGameOver() {}, onHud() {} });
  fingers.resize();
  fingers.setDifficulty('mittel');
  fingers.cfg = getPulseDifficulty('mittel');
  fingers.running = true;
  fingers.alive = true;
  fingers.paused = false;
  fingers.bindInput();
  fingers.notes = [
    { time: 2, lane: 0, hold: false, endTime: 2, resolved: false, holding: false, judgment: null },
    { time: 2, lane: 1, hold: false, endTime: 2, resolved: false, holding: false, judgment: null },
  ];
  fingers._forcedTime = 2;
  const leftX = fingers.laneX(0);
  const rightX = fingers.laneX(1);
  const midX = (leftX + rightX) / 2;
  const press = (pointerId, clientX) =>
    fingers._onPointerDown({
      pointerId,
      pointerType: 'touch',
      clientX,
      clientY: fingers.hitY,
      button: 0,
      cancelable: true,
      preventDefault() {},
    });
  press(11, leftX + 4);
  press(12, midX - 8);
  assert(
    fingers.notes[0].resolved && fingers.notes[1].resolved && fingers.orbsCollected === 2,
    'two fingers on adjacent lanes both score'
  );
  const holdPair = new PulseGame(canvas, { audio, onGameOver() {}, onHud() {} });
  holdPair.resize();
  holdPair.setDifficulty('mittel');
  holdPair.cfg = getPulseDifficulty('mittel');
  holdPair.running = true;
  holdPair.alive = true;
  holdPair.paused = false;
  holdPair.bindInput();
  holdPair.notes = [
    { time: 3, lane: 0, hold: true, endTime: 4, resolved: false, holding: false, judgment: null },
    { time: 3, lane: 1, hold: false, endTime: 3, resolved: false, holding: false, judgment: null },
  ];
  holdPair._forcedTime = 3;
  const holdLeft = holdPair.laneX(0);
  const holdMid = (holdLeft + holdPair.laneX(1)) / 2;
  const holdPress = (pointerId, clientX) =>
    holdPair._onPointerDown({
      pointerId,
      pointerType: 'touch',
      clientX,
      clientY: holdPair.hitY,
      button: 0,
      cancelable: true,
      preventDefault() {},
    });
  holdPress(21, holdLeft + 2);
  holdPress(22, holdMid - 6);
  assert(holdPair.notes[0].holding && holdPair.notes[1].resolved, 'a hold and a side-by-side tap both register');
  assert(holdPair.orbsCollected === 1, 'the tap scores while the hold is still down');

  const clock = {
    t: 6.8034,
    hasClip() {
      return true;
    },
    clipTime() {
      return this.t;
    },
    clipEnded() {
      return false;
    },
  };
  const synced = new PulseGame(canvas, { audio: clock, onGameOver() {}, onHud() {} });
  synced.resize();
  synced.setDifficulty('einfach');
  synced.alive = true;
  synced.running = true;
  synced.durationSec = 55;
  synced.notes = [];
  synced._forcedTime = null;
  synced._fallbackTime = 99;
  synced.update(0.5);
  assert(
    Math.abs(synced.songTime() - (6.8034 + PULSE_AUDIO_OFFSET_SEC)) < 1e-9,
    'judgment follows audio.currentTime plus the latency offset'
  );
  assert(synced._fallbackTime === 99, 'the rAF clock does not advance while a clip is loaded');

  for (const file of einfachChain) primePulseBeatmap(manifest.tracks[file].beatmap, loadBeatmap(file));
  const hadRaf = globalThis.requestAnimationFrame;
  const hadCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = undefined;
  globalThis.cancelAnimationFrame = undefined;
  let chainOver = null;
  const chain = new PulseGame(canvas, {
    audio,
    onGameOver(result) {
      chainOver = result;
    },
    onHud() {},
  });
  chain.stageGapMs = 40;
  chain.resize();
  chain.start({
    difficulty: 'einfach',
    manifest,
    silent: true,
    rng: fixedRng,
    beatmap: loadBeatmap(einfachChain[0]),
  });
  assert(chain.stageIndex === 0 && chain.stageCount === 4, 'einfach opens on level 1 of 4');
  assert(chain.stageFiles.join('|') === einfachChain.join('|'), 'the run keeps its shuffled order');
  assert(chain.trackFile === einfachChain[0], 'level 1 is the first shuffled track');
  assert(
    chain.trackTitle === pulseTrackTitle(einfachChain[0], manifest.tracks[einfachChain[0]]),
    'level 1 shows that track'
  );
  assert(
    chain.notes.every((note) => onBeat(note.time, loadBeatmap(einfachChain[0]).beatTimes)),
    'level 1 notes follow the first song beatmap'
  );
  chain.orbsCollected = 4;
  chain.comboBonus = 10;
  for (const note of chain.notes) note.resolved = true;
  chain._forcedTime = chain.durationSec;
  chain.alive = true;
  chain.update(0.016);
  assert(chain.celebrating && chain.celebration?.kind === 'advance', 'a clear celebrates before the next level');
  assert(chainOver == null, 'a mid-run clear does not submit');
  await new Promise((r) => setTimeout(r, 80));
  assert(chain.alive && chain.stageIndex === 1, 'the clear loads the next stage');
  assert(chain.trackFile === einfachChain[1], 'stage 2 plays the next shuffled song');
  assert(
    chain.notes.every((note) => onBeat(note.time, loadBeatmap(einfachChain[1]).beatTimes)),
    'stage 2 notes follow the new song beatmap'
  );
  assert(chain.orbsCollected === 4 && chain.comboBonus === 10, 'hits carry into the next stage');
  assert(chain.bankedSurvivalMs >= 50000, 'stage time banks into the run');
  assert(
    chain.cfg.perfectMs < getPulseDifficulty('einfach').perfectMs &&
      chain.cfg.missDrain > getPulseDifficulty('einfach').missDrain &&
      chain.travelSec < getPulseDifficulty('einfach').travelSec,
    'stage 2 is measurably harder'
  );
  assert(chain.notes.length > 0, 'stage 2 chart comes from the next beatmap');
  assert(
    chain.score === computeScore(chain.survivalMs, chain.orbsCollected, chain.comboBonus, chain.nearMisses),
    'the running total stays on the shared formula'
  );
  chain.sync = 0;
  chain.update(0.016);
  assert(!chain.alive && !chain.cleared, 'empty sync fails the run');
  await new Promise((r) => setTimeout(r, 80));
  assert(chainOver && chainOver.game === 'pulse' && chainOver.cleared === false, 'a fail ends the run');
  assert(chainOver.stage === 2 && chainOver.stageCount === 4, 'the fail reports how far the run got');
  assert(
    chainOver.trackTitle === pulseTrackTitle(einfachChain[1], manifest.tracks[einfachChain[1]]),
    'the fail names the track'
  );
  assert(chainOver.orbs === 4, 'the submitted run keeps earlier hits');
  assert(
    chainOver.score ===
      computeScore(chainOver.survivalMs, chainOver.orbs, chainOver.comboBonus, chainOver.nearMisses),
    'the finished run score matches the formula'
  );
  const postedChain = scoresMod.validatePostBody({
    name: 'Chain',
    score: chainOver.score,
    survivalMs: chainOver.survivalMs,
    orbs: chainOver.orbs,
    comboBonus: chainOver.comboBonus,
    nearMisses: chainOver.nearMisses,
    game: 'pulse',
    difficulty: 'einfach',
  });
  assert(postedChain.ok, `a chained pulse run still posts (${postedChain.error || ''})`);

  chainOver = null;
  const finale = new PulseGame(canvas, {
    audio,
    onGameOver(result) {
      chainOver = result;
    },
    onHud() {},
  });
  finale.stageGapMs = 40;
  finale.resize();
  finale.start({
    difficulty: 'einfach',
    manifest,
    silent: true,
    rng: fixedRng,
    beatmap: loadBeatmap(einfachChain[0]),
  });
  finale.stageIndex = finale.stageCount - 1;
  finale.trackFile = einfachChain[3];
  finale.trackTitle = pulseTrackTitle(einfachChain[3], manifest.tracks[einfachChain[3]]);
  for (const note of finale.notes) note.resolved = true;
  finale._forcedTime = finale.durationSec;
  finale.alive = true;
  finale.update(0.016);
  assert(finale.celebration?.kind === 'done', 'the last clear celebrates the run');
  await new Promise((r) => setTimeout(r, 80));
  assert(chainOver?.cleared === true && chainOver.stage === 4 && chainOver.stageCount === 4, 'the last track completes the run');

  const dailyLive = new PulseGame(canvas, { audio, onGameOver() {}, onHud() {} });
  dailyLive.resize();
  dailyLive.start({ daily: true, dailyDate: '2026-09-26', manifest, silent: true, beatmap: dailyMap });
  assert(dailyLive.daily && dailyLive.stageCount === 1, 'daily beat does not chain stages');
  for (const note of dailyLive.notes) note.resolved = true;
  dailyLive._forcedTime = dailyLive.durationSec;
  dailyLive.alive = true;
  dailyLive.update(0.016);
  assert(dailyLive.celebration == null, 'daily clear keeps the single-track result path');
  dailyLive.stop();

  if (hadRaf) globalThis.requestAnimationFrame = hadRaf;
  if (hadCancel) globalThis.cancelAnimationFrame = hadCancel;
}

const env = {
  ...process.env,
  PORT: String(PORT),
  AERGER_FILE: path.join(root, 'data', `aerger-smoke-${PORT}.json`),
  DUEL_FILE: path.join(root, 'data', `duel-smoke-${PORT}.json`),
};
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
  assert(health.version === '1.5' || health.version === '1.5.0', 'api version 1.5');

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

  await new Promise((r) => setTimeout(r, 2100));
  const driftScore = computeScore(8000, 3, 100, 2);
  const driftPost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'DriftPilot',
      score: driftScore,
      survivalMs: 8000,
      orbs: 3,
      comboBonus: 100,
      nearMisses: 2,
      game: 'drift',
      clientId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    }),
  });
  const driftBody = await driftPost.json();
  assert(driftPost.ok, `drift post failed: ${JSON.stringify(driftBody)}`);
  assert(driftBody.scores.every((s) => s.game === 'drift'), 'express drift board');
  assert(driftBody.scores.some((s) => s.name === 'DriftPilot'), 'express drift pilot');
  const rushAfterDrift = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=rush`).then((r) => r.json());
  assert(!rushAfterDrift.scores.some((s) => s.name === 'DriftPilot'), 'express keeps drift off rush');
  const mirrorAfterDrift = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=mirror`).then((r) => r.json());
  assert(!mirrorAfterDrift.scores.some((s) => s.name === 'DriftPilot'), 'express keeps drift off mirror');
  const driftBoard = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=drift`).then((r) => r.json());
  assert(driftBoard.game === 'drift' && driftBoard.scores.some((s) => s.name === 'DriftPilot'), 'express drift filter');
  assert(
    driftBoard.scores.some((s) => s.name === 'DriftPilot' && s.difficulty === 'mittel'),
    'drift default difficulty stays mittel'
  );
  const driftMittel = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=drift&difficulty=mittel`).then((r) => r.json());
  assert(driftMittel.scores.some((s) => s.name === 'DriftPilot'), 'drift difficulty filter includes mittel');
  const driftSchwer = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=drift&difficulty=schwer`).then((r) => r.json());
  assert(!driftSchwer.scores.some((s) => s.name === 'DriftPilot'), 'drift difficulty filter excludes other grades');
  const rushStill = await fetch(`http://127.0.0.1:${PORT}/api/scores?difficulty=mittel`).then((r) => r.json());
  assert(!rushStill.scores.some((s) => s.name === 'DriftPilot'), 'drift difficulty filter does not leak onto rush');

  await new Promise((r) => setTimeout(r, 2100));
  const pulseScore = computeScore(9000, 4, 100, 1);
  const pulsePost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'PulsePilot',
      score: pulseScore,
      survivalMs: 9000,
      orbs: 4,
      comboBonus: 100,
      nearMisses: 1,
      difficulty: 'baba',
      game: 'pulse',
      clientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }),
  });
  const pulseApi = await pulsePost.json();
  assert(pulsePost.ok, `pulse post failed: ${JSON.stringify(pulseApi)}`);
  assert(pulseApi.scores.every((s) => s.game === 'pulse'), 'express pulse board');
  assert(pulseApi.scores.some((s) => s.name === 'PulsePilot' && s.difficulty === 'baba'), 'express pulse pilot');
  assert(!pulseApi.scores.some((s) => s.game !== 'pulse'), 'express pulse board stays separate');

  await new Promise((r) => setTimeout(r, 2100));
  const pulseDailyDate = '2026-09-26';
  const pulseDailyScore = computeScore(5000, 2, 0, 1);
  const pulseDailyPost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'PulseDaily',
      score: pulseDailyScore,
      survivalMs: 5000,
      orbs: 2,
      comboBonus: 0,
      nearMisses: 1,
      game: 'pulse',
      mode: 'daily',
      dailyDate: pulseDailyDate,
      difficulty: 'einfach',
    }),
  });
  const pulseDailyApi = await pulseDailyPost.json();
  assert(pulseDailyPost.ok, `pulse daily post failed: ${JSON.stringify(pulseDailyApi)}`);
  assert(
    pulseDailyApi.scores.some((s) => s.name === 'PulseDaily' && s.mode === 'daily' && s.dailyDate === pulseDailyDate),
    'express pulse daily board'
  );
  assert(
    pulseDailyApi.scores.every((s) => s.game === 'pulse' && s.mode === 'daily'),
    'pulse daily response stays on the daily board'
  );
  const pulseDailyGet = await fetch(
    `http://127.0.0.1:${PORT}/api/scores?game=pulse&mode=daily&dailyDate=${pulseDailyDate}`
  ).then((r) => r.json());
  assert(pulseDailyGet.game === 'pulse' && pulseDailyGet.scores.some((s) => s.name === 'PulseDaily'), 'GET pulse daily');
  assert(!pulseDailyGet.scores.some((s) => s.name === 'PulsePilot'), 'pulse daily list hides normal runs');

  await new Promise((r) => setTimeout(r, 2100));
  const jetScore = computeScore(6000, 3, 50, 1);
  const jetPost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'JetPilot',
      score: jetScore,
      survivalMs: 6000,
      orbs: 3,
      comboBonus: 50,
      nearMisses: 1,
      difficulty: 'schwer',
      game: 'jet',
      clientId: 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
    }),
  });
  const jetApi = await jetPost.json();
  assert(jetPost.ok, `jet post failed: ${JSON.stringify(jetApi)}`);
  assert(jetApi.scores.every((s) => s.game === 'jet'), 'express jet board');
  assert(jetApi.scores.some((s) => s.name === 'JetPilot' && s.difficulty === 'schwer'), 'express jet pilot');

  // The score limiter is 30 requests per minute. Dash is the next board after Jet.
  await new Promise((r) => setTimeout(r, 61000));
  const dashScore = computeScore(4000, 2, 50, 1);
  const dashPost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'DashPilot',
      score: dashScore,
      survivalMs: 4000,
      orbs: 2,
      comboBonus: 50,
      nearMisses: 1,
      difficulty: 'einfach',
      game: 'dash',
      clientId: 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    }),
  });
  const dashApi = await dashPost.json();
  assert(dashPost.ok, `dash post failed: ${JSON.stringify(dashApi)}`);
  assert(dashApi.scores.every((s) => s.game === 'dash'), 'express dash board');
  assert(dashApi.scores.some((s) => s.name === 'DashPilot' && s.difficulty === 'einfach'), 'express dash pilot');
  const rushAfterDash = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=rush`).then((r) => r.json());
  assert(!rushAfterDash.scores.some((s) => s.name === 'DashPilot'), 'express keeps dash off rush');
  const dashBoard = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=dash&difficulty=einfach`).then((r) => r.json());
  assert(dashBoard.game === 'dash' && dashBoard.scores.some((s) => s.name === 'DashPilot'), 'express dash filter');

  await new Promise((r) => setTimeout(r, 2100));
  const huntScore = computeScore(90000, 4, 50, 2);
  const huntPost = await fetch(`http://127.0.0.1:${PORT}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'HuntPilot',
      score: huntScore,
      survivalMs: 90000,
      orbs: 4,
      comboBonus: 50,
      nearMisses: 2,
      difficulty: 'mittel',
      game: 'hunt',
      clientId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    }),
  });
  const huntApi = await huntPost.json();
  assert(huntPost.ok, `hunt post failed: ${JSON.stringify(huntApi)}`);
  assert(huntApi.scores.every((s) => s.game === 'hunt'), 'express hunt board');
  assert(huntApi.scores.some((s) => s.name === 'HuntPilot'), 'express hunt pilot');
  const rushAfterHunt = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=rush`).then((r) => r.json());
  assert(!rushAfterHunt.scores.some((s) => s.name === 'HuntPilot'), 'express keeps hunt off rush');
  const huntBoard = await fetch(`http://127.0.0.1:${PORT}/api/scores?game=hunt`).then((r) => r.json());
  assert(huntBoard.game === 'hunt' && huntBoard.scores.some((s) => s.name === 'HuntPilot'), 'express hunt filter');

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

  const duelCreated = await fetch(`${aergerBase}/api/duel/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ada' }),
  }).then(async (res) => ({ status: res.status, data: await res.json(), etag: res.headers.get('etag') }));
  assert(duelCreated.status === 200 && duelCreated.data.code?.length === 6, 'duel create');
  assert(duelCreated.data.state?.seats?.[0]?.you === true, 'duel host is you');
  assert(!JSON.stringify(duelCreated.data.state).includes(duelCreated.data.secret), 'duel secret stays off the public state');
  const duelCode = duelCreated.data.code;
  const duelPeek = await fetch(`${aergerBase}/api/duel/room/${duelCode}`);
  const duelPeekBody = await duelPeek.json();
  assert(duelPeek.status === 200 && duelPeekBody.version === 1, 'duel peek');
  const duelCached = await fetch(`${aergerBase}/api/duel/room/${duelCode}`, {
    headers: { 'If-None-Match': duelPeek.headers.get('etag') },
  });
  assert(duelCached.status === 304, 'duel lobby poll is 304');
  const duelJoined = await fetch(`${aergerBase}/api/duel/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: duelCode, name: 'Bea', version: duelPeekBody.version }),
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
  assert(duelJoined.status === 200 && duelJoined.data.state.seats[1].you === true, 'duel join');
  const [padA, padB] = await Promise.all([
    fetch(`${aergerBase}/api/duel/paddle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: duelCode, secret: duelCreated.data.secret, paddle: 0.2 }),
    }).then(async (res) => ({ status: res.status, data: await res.json() })),
    fetch(`${aergerBase}/api/duel/paddle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: duelCode, secret: duelJoined.data.secret, paddle: 0.8 }),
    }).then(async (res) => ({ status: res.status, data: await res.json() })),
  ]);
  assert(padA.status === 200 && padB.status === 200, `duel paddle race ${padA.status} ${padB.status}`);
  const duelMid = await fetch(`${aergerBase}/api/duel/room/${duelCode}`).then((res) => res.json());
  assert(Math.abs(duelMid.state.seats[0].paddle - 0.2) < 0.02, 'duel host paddle stuck');
  assert(Math.abs(duelMid.state.seats[1].paddle - 0.8) < 0.02, 'duel guest paddle stuck');
  const duelHostReady = await fetch(`${aergerBase}/api/duel/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: duelCode, secret: duelCreated.data.secret, version: duelMid.version }),
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
  assert(duelHostReady.status === 200 && duelHostReady.data.state.status === 'lobby', 'duel host ready waits');
  const duelStale = await fetch(`${aergerBase}/api/duel/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: duelCode, secret: duelJoined.data.secret, version: duelMid.version }),
  });
  assert(duelStale.status === 409, 'duel stale ready rejected');
  const duelGuestReady = await fetch(`${aergerBase}/api/duel/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: duelCode,
      secret: duelJoined.data.secret,
      version: duelHostReady.data.version,
    }),
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
  assert(duelGuestReady.status === 200 && duelGuestReady.data.state.status === 'countdown', 'duel both ready counts down');
  assert(duelGuestReady.data.state.target === 7, 'duel plays to 7');

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
  fs.rmSync(path.join(root, 'data', `duel-smoke-${PORT}.json`), { force: true });
}
