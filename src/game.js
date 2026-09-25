/**
 * Orbit Rush – Canvas 2D core (v1.3)
 * Control: A/D / arrows / horizontal drag → change orbit RADIUS
 * Craft auto-revolves; collect orbs; dodge asteroids; combos / near-miss / power-ups.
 * Difficulty presets: Einfach / Mittel / Schwer / Baba (see difficulty.js).
 * Daily Challenge: seeded PRNG from UTC date; near-miss only if survive ≥100ms after graze.
 *
 * Score = floor(survivalSeconds)×10 + orbs×100 + comboBonus + nearMisses×NEAR_MISS_POINTS
 */

import { getDifficulty, DEFAULT_DIFFICULTY, normalizeDifficulty } from './difficulty.js';
import { dailyRng, utcDateString } from './rng.js';
import { getSkin, DEFAULT_SKIN, normalizeSkin } from './skins.js';

const TWO_PI = Math.PI * 2;

export const NEAR_MISS_POINTS = 75;
/** Near-miss only counts if player stays alive this long after graze */
export const NEAR_MISS_CONFIRM_MS = 100;
export const COMBO_GAP_SEC = 1.35;
export const COMBO_MAX = 5;
/** Extra points per orb beyond base 100: (mult-1) * COMBO_STEP */
export const COMBO_STEP = 50;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

/**
 * @param {number} survivalMs
 * @param {number} orbs
 * @param {number} [comboBonus=0]
 * @param {number} [nearMisses=0]
 */
export function computeScore(survivalMs, orbs, comboBonus = 0, nearMisses = 0) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  return t * 10 + o * 100 + cb + nm * NEAR_MISS_POINTS;
}

/**
 * @param {number} survivalMs
 * @param {number} orbs
 * @param {number} comboBonus
 * @param {number} nearMisses
 * @param {number} score
 */
export function formatFormula(survivalMs, orbs, comboBonus, nearMisses, score) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  const nmPts = nm * NEAR_MISS_POINTS;
  const parts = [`${t}s × 10`, `${o} orbs × 100`];
  if (cb > 0) parts.push(`combo +${cb}`);
  if (nm > 0) parts.push(`${nm} near-miss × ${NEAR_MISS_POINTS}`);
  return `${parts.join(' + ')} = ${score ?? computeScore(survivalMs, orbs, cb, nm)}`;
}

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ audio: import('./audio.js').AudioBus, onGameOver: (r: object) => void, onHud: (h: object) => void, onTutorial?: (ev: object) => void }} hooks
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.audio = hooks.audio;
    this.onGameOver = hooks.onGameOver;
    this.onHud = hooks.onHud;
    this.onTutorial = hooks.onTutorial;

    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.cx = 0;
    this.cy = 0;

    this.running = false;
    this.paused = false;
    this.raf = 0;
    this.lastTs = 0;

    this.input = { left: false, right: false, dragX: null, pointerId: null };
    this._bound = false;

    /** @type {import('./difficulty.js').DifficultyId} */
    this.difficultyId = DEFAULT_DIFFICULTY;
    this.diffCfg = getDifficulty(DEFAULT_DIFFICULTY);

    /** @type {import('./skins.js').SkinId} */
    this.skinId = DEFAULT_SKIN;
    this.skin = getSkin(DEFAULT_SKIN);

    /** Daily challenge */
    this.dailyMode = false;
    this.dailyDate = null;
    /** @type {(() => number)|null} */
    this._rng = null;

    this.resetState();
  }

  /**
   * Gameplay RNG: seeded in daily mode, Math.random otherwise.
   * @param {number} a
   * @param {number} b
   */
  rand(a, b) {
    const u = this._rng ? this._rng() : Math.random();
    return a + u * (b - a);
  }

  /** @returns {number} [0,1) */
  random() {
    return this._rng ? this._rng() : Math.random();
  }

  /**
   * Apply difficulty preset (call before / via start).
   * @param {string} [id]
   */
  setDifficulty(id) {
    this.difficultyId = normalizeDifficulty(id);
    this.diffCfg = getDifficulty(this.difficultyId);
  }

  /** @param {string} [id] */
  setSkin(id) {
    this.skinId = normalizeSkin(id);
    this.skin = getSkin(this.skinId);
  }

  resetState() {
    this.planetR = 42;
    this.angle = -Math.PI / 2;
    this.angVel = 1.35;
    this.radius = 118;
    this.rMin = 72;
    this.rMax = 168;
    this.rTarget = this.radius;
    this._startRadius = 118;

    this.orbs = [];
    this.asteroids = [];
    this.particles = [];
    this.stars = [];
    this.shockwaves = [];
    this.floatTexts = [];
    this.powerups = [];

    this.orbsCollected = 0;
    this.survivalMs = 0;
    this.score = 0;
    this.comboBonus = 0;
    this.nearMisses = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboMult = 1;
    this.comboPeak = 1;
    /** @type {{x:number,y:number,midX:number,midY:number,confirmAt:number}[]} */
    this.pendingNearMisses = [];

    this.spawnOrbTimer = 0;
    this.spawnAstTimer = (this.diffCfg?.startAstDelay ?? 0.8);
    this.spawnPowerTimer = 8 * (this.diffCfg?.powerInterval ?? 1);
    this.ramp = 0;
    this.shake = 0;
    this.hitStop = 0;
    this.alive = true;
    this.flash = 0;
    this.flashColor = '255, 43, 214';
    this.trail = [];

    // Power-up timers (seconds remaining)
    this.shield = 0; // charges (0/1), not time-based — use shieldCharges
    this.shieldCharges = 0;
    this.slowMo = 0;
    this.magnet = 0;

    this.didOrbitChange = false;
    this.didCollectOrb = false;
    this.timeScale = 1;
  }

  resize() {
    const parent = this.canvas.parentElement || document.body;
    const rect = parent.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.w = Math.max(1, Math.floor(rect.width));
    this.h = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cx = this.w * 0.5;
    this.cy = this.h * 0.42;
    const scale = Math.min(this.w, this.h) / 390;
    this.planetR = 42 * scale;
    const span = this.diffCfg?.rSpan ?? 1;
    const mid = ((72 + 168) / 2) * scale;
    const half = ((168 - 72) / 2) * scale * span;
    this.rMin = mid - half;
    this.rMax = Math.min(mid + half, Math.min(this.w, this.h) * 0.42);
    if (this.rMax <= this.rMin + 20) {
      this.rMin = 72 * scale;
      this.rMax = Math.min(168 * scale, Math.min(this.w, this.h) * 0.42);
    }
    this.radius = clamp(this.radius, this.rMin, this.rMax);
    this.rTarget = this.radius;
    if (this.stars.length === 0) this.seedStars();
  }

  seedStars() {
    this.stars = [];
    for (let i = 0; i < 90; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: rand(0.4, 1.8),
        a: rand(0.2, 0.9),
        tw: rand(0.5, 2.5),
        ph: Math.random() * TWO_PI,
      });
    }
  }

  bindInput() {
    if (this._bound) return;
    this._bound = true;
    this._onKeyDown = (e) => {
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
      if (this.input.pointerId !== e.pointerId || this.input.dragX == null) return;
      const dx = e.clientX - this.input.dragX;
      this.input.dragX = e.clientX;
      const sensitivity = (this.rMax - this.rMin) / (this.w * 0.55);
      this.rTarget = clamp(this.rTarget + dx * sensitivity, this.rMin, this.rMax);
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
   * @param {string|object} [difficultyIdOrOpts]
   * @param {{ daily?: boolean, dailyDate?: string, skinId?: string, difficulty?: string }} [opts]
   */
  start(difficultyIdOrOpts, opts) {
    let difficultyId = null;
    let options = opts || {};
    if (difficultyIdOrOpts && typeof difficultyIdOrOpts === 'object') {
      options = difficultyIdOrOpts;
      difficultyId = options.difficulty ?? null;
    } else if (difficultyIdOrOpts != null) {
      difficultyId = difficultyIdOrOpts;
    }

    this.dailyMode = !!options.daily;
    this.dailyDate = this.dailyMode
      ? (options.dailyDate || utcDateString())
      : null;
    if (this.dailyMode) {
      this.setDifficulty('schwer');
      this._rng = dailyRng(this.dailyDate);
    } else {
      if (difficultyId != null) this.setDifficulty(difficultyId);
      this._rng = null;
    }
    if (options.skinId != null) this.setSkin(options.skinId);

    this.resetState();
    this.resize();
    // Re-clamp start radius after resize applied difficulty span
    this.radius = clamp((this.rMin + this.rMax) / 2, this.rMin, this.rMax);
    this.rTarget = this.radius;
    this._startRadius = this.radius;
    this.bindInput();
    this.running = true;
    this.paused = false;
    this.alive = true;
    this.lastTs = 0;
    this.emitHud();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  stop() {
    this.running = false;
    this.unbindInput();
    cancelAnimationFrame(this.raf);
  }

  setPaused(p) {
    this.paused = !!p;
    if (!this.paused && this.running) {
      this.lastTs = 0;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
  }

  emitHud() {
    this.onHud?.({
      score: this.score,
      orbs: this.orbsCollected,
      time: this.survivalMs / 1000,
      combo: this.comboMult,
      comboCount: this.comboCount,
      comboTimer: this.comboTimer,
      shield: this.shieldCharges > 0,
      slowMo: this.slowMo > 0,
      magnet: this.magnet > 0,
      nearMisses: this.nearMisses,
    });
  }

  playerPos() {
    return {
      x: this.cx + Math.cos(this.angle) * this.radius,
      y: this.cy + Math.sin(this.angle) * this.radius,
    };
  }

  spawnOrb() {
    const a = this.random() * TWO_PI;
    const r = this.rand(this.rMin + 8, this.rMax - 4);
    this.orbs.push({
      a,
      r,
      pulse: this.random() * TWO_PI,
      life: 12,
      collected: false,
    });
  }

  spawnAsteroid() {
    const side = Math.floor(this.random() * 4);
    let x, y;
    const margin = 40;
    if (side === 0) {
      x = -margin;
      y = this.rand(0, this.h);
    } else if (side === 1) {
      x = this.w + margin;
      y = this.rand(0, this.h);
    } else if (side === 2) {
      x = this.rand(0, this.w);
      y = -margin;
    } else {
      x = this.rand(0, this.w);
      y = this.h + margin;
    }
    const targetR = this.rand(this.rMin * 0.7, this.rMax * 1.05);
    const ta = this.random() * TWO_PI;
    const tx = this.cx + Math.cos(ta) * targetR;
    const ty = this.cy + Math.sin(ta) * targetR;
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.hypot(dx, dy) || 1;
    const cfg = this.diffCfg;
    const speed = (this.rand(70, 110) + this.ramp * 28) * (cfg?.astSpeed ?? 1);
    const size = (this.rand(7, 16) + this.ramp * 1.5) * (cfg?.astSize ?? 1);
    this.asteroids.push({
      x,
      y,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      r: size,
      rot: this.random() * TWO_PI,
      spin: this.rand(-3, 3),
      verts: this.makeRock(size),
      nearMissed: false,
    });
  }

  spawnPowerup() {
    const types = ['shield', 'slow', 'magnet'];
    const type = types[Math.floor(this.random() * types.length)];
    const a = this.random() * TWO_PI;
    const r = this.rand(this.rMin + 10, this.rMax - 6);
    this.powerups.push({
      type,
      a,
      r,
      pulse: this.random() * TWO_PI,
      life: 10,
      collected: false,
    });
  }

  makeRock(size) {
    const n = 6 + Math.floor(this.random() * 3);
    const verts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TWO_PI;
      const rr = size * this.rand(0.65, 1.15);
      verts.push({ a, r: rr });
    }
    return verts;
  }

  burst(x, y, color, n = 14, speedMul = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TWO_PI;
      const sp = rand(40, 220) * speedMul;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.35, 0.9),
        max: 0.9,
        r: rand(1.2, 3.8),
        color,
        drag: 0.96,
      });
    }
  }

  floatText(x, y, text, color = '#ffe566') {
    this.floatTexts.push({
      x,
      y,
      text,
      color,
      life: 0.9,
      max: 0.9,
      vy: -42,
    });
  }

  loop(ts) {
    if (!this.running) return;
    if (this.paused) {
      this.draw(0);
      return;
    }
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    dt = clamp(dt, 0, 0.05);

    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.draw(dt);
      this.raf = requestAnimationFrame((t) => this.loop(t));
      return;
    }

    if (this.alive) this.update(dt);
    else this.updateDead(dt);

    this.draw(dt);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    // Slow-mo affects gameplay clock but not survival score unfairly —
    // survival still counts real-ish time at reduced rate for fairness feel.
    const timeScale = this.slowMo > 0 ? 0.45 : 1;
    this.timeScale = timeScale;
    const gdt = dt * timeScale;

    this.survivalMs += dt * 1000; // wall time for score
    const cfg = this.diffCfg;
    this.ramp = Math.min(cfg.rampCap, this.survivalMs / cfg.rampDivisor);

    if (this.slowMo > 0) this.slowMo = Math.max(0, this.slowMo - dt);
    if (this.magnet > 0) this.magnet = Math.max(0, this.magnet - dt);

    // Keyboard radius
    const rSpeed = (this.rMax - this.rMin) * 1.15;
    if (this.input.left) this.rTarget -= rSpeed * dt;
    if (this.input.right) this.rTarget += rSpeed * dt;
    this.rTarget = clamp(this.rTarget, this.rMin, this.rMax);
    this.radius += (this.rTarget - this.radius) * Math.min(1, 14 * dt);

    if (
      !this.didOrbitChange &&
      Math.abs(this.radius - this._startRadius) > (this.rMax - this.rMin) * 0.08
    ) {
      this.didOrbitChange = true;
      this.onTutorial?.({ type: 'orbit' });
    }

    this.angVel = (cfg.angVelBase + this.ramp * cfg.angVelRamp) * (this.slowMo > 0 ? 0.85 : 1);
    this.angle += this.angVel * gdt;
    if (this.angle > TWO_PI) this.angle -= TWO_PI;

    const p = this.playerPos();
    this.trail.push({ x: p.x, y: p.y, life: 0.45, r: 2.8 });
    if (this.trail.length > 36) this.trail.shift();
    for (const t of this.trail) t.life -= dt;

    // Combo decay
    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboMult = 1;
        this.comboTimer = 0;
      }
    }

    // Spawns (scaled by difficulty; seeded in daily mode)
    this.spawnOrbTimer -= dt;
    if (this.spawnOrbTimer <= 0) {
      if (this.orbs.length < cfg.orbMax) this.spawnOrb();
      const baseOrb = this.rand(0.7, 1.35) - this.ramp * 0.15;
      this.spawnOrbTimer = Math.max(0.35, baseOrb * cfg.orbInterval);
    }
    this.spawnAstTimer -= dt;
    if (this.spawnAstTimer <= 0) {
      const doubleChance = this.ramp * 0.35 * Math.min(1.4, cfg.astRate);
      const count = 1 + (this.random() < doubleChance ? 1 : 0);
      for (let i = 0; i < count; i++) this.spawnAsteroid();
      const baseAst = Math.max(0.28, 1.15 - this.ramp * 0.45 + this.rand(-0.1, 0.15));
      this.spawnAstTimer = Math.max(0.18, baseAst / cfg.astRate);
    }
    this.spawnPowerTimer -= dt;
    if (this.spawnPowerTimer <= 0) {
      if (this.powerups.length < 1 && this.random() < cfg.powerChance) this.spawnPowerup();
      this.spawnPowerTimer = this.rand(9, 16) * cfg.powerInterval;
    }

    // Magnet: pull orbs toward player
    if (this.magnet > 0) {
      for (const o of this.orbs) {
        if (o.collected) continue;
        const ox = this.cx + Math.cos(o.a) * o.r;
        const oy = this.cy + Math.sin(o.a) * o.r;
        const dx = p.x - ox;
        const dy = p.y - oy;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 160) {
          // Nudge polar coords toward player
          const pull = (1 - d / 160) * 90 * dt;
          const nx = ox + (dx / d) * pull;
          const ny = oy + (dy / d) * pull;
          o.a = Math.atan2(ny - this.cy, nx - this.cx);
          o.r = Math.hypot(nx - this.cx, ny - this.cy);
        }
      }
    }

    // Orbs
    for (const o of this.orbs) {
      o.pulse += dt * 4;
      o.life -= dt * 0.08;
      const ox = this.cx + Math.cos(o.a) * o.r;
      const oy = this.cy + Math.sin(o.a) * o.r;
      if (!o.collected && dist(p.x, p.y, ox, oy) < 18) {
        o.collected = true;
        this.orbsCollected += 1;
        this.comboCount += 1;
        this.comboMult = Math.min(COMBO_MAX, this.comboCount);
        this.comboPeak = Math.max(this.comboPeak, this.comboMult);
        this.comboTimer = COMBO_GAP_SEC;
        const extra = (this.comboMult - 1) * COMBO_STEP;
        this.comboBonus += extra;

        this.audio.collect(this.comboMult);
        this.burst(ox, oy, '#00f0ff', 18 + this.comboMult * 2, 1 + this.comboMult * 0.08);
        this.burst(ox, oy, '#ff2bd6', 8 + this.comboMult, 1.1);
        this.flash = 0.12 + this.comboMult * 0.02;
        this.flashColor = '0, 240, 255';
        this.hitStop = this.comboMult >= 3 ? 0.035 : 0.018;

        if (this.comboMult >= 2) {
          this.floatText(ox, oy - 10, `x${this.comboMult}`, '#00f0ff');
        }
        if (this.comboMult === 3 || this.comboMult === 5) {
          this.audio.combo(this.comboMult);
          this.shockwaves.push({ x: ox, y: oy, r: 6, vr: 220, life: 0.4, color: '#00f0ff' });
        }

        if (!this.didCollectOrb) {
          this.didCollectOrb = true;
          this.onTutorial?.({ type: 'orb' });
        }
      }
    }
    this.orbs = this.orbs.filter((o) => !o.collected && o.life > 0);

    // Power-ups
    for (const pu of this.powerups) {
      pu.pulse += dt * 3;
      pu.life -= dt * 0.1;
      const px = this.cx + Math.cos(pu.a) * pu.r;
      const py = this.cy + Math.sin(pu.a) * pu.r;
      if (!pu.collected && dist(p.x, p.y, px, py) < 22) {
        pu.collected = true;
        this.applyPowerup(pu.type, px, py);
      }
    }
    this.powerups = this.powerups.filter((pu) => !pu.collected && pu.life > 0);

    // Asteroids
    const hitR = 11;
    const nearBand = 28;
    for (const a of this.asteroids) {
      a.x += a.vx * gdt;
      a.y += a.vy * gdt;
      a.rot += a.spin * gdt;
      const d = dist(p.x, p.y, a.x, a.y);
      if (d < a.r + hitR) {
        if (this.shieldCharges > 0) {
          this.shieldCharges = 0;
          this.audio.shieldBreak();
          this.burst(a.x, a.y, '#3dff9a', 22);
          this.burst(p.x, p.y, '#8b5cff', 12);
          this.shake = 0.55;
          this.flash = 0.25;
          this.flashColor = '61, 255, 154';
          this.floatText(p.x, p.y - 16, 'SHIELD!', '#3dff9a');
          this.shockwaves.push({ x: p.x, y: p.y, r: 8, vr: 300, life: 0.4, color: '#3dff9a' });
          // Knock asteroid away
          a.vx *= -1.2;
          a.vy *= -1.2;
          a.nearMissed = true;
          continue;
        }
        this.die(p.x, p.y);
        break;
      } else if (
        !a.nearMissed &&
        d < a.r + hitR + nearBand &&
        d > a.r + hitR + 2
      ) {
        // Mark graze; confirm only if player survives ≥ NEAR_MISS_CONFIRM_MS
        a.nearMissed = true;
        this.pendingNearMisses.push({
          x: p.x,
          y: p.y,
          midX: (p.x + a.x) / 2,
          midY: (p.y + a.y) / 2,
          confirmAt: this.survivalMs + NEAR_MISS_CONFIRM_MS,
        });
      }
    }
    this.asteroids = this.asteroids.filter(
      (a) => a.x > -80 && a.x < this.w + 80 && a.y > -80 && a.y < this.h + 80
    );

    // Confirm pending near-misses only if still alive after delay
    if (this.pendingNearMisses.length) {
      const ready = [];
      const keep = [];
      for (const nm of this.pendingNearMisses) {
        if (this.survivalMs >= nm.confirmAt) ready.push(nm);
        else keep.push(nm);
      }
      this.pendingNearMisses = keep;
      for (const nm of ready) {
        this.nearMisses += 1;
        this.audio.nearMiss();
        this.burst(nm.midX, nm.midY, '#ffe566', 10, 0.7);
        this.floatText(nm.midX, nm.midY - 8, 'NEAR MISS!', '#ffe566');
        this.flash = 0.08;
        this.flashColor = '255, 229, 102';
        this.shake = Math.max(this.shake, 0.25);
      }
    }

    // Particles
    for (const pt of this.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= pt.drag ?? 0.96;
      pt.vy *= pt.drag ?? 0.96;
      pt.life -= dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);

    for (const s of this.shockwaves) {
      s.r += s.vr * dt;
      s.life -= dt;
    }
    this.shockwaves = this.shockwaves.filter((s) => s.life > 0);

    for (const ft of this.floatTexts) {
      ft.y += ft.vy * dt;
      ft.life -= dt;
    }
    this.floatTexts = this.floatTexts.filter((ft) => ft.life > 0);

    this.shake = Math.max(0, this.shake - dt * 4);
    this.flash = Math.max(0, this.flash - dt);

    this.score = computeScore(
      this.survivalMs,
      this.orbsCollected,
      this.comboBonus,
      this.nearMisses
    );
    this.emitHud();
  }

  applyPowerup(type, x, y) {
    this.audio.powerup(type);
    this.burst(x, y, powerColor(type), 20);
    this.shockwaves.push({
      x,
      y,
      r: 6,
      vr: 260,
      life: 0.45,
      color: powerColor(type),
    });
    if (type === 'shield') {
      this.shieldCharges = 1;
      this.floatText(x, y - 12, 'SHIELD', '#3dff9a');
    } else if (type === 'slow') {
      this.slowMo = 4.5;
      this.floatText(x, y - 12, 'SLOW-MO', '#8b5cff');
    } else if (type === 'magnet') {
      this.magnet = 5;
      this.floatText(x, y - 12, 'MAGNET', '#00f0ff');
    }
    this.flash = 0.18;
    this.flashColor = powerRgb(type);
  }

  updateDead(dt) {
    for (const pt of this.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.97;
      pt.vy *= 0.97;
      pt.life -= dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const s of this.shockwaves) {
      s.r += s.vr * dt;
      s.life -= dt;
    }
    this.shockwaves = this.shockwaves.filter((s) => s.life > 0);
    for (const ft of this.floatTexts) {
      ft.y += ft.vy * dt;
      ft.life -= dt;
    }
    this.floatTexts = this.floatTexts.filter((ft) => ft.life > 0);
    this.shake = Math.max(0, this.shake - dt * 3);
  }

  die(x, y) {
    if (!this.alive) return;
    this.alive = false;
    // Discard unconfirmed grazes — death before confirm window voids them
    this.pendingNearMisses = [];
    this.audio.hit();
    this.shake = 1;
    this.flash = 0.4;
    this.flashColor = '255, 77, 109';
    this.hitStop = 0.08;
    this.burst(x, y, '#ff4d6d', 28);
    this.burst(x, y, '#ff2bd6', 16);
    this.burst(x, y, '#00f0ff', 12);
    this.shockwaves.push({ x, y, r: 4, vr: 280, life: 0.55, color: '#ff2bd6' });
    this.score = computeScore(
      this.survivalMs,
      this.orbsCollected,
      this.comboBonus,
      this.nearMisses
    );
    this.emitHud();
    const result = {
      score: this.score,
      survivalMs: Math.floor(this.survivalMs),
      orbs: this.orbsCollected,
      comboBonus: this.comboBonus,
      nearMisses: this.nearMisses,
      difficulty: this.difficultyId,
      comboPeak: this.comboPeak,
      daily: this.dailyMode,
      dailyDate: this.dailyDate,
      formula: formatFormula(
        this.survivalMs,
        this.orbsCollected,
        this.comboBonus,
        this.nearMisses,
        this.score
      ),
    };
    setTimeout(() => {
      this.stop();
      this.onGameOver?.(result);
    }, 650);
  }

  draw() {
    const ctx = this.ctx;
    const { w, h, cx, cy } = this;
    let ox = 0;
    let oy = 0;
    if (this.shake > 0) {
      ox = (Math.random() - 0.5) * this.shake * 10;
      oy = (Math.random() - 0.5) * this.shake * 10;
    }

    ctx.save();
    ctx.translate(ox, oy);

    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.75);
    g.addColorStop(0, this.slowMo > 0 ? '#1a1440' : '#16132e');
    g.addColorStop(0.45, '#0a0a1a');
    g.addColorStop(1, '#050510');
    ctx.fillStyle = g;
    ctx.fillRect(-ox - 20, -oy - 20, w + 40, h + 40);

    const t = performance.now() / 1000;
    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.tw + s.ph);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = '#c8d8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.lineWidth = 1;
    for (const rr of [this.rMin, (this.rMin + this.rMax) / 2, this.rMax]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius, 0, TWO_PI);
    ctx.stroke();
    ctx.setLineDash([]);

    this.drawPlanet(ctx, cx, cy, this.planetR);

    // Trail with fade size
    for (let i = 0; i < this.trail.length; i++) {
      const tr = this.trail[i];
      if (tr.life <= 0) continue;
      const a = (tr.life / 0.45) * 0.5;
      ctx.globalAlpha = a;
      ctx.fillStyle = this.magnet > 0 ? '#7af7ff' : (this.skin?.trail || '#00f0ff');
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, (tr.r || 2.5) * (tr.life / 0.45), 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Orbs
    for (const o of this.orbs) {
      const oxp = cx + Math.cos(o.a) * o.r;
      const oyp = cy + Math.sin(o.a) * o.r;
      const pulse = 1 + 0.15 * Math.sin(o.pulse);
      const glow = ctx.createRadialGradient(oxp, oyp, 0, oxp, oyp, 16 * pulse);
      glow.addColorStop(0, 'rgba(0, 240, 255, 0.95)');
      glow.addColorStop(0.4, 'rgba(255, 43, 214, 0.45)');
      glow.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(oxp, oyp, 16 * pulse, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = '#e8ffff';
      ctx.beginPath();
      ctx.arc(oxp, oyp, 4.5 * pulse, 0, TWO_PI);
      ctx.fill();
    }

    // Power-ups
    for (const pu of this.powerups) {
      const px = cx + Math.cos(pu.a) * pu.r;
      const py = cy + Math.sin(pu.a) * pu.r;
      this.drawPowerup(ctx, px, py, pu);
    }

    // Asteroids
    for (const a of this.asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      for (let i = 0; i < a.verts.length; i++) {
        const v = a.verts[i];
        const px = Math.cos(v.a) * v.r;
        const py = Math.sin(v.a) * v.r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = '#2a2438';
      ctx.strokeStyle = '#ff4d6d';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(255, 77, 109, 0.55)';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Particles
    for (const pt of this.particles) {
      ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Shockwaves
    for (const s of this.shockwaves) {
      ctx.globalAlpha = clamp(s.life / 0.55, 0, 1) * 0.7;
      ctx.strokeStyle = s.color || '#ff2bd6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Floating text
    for (const ft of this.floatTexts) {
      const a = clamp(ft.life / ft.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 14px Segoe UI, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 8;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    // Craft
    if (this.alive) {
      const p = this.playerPos();
      const heading = this.angle + Math.PI / 2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(heading);

      if (this.shieldCharges > 0) {
        ctx.beginPath();
        ctx.arc(0, 0, 18, 0, TWO_PI);
        ctx.strokeStyle = 'rgba(61, 255, 154, 0.75)';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#3dff9a';
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      const skin = this.skin || { craft: '#00f0ff', accent: '#ff2bd6', glow: '#00f0ff' };
      ctx.shadowColor = skin.glow || skin.craft;
      ctx.shadowBlur = 16;
      ctx.fillStyle = skin.craft;
      ctx.beginPath();
      ctx.moveTo(0, -12);
      ctx.lineTo(8, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-8, 10);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = skin.accent;
      ctx.beginPath();
      ctx.moveTo(0, 5);
      ctx.lineTo(4, 12);
      ctx.lineTo(0, 9);
      ctx.lineTo(-4, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashColor}, ${this.flash * 0.35})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawPowerup(ctx, x, y, pu) {
    const pulse = 1 + 0.12 * Math.sin(pu.pulse);
    const col = powerColor(pu.type);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 20 * pulse);
    glow.addColorStop(0, col);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 18 * pulse, 0, TWO_PI);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = col;
    ctx.fillStyle = '#0a0a1a';
    ctx.lineWidth = 2;
    if (pu.type === 'shield') {
      ctx.beginPath();
      ctx.arc(0, 0, 9 * pulse, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 5.5 * pulse, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else if (pu.type === 'slow') {
      ctx.beginPath();
      ctx.arc(0, 0, 9 * pulse, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(0, 1);
      ctx.lineTo(4, 4);
      ctx.stroke();
    } else {
      // magnet horseshoe-ish
      ctx.beginPath();
      ctx.arc(0, 0, 9 * pulse, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 1, 5, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPlanet(ctx, cx, cy, r) {
    const atm = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.6);
    atm.addColorStop(0, 'rgba(139, 92, 255, 0.35)');
    atm.addColorStop(0.5, 'rgba(0, 240, 255, 0.12)');
    atm.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = atm;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6, 0, TWO_PI);
    ctx.fill();

    const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    body.addColorStop(0, '#5a4dff');
    body.addColorStop(0.45, '#2b1f6e');
    body.addColorStop(1, '#0d0a22');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.28);
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.55, 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }
}

function powerColor(type) {
  if (type === 'shield') return '#3dff9a';
  if (type === 'slow') return '#8b5cff';
  return '#00f0ff';
}

function powerRgb(type) {
  if (type === 'shield') return '61, 255, 154';
  if (type === 'slow') return '139, 92, 255';
  return '0, 240, 255';
}

export { getDifficulty, normalizeDifficulty, DEFAULT_DIFFICULTY } from './difficulty.js';
