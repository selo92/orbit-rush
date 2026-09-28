/**
 * Orbit Dash — three-lane endless runner.
 *
 * The craft auto-runs down a neon path. Left / right is one discrete lane
 * step (swipe, arrows, or A/D), not free steering and not a tunnel. Barriers,
 * crates, and low walls occupy one or two lanes and end the run on contact.
 * Every row leaves at least one open lane, and that open lane is never more
 * than one step from the previous row's safe lane.
 *
 * Rings, combos, and near-misses use the shared Rush formula so `game=dash`
 * passes the existing D1 check. No new table: `scores.game` stays the text
 * column from migrations/0003_game.sql.
 *
 *   score = floor(seconds) × 10 + rings × 100 + comboBonus + nearMisses × 75
 *
 * The HUD shows distance in meters. Points stay on the clock (plus rings) so
 * the server can recompute them. Faster presets still score faster, because
 * rings are spaced in meters and the path moves quicker.
 */
import { computeScore, NEAR_MISS_POINTS, COMBO_GAP_SEC, COMBO_MAX, COMBO_STEP } from './game.js';
import { normalizeDifficulty } from './difficulty.js';

const TWO_PI = Math.PI * 2;
export const DASH_LANES = [-1, 0, 1];
export const LANE_PITCH = 1.2;
export const PLAYER_HALF = 0.18;
export const OBS_HALF = 0.28;
export const SWIPE_MIN_PX = 26;
export const LOOKAHEAD = 42;
const CAM_NEAR = 11;
const HIT_PAD = 0.18;
const TELEGRAPH_M = 16;

export const DASH_HIT_LINE = 'Hindernis';

/**
 * Start speed, ramp, and caps. The cap is what a phone can still read:
 * the next row is on screen for about a second before it arrives.
 *
 * @type {Record<'einfach'|'mittel'|'schwer'|'baba', object>}
 */
export const DASH_DIFFICULTIES = {
  einfach: {
    id: 'einfach',
    label: 'Einfach',
    blurb: 'Langsam · weite Lücken · wenige Doppelwände',
    speedBase: 8,
    speedGain: 4,
    speedLate: 2,
    speedCap: 14,
    rampDist: 800,
    rampSec: 80,
    gapBase: 30,
    gapMin: 18,
    firstGap: 42,
    twoStart: 0.05,
    twoCap: 0.25,
    ring: 0.5,
    grace: 1.2,
    switchSec: 0.16,
  },
  mittel: {
    id: 'mittel',
    label: 'Mittel',
    blurb: 'Schneller · dichtere Bahn · mehr Kisten',
    speedBase: 13,
    speedGain: 6,
    speedLate: 4,
    speedCap: 22,
    rampDist: 640,
    rampSec: 65,
    gapBase: 18,
    gapMin: 13,
    firstGap: 22,
    twoStart: 0.18,
    twoCap: 0.45,
    ring: 0.42,
    grace: 0.75,
    switchSec: 0.14,
  },
  schwer: {
    id: 'schwer',
    label: 'Schwer',
    blurb: 'Hohes Tempo · enge Lücken · viele Wände',
    speedBase: 16,
    speedGain: 7,
    speedLate: 4,
    speedCap: 26,
    rampDist: 520,
    rampSec: 55,
    gapBase: 15,
    gapMin: 11.5,
    firstGap: 16,
    twoStart: 0.28,
    twoCap: 0.55,
    ring: 0.34,
    grace: 0.45,
    switchSec: 0.13,
  },
  baba: {
    id: 'baba',
    label: 'Baba',
    blurb: '⚠ Extrem · kaum Luft · Doppelwände',
    speedBase: 19,
    speedGain: 8,
    speedLate: 3,
    speedCap: 30,
    rampDist: 420,
    rampSec: 48,
    gapBase: 13,
    gapMin: 10.5,
    firstGap: 13,
    twoStart: 0.38,
    twoCap: 0.6,
    ring: 0.28,
    grace: 0.3,
    switchSec: 0.12,
  },
};

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

/**
 * One obstacle row. `blocked` is 1 or 2 lanes. `safe` is always open, and
 * when a previous safe lane exists it is at most one step away — so a single
 * swipe can reach an open lane before the row arrives.
 *
 * @param {() => number} random
 * @param {number|null} prevSafe
 * @param {number} twoChance
 */
export function planDashRow(random, prevSafe, twoChance) {
  const roll = () => {
    const n = Number(random());
    return Number.isFinite(n) ? clamp(n, 0, 0.999999) : 0;
  };
  let safe;
  if (prevSafe == null || !DASH_LANES.includes(prevSafe)) {
    safe = DASH_LANES[Math.floor(roll() * DASH_LANES.length)];
  } else {
    const options = DASH_LANES.filter((lane) => Math.abs(lane - prevSafe) <= 1);
    safe = options[Math.floor(roll() * options.length)];
  }
  const others = DASH_LANES.filter((lane) => lane !== safe);
  const two = roll() < clamp(twoChance, 0, 1);
  const blocked = two ? others.slice() : [others[Math.floor(roll() * others.length)]];
  return { safe, blocked };
}

/** Meters per second. Never above the preset cap. */
export function dashSpeed(diff, distance, elapsedSec) {
  const distT = clamp(distance / Math.max(1, diff.rampDist), 0, 1);
  const timeT = smoothstep01(elapsedSec / Math.max(1, diff.rampSec));
  const raw = diff.speedBase + diff.speedGain * distT + diff.speedLate * timeT;
  return Math.min(diff.speedCap, raw);
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

/** True when the player body overlaps that lane's blocker. Adjacent lanes do not. */
export function dashHitsLane(playerX, lane) {
  return Math.abs(playerX - lane * LANE_PITCH) < PLAYER_HALF + OBS_HALF;
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

  setDifficulty(id) {
    this.difficultyId = normalizeDifficulty(id);
    this.diff = getDashDifficulty(this.difficultyId);
  }

  resetState() {
    clearTimeout(this._overTimer);
    this.distance = 0;
    this.survivalMs = 0;
    this.speed = this.diff.speedBase;
    this.lane = 0;
    this.x = 0;
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
    this.hintT = 3.1;
    this.rows = [];
    this.rowSeq = 1;
    this.prevSafe = null;
    this.nextZ = this.diff.firstGap;
    this.particles = [];
    this.floatTexts = [];
    this.alive = true;
    this.fillRows();
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
    this.roadScale = (Math.min(this.w, this.h) * 0.3) / LANE_PITCH;
    if (this.stars.length === 0) this.seedStars();
    if (this.buildings.length === 0) this.seedCity();
  }

  seedStars() {
    this.stars = [];
    for (let i = 0; i < 56; i++) {
      this.stars.push({
        x: Math.random(),
        y: Math.random() * 0.42,
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
        hue: i % 3 === 0 ? '#ff2bd6' : '#00f0ff',
      });
    }
  }

  fillRows() {
    let guard = 0;
    while (this.nextZ < this.distance + LOOKAHEAD && guard++ < 64) {
      const z = this.nextZ;
      const plan = planDashRow(() => Math.random(), this.prevSafe, dashTwoChance(this.diff, z));
      const kinds = ['crate', 'barrier', 'wall'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const depth = kind === 'wall' ? 0.95 : kind === 'barrier' ? 1.35 : 1.15;
      this.rows.push({
        id: this.rowSeq++,
        z,
        blocked: plan.blocked,
        safe: plan.safe,
        kind,
        depth,
        ring: Math.random() < this.diff.ring,
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
    const step = dir < 0 ? -1 : 1;
    const next = clamp(this.lane + step, -1, 1);
    if (next === this.lane) return false;
    this.lane = next;
    this.hintT = 0;
    return true;
  }

  /**
   * Horizontal swipe changes lane once. A vertical swipe is ignored.
   * @param {number} dx
   * @param {number} dy
   */
  handleSwipe(dx, dy) {
    if (Math.abs(dx) < SWIPE_MIN_PX) return false;
    if (Math.abs(dx) <= Math.abs(dy)) return false;
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
    this.speed = dashSpeed(this.diff, this.distance, this.survivalMs / 1000);
    this.distance += this.speed * dt;
    const slide = (LANE_PITCH / Math.max(0.08, this.diff.switchSec)) * dt;
    this.x = approach(this.x, this.lane * LANE_PITCH, slide);
    this.fillRows();
    this.collectRings();
    if (this.grace <= 0) this.collide();
    if (this.alive) this.resolveRows();
    this.rows = this.rows.filter((row) => row.z - this.distance > -8);
    this.fadeFx(dt);
  }

  collectRings() {
    for (const row of this.rows) {
      if (!row.ring || row.ringTaken) continue;
      const rel = row.z - this.distance;
      if (Math.abs(rel) > 0.7) continue;
      if (Math.abs(this.x - row.safe * LANE_PITCH) > 0.55) continue;
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
    for (const row of this.rows) {
      const rel = row.z - this.distance;
      if (rel > row.depth || rel < -HIT_PAD) continue;
      for (const lane of row.blocked) {
        if (dashHitsLane(this.x, lane)) {
          this.die();
          return;
        }
      }
    }
  }

  resolveRows() {
    const lane = clamp(Math.round(this.x / LANE_PITCH), -1, 1);
    for (const row of this.rows) {
      if (row.resolved) continue;
      if (row.z - this.distance > -HIT_PAD) continue;
      row.resolved = true;
      if (row.blocked.includes(lane)) continue;
      const adjacent = row.blocked.some((blocked) => Math.abs(blocked - lane) === 1);
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
    this.onHud?.({
      score: this.score,
      orbs: this.orbsCollected,
      meters: this.distance,
      time: this.survivalMs / 1000,
      combo: this.comboCount,
      difficulty: this.difficultyId,
      showHint: this.hintT > 0 && this.running && this.alive,
    });
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
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
      hitReason: DASH_HIT_LINE,
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
    this.lane = 0;
    this.x = 0;
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
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 43, 214, ${this.flash * 0.35})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  drawSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#120818');
    g.addColorStop(0.32, '#1a1030');
    g.addColorStop(0.48, '#071018');
    g.addColorStop(1, '#050510');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    const glow = ctx.createRadialGradient(this.cx, this.horizonY, 10, this.cx, this.horizonY, this.w * 0.55);
    glow.addColorStop(0, 'rgba(255, 43, 214, 0.28)');
    glow.addColorStop(0.45, 'rgba(0, 240, 255, 0.12)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.w, this.horizonY + 40);
    for (const s of this.stars) {
      const tw = 0.45 + 0.55 * Math.sin(this.clock * s.tw + s.ph);
      ctx.fillStyle = `rgba(232, 244, 255, ${s.a * tw})`;
      ctx.beginPath();
      ctx.arc(s.x * this.w, s.y * this.h, s.r, 0, TWO_PI);
      ctx.fill();
    }
  }

  drawCity(ctx) {
    const scroll = this.distance;
    for (const b of this.buildings) {
      const span = 60;
      let rel = (b.z - (scroll % span) + span) % span;
      if (rel > 52) rel -= span;
      if (rel < -2) continue;
      const edge = b.side * (2.15 + b.inset);
      const near = this.project(edge, rel);
      const far = this.project(edge + b.side * b.width, rel + 2.4);
      if (near.t < 0.04) continue;
      const top = near.y - b.height * 86 * near.t;
      ctx.fillStyle = 'rgba(8, 10, 22, 0.92)';
      ctx.beginPath();
      ctx.moveTo(near.x, near.y);
      ctx.lineTo(far.x, far.y);
      ctx.lineTo(far.x, far.y - b.height * 70 * far.t);
      ctx.lineTo(near.x, top);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = b.hue;
      ctx.globalAlpha = 0.55 + near.t * 0.4;
      ctx.lineWidth = Math.max(1, 2 * near.t);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      const win = Math.max(1, b.windows);
      for (let i = 0; i < win; i++) {
        const wy = top + (near.y - top) * ((i + 1) / (win + 1));
        ctx.fillStyle = i % 2 === 0 ? 'rgba(0, 240, 255, 0.75)' : 'rgba(255, 43, 214, 0.7)';
        ctx.fillRect(near.x + b.side * 4 * near.t, wy, Math.max(1.5, 5 * near.t), Math.max(1.5, 3.5 * near.t));
      }
      ctx.globalAlpha = 1;
    }
  }

  drawRoad(ctx) {
    const left = -2.05;
    const right = 2.05;
    const farL = this.project(left, 52);
    const farR = this.project(right, 52);
    const nearL = this.project(left, 0);
    const nearR = this.project(right, 0);
    const road = ctx.createLinearGradient(0, this.horizonY, 0, this.h);
    road.addColorStop(0, '#14081c');
    road.addColorStop(0.45, '#0c1024');
    road.addColorStop(1, '#070814');
    ctx.fillStyle = road;
    ctx.beginPath();
    ctx.moveTo(farL.x, farL.y);
    ctx.lineTo(farR.x, farR.y);
    ctx.lineTo(nearR.x, this.h + 8);
    ctx.lineTo(nearL.x, this.h + 8);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.85)';
    ctx.beginPath();
    ctx.moveTo(farL.x, farL.y);
    ctx.lineTo(nearL.x, this.h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.85)';
    ctx.beginPath();
    ctx.moveTo(farR.x, farR.y);
    ctx.lineTo(nearR.x, this.h);
    ctx.stroke();

    ctx.setLineDash([10, 16]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    for (const lane of DASH_LANES) {
      const a = this.project(lane * LANE_PITCH, 48);
      const b = this.project(lane * LANE_PITCH, 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, this.groundY + 10);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const span = 4;
    const phase = this.distance % span;
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.28)';
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
      for (const lane of row.blocked) this.drawObstacle(ctx, lane, rel, row);
      if (row.ring && !row.ringTaken) this.drawRing(ctx, row.safe, rel + 0.15);
    }
  }

  /** Magenta wash down the blocked lane so the closed lane reads before the box arrives. */
  drawTelegraph(ctx, row) {
    const rel = row.z - this.distance;
    if (rel < -0.4 || rel > 28) return;
    const nearZ = Math.max(0.15, rel - TELEGRAPH_M);
    const farZ = rel + Math.min(row.depth, 1.4);
    for (const lane of row.blocked) {
      const x0 = lane * LANE_PITCH - 0.5;
      const x1 = lane * LANE_PITCH + 0.5;
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
      ctx.fillStyle = 'rgba(255, 43, 214, 0.22)';
      ctx.fill();
    }
  }

  drawObstacle(ctx, lane, relZ, row) {
    const x0 = lane * LANE_PITCH - 0.42;
    const x1 = lane * LANE_PITCH + 0.42;
    const z1 = relZ + row.depth;
    const n0 = this.project(x0, relZ);
    const n1 = this.project(x1, relZ);
    const f0 = this.project(x0, z1);
    const f1 = this.project(x1, z1);
    const height = row.kind === 'wall' ? 54 : row.kind === 'barrier' ? 150 : 108;
    const top = (p) => p.y - height * p.t;
    ctx.beginPath();
    ctx.moveTo(f0.x, top(f0));
    ctx.lineTo(f1.x, top(f1));
    ctx.lineTo(n1.x, top(n1));
    ctx.lineTo(n0.x, top(n0));
    ctx.closePath();
    ctx.fillStyle = row.kind === 'wall' ? '#1a1030' : '#120818';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(n0.x, n0.y);
    ctx.lineTo(n1.x, n1.y);
    ctx.lineTo(n1.x, top(n1));
    ctx.lineTo(n0.x, top(n0));
    ctx.closePath();
    const face = ctx.createLinearGradient(n0.x, top(n0), n0.x, n0.y);
    if (row.kind === 'barrier') {
      face.addColorStop(0, '#ff4ad2');
      face.addColorStop(1, '#6a1048');
    } else if (row.kind === 'wall') {
      face.addColorStop(0, '#3a2a68');
      face.addColorStop(1, '#141028');
    } else {
      face.addColorStop(0, '#1ee0ff');
      face.addColorStop(1, '#0a4a58');
    }
    ctx.fillStyle = face;
    ctx.fill();
    ctx.strokeStyle = row.kind === 'crate' ? '#7af6ff' : '#ff7ae0';
    ctx.lineWidth = Math.max(1, 2 * n0.t);
    ctx.stroke();
    if (row.kind === 'crate') {
      ctx.strokeStyle = 'rgba(255, 43, 214, 0.8)';
      ctx.beginPath();
      ctx.moveTo(n0.x, (n0.y + top(n0)) / 2);
      ctx.lineTo(n1.x, (n1.y + top(n1)) / 2);
      ctx.stroke();
    }
  }

  drawRing(ctx, lane, relZ) {
    const p = this.project(lane * LANE_PITCH, relZ);
    const rx = Math.max(4, 18 * p.t);
    const ry = Math.max(2, 8 * p.t);
    const spin = this.clock * 3;
    ctx.save();
    ctx.translate(p.x, p.y - 22 * p.t);
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
    const padNear = this.project(this.lane * LANE_PITCH - 0.42, 0.1);
    const padNearR = this.project(this.lane * LANE_PITCH + 0.42, 0.1);
    const padFarL = this.project(this.lane * LANE_PITCH - 0.42, 6);
    const padFarR = this.project(this.lane * LANE_PITCH + 0.42, 6);
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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 8 * s, 16 * s, 6 * s, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 240, 255, 0.16)';
    ctx.beginPath();
    ctx.ellipse(0, 6 * s, 22 * s, 8 * s, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#00f0ff';
    ctx.beginPath();
    ctx.moveTo(0, -34 * s);
    ctx.lineTo(16 * s, 12 * s);
    ctx.lineTo(0, 2 * s);
    ctx.lineTo(-16 * s, 12 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ff2bd6';
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
    const w = Math.min(this.w - 36, 260);
    const x = (this.w - w) / 2;
    const y = this.groundY + 18;
    ctx.fillRect(x, y, w, 28);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.strokeRect(x, y, w, 28);
    ctx.fillStyle = '#d7f6ff';
    ctx.font = '600 13px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Links/rechts wischen', this.cx, y + 19);
    ctx.globalAlpha = 1;
  }
}
