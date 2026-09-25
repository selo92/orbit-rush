/**
 * Orbit Mirror — the ship flies the mirrored radius.
 *
 * Left / A / ← / drag-left moves the reflex ghost inward and the ship outward.
 * Right does the opposite. The ghost is where a normal Orbit Rush input would go.
 * Shards and orbs live in the ship's orbit. Score uses the Rush formula so the
 * shared leaderboard check accepts the run. `cleanStreak` is local juice only.
 */
import {
  computeScore,
  formatFormula,
  NEAR_MISS_CONFIRM_MS,
  COMBO_GAP_SEC,
  COMBO_MAX,
  COMBO_STEP,
} from './game.js';

const TWO_PI = Math.PI * 2;
const RADIUS_KEY_BANDS_PER_SEC = 2.4;
const RADIUS_KEY_FOLLOW = 64;
const DRAG_BAND_OF_SHORT_SIDE = 0.38;
const CLEAR_CHAIN_MS = 2200;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function angDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

function crossedForward(prev, now, target) {
  const span = angDelta(prev, now);
  if (span <= 0.0001) return false;
  const toTarget = angDelta(prev, target);
  return toTarget >= -0.0001 && toTarget <= span + 0.0001;
}

/** Reflect a radius across the middle of the orbit band. */
export function mirrorRadius(intent, rMin, rMax) {
  const mid = (rMin + rMax) / 2;
  return clamp(2 * mid - intent, rMin, rMax);
}

export class MirrorGame {
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
    this.cy = 0;
    this.input = { left: false, right: false, dragX: null, pointerId: null };
    this._bound = false;
    this._overTimer = 0;
    this.resetState();
  }

  resetState() {
    this.planetR = 42;
    this.angle = -Math.PI / 2;
    this.prevAngle = this.angle;
    this.angVel = 1.08;
    this.rMin = 72;
    this.rMax = 168;
    this.intent = 120;
    this.intentTarget = 120;
    this.radius = 120;
    this.shards = [];
    this.orbs = [];
    this.particles = [];
    this.floatTexts = [];
    this.stars = [];
    this.trail = [];
    this.orbsCollected = 0;
    this.survivalMs = 0;
    this.score = 0;
    this.comboBonus = 0;
    this.nearMisses = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboMult = 1;
    this.comboPeak = 1;
    this.cleanStreak = 0;
    this.bestClean = 0;
    this.lastClearAt = -1;
    this.pendingNear = [];
    this.spawnShardTimer = 1.2;
    this.spawnOrbTimer = 0.9;
    this.ramp = 0;
    this.alive = true;
    this._dying = false;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '255, 43, 214';
    this.hitStop = 0;
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
    this.cy = this.h * 0.42;
    const scale = Math.min(this.w, this.h) / 390;
    this.planetR = 42 * scale;
    const mid = ((72 + 168) / 2) * scale;
    const half = ((168 - 72) / 2) * scale;
    this.rMin = mid - half;
    this.rMax = Math.min(mid + half, Math.min(this.w, this.h) * 0.42);
    if (this.rMax <= this.rMin + 24) {
      this.rMin = 72 * scale;
      this.rMax = Math.min(168 * scale, Math.min(this.w, this.h) * 0.42);
    }
    this.intent = clamp(this.intent, this.rMin, this.rMax);
    this.intentTarget = clamp(this.intentTarget, this.rMin, this.rMax);
    this.radius = mirrorRadius(this.intent, this.rMin, this.rMax);
    if (this.stars.length === 0) this.seedStars();
  }

  seedStars() {
    this.stars = [];
    for (let i = 0; i < 80; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: 0.4 + Math.random() * 1.4,
        a: 0.25 + Math.random() * 0.7,
        tw: 0.6 + Math.random() * 2,
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
      const span = Math.max(1, this.rMax - this.rMin);
      const shortSide = Math.max(1, Math.min(this.w, this.h));
      const sensitivity = span / (shortSide * DRAG_BAND_OF_SHORT_SIDE);
      // Same drag as Rush on the reflex. The ship is the mirror, so the finger and the craft disagree.
      this.intentTarget = clamp(this.intentTarget + dx * sensitivity, this.rMin, this.rMax);
      this.intent = this.intentTarget;
      this.radius = mirrorRadius(this.intent, this.rMin, this.rMax);
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

  start() {
    clearTimeout(this._overTimer);
    this.resetState();
    this.resize();
    const mid = (this.rMin + this.rMax) / 2;
    this.intent = mid;
    this.intentTarget = mid;
    this.radius = mirrorRadius(mid, this.rMin, this.rMax);
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
    clearTimeout(this._overTimer);
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

  syncScore() {
    this.score = computeScore(this.survivalMs, this.orbsCollected, this.comboBonus, this.nearMisses);
  }

  emitHud() {
    this.onHud?.({
      score: this.score,
      orbs: this.orbsCollected,
      time: this.survivalMs / 1000,
      combo: this.comboMult,
      streak: this.cleanStreak,
      shield: false,
      slowMo: false,
      magnet: false,
      nearMisses: this.nearMisses,
    });
  }

  posAt(r, a = this.angle) {
    return {
      x: this.cx + Math.cos(a) * r,
      y: this.cy + Math.sin(a) * r,
    };
  }

  /**
   * A magenta wall ahead that covers the ship's current radius and one side.
   * The other side stays open. Returns false when there is no fair pocket.
   */
  spawnShard() {
    const span = Math.max(1, this.rMax - this.rMin);
    const hitR = span * (0.2 + this.ramp * 0.12);
    const need = hitR * 0.55 + 16;
    const roomOut = this.rMax - 6 - this.radius;
    const roomIn = this.radius - (this.rMin + 6);
    let safeOut = Math.random() < 0.5;
    const fits = (out) => (out ? roomOut : roomIn) > need;
    if (!fits(safeOut)) safeOut = !safeOut;
    if (!fits(safeOut)) return false;
    const r = safeOut ? this.radius - hitR * 0.45 : this.radius + hitR * 0.45;
    const dangerLo = r - hitR;
    const dangerHi = r + hitR;
    if (!(this.radius > dangerLo + 1 && this.radius < dangerHi - 1)) return false;
    const safeR = safeOut
      ? Math.min(this.rMax - 6, dangerHi + 8)
      : Math.max(this.rMin + 6, dangerLo - 8);
    if (Math.abs(safeR - r) < hitR) return false;
    const lead = 1.22 - this.ramp * 0.36;
    this.shards.push({
      a: this.angle + lead,
      r,
      hitR,
      safeR,
      safeOut,
      rot: Math.random() * TWO_PI,
      spin: (Math.random() * 2 - 1) * 2.2,
      resolved: false,
      fade: 0.45,
    });
    return true;
  }

  spawnOrb() {
    const shard = [...this.shards].reverse().find((s) => !s.resolved);
    let r;
    let a;
    if (shard) {
      r = shard.safeR;
      a = shard.a - 0.22;
    } else {
      const span = this.rMax - this.rMin;
      const offset = (Math.random() < 0.5 ? -1 : 1) * span * (0.22 + Math.random() * 0.2);
      r = clamp(this.radius + offset, this.rMin + 8, this.rMax - 8);
      a = this.angle + 0.75 + Math.random() * 0.45;
    }
    this.orbs.push({
      a,
      r,
      pulse: Math.random() * TWO_PI,
      life: 9,
      collected: false,
    });
  }

  burst(x, y, color, n = 12, speedMul = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TWO_PI;
      const sp = (40 + Math.random() * 180) * speedMul;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.45,
        r: 1.2 + Math.random() * 2.4,
        color,
      });
    }
    if (this.particles.length > 140) this.particles.splice(0, this.particles.length - 140);
  }

  floatText(x, y, text, color) {
    this.floatTexts.push({ x, y, text, color, life: 0.85, vy: -36 });
  }

  loop(ts) {
    if (!this.running) return;
    if (this.paused) {
      this.draw();
      return;
    }
    if (!this.lastTs) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    dt = clamp(dt, 0, 0.05);
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.draw();
      this.raf = requestAnimationFrame((t) => this.loop(t));
      return;
    }
    if (this.alive) this.update(dt);
    else this.updateDead(dt);
    this.draw();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  steer(dt) {
    const span = this.rMax - this.rMin;
    const rSpeed = span * RADIUS_KEY_BANDS_PER_SEC;
    if (this.input.left) this.intentTarget -= rSpeed * dt;
    if (this.input.right) this.intentTarget += rSpeed * dt;
    this.intentTarget = clamp(this.intentTarget, this.rMin, this.rMax);
    if (this.input.pointerId != null) {
      this.intent = this.intentTarget;
    } else {
      const follow = 1 - Math.exp(-RADIUS_KEY_FOLLOW * dt);
      this.intent += (this.intentTarget - this.intent) * follow;
    }
    this.intent = clamp(this.intent, this.rMin, this.rMax);
    this.radius = mirrorRadius(this.intent, this.rMin, this.rMax);
  }

  update(dt) {
    if (!this.alive) return;
    this.survivalMs += dt * 1000;
    this.ramp = Math.min(1, this.survivalMs / 42000);
    this.angVel = 1.08 + this.ramp * 1.15;
    this.steer(dt);

    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboMult = 1;
        this.comboTimer = 0;
      }
    }

    const prev = this.angle;
    this.angle += this.angVel * dt;

    const ship = this.posAt(this.radius);
    this.trail.push({ x: ship.x, y: ship.y, life: 0.4 });
    if (this.trail.length > 28) this.trail.shift();
    for (const t of this.trail) t.life -= dt;

    this.spawnShardTimer -= dt;
    if (this.spawnShardTimer <= 0) {
      const open = this.shards.filter((s) => !s.resolved).length;
      const cap = this.ramp > 0.55 ? 2 : 1;
      if (open < cap) this.spawnShard();
      this.spawnShardTimer = Math.max(0.52, 1.28 - this.ramp * 0.7);
    }

    this.spawnOrbTimer -= dt;
    if (this.spawnOrbTimer <= 0) {
      if (this.orbs.length < 3) this.spawnOrb();
      this.spawnOrbTimer = Math.max(0.55, 1.2 - this.ramp * 0.45);
    }

    for (const o of this.orbs) {
      o.pulse += dt * 4;
      o.life -= dt * 0.12;
      const ox = this.cx + Math.cos(o.a) * o.r;
      const oy = this.cy + Math.sin(o.a) * o.r;
      if (!o.collected && Math.hypot(ship.x - ox, ship.y - oy) < 18) {
        o.collected = true;
        this.orbsCollected += 1;
        this.comboCount += 1;
        this.comboMult = Math.min(COMBO_MAX, this.comboCount);
        this.comboPeak = Math.max(this.comboPeak, this.comboMult);
        this.comboTimer = COMBO_GAP_SEC;
        this.comboBonus += (this.comboMult - 1) * COMBO_STEP;
        this.audio.collect(this.comboMult);
        this.burst(ox, oy, '#00f0ff', 14, 1);
        this.burst(ox, oy, '#ff2bd6', 8, 1.1);
        this.flash = 0.1;
        this.flashColor = '0, 240, 255';
        this.hitStop = this.comboMult >= 3 ? 0.03 : 0.016;
        if (this.comboMult >= 2) this.floatText(ox, oy - 12, `x${this.comboMult}`, '#00f0ff');
      }
    }
    this.orbs = this.orbs.filter((o) => !o.collected && o.life > 0);

    for (const shard of this.shards) {
      if (shard.resolved) {
        shard.fade -= dt;
        shard.rot += shard.spin * dt;
        continue;
      }
      shard.rot += shard.spin * dt;
      const gap = Math.abs(this.radius - shard.r);
      const ad = Math.abs(angDelta(this.angle, shard.a));
      if (ad < 0.2 && gap < shard.hitR) {
        this.die(ship.x, ship.y);
        break;
      }
      if (crossedForward(prev, this.angle, shard.a)) {
        if (gap < shard.hitR) {
          this.die(ship.x, ship.y);
          break;
        }
        this.clearShard(shard, gap, ship);
      }
    }
    if (!this.alive) return;
    this.shards = this.shards.filter((s) => !s.resolved || s.fade > 0);

    if (this.pendingNear.length) {
      const ready = [];
      const keep = [];
      for (const nm of this.pendingNear) {
        if (this.survivalMs >= nm.confirmAt) ready.push(nm);
        else keep.push(nm);
      }
      this.pendingNear = keep;
      for (const nm of ready) {
        this.nearMisses += 1;
        this.audio.nearMiss();
        this.burst(nm.x, nm.y, '#ffe566', 10, 0.7);
        this.floatText(nm.x, nm.y - 10, 'NEAR', '#ffe566');
        this.flash = 0.08;
        this.flashColor = '255, 229, 102';
        this.shake = Math.max(this.shake, 0.22);
      }
    }

    this.fadeFx(dt);
    this.syncScore();
    this.emitHud();
  }

  clearShard(shard, gap, ship) {
    shard.resolved = true;
    shard.fade = 0.4;
    const now = this.survivalMs;
    if (this.lastClearAt >= 0 && now - this.lastClearAt <= CLEAR_CHAIN_MS) this.cleanStreak += 1;
    else this.cleanStreak = 1;
    this.lastClearAt = now;
    if (this.cleanStreak > this.bestClean) this.bestClean = this.cleanStreak;
    const ghostGap = Math.abs(this.intent - shard.r);
    if (ghostGap < shard.hitR) {
      this.floatText(ship.x, ship.y - 16, 'MIRROR', '#ff2bd6');
      this.audio.combo(Math.min(COMBO_MAX, Math.max(2, this.cleanStreak)));
      this.flash = Math.max(this.flash, 0.08);
      this.flashColor = '255, 43, 214';
    }
    if (gap < shard.hitR + 18) {
      this.pendingNear.push({
        confirmAt: now + NEAR_MISS_CONFIRM_MS,
        x: ship.x,
        y: ship.y,
      });
    }
  }

  fadeFx(dt) {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.flash = Math.max(0, this.flash - dt);
    for (const pt of this.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.96;
      pt.vy *= 0.96;
      pt.life -= dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const ft of this.floatTexts) {
      ft.y += ft.vy * dt;
      ft.life -= dt;
    }
    this.floatTexts = this.floatTexts.filter((ft) => ft.life > 0);
  }

  updateDead(dt) {
    this.fadeFx(dt);
  }

  die(x, y) {
    if (!this.alive) return;
    this.alive = false;
    this.syncScore();
    this.audio.hit();
    this.burst(x, y, '#ff2bd6', 28, 1.2);
    this.burst(x, y, '#00f0ff', 12, 0.85);
    this.shake = 1;
    this.flash = 0.4;
    this.flashColor = '255, 77, 109';
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
    return {
      game: 'mirror',
      score: this.score,
      survivalMs,
      orbs: this.orbsCollected,
      comboBonus: this.comboBonus,
      nearMisses: this.nearMisses,
      difficulty: 'mittel',
      daily: false,
      comboPeak: this.comboPeak,
      cleanStreak: this.bestClean,
      formula: formatFormula(
        survivalMs,
        this.orbsCollected,
        this.comboBonus,
        this.nearMisses,
        this.score
      ),
    };
  }

  /** Menu backdrop: ghost and ship breathe on opposite sides of the band. */
  drawIdle() {
    if (!this.w) this.resize();
    const mid = (this.rMin + this.rMax) / 2;
    const amp = (this.rMax - this.rMin) * 0.22;
    const wobble = Math.sin(performance.now() / 700) * amp;
    this.intent = clamp(mid + wobble, this.rMin, this.rMax);
    this.intentTarget = this.intent;
    this.radius = mirrorRadius(this.intent, this.rMin, this.rMax);
    this.angle += 0.004;
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.w) return;
    const { w, h, cx, cy } = this;
    let ox = 0;
    let oy = 0;
    if (this.shake > 0) {
      ox = (Math.random() - 0.5) * this.shake * 8;
      oy = (Math.random() - 0.5) * this.shake * 8;
    }
    ctx.save();
    ctx.translate(ox, oy);
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#1a1028');
    g.addColorStop(0.5, '#0a0a1a');
    g.addColorStop(1, '#050510');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, w + 40, h + 40);

    const t = performance.now() / 1000;
    for (const s of this.stars) {
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = '#d7c8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.lineWidth = 1;
    for (const rr of [this.rMin, (this.rMin + this.rMax) / 2, this.rMax]) {
      ctx.strokeStyle = 'rgba(255, 43, 214, 0.1)';
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.28)';
    ctx.beginPath();
    ctx.arc(cx, cy, this.intent, 0, TWO_PI);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(cx, cy, this.radius, 0, TWO_PI);
    ctx.stroke();
    ctx.setLineDash([]);

    this.drawPlanet(ctx);

    for (const shard of this.shards) {
      const alpha = shard.resolved ? Math.max(0, shard.fade / 0.45) : 1;
      ctx.save();
      ctx.globalAlpha = 0.85 * alpha;
      ctx.strokeStyle = 'rgba(255, 43, 214, 0.8)';
      ctx.lineWidth = Math.max(6, shard.hitR * 2);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(cx, cy, shard.r, shard.a - 0.2, shard.a + 0.2);
      ctx.stroke();
      ctx.restore();
      if (!shard.resolved && this.running && this.survivalMs < 8000) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, shard.safeR, shard.a - 0.16, shard.a + 0.16);
        ctx.stroke();
        ctx.restore();
      }
      const sx = cx + Math.cos(shard.a) * shard.r;
      const sy = cy + Math.sin(shard.a) * shard.r;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(sx, sy);
      ctx.rotate(shard.rot);
      ctx.fillStyle = '#ff4d8d';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 0);
      ctx.lineTo(0, 7);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    for (const o of this.orbs) {
      const ox = cx + Math.cos(o.a) * o.r;
      const oy = cy + Math.sin(o.a) * o.r;
      const pr = 6 + Math.sin(o.pulse) * 1.4;
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.arc(ox, oy, pr, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (let i = 0; i < this.trail.length; i++) {
      const tr = this.trail[i];
      ctx.globalAlpha = Math.max(0, tr.life) * 0.45;
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, 2.2, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const ghost = this.posAt(this.intent);
    const ship = this.posAt(this.radius);
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.45)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(ghost.x, ghost.y);
    ctx.lineTo(ship.x, ship.y);
    ctx.stroke();
    this.drawCraft(ctx, this.intent, true);
    this.drawCraft(ctx, this.radius, false);

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

    if (this.running && this.alive && this.survivalMs < 3200) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = '#e8f0ff';
      ctx.textAlign = 'center';
      const y = Math.min(this.h - 78, cy + this.rMax + 26);
      ctx.fillText('← außen / OUT    ·    → innen / IN', cx, y);
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(${this.flashColor}, ${Math.min(0.35, this.flash)})`;
      ctx.fillRect(-20, -20, w + 40, h + 40);
    }
    ctx.restore();
  }

  drawPlanet(ctx) {
    const { cx, cy, planetR } = this;
    const g = ctx.createRadialGradient(cx - planetR * 0.3, cy - planetR * 0.35, 4, cx, cy, planetR);
    g.addColorStop(0, '#3a2a68');
    g.addColorStop(1, '#100818');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, planetR, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawCraft(ctx, r, ghost) {
    const x = this.cx + Math.cos(this.angle) * r;
    const y = this.cy + Math.sin(this.angle) * r;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.angle + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, ghost ? -8 : -11);
    ctx.lineTo(ghost ? 6 : 8, ghost ? 7 : 9);
    ctx.lineTo(ghost ? -6 : -8, ghost ? 7 : 9);
    ctx.closePath();
    if (ghost) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#00f0ff';
      ctx.fill();
      ctx.strokeStyle = '#ff2bd6';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  }
}
