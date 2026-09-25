/**
 * Orbit Drift — keep the craft in a neon tunnel while the lane bends.
 *
 * A/D, arrows, or a horizontal drag steer. The camera stays on the ship, so
 * the walls slide toward you when you leave the glowing path. Three hull hits
 * end the run. Rings and near-misses use the Rush score formula so the shared
 * leaderboard check accepts the run. The board is `game=drift`.
 *
 * Difficulty (Einfach / Mittel / Schwer / Baba) scales speed, bend, lane width,
 * and tunnel obstacles. Mittel is harder than the original single ramp.
 * Einfach stays wide and slow. Scores keep the same difficulty field as Rush.
 */
import {
  computeScore,
  NEAR_MISS_POINTS,
  NEAR_MISS_CONFIRM_MS,
  COMBO_GAP_SEC,
  COMBO_MAX,
  COMBO_STEP,
} from './game.js';
import { normalizeDifficulty } from './difficulty.js';

const TWO_PI = Math.PI * 2;
const STEP = 12;
const LOOKAHEAD = 240;
const NEAR_CLEARANCE = 0.24;
const RING_RADIUS = 0.46;
const HULL_MAX = 3;
const SHIP_R = 0.14;

/**
 * Scaling is absolute, not a multiplier on the old ramp.
 * The old tunnel was speed 24→44 and half-width 1.32→0.82, with no obstacles.
 *
 * @type {Record<'einfach'|'mittel'|'schwer'|'baba', object>}
 */
export const DRIFT_DIFFICULTIES = {
  einfach: {
    id: 'einfach',
    label: 'Einfach',
    blurb: 'Langsam · weite Bahn · wenige Trümmer',
    speedBase: 19,
    speedGain: 12,
    speedDist: 2200,
    rampDist: 2200,
    laneStart: 1.52,
    laneShrink: 0.28,
    halfMin: 1.18,
    bendAmp: 0.24,
    bendGain: 0.85,
    bendGap: 150,
    bendGapRand: 120,
    bendTighten: 0.15,
    bendFollow: 0.036,
    bendFollowRamp: 0.016,
    firstBend: 220,
    obsStart: 360,
    obsGap: 230,
    obsGapRand: 100,
    debrisWeight: 0.82,
    barrierWeight: 0.16,
    debrisRadius: 0.18,
    barrierCover: 0.46,
    spikeDepth: 0.2,
    spikeDepthRamp: 0.06,
    minGap: 0.92,
    grace: 1.25,
    invuln: 1,
    steerAccel: 8.2,
    steerMax: 2.35,
  },
  mittel: {
    id: 'mittel',
    label: 'Mittel',
    blurb: 'Schneller · engere Kurven · Hindernisse',
    speedBase: 33,
    speedGain: 28,
    speedDist: 1250,
    rampDist: 1400,
    laneStart: 1.06,
    laneShrink: 0.4,
    halfMin: 0.64,
    bendAmp: 0.68,
    bendGain: 2.05,
    bendGap: 60,
    bendGapRand: 54,
    bendTighten: 0.4,
    bendFollow: 0.07,
    bendFollowRamp: 0.045,
    firstBend: 100,
    obsStart: 140,
    obsGap: 86,
    obsGapRand: 44,
    debrisWeight: 0.4,
    barrierWeight: 0.34,
    debrisRadius: 0.26,
    barrierCover: 0.68,
    spikeDepth: 0.32,
    spikeDepthRamp: 0.12,
    minGap: 0.48,
    grace: 0.58,
    invuln: 0.6,
    steerAccel: 9.6,
    steerMax: 2.9,
  },
  schwer: {
    id: 'schwer',
    label: 'Schwer',
    blurb: 'Hohes Tempo · enge Bahn · viele Barrieren',
    speedBase: 44,
    speedGain: 38,
    speedDist: 1000,
    rampDist: 1100,
    laneStart: 0.92,
    laneShrink: 0.34,
    halfMin: 0.56,
    bendAmp: 0.88,
    bendGain: 2.4,
    bendGap: 44,
    bendGapRand: 36,
    bendTighten: 0.48,
    bendFollow: 0.086,
    bendFollowRamp: 0.05,
    firstBend: 64,
    obsStart: 72,
    obsGap: 58,
    obsGapRand: 28,
    debrisWeight: 0.24,
    barrierWeight: 0.38,
    debrisRadius: 0.28,
    barrierCover: 0.76,
    spikeDepth: 0.36,
    spikeDepthRamp: 0.14,
    minGap: 0.4,
    grace: 0.4,
    invuln: 0.46,
    steerAccel: 10.5,
    steerMax: 3.15,
  },
  baba: {
    id: 'baba',
    label: 'Baba',
    blurb: '⚠ Extrem · Spikes · kaum Luft',
    speedBase: 54,
    speedGain: 48,
    speedDist: 820,
    rampDist: 900,
    laneStart: 0.84,
    laneShrink: 0.3,
    halfMin: 0.52,
    bendAmp: 1.05,
    bendGain: 2.75,
    bendGap: 32,
    bendGapRand: 22,
    bendTighten: 0.55,
    bendFollow: 0.1,
    bendFollowRamp: 0.055,
    firstBend: 36,
    obsStart: 28,
    obsGap: 40,
    obsGapRand: 16,
    debrisWeight: 0.16,
    barrierWeight: 0.4,
    debrisRadius: 0.3,
    barrierCover: 0.82,
    spikeDepth: 0.4,
    spikeDepthRamp: 0.16,
    minGap: 0.34,
    grace: 0.26,
    invuln: 0.34,
    steerAccel: 11.2,
    steerMax: 3.45,
  },
};

/** @param {unknown} id */
export function getDriftDifficulty(id) {
  return DRIFT_DIFFICULTIES[normalizeDifficulty(id)];
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/**
 * German readout of the shared formula.
 * score = floor(seconds)×10 + rings×100 + comboBonus + nearMisses×75
 */
export function formatDriftFormula(survivalMs, orbs, comboBonus, nearMisses, score) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  const parts = [`${t}s × 10`, `${o} Ringe × 100`];
  if (cb > 0) parts.push(`Kette +${cb}`);
  if (nm > 0) parts.push(`${nm} Fast-vorbei × ${NEAR_MISS_POINTS}`);
  return `${parts.join(' + ')} = ${score ?? computeScore(survivalMs, orbs, cb, nm)}`;
}

export class DriftGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ audio: import('./audio.js').AudioBus, onGameOver?: (r: object) => void, onHud?: (h: object) => void }} hooks
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.audio = hooks.audio;
    this.onGameOver = hooks.onGameOver;
    this.onHud = hooks.onHud;
    this.running = false;
    this.paused = false;
    this.raf = 0;
    this.lastTs = 0;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.cx = 0;
    this.horizonY = 0;
    this.shipY = 0;
    this.lateral = 120;
    this.input = { left: false, right: false, dragX: null, pointerId: null };
    this._bound = false;
    this._overTimer = 0;
    this.difficultyId = 'mittel';
    this.diff = getDriftDifficulty('mittel');
    this.stars = [];
    this.resetState();
  }

  /** @param {unknown} id */
  setDifficulty(id) {
    this.difficultyId = normalizeDifficulty(id);
    this.diff = getDriftDifficulty(this.difficultyId);
  }

  resetState() {
    const cfg = this.diff || getDriftDifficulty('mittel');
    this.playerZ = 0;
    this.cursorZ = 0;
    this.x = 0;
    this.vx = 0;
    this.center = 0;
    this.bendTarget = 0;
    this.nextBendAt = cfg.firstBend;
    this.nextObstacleAt = cfg.obsStart;
    this.samples = [];
    this.rings = [];
    this.obstacles = [];
    this.particles = [];
    this.floatTexts = [];
    this.pendingNear = [];
    this.lastGateZ = -1;
    this.orbsCollected = 0;
    this.survivalMs = 0;
    this.score = 0;
    this.comboBonus = 0;
    this.nearMisses = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboPeak = 1;
    this.hull = HULL_MAX;
    this.invuln = 0;
    this.grace = cfg.grace;
    this.alive = true;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '255, 77, 109';
    this.trail = 0;
  }

  speedAt(z) {
    const cfg = this.diff;
    const ramp = Math.min(1, Math.max(0, z) / cfg.speedDist);
    return cfg.speedBase + ramp * cfg.speedGain;
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
    this.horizonY = this.h * 0.2;
    this.shipY = Math.min(this.h * 0.78, this.h - 88);
    // Opening lane half is about 1.32. Keep both walls on screen, with room to drift.
    this.lateral = (Math.min(this.w, this.h) * 0.36) / 1.32;
    if (this.stars.length === 0) this.seedStars();
    if (this.samples.length === 0) this.ensureTrack();
  }

  seedStars() {
    this.stars = [];
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: 0.4 + Math.random() * 1.5,
        a: 0.25 + Math.random() * 0.65,
        tw: 0.6 + Math.random() * 2,
        ph: Math.random() * TWO_PI,
        spd: 0.35 + Math.random() * 1.1,
      });
    }
  }

  ensureTrack() {
    const cfg = this.diff;
    const ahead = this.playerZ + LOOKAHEAD;
    while (this.cursorZ < ahead) {
      const ramp = Math.min(1, this.cursorZ / cfg.rampDist);
      if (this.cursorZ >= this.nextBendAt) {
        const amp = cfg.bendAmp + ramp * cfg.bendGain;
        this.bendTarget = (Math.random() * 2 - 1) * amp;
        const gap = cfg.bendGap + Math.random() * cfg.bendGapRand * (1 - ramp * cfg.bendTighten);
        this.nextBendAt = this.cursorZ + gap;
      }
      const follow = cfg.bendFollow + ramp * cfg.bendFollowRamp;
      this.center += (this.bendTarget - this.center) * follow;
      const half = Math.max(cfg.halfMin, cfg.laneStart - ramp * cfg.laneShrink);
      const index = Math.round(this.cursorZ / STEP);
      const gate = index > 2 && index % 4 === 0;
      this.samples.push({
        z: this.cursorZ,
        center: this.center,
        half,
        gate,
      });
      if (index > 2 && index % 7 === 0) {
        this.rings.push({ z: this.cursorZ, x: this.center, taken: false });
      }
      if (this.cursorZ >= this.nextObstacleAt) {
        this.spawnObstacle(this.cursorZ, this.center, half, ramp);
        const gap = cfg.obsGap + Math.random() * cfg.obsGapRand * (1 - ramp * 0.35);
        this.nextObstacleAt = this.cursorZ + Math.max(STEP * 2, gap);
      }
      this.cursorZ += STEP;
    }
    const keep = this.playerZ - 36;
    while (this.samples.length && this.samples[0].z < keep) this.samples.shift();
    while (this.rings.length && this.rings[0].z < keep) this.rings.shift();
    while (this.obstacles.length && this.obstacles[0].z < keep) this.obstacles.shift();
  }

  /**
   * Place one obstacle that still leaves a threadable gap of `minGap`.
   * Returns false when a ring already owns this slice.
   * @param {number} z
   * @param {number} center
   * @param {number} half
   * @param {number} ramp
   */
  spawnObstacle(z, center, half, ramp) {
    const cfg = this.diff;
    for (const ring of this.rings) {
      if (!ring.taken && Math.abs(ring.z - z) < 18) return false;
    }
    const roll = Math.random();
    const side = Math.random() < 0.5 ? -1 : 1;
    let kind = 'spike';
    if (roll < cfg.debrisWeight) kind = 'debris';
    else if (roll < cfg.debrisWeight + cfg.barrierWeight) kind = 'barrier';

    if (kind === 'debris') {
      const radius = Math.min(
        cfg.debrisRadius * (0.85 + ramp * 0.35),
        Math.max(0.12, half - cfg.minGap)
      );
      const maxOffset = Math.max(0, half - radius - cfg.minGap);
      const offset = side * maxOffset * (0.55 + Math.random() * 0.45);
      this.obstacles.push({
        z,
        kind,
        x: center + offset,
        radius,
        side,
        resolved: false,
      });
      return true;
    }
    if (kind === 'barrier') {
      const maxCover = Math.max(0.16, 2 * half - cfg.minGap);
      const cover = Math.min(maxCover, Math.max(0.16, half * cfg.barrierCover));
      this.obstacles.push({ z, kind, side, cover, resolved: false });
      return true;
    }
    const depth = Math.min(
      cfg.spikeDepth + ramp * cfg.spikeDepthRamp,
      Math.max(0.12, half - cfg.minGap)
    );
    this.obstacles.push({ z, kind, side, depth, resolved: false });
    return true;
  }

  /** @param {object} obs @param {number} x */
  obstacleHits(obs, x) {
    const lane = this.sampleAt(obs.z);
    if (obs.kind === 'debris') return Math.abs(x - obs.x) <= obs.radius + SHIP_R;
    if (obs.kind === 'barrier') {
      const wall = lane.center + obs.side * lane.half;
      const inner = wall - obs.side * obs.cover;
      return obs.side > 0 ? x >= inner - SHIP_R : x <= inner + SHIP_R;
    }
    const wall = lane.center + obs.side * lane.half;
    const tip = wall - obs.side * obs.depth;
    return obs.side > 0 ? x >= tip - SHIP_R : x <= tip + SHIP_R;
  }

  sampleAt(z) {
    const s = this.samples;
    if (!s.length) return { z, center: 0, half: 1.2, gate: false };
    if (z <= s[0].z) return s[0];
    const last = s[s.length - 1];
    if (z >= last.z) return last;
    for (let i = 1; i < s.length; i++) {
      if (s[i].z >= z) {
        const a = s[i - 1];
        const b = s[i];
        const t = (z - a.z) / Math.max(0.0001, b.z - a.z);
        return {
          z,
          center: a.center + (b.center - a.center) * t,
          half: a.half + (b.half - a.half) * t,
          gate: false,
        };
      }
    }
    return last;
  }

  bindInput() {
    if (this._bound) return;
    this._bound = true;
    this._onKeyDown = (e) => {
      if (!this.running || this.paused) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        this.input.left = true;
        e.preventDefault();
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        this.input.right = true;
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.input.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.input.right = false;
    };
    this._onPointerDown = (e) => {
      if (!this.running || this.paused) return;
      if (this.input.pointerId != null) return;
      this.input.pointerId = e.pointerId;
      this.input.dragX = e.clientX;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    this._onPointerMove = (e) => {
      if (!this.running || this.paused) return;
      if (this.input.pointerId !== e.pointerId || this.input.dragX == null) return;
      const dx = e.clientX - this.input.dragX;
      this.input.dragX = e.clientX;
      const shortSide = Math.max(1, Math.min(this.w, this.h));
      const sensitivity = 2.6 / (shortSide * 0.42);
      this.x += dx * sensitivity;
      this.vx = 0;
    };
    this._onPointerUp = (e) => {
      if (this.input.pointerId !== e.pointerId) return;
      this.input.pointerId = null;
      this.input.dragX = null;
    };
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerUp);
  }

  unbindInput() {
    if (!this._bound) return;
    this._bound = false;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerUp);
    this.input = { left: false, right: false, dragX: null, pointerId: null };
  }

  /**
   * @param {string} [difficultyId]
   */
  start(difficultyId) {
    if (difficultyId != null && difficultyId !== '') this.setDifficulty(difficultyId);
    clearTimeout(this._overTimer);
    this.resetState();
    this.resize();
    this.playerZ = 0;
    this.x = 0;
    this.vx = 0;
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
      this.input.left = false;
      this.input.right = false;
      this.input.pointerId = null;
      this.input.dragX = null;
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
      const step = Math.min(0.05, left);
      this.step(step);
      left -= step;
    }
    if (!this.alive) this.fadeFx(Math.max(0, dt));
    else this.syncScore();
    this.emitHud();
  }

  step(dt) {
    const cfg = this.diff;
    const steer = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    if (steer !== 0) this.vx += steer * cfg.steerAccel * dt;
    else this.vx *= Math.exp(-5.5 * dt);
    this.vx = clamp(this.vx, -cfg.steerMax, cfg.steerMax);
    this.x += this.vx * dt;

    const prevZ = this.playerZ;
    const spd = this.speedAt(prevZ);
    this.playerZ = prevZ + spd * dt;
    this.survivalMs += dt * 1000;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.grace = Math.max(0, this.grace - dt);
    this.ensureTrack();

    for (const ring of this.rings) {
      if (ring.taken || ring.z <= prevZ || ring.z > this.playerZ) continue;
      if (Math.abs(this.x - ring.x) <= RING_RADIUS) this.collectRing(ring);
    }

    if (this.grace <= 0) {
      for (const s of this.samples) {
        if (!s.gate || s.z <= prevZ || s.z > this.playerZ || s.z <= this.lastGateZ) continue;
        this.lastGateZ = s.z;
        const clearance = s.half - Math.abs(this.x - s.center);
        if (clearance >= 0 && clearance < NEAR_CLEARANCE) {
          this.pendingNear.push({ confirmAt: this.survivalMs + NEAR_MISS_CONFIRM_MS });
        }
      }
      for (const obs of this.obstacles) {
        if (obs.resolved || obs.z <= prevZ || obs.z > this.playerZ) continue;
        obs.resolved = true;
        if (this.invuln > 0) continue;
        if (this.obstacleHits(obs, this.x)) {
          this.hitObstacle(obs);
          if (!this.alive) break;
        } else if (obs.kind === 'debris') {
          const dist = Math.abs(this.x - obs.x) - obs.radius;
          if (dist >= 0 && dist < 0.22) {
            this.pendingNear.push({ confirmAt: this.survivalMs + NEAR_MISS_CONFIRM_MS });
          }
        }
      }
    }

    const lane = this.sampleAt(this.playerZ);
    const clearance = lane.half - Math.abs(this.x - lane.center);
    if (this.grace <= 0 && this.invuln <= 0 && clearance < 0) this.hitWall(lane);

    const now = this.survivalMs;
    if (this.alive) {
      const still = [];
      for (const pending of this.pendingNear) {
        if (now >= pending.confirmAt) {
          this.nearMisses += 1;
          this.audio.nearMiss();
          this.floatText(this.cx, this.shipY - 28, 'FAST', '#7dffa8');
          this.flash = Math.max(this.flash, 0.08);
          this.flashColor = '125, 255, 168';
        } else still.push(pending);
      }
      this.pendingNear = still;
    }

    this.x = clamp(this.x, lane.center - lane.half - 1.35, lane.center + lane.half + 1.35);
    this.fadeFx(dt);
  }

  collectRing(ring) {
    ring.taken = true;
    this.orbsCollected += 1;
    if (this.comboTimer > 0) this.comboCount = Math.min(COMBO_MAX, this.comboCount + 1);
    else this.comboCount = 1;
    this.comboTimer = COMBO_GAP_SEC;
    if (this.comboCount > this.comboPeak) this.comboPeak = this.comboCount;
    this.comboBonus += (this.comboCount - 1) * COMBO_STEP;
    this.audio.collect(this.comboCount);
    if (this.comboCount > 1) this.audio.combo(this.comboCount);
    this.floatText(this.cx, this.shipY - 36, this.comboCount > 1 ? `x${this.comboCount}` : 'RING', '#00f0ff');
  }

  hitObstacle(obs) {
    if (!this.alive) return;
    const lane = this.sampleAt(this.playerZ);
    this.hull -= 1;
    this.invuln = this.diff.invuln;
    let sign = -obs.side || 1;
    if (obs.kind === 'debris') sign = Math.sign(this.x - obs.x) || -obs.side || 1;
    this.x += sign * 0.28;
    this.vx = sign * 1.35;
    this.x = clamp(this.x, lane.center - lane.half + 0.08, lane.center + lane.half - 0.08);
    this.audio.hit();
    this.shake = 1;
    this.flash = 0.45;
    const label = obs.kind === 'barrier' ? 'BARRIERE' : obs.kind === 'spike' ? 'SPIKE' : 'TRÜMMER';
    const color = obs.kind === 'spike' ? '#ff4d6d' : obs.kind === 'barrier' ? '#ff2bd6' : '#ffe566';
    this.flashColor = obs.kind === 'spike' ? '255, 77, 109' : obs.kind === 'barrier' ? '255, 43, 214' : '255, 229, 102';
    this.floatText(this.cx, this.shipY - 42, label, color);
    this.burst(this.cx, this.shipY, color, 14);
    if (this.hull <= 0) this.die();
  }

  hitWall(lane) {
    if (!this.alive) return;
    this.hull -= 1;
    this.invuln = this.diff.invuln;
    const sign = Math.sign(this.x - lane.center) || 1;
    this.x = lane.center + sign * Math.max(0.05, lane.half - 0.12);
    this.vx = -sign * 1.5;
    this.audio.hit();
    this.shake = 1;
    this.flash = 0.45;
    this.flashColor = '255, 77, 109';
    this.floatText(this.cx, this.shipY - 42, 'HÜLLE', '#ff4d6d');
    this.burst(this.cx, this.shipY, '#ff4d6d', 16);
    if (this.hull <= 0) this.die();
  }

  fadeFx(dt) {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.flash = Math.max(0, this.flash - dt * 1.4);
    for (const pt of this.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const ft of this.floatTexts) {
      ft.y += ft.vy * dt;
      ft.life -= dt;
    }
    this.floatTexts = this.floatTexts.filter((ft) => ft.life > 0);
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TWO_PI;
      const s = 30 + Math.random() * 90;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.3,
        r: 1.2 + Math.random() * 1.8,
        color,
      });
    }
  }

  floatText(x, y, text, color) {
    this.floatTexts.push({ x, y, text, color, life: 0.7, vy: -36 });
  }

  syncScore() {
    this.score = computeScore(this.survivalMs, this.orbsCollected, this.comboBonus, this.nearMisses);
  }

  emitHud() {
    this.onHud?.({
      score: this.score,
      orbs: this.orbsCollected,
      time: this.playerZ / 100,
      combo: this.comboCount,
      hull: this.hull,
      distance: this.playerZ / 100,
    });
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.hull = 0;
    this.syncScore();
    this.burst(this.cx, this.shipY, '#ff2bd6', 26);
    this.burst(this.cx, this.shipY, '#00f0ff', 12);
    this.shake = 1;
    this.flash = 0.55;
    this.emitHud();
    clearTimeout(this._overTimer);
    this._overTimer = setTimeout(() => {
      const result = this.buildResult();
      this.stop();
      this.onGameOver?.(result);
    }, 650);
  }

  buildResult() {
    this.syncScore();
    const survivalMs = Math.floor(this.survivalMs);
    const distanceKm = Math.round(this.playerZ) / 100;
    return {
      game: 'drift',
      score: this.score,
      survivalMs,
      orbs: this.orbsCollected,
      comboBonus: this.comboBonus,
      nearMisses: this.nearMisses,
      difficulty: this.difficultyId,
      daily: false,
      comboPeak: this.comboPeak,
      distanceKm,
      hull: this.hull,
      formula: formatDriftFormula(
        survivalMs,
        this.orbsCollected,
        this.comboBonus,
        this.nearMisses,
        this.score
      ),
    };
  }

  /** Menu backdrop: the tunnel scrolls while the craft stays in the lane. */
  drawIdle() {
    if (!this.w) this.resize();
    this.ensureTrack();
    this.playerZ += 0.55;
    const lane = this.sampleAt(this.playerZ);
    this.x += (lane.center - this.x) * 0.12;
    this.draw();
  }

  project(ahead, worldX) {
    const depth = ahead / (ahead + 46);
    const y = this.shipY + (this.horizonY - this.shipY) * depth;
    const scale = 1 - depth * 0.92;
    const x = this.cx + (worldX - this.x) * this.lateral * scale;
    return { x, y, scale, depth };
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.w) return;
    const { w, h } = this;
    let ox = 0;
    let oy = 0;
    if (this.shake > 0) {
      ox = (Math.random() - 0.5) * this.shake * 10;
      oy = (Math.random() - 0.5) * this.shake * 6;
    }
    ctx.save();
    ctx.translate(ox, oy);

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#070816');
    g.addColorStop(0.45, '#0a1020');
    g.addColorStop(1, '#050510');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, w + 40, h + 40);

    const t = performance.now() / 1000;
    const scroll = (this.playerZ * 2.4) % (h + 20);
    for (const s of this.stars) {
      const y = (s.y + scroll * s.spd) % (h + 10);
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = '#d7fff0';
      ctx.beginPath();
      ctx.arc(s.x, y, s.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const laneNow = this.sampleAt(this.playerZ);
    const clearance = laneNow.half - Math.abs(this.x - laneNow.center);
    const danger = clearance < 0.28;

    const slices = [];
    for (let ahead = 200; ahead >= 0; ahead -= 8) {
      const lane = this.sampleAt(this.playerZ + ahead);
      slices.push({
        ahead,
        lane,
        left: this.project(ahead, lane.center - lane.half),
        right: this.project(ahead, lane.center + lane.half),
        mid: this.project(ahead, lane.center),
      });
    }

    if (slices.length > 1) {
      ctx.beginPath();
      ctx.moveTo(slices[0].left.x, slices[0].left.y);
      for (const s of slices) ctx.lineTo(s.left.x, s.left.y);
      for (let i = slices.length - 1; i >= 0; i--) ctx.lineTo(slices[i].right.x, slices[i].right.y);
      ctx.closePath();
      const floor = ctx.createLinearGradient(0, this.horizonY, 0, this.shipY);
      floor.addColorStop(0, 'rgba(0, 240, 255, 0.02)');
      floor.addColorStop(1, danger ? 'rgba(255, 77, 109, 0.16)' : 'rgba(0, 240, 255, 0.1)');
      ctx.fillStyle = floor;
      ctx.fill();

      ctx.lineWidth = 2.4;
      ctx.strokeStyle = danger ? 'rgba(255, 77, 109, 0.95)' : 'rgba(0, 240, 255, 0.9)';
      ctx.shadowColor = danger ? '#ff4d6d' : '#00f0ff';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      slices.forEach((s, i) => (i === 0 ? ctx.moveTo(s.left.x, s.left.y) : ctx.lineTo(s.left.x, s.left.y)));
      ctx.stroke();
      ctx.beginPath();
      slices.forEach((s, i) => (i === 0 ? ctx.moveTo(s.right.x, s.right.y) : ctx.lineTo(s.right.x, s.right.y)));
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(255, 43, 214, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      slices.forEach((s, i) => {
        const outer = 10 + s.left.scale * 16;
        const x = s.left.x - outer;
        if (i === 0) ctx.moveTo(x, s.left.y);
        else ctx.lineTo(x, s.left.y);
      });
      ctx.stroke();
      ctx.beginPath();
      slices.forEach((s, i) => {
        const outer = 10 + s.right.scale * 16;
        const x = s.right.x + outer;
        if (i === 0) ctx.moveTo(x, s.right.y);
        else ctx.lineTo(x, s.right.y);
      });
      ctx.stroke();

      ctx.strokeStyle = 'rgba(125, 255, 168, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      slices.forEach((s, i) => (i === 0 ? ctx.moveTo(s.mid.x, s.mid.y) : ctx.lineTo(s.mid.x, s.mid.y)));
      ctx.stroke();
      ctx.setLineDash([]);

      for (const s of this.samples) {
        if (!s.gate) continue;
        const ahead = s.z - this.playerZ;
        if (ahead < 0 || ahead > 200) continue;
        const left = this.project(ahead, s.center - s.half);
        const right = this.project(ahead, s.center + s.half);
        ctx.globalAlpha = 0.35 + 0.4 * (1 - ahead / 200);
        ctx.strokeStyle = '#ff2bd6';
        ctx.lineWidth = Math.max(1, 3 * left.scale);
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    this.drawObstacles(ctx);

    for (const ring of this.rings) {
      if (ring.taken) continue;
      const ahead = ring.z - this.playerZ;
      if (ahead < -2 || ahead > 200) continue;
      const p = this.project(Math.max(0, ahead), ring.x);
      const rx = Math.max(3, 16 * p.scale);
      const ry = Math.max(1.5, 6 * p.scale);
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = Math.max(1.2, 2.4 * p.scale);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TWO_PI);
      ctx.stroke();
      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rx * 0.55, ry * 0.55, 0, 0, TWO_PI);
      ctx.stroke();
    }

    const blink = this.invuln > 0 && Math.floor(this.invuln * 16) % 2 === 0;
    if (!blink) this.drawShip(ctx, danger);

    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life * 2);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const ft of this.floatTexts) {
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    if (this.running && this.alive && this.survivalMs < 3600) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = '#e8f0ff';
      ctx.textAlign = 'center';
      ctx.fillText('A/D · Pfeile · Wischen', this.cx, Math.min(h - 28, this.shipY + 46));
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashColor}, ${Math.min(0.38, this.flash)})`;
      ctx.fillRect(-20, -20, w + 40, h + 40);
    }
    ctx.restore();
  }

  drawObstacles(ctx) {
    for (const obs of this.obstacles) {
      const ahead = obs.z - this.playerZ;
      if (ahead < -16 || ahead > 210) continue;
      if (obs.kind === 'debris') this.drawDebris(ctx, obs, ahead);
      else if (obs.kind === 'barrier') this.drawBarrier(ctx, obs);
      else this.drawSpike(ctx, obs);
    }
  }

  drawDebris(ctx, obs, ahead) {
    const p = this.project(Math.max(0, ahead), obs.x);
    const s = Math.max(3.5, (9 + obs.radius * 26) * p.scale);
    const fade = Math.max(0.4, 1 - Math.max(0, ahead) / 220);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(obs.z * 0.2 + performance.now() / 380);
    ctx.globalAlpha = fade;
    ctx.shadowColor = '#ffe566';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffe566';
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.7, 0);
    ctx.lineTo(0, s * 0.82);
    ctx.lineTo(-s * 0.7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ff2bd6';
    ctx.lineWidth = Math.max(1, 1.8 * p.scale);
    ctx.stroke();
    ctx.restore();
  }

  drawBarrier(ctx, obs) {
    const z0 = obs.z;
    const z1 = obs.z + 14;
    if (z1 - this.playerZ < 0 || z0 - this.playerZ > 210) return;
    const slice = (z) => {
      const ahead = Math.max(0, z - this.playerZ);
      const lane = this.sampleAt(Math.max(this.playerZ, z));
      const wallX = lane.center + obs.side * lane.half;
      const innerX = wallX - obs.side * obs.cover;
      return {
        wall: this.project(ahead, wallX),
        inner: this.project(ahead, innerX),
      };
    };
    const a = slice(z0);
    const b = slice(z1);
    const fade = Math.max(0.45, 1 - Math.max(0, z0 - this.playerZ) / 220);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.moveTo(a.wall.x, a.wall.y);
    ctx.lineTo(a.inner.x, a.inner.y);
    ctx.lineTo(b.inner.x, b.inner.y);
    ctx.lineTo(b.wall.x, b.wall.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 43, 214, 0.72)';
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffe566';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a.inner.x, a.inner.y);
    ctx.lineTo(b.inner.x, b.inner.y);
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  drawSpike(ctx, obs) {
    this.drawSpikeWedge(ctx, obs, obs.z, 1);
    this.drawSpikeWedge(ctx, obs, obs.z + 8, 0.62);
  }

  drawSpikeWedge(ctx, obs, z, scale) {
    const ahead0 = z - this.playerZ;
    if (ahead0 > 210 || ahead0 < -8) return;
    const lane = this.sampleAt(Math.max(this.playerZ, z));
    const wallX = lane.center + obs.side * lane.half;
    const tipX = wallX - obs.side * obs.depth * scale;
    const a0 = Math.max(0, ahead0);
    const a1 = Math.max(0, ahead0 + 9);
    const wall0 = this.project(a0, wallX);
    const wall1 = this.project(a1, wallX);
    const tip = this.project((a0 + a1) * 0.5, tipX);
    const fade = Math.max(0.45, 1 - Math.max(0, ahead0) / 220);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.moveTo(wall0.x, wall0.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(wall1.x, wall1.y);
    ctx.closePath();
    ctx.fillStyle = '#ff4d6d';
    ctx.shadowColor = '#ff4d6d';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffe566';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  drawShip(ctx, danger) {
    const bob = Math.sin(performance.now() / 180) * 1.5;
    ctx.save();
    ctx.translate(this.cx, this.shipY + bob);
    ctx.fillStyle = danger ? '#ff4d6d' : '#00f0ff';
    ctx.shadowColor = danger ? '#ff4d6d' : '#00f0ff';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(11, 12);
    ctx.lineTo(0, 6);
    ctx.lineTo(-11, 12);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#7dffa8';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#e8fff4';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(3.5, 2);
    ctx.lineTo(-3.5, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
