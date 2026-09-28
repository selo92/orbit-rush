/**
 * Orbit Dash — endless lane runner.
 *
 * The craft auto-runs. Left / right is one discrete lane step (swipe, arrows,
 * or A/D). Swipe up, ArrowUp, W, or Space jumps. A jump clears a low wall.
 * High barriers and crates still kill in that lane. Down-swipe is unused.
 *
 * Einfach and Mittel use 3 lanes (1–2 blocked). Schwer and Baba use 4 lanes
 * (1–3 blocked). Every row leaves at least one open lane, and that open lane
 * is never more than one step from the previous row's open lane.
 *
 * The run is endless. Distance advances Neonstadt → Leerentunnel → Cyber-Gasse
 * and then loops. A short German title flashes on each change; the HUD keeps
 * the stage name and the current speed.
 *
 * Rings, combos, and near-misses use the shared Rush formula so `game=dash`
 * passes the existing D1 check. Jumping does not add a new term.
 *
 *   score = floor(seconds) × 10 + rings × 100 + comboBonus + nearMisses × 75
 *
 * The HUD shows distance in meters and speed in km/h. Points stay on the
 * clock (plus rings) so the server can recompute them.
 */
import { computeScore, NEAR_MISS_POINTS, COMBO_GAP_SEC, COMBO_MAX, COMBO_STEP } from './game.js';
import { normalizeDifficulty } from './difficulty.js';

const TWO_PI = Math.PI * 2;
export const DASH_LANES = [-1, 0, 1];
export const DASH_LANES_4 = [-1.5, -0.5, 0.5, 1.5];
export const LANE_PITCH = 1.2;
export const LANE_PITCH_4 = 1.05;
export const PLAYER_HALF = 0.18;
export const OBS_HALF = 0.28;
export const SWIPE_MIN_PX = 26;
export const LOOKAHEAD = 42;
export const JUMP_SEC = 0.42;
/** Sine height at which a low wall is cleared. Takeoff and landing still hit. */
export const JUMP_CLEAR = 0.45;
export const STAGE_BANNER_SEC = 1.75;
const CAM_NEAR = 11;
const HIT_PAD = 0.18;

export const DASH_HIT_LINE = 'Hindernis';

/**
 * Start speed, ramp, and caps, in m/s. The cap stays readable on a phone:
 * the lane wash reaches toward the runner so the next row is still on screen
 * for a bit more than half a second at the cap.
 *
 * @type {Record<'einfach'|'mittel'|'schwer'|'baba', object>}
 */
export const DASH_DIFFICULTIES = {
  einfach: {
    id: 'einfach',
    label: 'Einfach',
    blurb: 'Ruhiger Start · 3 Bahnen · weite Lücken',
    lanes: 3,
    speedBase: 12,
    speedGain: 6,
    speedLate: 4,
    speedCap: 20,
    rampDist: 620,
    rampSec: 52,
    gapBase: 32,
    gapMin: 20,
    firstGap: 48,
    twoStart: 0.05,
    twoCap: 0.25,
    ring: 0.5,
    grace: 1.15,
    switchSec: 0.14,
    stageLen: 680,
  },
  mittel: {
    id: 'mittel',
    label: 'Mittel',
    blurb: 'Schneller · 3 Bahnen · dichtere Bahn',
    lanes: 3,
    speedBase: 18,
    speedGain: 9,
    speedLate: 6,
    speedCap: 31,
    rampDist: 500,
    rampSec: 42,
    gapBase: 22,
    gapMin: 15.5,
    firstGap: 26,
    twoStart: 0.18,
    twoCap: 0.45,
    ring: 0.42,
    grace: 0.7,
    switchSec: 0.12,
    stageLen: 860,
  },
  schwer: {
    id: 'schwer',
    label: 'Schwer',
    blurb: 'Hohes Tempo · 4 Bahnen · enge Lücken',
    lanes: 4,
    speedBase: 22,
    speedGain: 11,
    speedLate: 7,
    speedCap: 38,
    rampDist: 420,
    rampSec: 36,
    gapBase: 18,
    gapMin: 14.5,
    firstGap: 20,
    twoStart: 0.22,
    twoCap: 0.72,
    ring: 0.34,
    grace: 0.42,
    switchSec: 0.11,
    stageLen: 1040,
  },
  baba: {
    id: 'baba',
    label: 'Baba',
    blurb: '⚠ Extrem · 4 Bahnen · kaum Luft',
    lanes: 4,
    speedBase: 26,
    speedGain: 14,
    speedLate: 8,
    speedCap: 46,
    rampDist: 340,
    rampSec: 30,
    gapBase: 16,
    gapMin: 13.5,
    firstGap: 16,
    twoStart: 0.35,
    twoCap: 0.88,
    ring: 0.28,
    grace: 0.28,
    switchSec: 0.1,
    stageLen: 1200,
  },
};

/**
 * Endless environments. `low` / `high` / `crate` are relative spawn weights.
 * The tunnel favors low walls; the alley favors crates.
 */
export const DASH_STAGES = [
  {
    id: 'neon',
    name: 'Neonstadt',
    scenery: 'city',
    sky: [
      [0, '#120818'],
      [0.32, '#1a1030'],
      [0.48, '#071018'],
      [1, '#050510'],
    ],
    glow: ['rgba(255, 43, 214, 0.28)', 'rgba(0, 240, 255, 0.12)'],
    road: ['#14081c', '#0c1024', '#070814'],
    edgeL: 'rgba(255, 43, 214, 0.85)',
    edgeR: 'rgba(0, 240, 255, 0.85)',
    lane: 'rgba(0, 240, 255, 0.35)',
    grid: 'rgba(255, 43, 214, 0.28)',
    hueA: '#ff2bd6',
    hueB: '#00f0ff',
    low: 0.36,
    high: 0.34,
    crate: 0.3,
  },
  {
    id: 'void',
    name: 'Leerentunnel',
    scenery: 'void',
    sky: [
      [0, '#04010c'],
      [0.28, '#0c0622'],
      [0.46, '#140818'],
      [1, '#020208'],
    ],
    glow: ['rgba(150, 100, 255, 0.42)', 'rgba(0, 240, 255, 0.08)'],
    road: ['#10081c', '#070414', '#03020c'],
    edgeL: 'rgba(176, 120, 255, 0.9)',
    edgeR: 'rgba(0, 240, 255, 0.55)',
    lane: 'rgba(190, 150, 255, 0.4)',
    grid: 'rgba(120, 80, 255, 0.28)',
    hueA: '#b478ff',
    hueB: '#00f0ff',
    low: 0.5,
    high: 0.32,
    crate: 0.18,
  },
  {
    id: 'alley',
    name: 'Cyber-Gasse',
    scenery: 'alley',
    sky: [
      [0, '#10160a'],
      [0.3, '#141c0e'],
      [0.48, '#0c1210'],
      [1, '#050806'],
    ],
    glow: ['rgba(190, 255, 70, 0.2)', 'rgba(255, 150, 40, 0.18)'],
    road: ['#16180e', '#0e120c', '#070806'],
    edgeL: 'rgba(190, 255, 80, 0.8)',
    edgeR: 'rgba(255, 160, 40, 0.9)',
    lane: 'rgba(255, 196, 60, 0.38)',
    grid: 'rgba(190, 255, 70, 0.22)',
    hueA: '#d6ff4a',
    hueB: '#ff9a2e',
    low: 0.22,
    high: 0.36,
    crate: 0.42,
  },
];

/** @param {unknown} id */
export function getDashDifficulty(id) {
  return DASH_DIFFICULTIES[normalizeDifficulty(id)];
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function smoothstep01(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function approach(v, target, maxDelta) {
  if (v < target) return Math.min(target, v + maxDelta);
  if (v > target) return Math.max(target, v - maxDelta);
  return target;
}

function unitRandom(random) {
  const n = Number(random());
  return Number.isFinite(n) ? clamp(n, 0, 0.999999) : 0;
}

/** @param {number} count */
export function dashLaneList(count) {
  return count >= 4 ? DASH_LANES_4 : DASH_LANES;
}

/** @param {number} count */
export function dashLanePitch(count) {
  return count >= 4 ? LANE_PITCH_4 : LANE_PITCH;
}

/** @param {number} lane @param {number} count */
export function dashLaneWorld(lane, count) {
  return lane * dashLanePitch(count);
}

/** Center lane. Four lanes start on the left of the two middle lanes. */
export function dashStartLane(count) {
  const lanes = dashLaneList(count);
  return lanes[Math.floor((lanes.length - 1) / 2)];
}

/** @param {number} x @param {number} count */
export function dashNearestLane(x, count) {
  const lanes = dashLaneList(count);
  const pitch = dashLanePitch(count);
  let best = lanes[0];
  let bestD = Infinity;
  for (const lane of lanes) {
    const d = Math.abs(x - lane * pitch);
    if (d < bestD) {
      best = lane;
      bestD = d;
    }
  }
  return best;
}

/**
 * How many lanes a row blocks. 3-lane rows block 1 or 2. 4-lane rows block
 * 1, 2, or 3 — never the whole road. `density` 0 leans toward one lane,
 * 1 toward a fuller block.
 *
 * @param {number} density
 * @param {() => number} roll
 * @param {number} laneCount
 */
export function dashBlockCount(density, roll, laneCount) {
  const d = clamp(density, 0, 1);
  const r = roll();
  const lanes = laneCount >= 4 ? 4 : 3;
  if (lanes <= 3) return r < d ? 2 : 1;
  const p1 = 0.55 - 0.35 * d;
  const p2 = 0.35 + 0.05 * d;
  if (r < p1) return 1;
  if (r < p1 + p2) return 2;
  return 3;
}

function pickSome(pool, count, roll) {
  const bag = pool.slice();
  const n = Math.max(1, Math.min(count, bag.length));
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(roll() * (i + 1));
    const swap = bag[i];
    bag[i] = bag[j];
    bag[j] = swap;
  }
  return bag.slice(0, n);
}

/**
 * One obstacle row. `blocked` never includes `safe` and never covers every
 * lane. When a previous safe lane exists it is at most one step away.
 *
 * @param {() => number} random
 * @param {number|null} prevSafe
 * @param {number} density 3-lane: chance to block both other lanes. 4-lane: fullness.
 * @param {number} [laneCount=3]
 */
export function planDashRow(random, prevSafe, density, laneCount = 3) {
  const roll = () => unitRandom(random);
  const lanes = dashLaneList(laneCount);
  let safe;
  if (prevSafe == null || !lanes.includes(prevSafe)) {
    safe = lanes[Math.floor(roll() * lanes.length)];
  } else {
    const options = lanes.filter((lane) => Math.abs(lane - prevSafe) <= 1 + 1e-6);
    safe = options[Math.floor(roll() * options.length)];
  }
  const others = lanes.filter((lane) => lane !== safe);
  const count = dashBlockCount(density, roll, lanes.length);
  const blocked = lanes.length <= 3 && count >= 2 ? others.slice() : pickSome(others, count, roll);
  return { safe, blocked };
}

/**
 * Obstacle kind. `low` is a jumpable wall. `high` and `crate` kill even
 * while airborne. Einfach sees a few more low walls; Baba a few more crates.
 *
 * @param {() => number} random
 * @param {{ low: number, high: number, crate: number }} stage
 * @param {{ id?: string }} [diff]
 */
export function pickDashKind(random, stage, diff) {
  let low = stage.low;
  let high = stage.high;
  let crate = stage.crate;
  if (diff?.id === 'einfach') low += 0.12;
  else if (diff?.id === 'baba') {
    low = Math.max(0.08, low - 0.08);
    crate += 0.08;
  }
  const sum = Math.max(0.001, low + high + crate);
  const x = unitRandom(random) * sum;
  if (x < low) return 'low';
  if (x < low + high) return 'high';
  return 'crate';
}

/** @param {string} kind */
export function dashHitReason(kind) {
  if (kind === 'low') return 'Niedrige Wand';
  if (kind === 'crate') return 'Kiste';
  return 'Hohe Barriere';
}

/** Meters per second. Never above the preset cap. */
export function dashSpeed(diff, distance, elapsedSec) {
  const distT = clamp(distance / Math.max(1, diff.rampDist), 0, 1);
  const timeT = smoothstep01(elapsedSec / Math.max(1, diff.rampSec));
  const raw = diff.speedBase + diff.speedGain * distT + diff.speedLate * timeT;
  return Math.min(diff.speedCap, raw);
}

/** HUD speed. Internal motion stays m/s; the neon readout is km/h. */
export function dashSpeedKmh(mps) {
  const v = Number(mps);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 3.6);
}

/** Meters between rows. Shrinks with distance and stops at gapMin. */
export function dashGap(diff, distance) {
  const t = clamp(distance / Math.max(1, diff.rampDist), 0, 1);
  return Math.max(diff.gapMin, diff.gapBase + (diff.gapMin - diff.gapBase) * t);
}

export function dashTwoChance(diff, distance) {
  const t = clamp(distance / Math.max(1, diff.rampDist), 0, 1);
  return diff.twoStart + (diff.twoCap - diff.twoStart) * t;
}

/**
 * How far the lane wash reaches back toward the runner, in meters.
 * Scales with speed so a faster cap still telegraphs for ~0.6 s.
 */
export function dashTelegraphMeters(speed) {
  const v = Number(speed);
  if (!Number.isFinite(v)) return 16;
  return clamp(v * 0.62, 16, 32);
}

/** 0-based stage index along the run. Loops the stage list. */
export function dashStageIndex(distance, stageLen) {
  const len = Math.max(1, Number(stageLen) || 1);
  return Math.floor(Math.max(0, distance) / len);
}

/** Stage at this distance, with a 1-based `number` that keeps climbing. */
export function dashStage(distance, stageLen) {
  const n = dashStageIndex(distance, stageLen);
  const stage = DASH_STAGES[n % DASH_STAGES.length];
  return { ...stage, number: n + 1, index: n % DASH_STAGES.length };
}

/** True when the player body overlaps that lane's blocker. Adjacent lanes do not. */
export function dashHitsLane(playerX, lane, pitch = LANE_PITCH) {
  return Math.abs(playerX - lane * pitch) < PLAYER_HALF + OBS_HALF;
}

/** 0 on the ground, 1 at the apex. */
export function dashJumpHeight(jumpT, duration = JUMP_SEC) {
  if (!(jumpT > 0)) return 0;
  const u = 1 - jumpT / duration;
  return Math.sin(Math.PI * clamp(u, 0, 1));
}

export function dashJumpClears(jumpT) {
  return dashJumpHeight(jumpT) >= JUMP_CLEAR;
}

/**
 * German readout of the shared formula.
 * score = floor(seconds)×10 + rings×100 + comboBonus + nearMisses×75
 */
export function formatDashFormula(survivalMs, orbs, comboBonus, nearMisses, score) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  const parts = [`${t}s × 10`, `${o} Ringe × 100`];
  if (cb > 0) parts.push(`Kette +${cb}`);
  if (nm > 0) parts.push(`${nm} Fast-vorbei × ${NEAR_MISS_POINTS}`);
  return `${parts.join(' + ')} = ${score ?? computeScore(survivalMs, orbs, cb, nm)}`;
}

export class DashGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ audio?: { collect?: Function, combo?: Function, nearMiss?: Function, hit?: Function, click?: Function }, onGameOver?: (r: object) => void, onHud?: (h: object) => void }} hooks
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.audio = hooks.audio || {};
    this.onGameOver = hooks.onGameOver;
    this.onHud = hooks.onHud;
    this.running = false;
    this.paused = false;
    this.alive = false;
    this.raf = 0;
    this.lastTs = 0;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.cx = 0;
    this.horizonY = 0;
    this.groundY = 0;
    this.roadScale = 80;
    this._bound = false;
    this._overTimer = 0;
    this.difficultyId = 'mittel';
    this.diff = getDashDifficulty('mittel');
    this.input = { pointerId: null };
    this.swipe = null;
    this.stars = [];
    this.buildings = [];
    this.particles = [];
    this.floatTexts = [];
    this.idleT = 0;
    this.resetState();
  }

  get laneCount() {
    return this.diff.lanes >= 4 ? 4 : 3;
  }

  get laneList() {
    return dashLaneList(this.laneCount);
  }

  get pitch() {
    return dashLanePitch(this.laneCount);
  }

  currentStage() {
    return dashStage(this.distance, this.diff.stageLen);
  }

  roadHalf() {
    const outer = Math.abs(this.laneList[0]) * this.pitch;
    return outer + (this.laneCount >= 4 ? 0.72 : 0.85);
  }

  setDifficulty(id) {
    this.difficultyId = normalizeDifficulty(id);
    this.diff = getDashDifficulty(this.difficultyId);
  }

  resetState() {
    clearTimeout(this._overTimer);
    this.distance = 0;
    this.survivalMs = 0;
    this.speed = this.diff.speedBase;
    this.lane = dashStartLane(this.laneCount);
    this.x = dashLaneWorld(this.lane, this.laneCount);
    this.jumpT = 0;
    this.stageNumber = 1;
    this.bannerT = 0;
    this.hitReason = DASH_HIT_LINE;
    this.orbsCollected = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboBonus = 0;
    this.comboPeak = 0;
    this.nearMisses = 0;
    this.score = 0;
    this.grace = this.diff.grace;
    this.clock = 0;
    this.shake = 0;
    this.flash = 0;
    this.hintT = 4.2;
    this.rows = [];
    this.rowSeq = 1;
    this.prevSafe = null;
    this.nextZ = this.diff.firstGap;
    this.particles = [];
    this.floatTexts = [];
    this.alive = true;
    this.fillRows();
    this.layoutRoad();
  }

  layoutRoad() {
    if (!this.w) return;
    const phone = Math.min(this.w, this.h);
    const classic = (phone * 0.3) / LANE_PITCH;
    if (this.laneCount >= 4) {
      const outer = 1.5 * LANE_PITCH_4 + 0.5;
      const fit = (this.w * 0.46) / outer;
      this.roadScale = Math.min(classic, fit);
    } else {
      this.roadScale = classic;
    }
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect?.() || { width: this.canvas.width, height: this.canvas.height };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = Math.max(1, Math.floor(rect.width || this.canvas.width || 1));
    this.h = Math.max(1, Math.floor(rect.height || this.canvas.height || 1));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cx = this.w * 0.5;
    this.horizonY = this.h * 0.28;
    this.groundY = Math.min(this.h * 0.74, this.h - 108);
    this.layoutRoad();
    if (this.stars.length === 0) this.seedStars();
    if (this.buildings.length === 0) this.seedCity();
  }

  seedStars() {
    this.stars = [];
    for (let i = 0; i < 64; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random() * 0.46,
        r: 0.4 + Math.random() * 1.5,
        a: 0.25 + Math.random() * 0.6,
        tw: 0.6 + Math.random() * 2.2,
        ph: Math.random() * TWO_PI,
      });
    }
  }

  seedCity() {
    this.buildings = [];
    for (let i = 0; i < 16; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.buildings.push({
        z: (i % 8) * 7.5,
        side,
        width: 0.55 + ((i * 17) % 10) / 18,
        height: 1.3 + ((i * 13) % 12) / 3.2,
        inset: 0.85 + ((i * 5) % 7) / 12,
        windows: 2 + (i % 3),
        stripe: i % 2 === 0,
      });
    }
  }

  fillRows() {
    let guard = 0;
    while (this.nextZ < this.distance + LOOKAHEAD && guard++ < 64) {
      const z = this.nextZ;
      const stage = dashStage(z, this.diff.stageLen);
      const plan = planDashRow(() => Math.random(), this.prevSafe, dashTwoChance(this.diff, z), this.laneCount);
      const kind = pickDashKind(() => Math.random(), stage, this.diff);
      const jumpable = kind === 'low';
      const depth = kind === 'low' ? 0.95 : kind === 'high' ? 1.25 : 1.15;
      let ringLane = plan.safe;
      const ring = Math.random() < this.diff.ring;
      if (ring && jumpable && plan.blocked.length && Math.random() < 0.5) {
        ringLane = plan.blocked[Math.floor(Math.random() * plan.blocked.length)];
      }
      this.rows.push({
        id: this.rowSeq++,
        z,
        blocked: plan.blocked,
        safe: plan.safe,
        kind,
        jumpable,
        depth,
        ring,
        ringLane,
        ringTaken: false,
        resolved: false,
      });
      this.prevSafe = plan.safe;
      this.nextZ = z + dashGap(this.diff, z);
    }
  }

  /**
   * One lane step. Returns false at the edge or when the run is not taking input.
   * @param {number} dir -1 left, +1 right
   */
  nudge(dir) {
    if (!this.running || this.paused || !this.alive) return false;
    const lanes = this.laneList;
    const index = lanes.indexOf(this.lane);
    if (index < 0) return false;
    const step = dir < 0 ? -1 : 1;
    const next = lanes[index + step];
    if (next == null || next === this.lane) return false;
    this.lane = next;
    this.hintT = 0;
    return true;
  }

  /** Hop. A second press while airborne does nothing. */
  jump() {
    if (!this.running || this.paused || !this.alive) return false;
    if (this.jumpT > 0) return false;
    this.jumpT = JUMP_SEC;
    this.hintT = 0;
    const p = this.project(this.x, 0.12);
    this.burst(p.x, p.y + 8, '#ffe566', 7);
    return true;
  }

  /**
   * Horizontal swipe changes lane once. Swipe up jumps. Swipe down is ignored.
   * @param {number} dx
   * @param {number} dy
   */
  handleSwipe(dx, dy) {
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (ady >= SWIPE_MIN_PX && ady > adx && dy < 0) return this.jump();
    if (adx < SWIPE_MIN_PX) return false;
    if (adx <= ady) return false;
    return this.nudge(dx > 0 ? 1 : -1);
  }

  bindInput() {
    if (this._bound) return;
    this._bound = true;
    this._onKeyDown = (e) => {
      if (!this.running || this.paused || !this.alive) return;
      if (e.repeat) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        this.nudge(-1);
        e.preventDefault();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        this.nudge(1);
        e.preventDefault();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
        this.jump();
        e.preventDefault();
      }
    };
    this._onPointerDown = (e) => {
      if (!this.running || this.paused || !this.alive) return;
      this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, armed: true };
      this.input.pointerId = e.pointerId;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    this._onPointerMove = (e) => {
      if (!this.swipe?.armed || this.swipe.id !== e.pointerId) return;
      const dx = e.clientX - this.swipe.x;
      const dy = e.clientY - this.swipe.y;
      if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return;
      this.swipe.armed = false;
      this.handleSwipe(dx, dy);
    };
    this._onPointerUp = (e) => {
      if (!this.swipe || this.swipe.id !== e.pointerId) return;
      if (this.swipe.armed) {
        const dx = e.clientX - this.swipe.x;
        const dy = e.clientY - this.swipe.y;
        this.handleSwipe(dx, dy);
      }
      this.swipe.armed = false;
      this.swipe = null;
      this.input.pointerId = null;
    };
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerUp);
  }

  unbindInput() {
    if (!this._bound) return;
    this._bound = false;
    window.removeEventListener('keydown', this._onKeyDown);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerUp);
    this.swipe = null;
    this.input.pointerId = null;
  }

  /**
   * @param {string} [difficultyId]
   */
  start(difficultyId) {
    if (difficultyId != null && difficultyId !== '') this.setDifficulty(difficultyId);
    clearTimeout(this._overTimer);
    this.resetState();
    this.resize();
    this.bindInput();
    this.running = true;
    this.paused = false;
    this.alive = true;
    this.lastTs = 0;
    this.syncScore();
    this.emitHud();
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    if (typeof requestAnimationFrame === 'function') {
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
  }

  stop() {
    this.running = false;
    clearTimeout(this._overTimer);
    this.unbindInput();
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
  }

  setPaused(p) {
    this.paused = !!p;
    if (this.paused) {
      this.swipe = null;
      this.input.pointerId = null;
    }
    if (!this.paused && this.running) {
      this.lastTs = 0;
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
      if (typeof requestAnimationFrame === 'function') {
        this.raf = requestAnimationFrame((t) => this.loop(t));
      }
    }
  }

  loop(ts) {
    if (!this.running) return;
    let dt = 0;
    if (this.lastTs) dt = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    if (!this.paused && dt > 0) this.update(dt);
    this.draw();
    if (this.running) this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    let left = Math.max(0, dt);
    while (left > 0 && this.alive) {
      const step = Math.min(0.02, left);
      this.step(step);
      left -= step;
    }
    if (!this.alive) this.fadeFx(Math.max(0, dt));
    else this.syncScore();
    this.emitHud();
  }

  step(dt) {
    this.clock += dt;
    this.grace = Math.max(0, this.grace - dt);
    this.hintT = Math.max(0, this.hintT - dt);
    this.survivalMs += dt * 1000;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.jumpT > 0) this.jumpT = Math.max(0, this.jumpT - dt);
    this.speed = dashSpeed(this.diff, this.distance, this.survivalMs / 1000);
    this.distance += this.speed * dt;
    const stage = this.currentStage();
    if (stage.number !== this.stageNumber) {
      this.stageNumber = stage.number;
      this.bannerT = STAGE_BANNER_SEC;
    }
    if (this.bannerT > 0) this.bannerT = Math.max(0, this.bannerT - dt);
    const slide = (this.pitch / Math.max(0.08, this.diff.switchSec)) * dt;
    this.x = approach(this.x, this.lane * this.pitch, slide);
    this.fillRows();
    this.collectRings();
    if (this.grace <= 0) this.collide();
    if (this.alive) this.resolveRows();
    this.rows = this.rows.filter((row) => row.z - this.distance > -8);
    this.fadeFx(dt);
  }

  collectRings() {
    const reach = Math.min(0.55, this.pitch * 0.45);
    for (const row of this.rows) {
      if (!row.ring || row.ringTaken) continue;
      const rel = row.z - this.distance;
      if (Math.abs(rel) > 0.85) continue;
      const ringLane = row.ringLane ?? row.safe;
      if (Math.abs(this.x - ringLane * this.pitch) > reach) continue;
      const hopped = row.jumpable && row.blocked.includes(ringLane);
      if (hopped && !dashJumpClears(this.jumpT)) continue;
      row.ringTaken = true;
      this.awardRing();
    }
  }

  awardRing() {
    this.orbsCollected += 1;
    if (this.comboTimer > 0) this.comboCount = Math.min(COMBO_MAX, this.comboCount + 1);
    else this.comboCount = 1;
    this.comboTimer = COMBO_GAP_SEC;
    if (this.comboCount > this.comboPeak) this.comboPeak = this.comboCount;
    this.comboBonus += (this.comboCount - 1) * COMBO_STEP;
    this.audio.collect?.(this.comboCount);
    if (this.comboCount > 1) this.audio.combo?.(this.comboCount);
    this.floatText(this.comboCount > 1 ? `x${this.comboCount}` : 'RING', '#00f0ff');
  }

  collide() {
    const pitch = this.pitch;
    const clearing = dashJumpClears(this.jumpT);
    for (const row of this.rows) {
      const rel = row.z - this.distance;
      if (rel > row.depth || rel < -HIT_PAD) continue;
      for (const lane of row.blocked) {
        if (!dashHitsLane(this.x, lane, pitch)) continue;
        if (row.jumpable && clearing) continue;
        this.die(dashHitReason(row.kind));
        return;
      }
    }
  }

  resolveRows() {
    const lane = dashNearestLane(this.x, this.laneCount);
    for (const row of this.rows) {
      if (row.resolved) continue;
      if (row.z - this.distance > -HIT_PAD) continue;
      row.resolved = true;
      if (row.blocked.includes(lane)) continue;
      const adjacent = row.blocked.some((blocked) => Math.abs(blocked - lane) <= 1 + 1e-6);
      if (!adjacent) continue;
      this.nearMisses += 1;
      this.audio.nearMiss?.();
    }
  }

  fadeFx(dt) {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.flash = Math.max(0, this.flash - dt * 1.4);
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floatTexts) {
      f.life -= dt;
      f.y += f.vy * dt;
    }
    this.floatTexts = this.floatTexts.filter((f) => f.life > 0);
  }

  floatText(text, color) {
    const p = this.project(this.x, 0.2);
    this.floatTexts.push({ x: p.x, y: p.y - 28, text, color, life: 0.7, vy: -42 });
  }

  syncScore() {
    this.score = computeScore(this.survivalMs, this.orbsCollected, this.comboBonus, this.nearMisses);
  }

  emitHud() {
    const stage = this.currentStage();
    this.onHud?.({
      score: this.score,
      orbs: this.orbsCollected,
      meters: this.distance,
      time: this.survivalMs / 1000,
      combo: this.comboCount,
      difficulty: this.difficultyId,
      showHint: this.hintT > 0 && this.running && this.alive,
      speed: this.speed,
      speedKmh: dashSpeedKmh(this.speed),
      stageName: stage.name,
      stageNumber: stage.number,
    });
  }

  die(reason) {
    if (!this.alive) return;
    this.alive = false;
    this.hitReason = reason || DASH_HIT_LINE;
    this.audio.hit?.();
    this.shake = 1;
    this.flash = 0.55;
    const p = this.project(this.x, 0.15);
    this.burst(p.x, p.y, '#ff2bd6', 18);
    this.burst(p.x, p.y, '#00f0ff', 10);
    this.syncScore();
    this.emitHud();
    clearTimeout(this._overTimer);
    this._overTimer = setTimeout(() => {
      const result = this.buildResult();
      this.stop();
      this.onGameOver?.(result);
    }, 620);
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TWO_PI;
      const s = 40 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.28 + Math.random() * 0.28,
        r: 1.2 + Math.random() * 1.8,
        color,
      });
    }
  }

  buildResult() {
    this.syncScore();
    const survivalMs = Math.floor(this.survivalMs);
    const distanceM = Math.max(0, Math.floor(this.distance));
    return {
      game: 'dash',
      score: this.score,
      survivalMs,
      orbs: this.orbsCollected,
      comboBonus: this.comboBonus,
      nearMisses: this.nearMisses,
      difficulty: this.difficultyId,
      daily: false,
      distanceM,
      comboPeak: this.comboPeak,
      hitReason: this.hitReason || DASH_HIT_LINE,
      formula: formatDashFormula(
        survivalMs,
        this.orbsCollected,
        this.comboBonus,
        this.nearMisses,
        this.score
      ),
    };
  }

  project(worldX, relZ) {
    const z = Math.max(0.42, relZ + CAM_NEAR);
    const t = CAM_NEAR / z;
    return {
      x: this.cx + worldX * this.roadScale * t,
      y: this.horizonY + (this.groundY - this.horizonY) * t,
      t,
    };
  }

  drawIdle() {
    if (!this.w) this.resize();
    this.idleT += 0.016;
    const saved = this.distance;
    const savedX = this.x;
    const savedLane = this.lane;
    this.distance = this.idleT * 8;
    this.lane = dashStartLane(this.laneCount);
    this.x = dashLaneWorld(this.lane, this.laneCount);
    this.draw();
    this.distance = saved;
    this.x = savedX;
    this.lane = savedLane;
  }

  draw() {
    if (!this.w || !this.ctx) return;
    const ctx = this.ctx;
    const shakeX = (Math.random() - 0.5) * this.shake * 8;
    const shakeY = (Math.random() - 0.5) * this.shake * 5;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.drawSky(ctx);
    this.drawCity(ctx);
    this.drawRoad(ctx);
    this.drawRows(ctx);
    this.drawPlayer(ctx);
    this.drawFx(ctx);
    if (this.hintT > 0 && this.running) this.drawHint(ctx);
    ctx.restore();
    this.drawBanner(ctx);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 43, 214, ${this.flash * 0.35})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  drawSky(ctx) {
    const stage = this.currentStage();
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    for (const stop of stage.sky) g.addColorStop(stop[0], stop[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    const glow = ctx.createRadialGradient(this.cx, this.horizonY, 10, this.cx, this.horizonY, this.w * 0.55);
    glow.addColorStop(0, stage.glow[0]);
    glow.addColorStop(0.45, stage.glow[1]);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.horizonY + 40);
    for (const s of this.stars) {
      const tw = 0.45 + 0.55 * Math.sin(this.clock * s.tw + s.ph);
      const drift = stage.scenery === 'void' ? (this.distance * 0.15 + s.ph) % 1 : 0;
      const sx = ((s.x + drift * 0.04) % 1) * this.w;
      const sy = s.y * this.h;
      ctx.fillStyle = `rgba(232, 244, 255, ${s.a * tw})`;
      if (stage.scenery === 'void') {
        ctx.fillRect(sx, sy, Math.max(1, s.r * 3.2), s.r);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, s.r, 0, TWO_PI);
        ctx.fill();
      }
    }
  }

  drawCity(ctx) {
    const stage = this.currentStage();
    if (stage.scenery === 'void') {
      this.drawVoid(ctx, stage);
      return;
    }
    const scroll = this.distance;
    const half = this.roadHalf();
    for (const b of this.buildings) {
      const span = 60;
      let rel = (b.z - (scroll % span) + span) % span;
      if (rel > 52) rel -= span;
      if (rel < -2) continue;
      const edge = b.side * (half + 0.15 + b.inset * 0.35);
      const near = this.project(edge, rel);
      const far = this.project(edge + b.side * b.width, rel + 2.4);
      if (near.t < 0.04) continue;
      const top = near.y - b.height * (stage.scenery === 'alley' ? 70 : 86) * near.t;
      ctx.fillStyle = stage.scenery === 'alley' ? 'rgba(12, 16, 10, 0.94)' : 'rgba(8, 10, 22, 0.92)';
      ctx.beginPath();
      ctx.moveTo(near.x, near.y);
      ctx.lineTo(far.x, far.y);
      ctx.lineTo(far.x, far.y - b.height * (stage.scenery === 'alley' ? 54 : 70) * far.t);
      ctx.lineTo(near.x, top);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = b.side < 0 ? stage.hueA : stage.hueB;
      ctx.globalAlpha = 0.55 + near.t * 0.4;
      ctx.lineWidth = Math.max(1, 2 * near.t);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      const win = Math.max(1, b.windows);
      for (let i = 0; i < win; i++) {
        const wy = top + (near.y - top) * ((i + 1) / (win + 1));
        ctx.fillStyle = i % 2 === 0 ? stage.hueB : stage.hueA;
        ctx.globalAlpha = stage.scenery === 'alley' ? 0.7 : 0.85;
        ctx.fillRect(near.x + b.side * 4 * near.t, wy, Math.max(1.5, 5 * near.t), Math.max(1.5, 3.5 * near.t));
      }
      if (stage.scenery === 'alley' && b.stripe) {
        ctx.globalAlpha = 0.9;
        const stripeY = near.y - 8 * near.t;
        ctx.fillStyle = '#14180c';
        ctx.fillRect(Math.min(near.x, far.x), stripeY, Math.abs(far.x - near.x), Math.max(3, 7 * near.t));
        ctx.fillStyle = '#ffe566';
        const stripes = 4;
        const spanX = far.x - near.x;
        for (let s = 0; s < stripes; s++) {
          if (s % 2 === 0) continue;
          ctx.fillRect(near.x + (spanX * s) / stripes, stripeY, spanX / stripes, Math.max(3, 7 * near.t));
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  drawVoid(ctx, stage) {
    const span = 7.5;
    const phase = this.distance % span;
    const half = this.roadHalf() * 0.96;
    for (let i = 0; i < 9; i++) {
      const rel = i * span - phase + 3;
      if (rel < 0.35) continue;
      const l = this.project(-half, rel);
      const r = this.project(half, rel);
      const lift = 78 * l.t;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.quadraticCurveTo(this.cx, l.y - lift * 2.4, r.x, r.y);
      ctx.strokeStyle = i % 2 === 0 ? stage.edgeL : stage.edgeR;
      ctx.globalAlpha = clamp(l.t * 1.3, 0.15, 0.85);
      ctx.lineWidth = Math.max(1, 2.6 * l.t);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const shardSpan = 18;
    for (let i = 0; i < 6; i++) {
      const rel = ((i * 9 + 4 - (this.distance % shardSpan)) + shardSpan) % shardSpan;
      if (rel < 1) continue;
      const side = i % 2 === 0 ? -1 : 1;
      const p = this.project(side * (half + 0.35), rel);
      const s = Math.max(2, 10 * p.t);
      ctx.save();
      ctx.translate(p.x, p.y - 30 * p.t);
      ctx.rotate(this.clock * 0.4 + i);
      ctx.strokeStyle = stage.hueA;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.7, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.7, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawRoad(ctx) {
    const stage = this.currentStage();
    const half = this.roadHalf();
    const left = -half;
    const right = half;
    const farL = this.project(left, 52);
    const farR = this.project(right, 52);
    const road = ctx.createLinearGradient(0, this.horizonY, 0, this.h);
    road.addColorStop(0, stage.road[0]);
    road.addColorStop(0.45, stage.road[1]);
    road.addColorStop(1, stage.road[2]);
    ctx.fillStyle = road;
    ctx.beginPath();
    ctx.moveTo(farL.x, farL.y);
    ctx.lineTo(farR.x, farR.y);
    ctx.lineTo(this.project(right, 0).x, this.h + 8);
    ctx.lineTo(this.project(left, 0).x, this.h + 8);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = stage.edgeL;
    ctx.beginPath();
    ctx.moveTo(farL.x, farL.y);
    ctx.lineTo(this.project(left, 0).x, this.h);
    ctx.stroke();
    ctx.strokeStyle = stage.edgeR;
    ctx.beginPath();
    ctx.moveTo(farR.x, farR.y);
    ctx.lineTo(this.project(right, 0).x, this.h);
    ctx.stroke();

    ctx.setLineDash([10, 16]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stage.lane;
    for (const lane of this.laneList) {
      const a = this.project(lane * this.pitch, 48);
      const b = this.project(lane * this.pitch, 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, this.groundY + 10);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const span = 4;
    const phase = this.distance % span;
    ctx.strokeStyle = stage.grid;
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const rel = i * span - phase;
      if (rel < 0.2) continue;
      const l = this.project(left, rel);
      const r = this.project(right, rel);
      ctx.globalAlpha = clamp(l.t * 1.4, 0, 0.8);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawRows(ctx) {
    const visible = this.rows
      .filter((row) => {
        const rel = row.z - this.distance;
        return rel < 48 && rel > -3;
      })
      .sort((a, b) => b.z - a.z);
    for (const row of visible) this.drawTelegraph(ctx, row);
    for (const row of visible) {
      const rel = row.z - this.distance;
      for (const lane of row.blocked) {
        this.drawObstacle(ctx, lane, rel, row);
        if (row.jumpable) {
          this.drawJumpMark(ctx, lane, rel, 1);
          if (rel > 5) this.drawJumpMark(ctx, lane, Math.max(0.8, rel - 7), 0.72);
        }
      }
      if (row.ring && !row.ringTaken) this.drawRing(ctx, row.ringLane ?? row.safe, rel + 0.15, row);
    }
  }

  /** Lane wash so a closed lane reads before the obstacle arrives. Gold = jump, magenta = leave the lane. */
  drawTelegraph(ctx, row) {
    const rel = row.z - this.distance;
    if (rel < -0.4 || rel > 34) return;
    const reach = dashTelegraphMeters(this.speed);
    const nearZ = Math.max(0.15, rel - reach);
    const farZ = rel + Math.min(row.depth, 1.4);
    const wash = this.laneCount >= 4 ? 0.4 : 0.5;
    for (const lane of row.blocked) {
      const x0 = lane * this.pitch - wash;
      const x1 = lane * this.pitch + wash;
      const a = this.project(x0, nearZ);
      const b = this.project(x1, nearZ);
      const c = this.project(x1, farZ);
      const d = this.project(x0, farZ);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fillStyle = row.jumpable ? 'rgba(255, 214, 80, 0.28)' : 'rgba(255, 43, 214, 0.22)';
      ctx.fill();
    }
  }

  drawJumpMark(ctx, lane, relZ, scale) {
    const p = this.project(lane * this.pitch, relZ);
    const s = Math.max(0.28, p.t) * scale;
    ctx.save();
    ctx.translate(p.x, p.y - 36 * s);
    ctx.strokeStyle = '#ffe566';
    ctx.lineWidth = Math.max(1.25, 2.2 * s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8 * s, 5 * s);
    ctx.lineTo(0, -8 * s);
    ctx.lineTo(8 * s, 5 * s);
    ctx.stroke();
    ctx.restore();
  }

  drawObstacle(ctx, lane, relZ, row) {
    const halfW = this.laneCount >= 4 ? 0.36 : 0.42;
    const x0 = lane * this.pitch - halfW;
    const x1 = lane * this.pitch + halfW;
    const z1 = relZ + row.depth;
    const n0 = this.project(x0, relZ);
    const n1 = this.project(x1, relZ);
    const f0 = this.project(x0, z1);
    const f1 = this.project(x1, z1);
    const height = row.kind === 'low' ? 42 : row.kind === 'crate' ? 112 : 156;
    const top = (p) => p.y - height * p.t;
    ctx.beginPath();
    ctx.moveTo(f0.x, top(f0));
    ctx.lineTo(f1.x, top(f1));
    ctx.lineTo(n1.x, top(n1));
    ctx.lineTo(n0.x, top(n0));
    ctx.closePath();
    ctx.fillStyle = row.kind === 'low' ? '#2a2208' : row.kind === 'crate' ? '#071820' : '#1a1030';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(n0.x, n0.y);
    ctx.lineTo(n1.x, n1.y);
    ctx.lineTo(n1.x, top(n1));
    ctx.lineTo(n0.x, top(n0));
    ctx.closePath();
    const face = ctx.createLinearGradient(n0.x, top(n0), n0.x, n0.y);
    if (row.kind === 'low') {
      face.addColorStop(0, '#ffe566');
      face.addColorStop(0.55, '#ff9a2e');
      face.addColorStop(1, '#6a4010');
    } else if (row.kind === 'crate') {
      face.addColorStop(0, '#1ee0ff');
      face.addColorStop(1, '#0a4a58');
    } else {
      face.addColorStop(0, '#ff4ad2');
      face.addColorStop(1, '#6a1048');
    }
    ctx.fillStyle = face;
    ctx.fill();
    ctx.strokeStyle = row.kind === 'low' ? '#ffe566' : row.kind === 'crate' ? '#7af6ff' : '#ff7ae0';
    ctx.lineWidth = Math.max(1, 2 * n0.t);
    ctx.stroke();
    if (row.kind === 'crate') {
      ctx.strokeStyle = 'rgba(255, 43, 214, 0.8)';
      ctx.beginPath();
      ctx.moveTo(n0.x, top(n0));
      ctx.lineTo(n1.x, n1.y);
      ctx.moveTo(n1.x, top(n1));
      ctx.lineTo(n0.x, n0.y);
      ctx.stroke();
    } else if (row.kind === 'high') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath();
      ctx.moveTo(n0.x, top(n0) + 8 * n0.t);
      ctx.lineTo(n1.x, top(n1) + 8 * n1.t);
      ctx.stroke();
    }
  }

  drawRing(ctx, lane, relZ, row) {
    const p = this.project(lane * this.pitch, relZ);
    const rx = Math.max(4, 18 * p.t);
    const ry = Math.max(2, 8 * p.t);
    const spin = this.clock * 3;
    const lift = row?.jumpable && row.blocked.includes(lane) ? 48 : 22;
    ctx.save();
    ctx.translate(p.x, p.y - lift * p.t);
    ctx.rotate(Math.sin(spin) * 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TWO_PI);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = Math.max(1.5, 3 * p.t);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.55, ry * 0.55, 0, 0, TWO_PI);
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.9)';
    ctx.lineWidth = Math.max(1, 1.6 * p.t);
    ctx.stroke();
    ctx.restore();
  }

  drawPlayer(ctx) {
    const p = this.project(this.x, 0.05);
    const s = Math.max(0.65, p.t);
    const height = dashJumpHeight(this.jumpT);
    const lift = height * 58 * s;
    const padNear = this.project(this.lane * this.pitch - 0.42, 0.1);
    const padNearR = this.project(this.lane * this.pitch + 0.42, 0.1);
    const padFarL = this.project(this.lane * this.pitch - 0.42, 6);
    const padFarR = this.project(this.lane * this.pitch + 0.42, 6);
    ctx.beginPath();
    ctx.moveTo(padNear.x, padNear.y);
    ctx.lineTo(padNearR.x, padNearR.y);
    ctx.lineTo(padFarR.x, padFarR.y);
    ctx.lineTo(padFarL.x, padFarL.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 240, 255, 0.18)';
    ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y);
    const shadow = 1 - height * 0.45;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.45 * shadow})`;
    ctx.beginPath();
    ctx.ellipse(0, 8 * s, 16 * s * (1 - height * 0.25), 6 * s * shadow, 0, 0, TWO_PI);
    ctx.fill();
    ctx.translate(0, -lift);
    ctx.fillStyle = 'rgba(0, 240, 255, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, 6 * s, 22 * s, 8 * s, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = height > 0.2 ? '#e8fbff' : '#00f0ff';
    ctx.beginPath();
    ctx.moveTo(0, -34 * s);
    ctx.lineTo(16 * s, 12 * s);
    ctx.lineTo(0, 2 * s);
    ctx.lineTo(-16 * s, 12 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = height > JUMP_CLEAR ? '#ffe566' : '#ff2bd6';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#e8fbff';
    ctx.beginPath();
    ctx.moveTo(0, -12 * s);
    ctx.lineTo(4 * s, 0);
    ctx.lineTo(0, -2 * s);
    ctx.lineTo(-4 * s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6 * s, 12 * s);
    ctx.lineTo(-2 * s, 22 * s);
    ctx.moveTo(6 * s, 12 * s);
    ctx.lineTo(2 * s, 22 * s);
    ctx.stroke();
    ctx.restore();
  }

  drawFx(ctx) {
    for (const particle of this.particles) {
      ctx.globalAlpha = clamp(particle.life * 2, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = '700 14px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.floatTexts) {
      ctx.globalAlpha = clamp(f.life * 1.6, 0, 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  drawHint(ctx) {
    ctx.globalAlpha = clamp(this.hintT, 0, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    const w = Math.min(this.w - 36, 280);
    const x = (this.w - w) / 2;
    const y = this.groundY + 18;
    ctx.fillRect(x, y, w, 28);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.strokeRect(x, y, w, 28);
    ctx.fillStyle = '#d7f6ff';
    ctx.font = '600 13px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('← → Bahn · ↑ Sprung', this.cx, y + 19);
    ctx.globalAlpha = 1;
  }

  drawBanner(ctx) {
    if (!(this.bannerT > 0) || !this.running) return;
    const intro = Math.min(1, (STAGE_BANNER_SEC - this.bannerT) / 0.16);
    const outro = Math.min(1, this.bannerT / 0.45);
    const a = intro * outro;
    if (a <= 0.02) return;
    const stage = this.currentStage();
    const panelW = Math.min(this.w - 40, 320);
    const panelH = 74;
    const x = (this.w - panelW) / 2;
    const y = Math.max(78, this.h * 0.18);
    ctx.save();
    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = stage.glow[0];
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(5, 5, 16, 0.78)';
    ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = stage.edgeR;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d7f6ff';
    ctx.font = '600 12px Segoe UI, system-ui, sans-serif';
    ctx.fillText(`STUFE ${stage.number}`, this.cx, y + 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 22px Segoe UI, system-ui, sans-serif';
    ctx.fillText(stage.name.toUpperCase(), this.cx, y + 54);
    ctx.restore();
  }
}
