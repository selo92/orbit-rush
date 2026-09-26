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
  assert(scoresMod.normalizeGame('Drift') === 'drift', 'normalize drift');
  assert(scoresMod.normalizeGame('Pulse') === 'pulse', 'normalize pulse');
  assert(scoresMod.normalizeGame('nope') === 'rush', 'unknown game defaults to rush');
{
  const mixed = [
    { name: 'R', score: 10, ts: 1, difficulty: 'mittel', mode: 'normal' },
    { name: 'M', score: 50, ts: 2, difficulty: 'mittel', mode: 'normal', game: 'mirror' },
    { name: 'D', score: 80, ts: 3, difficulty: 'mittel', mode: 'normal', game: 'drift' },
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
  assert(!badGame.ok && badGame.error === 'Invalid game (rush|mirror|drift|pulse)', 'reject bad game');
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
