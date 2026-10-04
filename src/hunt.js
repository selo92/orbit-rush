/**
 * Orbit Hunt — a 90-second cartoon shooting gallery.
 *
 * Original pufflings (round fluffballs), not any existing shooting-gallery cast.
 * Far / small ones are worth more than near / big ones. The round always lasts
 * 90 seconds. The magazine holds 8 shots; reload with R, right-click, or the
 * on-screen button.
 *
 * Points fold into the shared Rush formula so `game=hunt` passes the D1 check:
 *
 *   score = floor(seconds) × 10 + orbs × 100 + comboBonus + nearMisses × 75
 *
 *   near puffling   75   = 1 near-miss
 *   mid puffling   100   = 1 orb
 *   far puffling   175   = 1 orb + 1 near-miss
 *   golden puffling 300  = 3 orbs
 *   hidden puffling 200  = 2 orbs
 *   signpost       100   = 1 orb
 *   penalty        −100  (removed from orbs, then near-misses, before submit)
 *
 * A hit inside the combo window adds the usual chain bonus on orb hits.
 */
import { computeScore, NEAR_MISS_POINTS, COMBO_GAP_SEC, COMBO_MAX, COMBO_STEP } from './game.js';

const TWO_PI = Math.PI * 2;

export const HUNT_ROUND_SEC = 90;
export const HUNT_ROUND_MS = HUNT_ROUND_SEC * 1000;
export const HUNT_MAG = 8;
export const HUNT_RELOAD_SEC = 0.48;
export const HUNT_WORLD_SCREENS = 3.2;

/** Base award, before the combo chain. */
export const HUNT_AWARDS = {
  near: { orbs: 0, near: 1, points: 75 },
  mid: { orbs: 1, near: 0, points: 100 },
  far: { orbs: 1, near: 1, points: 175 },
  gold: { orbs: 3, near: 0, points: 300 },
  hidden: { orbs: 2, near: 0, points: 200 },
  sign: { orbs: 1, near: 0, points: 100 },
};

const KIND_LOOK = {
  near: { body: '#ffe0bf', wing: '#ff9d73', beak: '#ff8a5a', tuft: '#ffb088', belly: '#fff7ee' },
  mid: { body: '#ffd0ea', wing: '#ff8ec8', beak: '#ff7eb3', tuft: '#ffe0f4', belly: '#fff5fb' },
  far: { body: '#d5dcff', wing: '#9aa8f0', beak: '#f0b06a', tuft: '#eef1ff', belly: '#f7f8ff' },
  gold: { body: '#ffe566', wing: '#ffc14d', beak: '#ff9a3c', tuft: '#fff6c2', belly: '#fff8d8', crown: true },
  hidden: { body: '#9ef0c8', wing: '#5ed6a4', beak: '#ffb088', tuft: '#e7fff4', belly: '#f3fff9' },
};

const KIND_FLIGHT = {
  near: { depth: 1, speed: 78, r: 48, y: 0.5 },
  mid: { depth: 0.72, speed: 128, r: 32, y: 0.34 },
  far: { depth: 0.42, speed: 196, r: 18, y: 0.18 },
  gold: { depth: 0.55, speed: 360, r: 24, y: 0.24 },
};

/**
 * Fold penalties into the shared formula. Idempotent: the same raw totals
 * always produce the same submit payload.
 *
 * @param {number} survivalMs
 * @param {number} orbs
 * @param {number} comboBonus
 * @param {number} nearMisses
 * @param {number} debt
 */
export function settleHuntScore(survivalMs, orbs, comboBonus, nearMisses, debt) {
  let o = Math.max(0, Math.floor(Number(orbs) || 0));
  let n = Math.max(0, Math.floor(Number(nearMisses) || 0));
  let c = Math.max(0, Math.floor(Number(comboBonus) || 0));
  let d = Math.max(0, Math.floor(Number(debt) || 0));
  while (d >= 100 && o > 0) {
    o -= 1;
    d -= 100;
  }
  while (d >= 75 && n > 0) {
    n -= 1;
    d -= 75;
  }
  const maxC = o * (COMBO_MAX - 1) * COMBO_STEP;
  if (c > maxC) c = maxC;
  const survival = Math.max(0, Math.floor(Number(survivalMs) || 0));
  return {
    survivalMs: survival,
    orbs: o,
    comboBonus: c,
    nearMisses: n,
    score: computeScore(survival, o, c, n),
  };
}

/** Sticker value of a target before combo, used by the smoke test. */
export function huntTargetPoints(kind) {
  const spec = HUNT_AWARDS[kind];
  if (!spec) return 0;
  return spec.orbs * 100 + spec.near * NEAR_MISS_POINTS;
}

/**
 * @param {number} survivalMs
 * @param {number} orbs
 * @param {number} comboBonus
 * @param {number} nearMisses
 * @param {number} score
 */
export function formatHuntFormula(survivalMs, orbs, comboBonus, nearMisses, score) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  const parts = [`${t}s × 10`, `${o} Treffer × 100`];
  if (cb > 0) parts.push(`Kette +${cb}`);
  if (nm > 0) parts.push(`${nm} Weit × ${NEAR_MISS_POINTS}`);
  return `${parts.join(' + ')} = ${score ?? computeScore(survivalMs, orbs, cb, nm)}`;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export class HuntGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ audio?: object, onGameOver?: (r: object) => void, onHud?: (h: object) => void }} hooks
   */
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
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
    this._bound = false;
    this.clouds = [];
    this.idleT = 0;
    this.resetState();
  }

  resetState() {
    this.clock = 0;
    this.survivalMs = 0;
    this.ending = false;
    this.endT = 0;
    this.finished = false;
    this.score = 0;
    this.orbs = 0;
    this.comboBonus = 0;
    this.nearMisses = 0;
    this.debt = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboPeak = 0;
    this.ammo = HUNT_MAG;
    this.reloadT = 0;
    this.shots = 0;
    this.hits = 0;
    this.penalties = 0;
    this.birds = [];
    this.feathers = [];
    this.floats = [];
    this.sparks = [];
    this.props = [];
    this.popup = null;
    this.popupGap = 2.4;
    this.spawnT = 0.35;
    this.goldT = 7.5;
    this.cam = 0;
    this.maxCam = 0;
    this.worldW = 0;
    this.aim = { x: 0, y: 0 };
    this.pointerKind = '';
    this.pointerInside = false;
    this.shake = 0;
    this.muzzle = 0;
    this.bannerT = 2.6;
    this._settled = null;
    this.drag = null;
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect?.() || {
      width: this.canvas.width,
      height: this.canvas.height,
      left: 0,
      top: 0,
    };
    const ratio = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    this.dpr = Math.min(ratio, 2);
    const oldWorld = this.worldW || 0;
    this.w = Math.max(1, Math.floor(rect.width || this.canvas.width || 1));
    this.h = Math.max(1, Math.floor(rect.height || this.canvas.height || 1));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx?.setTransform?.(this.dpr, 0, 0, this.dpr, 0, 0);
    this.worldW = Math.max(this.w + 80, Math.round(this.w * HUNT_WORLD_SCREENS));
    this.maxCam = Math.max(0, this.worldW - this.w);
    if (oldWorld > 1 && Math.abs(oldWorld - this.worldW) > 1) {
      const k = this.worldW / oldWorld;
      this.cam *= k;
      for (const bird of this.birds) bird.x *= k;
    }
    this.cam = clamp(this.cam, 0, this.maxCam);
    if (!this.aim || (this.aim.x === 0 && this.aim.y === 0)) {
      this.aim = { x: this.w * 0.5, y: this.h * 0.4 };
    } else {
      this.aim.x = clamp(this.aim.x, 0, this.w);
      this.aim.y = clamp(this.aim.y, 0, this.h);
    }
    this.layoutProps();
    if (this.clouds.length === 0) this.seedSky();
  }

  seedSky() {
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      this.clouds.push({
        u: (i + 0.15) / 7,
        y: 0.07 + (i % 3) * 0.055,
        s: 0.8 + (i % 3) * 0.22,
      });
    }
  }

  layoutProps() {
    const prev = new Map((this.props || []).map((p) => [p.id, p]));
    const ground = this.h * 0.63;
    const w = this.worldW || this.w;
    /** @type {Array<object>} */
    const defs = [
      { id: 'wind', kind: 'windmill', x: w * 0.18, y: ground, depth: 0.86, h: this.h * 0.28, peekX: 8 },
      { id: 'tree', kind: 'tree', x: w * 0.46, y: ground, depth: 0.96, h: this.h * 0.24, peekX: this.h * 0.04 },
      { id: 'hay', kind: 'hay', x: w * 0.73, y: ground, depth: 1, h: this.h * 0.12, peekX: 0 },
      { id: 'sign', kind: 'sign', x: w * 0.32, y: ground, depth: 1, h: this.h * 0.16 },
      { id: 'lantern', kind: 'penalty', sub: 'laterne', x: w * 0.1, y: ground, depth: 1, h: this.h * 0.14, r: 26 },
      { id: 'basket', kind: 'penalty', sub: 'korb', x: w * 0.58, y: ground, depth: 1, h: this.h * 0.08, r: 30 },
      { id: 'sleeper', kind: 'penalty', sub: 'wolke', x: w * 0.86, y: this.h * 0.3, depth: 0.7, h: 40, r: 36 },
    ];
    this.props = defs.map((d) => {
      const old = prev.get(d.id);
      return {
        ...d,
        up: old ? old.up !== false : true,
        cool: old?.cool || 0,
        fall: old?.fall || 0,
        respawn: old?.respawn || 0,
      };
    });
  }

  localPoint(e) {
    const rect = this.canvas.getBoundingClientRect?.() || { left: 0, top: 0, width: this.w, height: this.h };
    const rw = rect.width || this.w || 1;
    const rh = rect.height || this.h || 1;
    return {
      x: ((e.clientX - rect.left) * this.w) / rw,
      y: ((e.clientY - rect.top) * this.h) / rh,
    };
  }

  bindInput() {
    if (this._bound) return;
    this._bound = true;
    this._onKeyDown = (e) => {
      if (!this.running || this.paused || !this.alive || this.ending) return;
      if (e.code !== 'KeyR') return;
      this.reload();
      e.preventDefault();
    };
    this._onContext = (e) => {
      if (!this.running) return;
      e.preventDefault();
      this.reload();
    };
    this._onPointerDown = (e) => {
      if (!this.running || this.paused || !this.alive) return;
      const p = this.localPoint(e);
      if (e.pointerType === 'mouse') {
        this.pointerKind = 'mouse';
        this.pointerInside = true;
        this.aim = p;
        if (e.button === 2) {
          this.reload();
          return;
        }
        if (e.button === 0) this.shoot();
        return;
      }
      this.pointerKind = e.pointerType || 'touch';
      this.drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        moved: false,
      };
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    this._onPointerMove = (e) => {
      if (!this.running || this.paused) return;
      if (e.pointerType === 'mouse') {
        this.pointerKind = 'mouse';
        this.pointerInside = true;
        this.aim = this.localPoint(e);
        return;
      }
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 16) return;
      this.drag.moved = true;
      this.cam -= dx;
      this.clampCam();
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    };
    this._onPointerUp = (e) => {
      if (this.drag && this.drag.id === e.pointerId) {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const dt = now - this.drag.t;
        if (!this.drag.moved && dt < 360 && this.running && !this.paused && this.alive) {
          this.aim = this.localPoint(e);
          this.shoot();
        }
        this.drag = null;
      }
    };
    this._onPointerLeave = (e) => {
      if (e.pointerType === 'mouse') this.pointerInside = false;
    };
    const win = typeof window !== 'undefined' ? window : null;
    win?.addEventListener('keydown', this._onKeyDown, { passive: false });
    this.canvas.addEventListener('contextmenu', this._onContext);
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerUp);
    this.canvas.addEventListener('pointerleave', this._onPointerLeave);
  }

  unbindInput() {
    if (!this._bound) return;
    this._bound = false;
    const win = typeof window !== 'undefined' ? window : null;
    win?.removeEventListener('keydown', this._onKeyDown);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerUp);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this.drag = null;
  }

  start() {
    clearTimeout(this._overTimer);
    this.resetState();
    this.resize();
    this.seedFlock();
    this.bindInput();
    this.running = true;
    this.paused = false;
    this.alive = true;
    this.lastTs = 0;
    this.canvas.style.cursor = 'none';
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
    if (this.canvas?.style) this.canvas.style.cursor = '';
    this.canvas.classList?.remove('hunt-aim');
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
  }

  setPaused(p) {
    this.paused = !!p;
    if (this.paused) this.drag = null;
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
    if (!this.running) return;
    this.draw();
    if (this.running) this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    let left = Math.max(0, dt);
    while (left > 0 && this.alive && !this.finished) {
      const step = Math.min(0.02, left);
      this.step(step);
      left -= step;
      if (this.finished) break;
    }
    this.fadeFx(dt);
    this.syncScore();
    this.emitHud();
  }

  step(dt) {
    this.clock += dt;
    if (!this.ending) this.survivalMs += dt * 1000;
    if (!this.ending && this.survivalMs >= HUNT_ROUND_MS) {
      this.survivalMs = HUNT_ROUND_MS;
      this.ending = true;
      this.endT = 0.7;
    }
    if (this.ending) {
      this.endT -= dt;
      if (this.endT <= 0) {
        this.finish();
        return;
      }
    }
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      if (this.reloadT === 0) {
        this.ammo = HUNT_MAG;
        this.audio.cock?.();
      }
    }
    if (this.pointerKind === 'mouse' && this.pointerInside && !this.ending) {
      const edge = this.w * 0.16;
      let push = 0;
      if (this.aim.x < edge) push = -((edge - this.aim.x) / edge);
      else if (this.aim.x > this.w - edge) push = (this.aim.x - (this.w - edge)) / edge;
      if (push) this.cam += push * 720 * dt;
    }
    this.clampCam();
    if (!this.ending) this.spawn(dt);
    this.advanceBirds(dt);
    this.advanceProps(dt);
  }

  clampCam() {
    this.cam = clamp(this.cam, 0, this.maxCam);
  }

  spawn(dt) {
    this.spawnT -= dt;
    this.goldT -= dt;
    this.popupGap -= dt;
    const alive = this.birds.filter((b) => !b.falling).length;
    if (this.spawnT <= 0 && alive < 8) {
      this.spawnT = 0.72 + Math.random() * 0.55;
      const roll = Math.random();
      const kind = roll < 0.34 ? 'near' : roll < 0.68 ? 'mid' : 'far';
      this.birds.push(this.makeBird(kind));
    }
    if (this.goldT <= 0) {
      this.goldT = 8.5 + Math.random() * 4;
      if (!this.birds.some((b) => b.kind === 'gold' && !b.falling)) {
        this.birds.push(this.makeBird('gold'));
      }
    }
    if (this.popupGap <= 0 && !this.popup) {
      this.popupGap = 5.5 + Math.random() * 2.5;
      const hosts = this.props.filter((p) => p.kind === 'windmill' || p.kind === 'tree' || p.kind === 'hay');
      const host = hosts[Math.floor(Math.random() * hosts.length)];
      if (host) this.popup = { id: host.id, t: 0, dur: 1.35 };
    }
    if (this.popup) {
      this.popup.t += dt;
      if (this.popup.t >= this.popup.dur) this.popup = null;
    }
  }

  makeBird(kind, x) {
    const flight = KIND_FLIGHT[kind] || KIND_FLIGHT.mid;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const scale = clamp(this.h / 780, 0.72, 1.15);
    const x0 = x == null ? (dir < 0 ? this.worldW + 30 : -30) : x;
    return {
      kind,
      x: x0,
      y: this.h * flight.y + (Math.random() - 0.5) * this.h * 0.03,
      vx: dir * flight.speed * (0.88 + Math.random() * 0.28),
      depth: flight.depth,
      r: flight.r * scale,
      falling: false,
      vy: 0,
      rot: 0,
      flap: Math.random() * 6,
      bob: Math.random() * 6,
    };
  }

  seedFlock() {
    this.birds = [];
    const spots = [
      ['near', 0.14, 1],
      ['mid', 0.3, -1],
      ['far', 0.42, 1],
      ['mid', 0.56, 1],
      ['far', 0.68, -1],
      ['near', 0.84, -1],
    ];
    for (const [kind, u, dir] of spots) {
      const bird = this.makeBird(kind, this.worldW * u);
      bird.vx = dir * Math.abs(bird.vx);
      this.birds.push(bird);
    }
  }

  advanceBirds(dt) {
    for (const bird of this.birds) {
      bird.flap += dt * (bird.kind === 'gold' ? 16 : 9);
      if (bird.falling) {
        bird.vy += 980 * dt;
        bird.y += bird.vy * dt;
        bird.x += bird.vx * dt;
        bird.rot += dt * 7;
      } else {
        bird.bob += dt * (bird.kind === 'gold' ? 11 : 6);
        bird.x += bird.vx * dt;
      }
    }
    this.birds = this.birds.filter((bird) => {
      if (bird.falling) return bird.y < this.h + bird.r + 40;
      return bird.x > -180 && bird.x < this.worldW + 180;
    });
  }

  advanceProps(dt) {
    for (const prop of this.props) {
      if (prop.cool > 0) prop.cool = Math.max(0, prop.cool - dt);
      if (prop.kind === 'sign' && !prop.up) {
        prop.fall += dt;
        prop.respawn -= dt;
        if (prop.respawn <= 0) {
          prop.up = true;
          prop.fall = 0;
          prop.respawn = 0;
        }
      }
    }
  }

  reload() {
    if (!this.running || this.paused || !this.alive || this.ending) return false;
    if (this.reloadT > 0 || this.ammo >= HUNT_MAG) return false;
    this.reloadT = HUNT_RELOAD_SEC;
    this.audio.reload?.();
    return true;
  }

  shoot() {
    if (!this.running || this.paused || !this.alive || this.ending) return false;
    if (this.reloadT > 0) return false;
    if (this.ammo <= 0) {
      this.audio.dry?.();
      this.floatText('leer', this.aim.x, this.aim.y - 18, '#ffb4c4');
      return false;
    }
    this.ammo -= 1;
    this.shots += 1;
    this.muzzle = 1;
    this.shake = Math.min(1, this.shake + 0.55);
    this.audio.shot?.();
    const hit = this.pick(this.aim.x, this.aim.y);
    if (!hit) return true;
    this.resolve(hit);
    return true;
  }

  birdScreen(bird) {
    const bob = bird.falling ? 0 : Math.sin(bird.bob) * bird.r * 0.22;
    return {
      x: bird.x - this.cam * bird.depth,
      y: bird.y + bob,
      r: bird.r,
    };
  }

  popupHost() {
    if (!this.popup) return null;
    return this.props.find((p) => p.id === this.popup.id) || null;
  }

  popupPoint(prop) {
    if (!prop || !this.popup) return null;
    const peek = Math.sin(clamp(this.popup.t / this.popup.dur, 0, 1) * Math.PI);
    const sx = prop.x - this.cam * prop.depth + (prop.peekX || 0);
    const y = prop.y - prop.h * (0.25 + 0.7 * peek);
    return { x: sx, y, r: Math.max(22, this.h * 0.03), peek };
  }

  signPoint(prop) {
    const sx = prop.x - this.cam * prop.depth;
    const drop = prop.up ? 0 : Math.min(80, prop.fall * 140);
    return { x: sx, y: prop.y - prop.h * 0.82 + drop, r: Math.max(24, prop.h * 0.28) };
  }

  penaltyPoint(prop) {
    const sx = prop.x - this.cam * prop.depth;
    const y = prop.sub === 'wolke' ? prop.y : prop.y - prop.h * 0.45;
    return { x: sx, y, r: prop.r || 28 };
  }

  pick(sx, sy) {
    /** @type {Array<{kind: string, depth: number, d: number, bird?: object, prop?: object}>} */
    const hits = [];
    for (const bird of this.birds) {
      if (bird.falling) continue;
      const p = this.birdScreen(bird);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d <= p.r * 1.06) hits.push({ kind: 'bird', depth: bird.depth, d, bird });
    }
    const host = this.popupHost();
    const pop = host ? this.popupPoint(host) : null;
    if (pop && pop.peek > 0.42) {
      const d = Math.hypot(pop.x - sx, pop.y - sy);
      if (d <= pop.r) hits.push({ kind: 'hidden', depth: (host?.depth || 1) + 0.2, d, prop: host });
    }
    for (const prop of this.props) {
      if (prop.kind === 'sign' && prop.up) {
        const p = this.signPoint(prop);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d <= p.r) hits.push({ kind: 'sign', depth: prop.depth, d, prop });
      } else if (prop.kind === 'penalty' && prop.cool <= 0) {
        const p = this.penaltyPoint(prop);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d <= p.r) hits.push({ kind: 'penalty', depth: prop.depth, d, prop });
      }
    }
    hits.sort((a, b) => {
      if (b.depth !== a.depth) return b.depth - a.depth;
      if (a.kind === 'bird' && b.kind !== 'bird') return -1;
      if (b.kind === 'bird' && a.kind !== 'bird') return 1;
      return a.d - b.d;
    });
    return hits[0] || null;
  }

  resolve(hit) {
    if (hit.kind === 'bird' && hit.bird) {
      const bird = hit.bird;
      const p = this.birdScreen(bird);
      bird.falling = true;
      bird.vy = 20;
      bird.vx *= 0.25;
      const gain = this.award(bird.kind);
      this.puff(p.x, p.y, KIND_LOOK[bird.kind]?.body || '#fff', bird.kind === 'gold' ? 16 : 10);
      this.floatText(gain >= 0 ? `+${gain}` : `${gain}`, p.x, p.y - bird.r, bird.kind === 'gold' ? '#ffe566' : '#fff');
      if (bird.kind === 'gold') this.audio.sparkle?.();
      else this.audio.fluff?.();
      return;
    }
    if (hit.kind === 'hidden' && hit.prop) {
      const p = this.popupPoint(hit.prop);
      this.popup = null;
      this.popupGap = 4.2;
      const gain = this.award('hidden');
      if (p) {
        this.puff(p.x, p.y, '#9ef0c8', 12);
        this.floatText(`+${gain}`, p.x, p.y - 20, '#d8ffe8');
      }
      this.audio.fluff?.();
      return;
    }
    if (hit.kind === 'sign' && hit.prop) {
      hit.prop.up = false;
      hit.prop.fall = 0;
      hit.prop.respawn = 8;
      const p = this.signPoint(hit.prop);
      const gain = this.award('sign');
      this.floatText(`+${gain}`, p.x, p.y, '#ffe7b0');
      this.audio.fluff?.();
      return;
    }
    if (hit.kind === 'penalty' && hit.prop) {
      hit.prop.cool = 2.4;
      const p = this.penaltyPoint(hit.prop);
      const delta = this.penalize();
      this.floatText(`${delta}`, p.x, p.y - 16, '#ff4d6d');
      this.audio.penalty?.();
      this.shake = Math.min(1, this.shake + 0.35);
    }
  }

  /**
   * Positive target. Returns the score delta after combo and leftover penalties.
   * @param {keyof typeof HUNT_AWARDS} kind
   */
  award(kind) {
    const spec = HUNT_AWARDS[kind];
    if (!spec) return 0;
    const before = this.score;
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = COMBO_GAP_SEC;
    const mult = Math.min(COMBO_MAX, this.comboCount);
    if (this.comboCount > this.comboPeak) this.comboPeak = this.comboCount;
    this.orbs += spec.orbs;
    this.nearMisses += spec.near;
    if (spec.orbs > 0) this.comboBonus += (mult - 1) * COMBO_STEP;
    this.hits += 1;
    this.syncScore();
    return this.score - before;
  }

  penalize() {
    const before = this.score;
    this.debt += 100;
    this.penalties += 1;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.syncScore();
    return this.score - before;
  }

  puff(x, y, color, n) {
    for (let i = 0; i < n && this.feathers.length < 90; i++) {
      const a = Math.random() * TWO_PI;
      const s = 30 + Math.random() * 150;
      this.feathers.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 50,
        life: 0.4 + Math.random() * 0.35,
        max: 0.75,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 9,
        color,
        s: 3 + Math.random() * 4,
      });
    }
  }

  floatText(text, x, y, color) {
    this.floats.push({ text, x, y, color, life: 0.75, vy: -42 });
    if (this.floats.length > 14) this.floats.shift();
  }

  fadeFx(dt) {
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.muzzle = Math.max(0, this.muzzle - dt * 6);
    for (const f of this.feathers) {
      f.life -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 280 * dt;
      f.rot += f.vr * dt;
    }
    this.feathers = this.feathers.filter((f) => f.life > 0);
    for (const f of this.floats) {
      f.life -= dt;
      f.y += f.vy * dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
  }

  syncScore() {
    this._settled = settleHuntScore(this.survivalMs, this.orbs, this.comboBonus, this.nearMisses, this.debt);
    this.score = this._settled.score;
  }

  emitHud() {
    const left = Math.max(0, (HUNT_ROUND_MS - this.survivalMs) / 1000);
    const chain = this.comboTimer > 0 ? Math.min(COMBO_MAX, this.comboCount) : 0;
    this.onHud?.({
      score: this.score,
      ammo: this.ammo,
      mag: HUNT_MAG,
      time: left,
      combo: chain,
      reloading: this.reloadT > 0,
      lowTime: left <= 10 && this.running,
    });
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.alive = false;
    this.survivalMs = Math.min(this.survivalMs, HUNT_ROUND_MS);
    this.syncScore();
    this.emitHud();
    const result = this.buildResult();
    this.draw();
    this.stop();
    this.onGameOver?.(result);
  }

  buildResult() {
    this.syncScore();
    const settled = this._settled;
    const shots = this.shots;
    const hits = this.hits;
    const accuracy = shots > 0 ? Math.round((hits / shots) * 100) : 0;
    return {
      game: 'hunt',
      score: settled.score,
      survivalMs: settled.survivalMs,
      orbs: settled.orbs,
      comboBonus: settled.comboBonus,
      nearMisses: settled.nearMisses,
      difficulty: 'mittel',
      daily: false,
      hits,
      shots,
      accuracy,
      penalties: this.penalties,
      comboPeak: Math.min(COMBO_MAX, this.comboPeak),
      formula: formatHuntFormula(
        settled.survivalMs,
        settled.orbs,
        settled.comboBonus,
        settled.nearMisses,
        settled.score
      ),
    };
  }

  drawIdle() {
    if (!this.w) this.resize();
    this.idleT += 0.016;
    const saved = this.cam;
    this.cam = (this.idleT * 18) % Math.max(1, this.maxCam || 1);
    this.draw();
    this.cam = saved;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.beginPath !== 'function' || !this.w) return;
    const shakeX = (Math.random() - 0.5) * this.shake * 7;
    const shakeY = (Math.random() - 0.5) * this.shake * 5;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.drawSky(ctx);
    this.drawClouds(ctx);
    this.drawHills(ctx, 0.18, '#b7e3a4', this.h * 0.04, this.h * 0.56);
    this.drawHills(ctx, 0.34, '#8ed48a', this.h * 0.05, this.h * 0.6);
    this.drawGround(ctx);
    this.drawScenery(ctx);
    const layers = [];
    const host = this.popupHost();
    if (host && this.popup) {
      layers.push({
        depth: host.depth - 0.03,
        draw: () => this.drawPopup(ctx, host),
      });
    }
    for (const prop of this.props) {
      layers.push({ depth: prop.depth, draw: () => this.drawProp(ctx, prop) });
    }
    for (const bird of this.birds) {
      layers.push({ depth: bird.depth, draw: () => this.drawBird(ctx, bird) });
    }
    layers.sort((a, b) => a.depth - b.depth);
    for (const layer of layers) layer.draw();
    this.drawFeathers(ctx);
    this.drawForeground(ctx);
    this.drawFloats(ctx);
    this.drawCrosshair(ctx);
    this.drawAmmo(ctx);
    if (this.bannerT > 0 && this.running) this.drawBanner(ctx);
    ctx.restore();
  }

  drawSky(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#79c8ff');
    g.addColorStop(0.42, '#ffe0b0');
    g.addColorStop(0.66, '#fff0d2');
    g.addColorStop(1, '#7ec86a');
    ctx.fillStyle = g;
    ctx.fillRect(-8, -8, this.w + 16, this.h + 16);
    const sunX = this.w * 0.78 - this.cam * 0.05;
    const sunY = this.h * 0.16;
    const halo = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, this.h * 0.22);
    halo.addColorStop(0, 'rgba(255, 248, 210, 0.95)');
    halo.addColorStop(0.4, 'rgba(255, 214, 140, 0.35)');
    halo.addColorStop(1, 'rgba(255, 214, 140, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sunX, sunY, this.h * 0.22, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff6cf';
    ctx.beginPath();
    ctx.arc(sunX, sunY, Math.max(18, this.h * 0.045), 0, TWO_PI);
    ctx.fill();
    const planetX = this.w * 0.18 - this.cam * 0.04;
    const planetY = this.h * 0.12;
    ctx.fillStyle = '#d7e6ff';
    ctx.beginPath();
    ctx.arc(planetX, planetY, 11, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#ffb3e0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(planetX, planetY, 20, 6, -0.4, 0, TWO_PI);
    ctx.stroke();
  }

  drawClouds(ctx) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    for (const c of this.clouds) {
      const x = c.u * this.worldW - this.cam * 0.22;
      if (x < -80 || x > this.w + 80) continue;
      const y = c.y * this.h;
      const s = c.s * 26;
      this.blob(ctx, x, y, s, s * 0.62);
    }
  }

  blob(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TWO_PI);
    ctx.ellipse(x - rx * 0.7, y + ry * 0.15, rx * 0.62, ry * 0.7, 0, 0, TWO_PI);
    ctx.ellipse(x + rx * 0.65, y + ry * 0.1, rx * 0.55, ry * 0.68, 0, 0, TWO_PI);
    ctx.fill();
  }

  drawHills(ctx, parallax, color, amp, base) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, this.h);
    const shift = this.cam * parallax;
    for (let x = 0; x <= this.w; x += 16) {
      const wx = x + shift;
      const y = base - Math.sin(wx * 0.012) * amp - Math.sin(wx * 0.005 + 1.2) * amp * 0.55;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.w, this.h);
    ctx.closePath();
    ctx.fill();
  }

  drawGround(ctx) {
    const y = this.h * 0.63;
    const g = ctx.createLinearGradient(0, y, 0, this.h);
    g.addColorStop(0, '#8ed56a');
    g.addColorStop(0.35, '#5eae4e');
    g.addColorStop(1, '#3d8c40');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, this.w, this.h - y);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, y + 1);
    ctx.lineTo(this.w, y + 1);
    ctx.stroke();
  }

  drawScenery(ctx) {
    const y = this.h * 0.63;
    ctx.fillStyle = '#6fbf78';
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.3) * (this.worldW / 9) - this.cam * 0.48;
      if (x < -40 || x > this.w + 40) continue;
      ctx.beginPath();
      ctx.ellipse(x, y + 2, 18, 10, 0, 0, TWO_PI);
      ctx.fill();
    }
  }

  drawForeground(ctx) {
    const base = this.h * 0.9;
    ctx.fillStyle = '#2f7a38';
    for (let i = 0; i < 18; i++) {
      const x = ((i * 47 - this.cam * 1.15) % (this.w + 60)) - 20;
      const h = 16 + (i % 4) * 7;
      ctx.beginPath();
      ctx.moveTo(x, this.h);
      ctx.quadraticCurveTo(x + 4, base - h, x + 10, this.h);
      ctx.fill();
    }
  }

  drawProp(ctx, prop) {
    const x = prop.x - this.cam * prop.depth;
    if (x < -160 || x > this.w + 160) return;
    if (prop.kind === 'windmill') this.drawWindmill(ctx, x, prop.y, prop.h);
    else if (prop.kind === 'tree') this.drawTree(ctx, x, prop.y, prop.h);
    else if (prop.kind === 'hay') this.drawHay(ctx, x, prop.y, prop.h);
    else if (prop.kind === 'sign') this.drawSign(ctx, prop, x);
    else if (prop.kind === 'penalty') this.drawPenalty(ctx, prop, x);
  }

  drawWindmill(ctx, x, y, h) {
    ctx.fillStyle = '#f4e2c4';
    ctx.beginPath();
    ctx.moveTo(x - h * 0.16, y);
    ctx.lineTo(x + h * 0.16, y);
    ctx.lineTo(x + h * 0.1, y - h * 0.62);
    ctx.lineTo(x - h * 0.1, y - h * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e7c99a';
    ctx.fillRect(x - h * 0.05, y - h * 0.38, h * 0.1, h * 0.16);
    const hubY = y - h * 0.62;
    ctx.save();
    ctx.translate(x, hubY);
    ctx.rotate(this.clock * 0.8);
    ctx.fillStyle = '#ff8f6b';
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.roundRect?.(-6, 8, 12, h * 0.28, 6);
      if (!ctx.roundRect) ctx.rect(-6, 8, 12, h * 0.28);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#ffe7c2';
    ctx.beginPath();
    ctx.arc(x, hubY, 10, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#5b4636';
    ctx.beginPath();
    ctx.arc(x, hubY, 3.5, 0, TWO_PI);
    ctx.fill();
  }

  drawTree(ctx, x, y, h) {
    ctx.fillStyle = '#8a5a3a';
    ctx.fillRect(x - 7, y - h * 0.42, 14, h * 0.42);
    ctx.fillStyle = '#3ecf8e';
    ctx.beginPath();
    ctx.arc(x, y - h * 0.62, h * 0.28, 0, TWO_PI);
    ctx.arc(x - h * 0.18, y - h * 0.48, h * 0.2, 0, TWO_PI);
    ctx.arc(x + h * 0.18, y - h * 0.5, h * 0.18, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#7dffb0';
    ctx.beginPath();
    ctx.arc(x - h * 0.08, y - h * 0.74, h * 0.08, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#ffe566';
    ctx.beginPath();
    ctx.arc(x + h * 0.1, y - h * 0.58, 4, 0, TWO_PI);
    ctx.arc(x - h * 0.12, y - h * 0.5, 3.5, 0, TWO_PI);
    ctx.fill();
  }

  drawHay(ctx, x, y, h) {
    ctx.fillStyle = '#f0c14a';
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.35, h * 0.85, h * 0.55, 0, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = 'rgba(184, 122, 28, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.35, h * 0.55, h * 0.28, 0.4, 0, Math.PI);
    ctx.stroke();
    ctx.strokeStyle = '#8a5a3a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + h * 0.2, y - h * 0.7);
    ctx.lineTo(x + h * 0.55, y - h * 1.15);
    ctx.moveTo(x + h * 0.55, y - h * 1.15);
    ctx.lineTo(x + h * 0.35, y - h * 0.95);
    ctx.moveTo(x + h * 0.55, y - h * 1.15);
    ctx.lineTo(x + h * 0.72, y - h * 0.92);
    ctx.stroke();
  }

  drawSign(ctx, prop, x) {
    const p = this.signPoint(prop);
    ctx.strokeStyle = '#8a5a3a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, prop.y);
    ctx.lineTo(x, p.y + 8);
    ctx.stroke();
    ctx.save();
    ctx.translate(p.x, p.y);
    if (!prop.up) ctx.rotate(Math.min(1.1, prop.fall * 2));
    ctx.fillStyle = '#ffe7b0';
    ctx.strokeStyle = '#c9843a';
    ctx.lineWidth = 3;
    const rw = Math.max(54, prop.h * 0.7);
    const rh = Math.max(28, prop.h * 0.34);
    ctx.beginPath();
    ctx.rect(-rw / 2, -rh / 2, rw, rh);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6b4428';
    ctx.font = `800 ${Math.max(12, rh * 0.46)}px Segoe UI, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WEG', 0, 1);
    ctx.restore();
  }

  drawPenalty(ctx, prop, x) {
    const wobble = prop.cool > 0 ? Math.sin(this.clock * 28) * 3 : 0;
    ctx.save();
    ctx.translate(x + wobble, 0);
    if (prop.sub === 'wolke') this.drawSleeper(ctx, 0, prop.y);
    else if (prop.sub === 'laterne') this.drawLantern(ctx, 0, prop.y, prop.h);
    else this.drawBasket(ctx, 0, prop.y, prop.h);
    ctx.restore();
  }

  drawLantern(ctx, x, y, h) {
    ctx.strokeStyle = '#5b4636';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h);
    ctx.stroke();
    ctx.fillStyle = '#ffcf70';
    ctx.strokeStyle = '#e0922f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x - 12, y - h - 22, 24, 26);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 220, 120, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y - h - 8, 20, 0, TWO_PI);
    ctx.fill();
    this.drawMinus(ctx, x + 16, y - h - 28);
  }

  drawBasket(ctx, x, y, h) {
    ctx.fillStyle = '#e7a15a';
    ctx.beginPath();
    ctx.moveTo(x - 22, y - h);
    ctx.lineTo(x + 22, y - h);
    ctx.lineTo(x + 16, y);
    ctx.lineTo(x - 16, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#b86b32';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ff6b8a';
    ctx.beginPath();
    ctx.ellipse(x, y - h - 2, 16, 8, 0, Math.PI, TWO_PI);
    ctx.fill();
    this.drawMinus(ctx, x + 18, y - h - 16);
  }

  drawSleeper(ctx, x, y) {
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    this.blob(ctx, x, y, 34, 20);
    ctx.strokeStyle = '#6a7896';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x - 10, y - 2, 5, 0.2 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + 8, y - 2, 5, 0.2 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#9aa6c3';
    ctx.font = '700 13px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('z', x + 18, y - 16);
    ctx.font = '700 10px Segoe UI, sans-serif';
    ctx.fillText('z', x + 28, y - 26);
    this.drawMinus(ctx, x - 28, y - 22);
  }

  drawMinus(ctx, x, y) {
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 4, y - 1.4, 8, 2.8);
  }

  drawPopup(ctx, prop) {
    const p = this.popupPoint(prop);
    if (!p || p.peek < 0.08) return;
    this.drawFluff(ctx, p.x, p.y, p.r, { ...KIND_LOOK.hidden, flap: this.clock * 8 });
  }

  drawBird(ctx, bird) {
    const p = this.birdScreen(bird);
    if (p.x < -80 || p.x > this.w + 80) return;
    const look = KIND_LOOK[bird.kind] || KIND_LOOK.mid;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (bird.falling) ctx.rotate(bird.rot);
    if (bird.kind === 'gold' && !bird.falling) {
      ctx.fillStyle = 'rgba(255, 214, 90, 0.85)';
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(-Math.sign(bird.vx || 1) * i * 12, i * 2, 2.4, 0, TWO_PI);
        ctx.fill();
      }
    }
    this.drawFluff(ctx, 0, 0, p.r, {
      ...look,
      flap: bird.flap,
      face: bird.falling ? 'hit' : 'fly',
    });
    ctx.restore();
  }

  drawFluff(ctx, x, y, r, look) {
    ctx.save();
    ctx.translate(x, y);
    const wing = Math.sin(look.flap || 0);
    ctx.fillStyle = 'rgba(70, 50, 30, 0.13)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.72, r * 0.62, r * 0.16, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = look.wing;
    ctx.beginPath();
    ctx.ellipse(-r * 0.72, r * 0.02, r * 0.42, r * 0.2, -0.7 + wing * 0.45, 0, TWO_PI);
    ctx.ellipse(r * 0.72, r * 0.02, r * 0.42, r * 0.2, 0.7 - wing * 0.45, 0, TWO_PI);
    ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.28, -r * 0.32, r * 0.1, 0, 0, r * 1.05);
    g.addColorStop(0, '#fffdf8');
    g.addColorStop(0.45, look.body);
    g.addColorStop(1, look.wing);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.92, r * 0.8, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = look.belly;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.22, r * 0.46, r * 0.34, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = look.tuft;
    ctx.beginPath();
    ctx.ellipse(-r * 0.08, -r * 0.78, r * 0.12, r * 0.22, -0.4, 0, TWO_PI);
    ctx.ellipse(r * 0.1, -r * 0.84, r * 0.1, r * 0.2, 0.3, 0, TWO_PI);
    ctx.ellipse(0, -r * 0.9, r * 0.09, r * 0.18, 0, 0, TWO_PI);
    ctx.fill();
    if (look.crown) {
      ctx.fillStyle = '#ff9a3c';
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, -r * 0.62);
      ctx.lineTo(-r * 0.16, -r * 1.05);
      ctx.lineTo(0, -r * 0.7);
      ctx.lineTo(r * 0.16, -r * 1.08);
      ctx.lineTo(r * 0.28, -r * 0.62);
      ctx.closePath();
      ctx.fill();
    }
    const eyeY = -r * 0.08;
    if (look.face === 'hit') {
      ctx.strokeStyle = '#3a2a22';
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.beginPath();
      ctx.moveTo(-r * 0.42, eyeY - r * 0.12);
      ctx.lineTo(-r * 0.18, eyeY + r * 0.08);
      ctx.moveTo(-r * 0.18, eyeY - r * 0.12);
      ctx.lineTo(-r * 0.42, eyeY + r * 0.08);
      ctx.moveTo(r * 0.18, eyeY - r * 0.12);
      ctx.lineTo(r * 0.42, eyeY + r * 0.08);
      ctx.moveTo(r * 0.42, eyeY - r * 0.12);
      ctx.lineTo(r * 0.18, eyeY + r * 0.08);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(-r * 0.28, eyeY, r * 0.2, r * 0.24, 0, 0, TWO_PI);
      ctx.ellipse(r * 0.28, eyeY, r * 0.2, r * 0.24, 0, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = '#2b241f';
      ctx.beginPath();
      ctx.arc(-r * 0.24, eyeY + r * 0.02, r * 0.1, 0, TWO_PI);
      ctx.arc(r * 0.32, eyeY + r * 0.02, r * 0.1, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-r * 0.28, eyeY - r * 0.04, r * 0.04, 0, TWO_PI);
      ctx.arc(r * 0.28, eyeY - r * 0.04, r * 0.04, 0, TWO_PI);
      ctx.fill();
    }
    ctx.fillStyle = look.beak;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.08);
    ctx.quadraticCurveTo(r * 0.16, r * 0.2, 0, r * 0.28);
    ctx.quadraticCurveTo(-r * 0.16, r * 0.2, 0, r * 0.08);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 120, 140, 0.45)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.46, r * 0.16, r * 0.12, r * 0.08, 0, 0, TWO_PI);
    ctx.ellipse(r * 0.46, r * 0.16, r * 0.12, r * 0.08, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  drawFeathers(ctx) {
    for (const f of this.feathers) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, f.s * 1.4, f.s * 0.55, 0, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawFloats(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 18px Segoe UI, sans-serif';
    for (const f of this.floats) {
      ctx.globalAlpha = clamp(f.life / 0.75, 0, 1);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(40, 24, 16, 0.45)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  drawCrosshair(ctx) {
    const x = this.aim?.x ?? this.w * 0.5;
    const y = this.aim?.y ?? this.h * 0.4;
    const reloading = this.reloadT > 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = reloading ? '#ffb15a' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, TWO_PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(-7, 0);
    ctx.moveTo(7, 0);
    ctx.lineTo(24, 0);
    ctx.moveTo(0, -24);
    ctx.lineTo(0, -7);
    ctx.moveTo(0, 7);
    ctx.lineTo(0, 24);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20, 16, 12, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, TWO_PI);
    ctx.stroke();
    if (this.muzzle > 0) {
      ctx.fillStyle = `rgba(255, 244, 210, ${this.muzzle * 0.7})`;
      ctx.beginPath();
      ctx.arc(0, 0, 8 + (1 - this.muzzle) * 16, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  drawAmmo(ctx) {
    const y = this.h - 22;
    const gap = 14;
    const total = (HUNT_MAG - 1) * gap;
    const x0 = this.w * 0.5 - total / 2;
    for (let i = 0; i < HUNT_MAG; i++) {
      const on = i < this.ammo;
      ctx.beginPath();
      ctx.fillStyle = on ? '#ffe7a8' : 'rgba(255,255,255,0.28)';
      ctx.arc(x0 + i * gap, y, on ? 4.2 : 3.2, 0, TWO_PI);
      ctx.fill();
    }
  }

  drawBanner(ctx) {
    ctx.globalAlpha = clamp(this.bannerT, 0, 1);
    ctx.fillStyle = 'rgba(20, 16, 12, 0.45)';
    ctx.fillRect(this.w * 0.08, this.h * 0.74, this.w * 0.84, 36);
    ctx.fillStyle = '#fff8ea';
    ctx.font = '700 13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Wischen schwenkt · Tippen trifft', this.w * 0.5, this.h * 0.74 + 18);
    ctx.globalAlpha = 1;
  }
}
