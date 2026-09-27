/**
 * Orbit Jet — vertical combat-jet shooter.
 *
 * The world scrolls down onto the player. The jet auto-fires. A finger, mouse,
 * or the arrows follow in X, with a short vertical leash. Weapon pickups climb
 * Einzel → Doppel → Dreifach → Fächer → Laser. A hit without a shield costs one
 * life and one weapon tier. Four stages end in a boss, then the run loops harder.
 *
 * Kills, pickups, graze, and the boss bonus all land on the shared Rush formula
 * so `game=jet` passes the existing D1 check. No new database and no new Worker.
 */
import { computeScore, NEAR_MISS_POINTS, COMBO_GAP_SEC, COMBO_MAX, COMBO_STEP } from './game.js';
import { normalizeDifficulty } from './difficulty.js';

const TWO_PI = Math.PI * 2;
const PLAYER_R = 9;
const WEAPON_MAX = 5;

/**
 * Träger sweep. The warning holds the ignition lane, then a narrow beam
 * crosses and switches off. Draw and hit tests share `carrierLaserWidth()`.
 */
export const CARRIER_LASER = {
  warn: 1.05,
  sweep: 1.35,
  cycle: 6.6,
};

/** Storm Titan columns: a short full-height strike with the same telegraph window. */
export const TITAN_PILLAR = {
  warn: 1.05,
  hot: 0.42,
};

export const JET_WEAPONS = ['', 'Einzel', 'Doppel', 'Dreifach', 'Fächer', 'Laser'];

export const JET_PICKUPS = {
  weapon: { label: 'WAFFE', color: '#ffe566' },
  shield: { label: 'SCHILD', color: '#7af7ff' },
  slow: { label: 'ZEITLUPE', color: '#c9b6ff' },
  bomb: { label: 'BOMBE', color: '#ff8a4a' },
  magnet: { label: 'MAGNET', color: '#ff4d9a' },
  overdrive: { label: 'BOOST', color: '#ffe566' },
  drone: { label: 'DROHNE', color: '#3dff9a' },
};

/** @type {Array<{ id: string, name: string, boss: string, bossName: string, bossHp: number, sky: string[], accent: string, fog: string, enemy: string }>} */
export const JET_STAGES = [
  {
    id: 'city',
    name: 'Neon City',
    boss: 'carrier',
    bossName: 'Träger',
    bossHp: 230,
    sky: ['#140818', '#241038', '#07060f'],
    accent: '#00f0ff',
    fog: '#ff2bd6',
    enemy: '#ff4d9a',
  },
  {
    id: 'desert',
    name: 'Desert Dusk',
    boss: 'wyrm',
    bossName: 'Sandwyrm',
    bossHp: 250,
    sky: ['#2a140c', '#4a2814', '#120804'],
    accent: '#ffb15a',
    fog: '#ff7a33',
    enemy: '#ffd29a',
  },
  {
    id: 'ice',
    name: 'Ice Orbit',
    boss: 'frost',
    bossName: 'Frostkern',
    bossHp: 240,
    sky: ['#07141c', '#102838', '#040c14'],
    accent: '#d7f6ff',
    fog: '#7fd0ff',
    enemy: '#b9ecff',
  },
  {
    id: 'storm',
    name: 'Storm Nebula',
    boss: 'titan',
    bossName: 'Sturmtitan',
    bossHp: 290,
    sky: ['#120818', '#1c1030', '#06140e'],
    accent: '#39ff9a',
    fog: '#c9a6ff',
    enemy: '#d2b6ff',
  },
];

/**
 * @type {Record<'einfach'|'mittel'|'schwer'|'baba', object>}
 */
export const JET_DIFFICULTIES = {
  einfach: {
    id: 'einfach',
    label: 'Einfach',
    blurb: 'Langsam · 4 Leben · ruhiges Feuer',
    speed: 0.74,
    fire: 0.62,
    spawn: 0.72,
    tough: 0.8,
    lives: 4,
  },
  mittel: {
    id: 'mittel',
    label: 'Mittel',
    blurb: 'Klassisch · Bosse · Auto-Feuer',
    speed: 1,
    fire: 1,
    spawn: 1,
    tough: 1,
    lives: 3,
  },
  schwer: {
    id: 'schwer',
    label: 'Schwer',
    blurb: 'Dichter · härtere Bosse · mehr Feuer',
    speed: 1.14,
    fire: 1.22,
    spawn: 1.16,
    tough: 1.2,
    lives: 3,
  },
  baba: {
    id: 'baba',
    label: 'Baba',
    blurb: '⚠ Extrem · 2 Leben · kaum Luft',
    speed: 1.28,
    fire: 1.42,
    spawn: 1.32,
    tough: 1.4,
    lives: 2,
  },
};

/** @param {unknown} id */
export function getJetDifficulty(id) {
  return JET_DIFFICULTIES[normalizeDifficulty(id)];
}

/**
 * German readout of the shared formula.
 * score = floor(seconds)×10 + targets×100 + comboBonus + nearMisses×75
 */
export function formatJetFormula(survivalMs, orbs, comboBonus, nearMisses, score) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  const parts = [`${t}s × 10`, `${o} Ziele × 100`];
  if (cb > 0) parts.push(`Kette +${cb}`);
  if (nm > 0) parts.push(`${nm} Fast-vorbei × ${NEAR_MISS_POINTS}`);
  return `${parts.join(' + ')} = ${score ?? computeScore(survivalMs, orbs, cb, nm)}`;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function hypot(x, y) {
  return Math.hypot(x, y);
}

export class JetGame {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ audio?: object, onGameOver?: (r: object) => void, onHud?: (h: object) => void }} hooks
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
    this._bound = false;
    this._overTimer = 0;
    this.uid = 1;
    this.difficultyId = 'mittel';
    this.diff = getJetDifficulty('mittel');
    this.keys = { left: false, right: false, up: false, down: false };
    this.aiming = false;
    this.aimX = 0;
    this.aimY = 0;
    this.pointerId = null;
    this.stars = [];
    this.resetState();
  }

  /** @param {unknown} id */
  setDifficulty(id) {
    this.difficultyId = normalizeDifficulty(id);
    this.diff = getJetDifficulty(this.difficultyId);
  }

  stage() {
    return JET_STAGES[this.stageIndex] || JET_STAGES[0];
  }

  resetState() {
    const cfg = this.diff || getJetDifficulty('mittel');
    this.stageIndex = 0;
    this.cycle = 0;
    this.phase = 'wave';
    this.phaseTime = 0;
    this.bannerT = 0;
    this.introT = 1.8;
    this.grace = 0.85;
    this.spawnCd = 0.35;
    this.obsCd = 0.7;
    this.pickupCd = 3.4;
    this.boss = null;
    this.pBullets = [];
    this.eBullets = [];
    this.enemies = [];
    this.obstacles = [];
    this.pickups = [];
    this.particles = [];
    this.floaters = [];
    this.px = this.w ? this.w * 0.5 : 180;
    this.py = this.h ? this.h * 0.78 : 520;
    this.weapon = 1;
    this.lives = cfg.lives;
    this.shield = 0;
    this.slowT = 0;
    this.magnetT = 0;
    this.overT = 0;
    this.droneT = 0;
    this.droneAng = 0;
    this.droneCd = 0.2;
    this.bombs = 0;
    this.fireCd = 0.18;
    this.invuln = 0;
    this.orbsCollected = 0;
    this.survivalMs = 0;
    this.score = 0;
    this.comboBonus = 0;
    this.nearMisses = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboPeak = 1;
    this.bossesCleared = 0;
    this.kills = 0;
    this.alive = true;
    this.shake = 0;
    this.flash = 0;
    this.muzzle = 0;
    this.sandstorm = 0;
    this.lightning = 0;
    this.bombWave = 0;
    this.scrollT = 0;
    this.tutorial = 4.4;
    this.banner = '';
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect?.() || { width: this.canvas.width, height: this.canvas.height };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.floor(rect.width || this.canvas.width || 1));
    this.h = Math.max(1, Math.floor(rect.height || this.canvas.height || 1));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx?.setTransform?.(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.running) {
      this.px = this.w * 0.5;
      this.py = this.h * 0.78;
    } else {
      this.px = clamp(this.px, 28, this.w - 28);
      this.py = clamp(this.py, this.h * 0.56, this.h * 0.9);
    }
    if (this.stars.length === 0) this.seedStars();
  }

  seedStars() {
    this.stars = [];
    for (let i = 0; i < 48; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: 0.6 + Math.random() * 1.6,
        s: 18 + Math.random() * 70,
        a: 0.25 + Math.random() * 0.6,
      });
    }
  }

  pace() {
    return this.slowT > 0 ? 0.6 : 1;
  }

  worldMul() {
    return this.diff.speed * (1 + this.stageIndex * 0.07 + this.cycle * 0.16);
  }

  fireMul() {
    return this.diff.fire * (1 + this.stageIndex * 0.05 + this.cycle * 0.1);
  }

  localPoint(e) {
    const rect =
      this.canvas.getBoundingClientRect?.() ||
      this.canvas.parentElement?.getBoundingClientRect?.() ||
      { left: 0, top: 0 };
    return { x: e.clientX - (rect.left || 0), y: e.clientY - (rect.top || 0) };
  }

  bindInput() {
    if (this._bound) return;
    this._bound = true;
    this._onKeyDown = (e) => {
      if (!this.running || this.paused) return;
      const code = e.code;
      if (code === 'ArrowLeft' || code === 'KeyA') this.keys.left = true;
      else if (code === 'ArrowRight' || code === 'KeyD') this.keys.right = true;
      else if (code === 'ArrowUp' || code === 'KeyW') this.keys.up = true;
      else if (code === 'ArrowDown' || code === 'KeyS') this.keys.down = true;
      else if (code === 'Space' || code === 'KeyF') {
        this.fireBomb();
      } else return;
      e.preventDefault();
    };
    this._onKeyUp = (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = false;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') this.keys.up = false;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.keys.down = false;
    };
    this._onPointerDown = (e) => {
      if (!this.running || this.paused) return;
      if (this.pointerId != null) return;
      this.pointerId = e.pointerId;
      const p = this.localPoint(e);
      this.aiming = true;
      this.aimX = p.x;
      this.aimY = p.y;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    this._onPointerMove = (e) => {
      if (!this.running || this.paused) return;
      if (this.pointerId !== e.pointerId) return;
      const p = this.localPoint(e);
      this.aiming = true;
      this.aimX = p.x;
      this.aimY = p.y;
    };
    this._onPointerUp = (e) => {
      if (this.pointerId !== e.pointerId) return;
      this.pointerId = null;
      this.aiming = false;
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
    this.keys = { left: false, right: false, up: false, down: false };
    this.aiming = false;
    this.pointerId = null;
  }

  /** @param {string} [difficultyId] */
  start(difficultyId) {
    if (difficultyId != null && difficultyId !== '') this.setDifficulty(difficultyId);
    clearTimeout(this._overTimer);
    this.resetState();
    this.resize();
    this.px = this.w * 0.5;
    this.py = this.h * 0.78;
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
      this.keys = { left: false, right: false, up: false, down: false };
      this.aiming = false;
      this.pointerId = null;
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
      const step = Math.min(0.033, left);
      this.step(step);
      left -= step;
    }
    if (!this.alive) this.fadeFx(Math.max(0, dt));
    else this.syncScore();
    this.emitHud();
  }

  step(dt) {
    const pace = this.pace();
    this.survivalMs += dt * 1000;
    this.scrollT += dt * 90 * this.worldMul() * pace;
    this.invuln = Math.max(0, this.invuln - dt);
    this.grace = Math.max(0, this.grace - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.magnetT = Math.max(0, this.magnetT - dt);
    this.overT = Math.max(0, this.overT - dt);
    this.droneT = Math.max(0, this.droneT - dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.sandstorm = Math.max(0, this.sandstorm - dt);
    this.lightning = Math.max(0, this.lightning - dt);
    this.bombWave = Math.max(0, this.bombWave - dt * 1.4);
    this.tutorial = Math.max(0, this.tutorial - dt);
    this.introT = Math.max(0, this.introT - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboCount = 0;
    }
    const stage = this.stage();
    if (stage.id === 'storm' && Math.random() < dt * 0.45) this.lightning = 0.09;

    if (this.phase === 'banner') {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.advanceStage();
    } else if (this.phase === 'wave' || this.phase === 'mid') {
      this.phaseTime += dt;
      const waveLen = (this.diff.id === 'einfach' ? 12 : 10.5) / Math.max(0.7, this.diff.spawn);
      const midLen = 8 / Math.max(0.7, this.diff.spawn);
      if (this.phase === 'wave' && this.phaseTime >= waveLen) {
        this.phase = 'mid';
        this.phaseTime = 0;
        this.banner = 'MITTE';
        this.introT = Math.max(this.introT, 1.1);
      } else if (this.phase === 'mid' && this.phaseTime >= midLen) {
        this.beginBoss();
      }
    }

    if ((this.phase === 'wave' || this.phase === 'mid') && this.grace <= 0) this.spawnStep(dt);
    this.stepBoss(dt);
    this.movePlayer(dt);
    this.firePlayer(dt);
    this.moveWorld(dt, pace);
    this.collide();
    this.fadeFx(dt);
  }

  advanceStage() {
    this.stageIndex += 1;
    if (this.stageIndex >= JET_STAGES.length) {
      this.stageIndex = 0;
      this.cycle += 1;
    }
    this.phase = 'wave';
    this.phaseTime = 0;
    this.grace = 1.25;
    this.bannerT = 0;
    this.banner = '';
    this.introT = 1.7;
    this.boss = null;
    this.spawnCd = 0.8;
  }

  beginBoss() {
    const stage = this.stage();
    const hp = Math.max(40, Math.round(stage.bossHp * this.diff.tough * (1 + this.cycle * 0.28)));
    this.phase = 'boss';
    this.phaseTime = 0;
    this.banner = stage.bossName;
    this.introT = 1.35;
    this.boss = {
      kind: stage.boss,
      name: stage.bossName,
      hp,
      maxHp: hp,
      x: this.w * 0.5,
      y: Math.max(96, this.h * 0.16),
      hw: stage.boss === 'frost' ? 36 : stage.boss === 'wyrm' ? 48 : 78,
      hh: stage.boss === 'frost' ? 36 : 32,
      t: 0,
      attackT: 0,
      laser: 'off',
      laserX: this.w * 0.5,
      laserW: 14,
      laserDir: 1,
      state: 'emerge',
      stateT: 0,
      visible: true,
      stormCd: 5.2,
      laneCd: 1.1,
      burstCd: 0.7,
      pillarCd: 1.15,
      homingCd: 0.85,
      shotCd: 0.6,
      deployed: false,
      lanes: [],
      pillars: [],
      nextX: this.w * 0.5,
    };
  }

  /**
   * Boss step. Safe to call from tests with a prepared `this.boss`.
   * @param {number} dt
   */
  stepBoss(dt) {
    const b = this.boss;
    if (!b || b.hp <= 0) return;
    const pace = this.pace();
    b.t += dt;
    b.attackT += dt * pace;
    if (b.kind === 'carrier') this.stepCarrier(b, dt, pace);
    else if (b.kind === 'wyrm') this.stepWyrm(b, dt, pace);
    else if (b.kind === 'frost') this.stepFrost(b, dt, pace);
    else if (b.kind === 'titan') this.stepTitan(b, dt, pace);
    if (b.hp <= 0) this.defeatBoss();
  }

  /**
   * Visible core of the Träger beam. Kept far under 18% of the play width so
   * a thumb can slide through the core.
   */
  carrierLaserWidth() {
    return Math.min(16, Math.max(12, this.w * 0.042));
  }

  /**
   * The hot beam travels between two edge pockets. Those pockets stay inside
   * the jet's movement range and are never swept, so the arena is not sealed.
   */
  carrierLaserTrack() {
    const inset = Math.max(72, Math.min(this.w * 0.22, this.w * 0.5 - 36));
    const start = inset;
    const end = Math.max(start + 1, this.w - inset);
    return { start, end, span: end - start };
  }

  stepCarrier(b, dt, pace) {
    b.y = Math.max(92, this.h * 0.15);
    b.x = this.w * 0.5 + Math.sin(b.t * 0.7) * (this.w * 0.28);
    b.hw = Math.min(96, this.w * 0.24);
    b.hh = 30;
    b.laserW = this.carrierLaserWidth();
    // The title card covers the telegraph. Hold the attack until it clears.
    if (this.introT > 0) {
      b.attackT = 0;
      b.laser = 'off';
      b.deployed = false;
      return;
    }
    const { warn, sweep, cycle } = CARRIER_LASER;
    if (b.attackT >= cycle) {
      b.attackT -= cycle;
      b.deployed = false;
      b.laserDir = -(b.laserDir || 1);
    }
    const at = b.attackT;
    const dir = b.laserDir || 1;
    const track = this.carrierLaserTrack();
    let along = 0;
    if (at < warn) {
      b.laser = 'warn';
      along = 0;
    } else if (at < warn + sweep) {
      b.laser = 'hot';
      along = (at - warn) / sweep;
    } else {
      b.laser = 'off';
      along = 1;
    }
    const origin = dir > 0 ? track.start : track.end;
    b.laserX = origin + dir * track.span * clamp(along, 0, 1);
    // Same half-width as the drawn core. The halo is wider and does not hit.
    if (b.laser === 'hot' && Math.abs(this.px - b.laserX) <= b.laserW * 0.5) this.hurt();
    if (!b.deployed && at >= 2.55) {
      b.deployed = true;
      this.spawnEnemy('drone', b.x - 36, b.y + 40);
      this.spawnEnemy('drone', b.x + 36, b.y + 46);
    }
    b.shotCd -= dt * pace;
    if (b.laser === 'off' && b.shotCd <= 0) {
      b.shotCd = 1.25;
      const sp = 150 * this.fireMul();
      this.spawnEBullet(b.x - 20, b.y + 24, -30, sp);
      this.spawnEBullet(b.x + 20, b.y + 24, 30, sp);
    }
  }

  stepWyrm(b, dt, pace) {
    b.stormCd -= dt * pace;
    if (b.stormCd <= 0) {
      this.sandstorm = 2.15;
      b.stormCd = 8.4;
    }
    b.stateT += dt * pace;
    if (b.state === 'burrow') {
      b.visible = false;
      if (b.stateT > 1.12) {
        b.x = clamp(b.nextX, 40, this.w - 40);
        b.y = Math.max(110, this.h * 0.2);
        b.state = 'emerge';
        b.stateT = 0;
        b.visible = true;
      }
      return;
    }
    b.visible = true;
    b.y = Math.max(108, this.h * 0.2);
    b.x += Math.sin(b.t * 1.6) * 70 * dt;
    b.x = clamp(b.x, 36, this.w - 36);
    b.shotCd -= dt * pace;
    if (b.shotCd <= 0) {
      b.shotCd = 0.78;
      const sp = 165 * this.fireMul();
      this.spawnEBullet(b.x, b.y + 18, (Math.random() - 0.5) * 90, sp);
      this.spawnEBullet(b.x - 18, b.y + 12, -50, sp * 0.9);
      this.spawnEBullet(b.x + 18, b.y + 12, 50, sp * 0.9);
    }
    if (b.stateT > 2.65) {
      b.state = 'burrow';
      b.stateT = 0;
      b.visible = false;
      b.nextX = 40 + Math.random() * Math.max(20, this.w - 80);
    }
  }

  stepFrost(b, dt, pace) {
    b.y = Math.max(100, this.h * 0.16);
    b.x = this.w * 0.5 + Math.sin(b.t * 0.85) * this.w * 0.2;
    b.hw = 34;
    b.hh = 34;
    b.laneCd -= dt * pace;
    if (b.laneCd <= 0) {
      b.laneCd = 4.1;
      b.lanes.push({
        x: 40 + Math.random() * Math.max(20, this.w - 80),
        w: 76,
        life: 3.5,
      });
    }
    b.burstCd -= dt * pace;
    if (b.burstCd <= 0) {
      b.burstCd = 2.55;
      const n = 11;
      const sp = 145 * this.fireMul();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TWO_PI + b.t * 0.2;
        this.spawnEBullet(b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp);
      }
    }
    for (const lane of b.lanes) lane.life -= dt;
    b.lanes = b.lanes.filter((lane) => lane.life > 0);
  }

  stepTitan(b, dt, pace) {
    b.y = Math.max(108, this.h * 0.17);
    b.x = this.w * 0.5 + Math.sin(b.t * 0.55) * this.w * 0.22;
    b.hw = Math.min(70, this.w * 0.18);
    b.hh = 36;
    b.pillarCd -= dt * pace;
    if (b.pillarCd <= 0) {
      b.pillarCd = 3.15;
      const side = Math.random() < 0.5 ? -1 : 1;
      const pillarW = Math.min(36, this.w * 0.16);
      const xs = [this.px, this.px + side * Math.min(110, this.w * 0.28)];
      for (const x of xs) {
        b.pillars.push({
          x: clamp(x, 24, this.w - 24),
          w: pillarW,
          age: 0,
          warn: TITAN_PILLAR.warn,
          hot: TITAN_PILLAR.hot,
        });
      }
    }
    b.homingCd -= dt * pace;
    if (b.homingCd <= 0) {
      b.homingCd = 2.05;
      this.spawnHoming(b.x - 18, b.y + 16);
      this.spawnHoming(b.x + 18, b.y + 16);
    }
    for (const pillar of b.pillars) {
      pillar.age += dt * pace;
      const hot = pillar.age >= pillar.warn && pillar.age <= pillar.warn + pillar.hot;
      if (hot && Math.abs(this.px - pillar.x) <= pillar.w * 0.5) this.hurt();
    }
    b.pillars = b.pillars.filter((pillar) => pillar.age < pillar.warn + pillar.hot + 0.05);
  }

  frozen() {
    const b = this.boss;
    if (!b || b.kind !== 'frost') return false;
    for (const lane of b.lanes) {
      if (Math.abs(this.px - lane.x) < lane.w * 0.5) return true;
    }
    return false;
  }

  defeatBoss() {
    if (!this.boss) return;
    const name = this.boss.name;
    this.boss = null;
    this.bossesCleared += 1;
    this.awardOrb(8);
    this.clearHostiles();
    this.phase = 'banner';
    this.bannerT = 2.15;
    this.banner = `${name} besiegt`;
    this.introT = 2.15;
    this.invuln = Math.max(this.invuln, 2.15);
    this.audio?.combo?.(COMBO_MAX);
    this.burst(this.w * 0.5, this.h * 0.28, this.stage().accent, 26);
    this.shake = 0.7;
  }

  clearHostiles() {
    for (const e of this.enemies) e.alive = false;
    for (const b of this.eBullets) b.alive = false;
    for (const o of this.obstacles) o.alive = false;
  }

  spawnStep(dt) {
    const rush = this.phase === 'mid' ? 1.35 : 1;
    const mul = Math.max(0.45, this.diff.spawn) * rush * (1 + this.cycle * 0.12);
    this.spawnCd -= dt * mul;
    this.obsCd -= dt * mul;
    this.pickupCd -= dt;
    if (this.spawnCd <= 0) {
      this.spawnCd = this.phase === 'mid' ? 0.7 : 0.95;
      this.spawnWaveEnemy();
    }
    if (this.obsCd <= 0) {
      this.obsCd = this.phase === 'mid' ? 1.15 : 1.55;
      this.spawnObstacle();
    }
    if (this.pickupCd <= 0) {
      this.pickupCd = 6.2;
      this.spawnPickup(30 + Math.random() * Math.max(20, this.w - 60), -16, null);
    }
  }

  spawnWaveEnemy() {
    const roll = Math.random();
    const x = 28 + Math.random() * Math.max(20, this.w - 56);
    if (this.phase === 'mid' && roll < 0.38) this.spawnEnemy('gunner', x, -28);
    else if (roll < (this.phase === 'mid' ? 0.62 : 0.28)) this.spawnEnemy('dart', x, -24);
    else this.spawnEnemy('scout', x, -24);
  }

  spawnEnemy(kind, x, y) {
    const e = this.alloc(this.enemies, 26);
    if (!e) return null;
    const tough = this.diff.tough * (1 + this.cycle * 0.12);
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.uid = ++this.uid;
    e.t = Math.random() * 4;
    e.r = kind === 'drone' ? 11 : kind === 'gunner' ? 14 : 12;
    e.hp = (kind === 'gunner' ? 5 : kind === 'dart' ? 2 : 3) * tough;
    e.maxHp = e.hp;
    e.shotCd = 0.45 + Math.random() * 0.6;
    e.vx = kind === 'dart' ? (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 50) : 0;
    e.vy = kind === 'drone' ? 36 : 50;
    e.alive = true;
    return e;
  }

  spawnObstacle() {
    const o = this.alloc(this.obstacles, 14);
    if (!o) return null;
    const stage = this.stage().id;
    o.kind = stage === 'ice' ? 'shard' : stage === 'desert' ? 'rock' : stage === 'storm' ? 'mine' : 'board';
    o.w = o.kind === 'shard' ? 16 : o.kind === 'mine' ? 18 : 28 + Math.random() * 18;
    o.h = o.kind === 'board' ? 14 : o.w * 0.62;
    let ox = 24 + Math.random() * Math.max(10, this.w - 48);
    if (Math.abs(ox - this.px) < 78) ox = clamp(this.px + (Math.random() < 0.5 ? -120 : 120), 24, this.w - 24);
    o.x = ox;
    o.y = -30;
    o.r = o.kind === 'board' ? o.w * 0.28 : o.kind === 'mine' ? 10 : 9;
    o.hp = (o.kind === 'board' ? 4 : 3) * this.diff.tough;
    o.uid = ++this.uid;
    o.spin = Math.random() * TWO_PI;
    o.alive = true;
    return o;
  }

  spawnPickup(x, y, type) {
    const keys = Object.keys(JET_PICKUPS);
    const picked = type && JET_PICKUPS[type] ? type : keys[Math.floor(Math.random() * keys.length)];
    const weighted = type
      ? picked
      : Math.random() < 0.4
        ? 'weapon'
        : keys[Math.floor(Math.random() * keys.length)];
    const p = this.alloc(this.pickups, 8);
    if (!p) return null;
    p.kind = weighted;
    p.x = x;
    p.y = y;
    p.r = 13;
    p.vy = 62;
    p.alive = true;
    return p;
  }

  spawnPBullet(x, y, vx, vy, dmg, pierce) {
    const b = this.alloc(this.pBullets, 72);
    if (!b) return null;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.dmg = dmg;
    b.pierce = pierce;
    b.r = pierce > 0 ? 3.2 : 3.6;
    b.life = 1.35;
    b.bossHit = false;
    if (!b.seen) b.seen = new Set();
    else b.seen.clear();
    b.alive = true;
    return b;
  }

  spawnEBullet(x, y, vx, vy) {
    const b = this.alloc(this.eBullets, 110);
    if (!b) return null;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.r = 3.5;
    b.life = 4.2;
    b.homing = false;
    b.turn = 0;
    b.grazed = false;
    b.alive = true;
    return b;
  }

  spawnHoming(x, y) {
    const b = this.spawnEBullet(x, y, 0, 70);
    if (!b) return null;
    b.homing = true;
    b.turn = 2.15;
    b.r = 5.5;
    return b;
  }

  alloc(list, max) {
    for (let i = 0; i < list.length; i++) {
      if (!list[i].alive) {
        list[i].alive = true;
        return list[i];
      }
    }
    if (list.length >= max) return null;
    const item = { alive: true };
    list.push(item);
    return item;
  }

  movePlayer(dt) {
    const leash = this.frozen() ? 0.38 : 1;
    const pad = 22;
    const yMin = this.h * 0.56;
    const yMax = Math.min(this.h - 28, this.h * 0.9);
    if (this.aiming) {
      const k = 1 - Math.exp(-14 * dt * leash);
      const tx = clamp(this.aimX, pad, this.w - pad);
      const ty = clamp(this.aimY, yMin, yMax);
      this.px += (tx - this.px) * k;
      this.py += (ty - this.py) * k;
    } else {
      const sp = 340 * leash * (this.overT > 0 ? 1.08 : 1);
      if (this.keys.left) this.px -= sp * dt;
      if (this.keys.right) this.px += sp * dt;
      if (this.keys.up) this.py -= sp * 0.75 * dt;
      if (this.keys.down) this.py += sp * 0.75 * dt;
      this.px = clamp(this.px, pad, this.w - pad);
      this.py = clamp(this.py, yMin, yMax);
    }
    if (this.droneT > 0) {
      this.droneAng += dt * 3.4;
      this.droneCd -= dt * (this.overT > 0 ? 1.4 : 1);
      if (this.droneCd <= 0) {
        this.droneCd = 0.24;
        const dx = Math.cos(this.droneAng) * 26;
        const dy = Math.sin(this.droneAng) * 16;
        this.spawnPBullet(this.px + dx, this.py + dy - 8, 0, -600, 0.65, 0);
      }
    }
  }

  firePlayer(dt) {
    const boost = this.overT > 0 ? 0.62 : 1;
    const dmgMul = this.overT > 0 ? 1.55 : 1;
    const gap = (this.weapon === 5 ? 0.07 : this.weapon === 4 ? 0.2 : 0.16) * boost;
    this.fireCd -= dt;
    if (this.fireCd > 0) return;
    this.fireCd = gap;
    this.muzzle = 0.045;
    const y = this.py - 16;
    const sp = 680;
    const shot = (ox, deg, dmg, pierce) => {
      const a = (deg * Math.PI) / 180;
      this.spawnPBullet(this.px + ox, y, Math.cos(a) * sp, Math.sin(a) * sp, dmg * dmgMul, pierce);
    };
    if (this.weapon <= 1) shot(0, -90, 1, 0);
    else if (this.weapon === 2) {
      shot(-8, -90, 1, 0);
      shot(8, -90, 1, 0);
    } else if (this.weapon === 3) {
      shot(-12, -90, 1, 0);
      shot(0, -90, 1, 0);
      shot(12, -90, 1, 0);
    } else if (this.weapon === 4) {
      shot(0, -118, 0.85, 0);
      shot(0, -104, 0.85, 0);
      shot(0, -90, 0.85, 0);
      shot(0, -76, 0.85, 0);
      shot(0, -62, 0.85, 0);
    } else {
      shot(0, -90, 0.8, 8);
    }
  }

  moveWorld(dt, pace) {
    const flow = this.worldMul() * pace;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt;
      if (e.kind === 'gunner') {
        const goal = this.h * 0.3;
        e.vy = e.y < goal ? 90 * flow : 16 * flow;
        e.x += Math.sin(e.t * 1.4) * 28 * dt;
      } else if (e.kind === 'dart') {
        e.vy = 150 * flow;
        e.x += e.vx * flow * dt;
      } else if (e.kind === 'drone') {
        e.vy = 28 * flow;
        e.x += Math.sin(e.t * 3) * 50 * dt;
      } else {
        e.vy = 78 * flow;
        e.x += Math.sin(e.t * 2.1) * 55 * dt;
      }
      e.y += e.vy * dt;
      e.shotCd -= dt * pace * this.fireMul();
      if (e.shotCd <= 0 && e.kind !== 'dart') {
        e.shotCd = e.kind === 'gunner' ? 1.7 : e.kind === 'drone' ? 1.55 : 2.05;
        this.enemyShoot(e);
      }
      if (e.y > this.h + 40 || e.x < -40 || e.x > this.w + 40) e.alive = false;
    }
    for (const o of this.obstacles) {
      if (!o.alive) continue;
      o.y += 115 * flow * dt;
      o.spin += dt * 1.4;
      if (o.y > this.h + 40) o.alive = false;
    }
    for (const p of this.pickups) {
      if (!p.alive) continue;
      if (this.magnetT > 0) {
        const dx = this.px - p.x;
        const dy = this.py - p.y;
        const m = hypot(dx, dy) || 1;
        p.x += (dx / m) * 260 * dt;
        p.y += (dy / m) * 260 * dt;
      } else {
        p.y += p.vy * flow * dt;
      }
      if (p.y > this.h + 30) p.alive = false;
    }
    for (const b of this.pBullets) {
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.y < -20 || b.x < -20 || b.x > this.w + 20) b.alive = false;
    }
    for (const b of this.eBullets) {
      if (!b.alive) continue;
      if (b.homing) {
        const desired = Math.atan2(this.py - b.y, this.px - b.x);
        let a = Math.atan2(b.vy, b.vx || 0.001);
        let diff = desired - a;
        while (diff > Math.PI) diff -= TWO_PI;
        while (diff < -Math.PI) diff += TWO_PI;
        const turn = b.turn * dt * pace;
        a += clamp(diff, -turn, turn);
        const sp = 155 * this.fireMul() * pace;
        b.vx = Math.cos(a) * sp;
        b.vy = Math.sin(a) * sp;
      }
      b.x += b.vx * pace * dt;
      b.y += b.vy * pace * dt;
      b.life -= dt;
      if (b.life <= 0 || b.y > this.h + 30 || b.y < -40 || b.x < -40 || b.x > this.w + 40) b.alive = false;
    }
    for (const s of this.stars) {
      s.y += s.s * flow * dt;
      if (s.y > this.h) {
        s.y = 0;
        s.x = Math.random() * this.w;
      }
    }
  }

  enemyShoot(e) {
    const sp = (e.kind === 'gunner' ? 168 : 132) * this.fireMul();
    if (e.kind === 'gunner' || e.kind === 'drone') {
      const dx = this.px - e.x;
      const dy = Math.max(40, this.py - e.y);
      const m = hypot(dx, dy) || 1;
      const sway = (Math.random() - 0.5) * 0.45;
      const vx = (dx / m) * sp + sway * sp;
      const vy = Math.max(70, (dy / m) * sp);
      this.spawnEBullet(e.x, e.y + 8, vx, vy);
      return;
    }
    this.spawnEBullet(e.x, e.y + 8, (Math.random() - 0.5) * 36, sp);
  }

  collide() {
    for (const b of this.pBullets) {
      if (!b.alive) continue;
      for (const e of this.enemies) {
        if (!b.alive || !e.alive) continue;
        if (b.seen.has(e.uid)) continue;
        if (hypot(b.x - e.x, b.y - e.y) <= b.r + e.r) this.bulletHit(b, e);
      }
      if (!b.alive) continue;
      for (const o of this.obstacles) {
        if (!b.alive || !o.alive) continue;
        if (b.seen.has(o.uid)) continue;
        if (hypot(b.x - o.x, b.y - o.y) <= b.r + o.r) this.bulletHit(b, o);
      }
      if (b.alive && this.boss && !b.bossHit && this.bossHits(b)) {
        b.bossHit = true;
        this.boss.hp -= b.dmg;
        this.burst(b.x, b.y, '#fff', 3);
        this.notePierce(b);
        if (this.boss.hp <= 0) this.defeatBoss();
      }
    }
    if (!this.alive) return;
    for (const b of this.eBullets) {
      if (!b.alive) continue;
      const d = hypot(b.x - this.px, b.y - this.py);
      if (d <= b.r + PLAYER_R) {
        b.alive = false;
        this.hurt();
      } else if (!b.grazed && d < 28) {
        b.grazed = true;
        this.addNear();
      }
    }
    for (const e of this.enemies) {
      if (!e.alive || this.invuln > 0) continue;
      if (hypot(e.x - this.px, e.y - this.py) <= e.r + PLAYER_R) {
        e.alive = false;
        this.burst(e.x, e.y, this.stage().enemy, 8);
        this.hurt();
      }
    }
    for (const o of this.obstacles) {
      if (!o.alive || this.invuln > 0) continue;
      if (hypot(o.x - this.px, o.y - this.py) <= o.r + PLAYER_R) {
        o.alive = false;
        this.burst(o.x, o.y, this.stage().accent, 8);
        this.hurt();
      }
    }
    for (const p of this.pickups) {
      if (!p.alive) continue;
      const reach = this.magnetT > 0 ? 22 : 16;
      if (hypot(p.x - this.px, p.y - this.py) <= p.r + reach) {
        p.alive = false;
        this.grantPickup(p.kind);
      }
    }
    if (this.boss && this.boss.visible !== false && this.invuln <= 0 && this.bossHitsPlayer()) this.hurt();
  }

  bossHitsPlayer() {
    const b = this.boss;
    if (!b || b.hp <= 0) return false;
    return Math.abs(this.px - b.x) < b.hw * 0.55 && Math.abs(this.py - b.y) < b.hh + PLAYER_R;
  }

  bossHits(b) {
    const boss = this.boss;
    if (!boss || boss.hp <= 0) return false;
    if (boss.kind === 'wyrm' && !boss.visible) return false;
    return Math.abs(b.x - boss.x) < boss.hw && Math.abs(b.y - boss.y) < boss.hh + b.r;
  }

  bulletHit(b, target) {
    b.seen.add(target.uid);
    target.hp -= b.dmg;
    if (target.hp <= 0) {
      if (target.kind && (target.kind === 'scout' || target.kind === 'gunner' || target.kind === 'dart' || target.kind === 'drone')) {
        this.killEnemy(target);
      } else {
        target.alive = false;
        this.burst(target.x, target.y, this.stage().accent, 7);
        this.awardOrb(1);
      }
    }
    this.notePierce(b);
  }

  notePierce(b) {
    if (b.pierce > 0) b.pierce -= 1;
    else b.alive = false;
  }

  killEnemy(e) {
    if (!e.alive) return;
    e.alive = false;
    this.kills += 1;
    this.awardOrb(1);
    this.burst(e.x, e.y, this.stage().enemy, 10);
    this.audio?.collect?.(Math.min(COMBO_MAX, this.comboCount));
    if (this.comboCount > 1) this.audio?.combo?.(Math.min(COMBO_MAX, this.comboCount));
    if (Math.random() < 0.18) {
      const type = Math.random() < 0.55 ? 'weapon' : null;
      this.spawnPickup(e.x, e.y, type);
    }
  }

  /** @param {string} type */
  grantPickup(type) {
    const spec = JET_PICKUPS[type];
    if (!spec) return;
    if (type === 'weapon') this.weapon = Math.min(WEAPON_MAX, this.weapon + 1);
    else if (type === 'shield') this.shield = Math.min(2, this.shield + 2);
    else if (type === 'slow') this.slowT = Math.max(this.slowT, 5);
    else if (type === 'bomb') this.bombs = Math.min(3, this.bombs + 1);
    else if (type === 'magnet') this.magnetT = Math.max(this.magnetT, 6.5);
    else if (type === 'overdrive') this.overT = Math.max(this.overT, 5.2);
    else if (type === 'drone') this.droneT = Math.max(this.droneT, 8);
    this.awardOrb(1);
    this.floatText(this.px, this.py - 28, spec.label, spec.color);
    this.audio?.powerup?.(type === 'shield' ? 'shield' : type === 'slow' ? 'slow' : 'magnet');
  }

  addNear() {
    const sec = Math.floor(this.survivalMs / 1000);
    const cap = Math.max(8, sec * 4 + 10);
    if (this.nearMisses >= cap) return;
    this.nearMisses += 1;
    this.audio?.nearMiss?.();
    this.syncScore();
  }

  /** One life, or one shield charge. A life also drops a single weapon tier. */
  hurt() {
    if (!this.alive || this.invuln > 0 || this.phase === 'banner') return;
    if (this.shield > 0) {
      this.shield -= 1;
      this.invuln = 0.38;
      this.flash = 0.28;
      this.shake = 0.35;
      this.audio?.shieldBreak?.();
      return;
    }
    this.lives -= 1;
    this.weapon = Math.max(1, this.weapon - 1);
    this.comboCount = 0;
    this.comboTimer = 0;
    this.invuln = 1.55;
    this.flash = 0.5;
    this.shake = 0.8;
    this.audio?.hit?.();
    this.burst(this.px, this.py, '#ff4d6d', 12);
    if (this.lives <= 0) this.die();
  }

  fireBomb() {
    if (!this.running || this.paused || !this.alive || this.bombs <= 0) return false;
    this.bombs -= 1;
    for (const b of this.eBullets) b.alive = false;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (hypot(e.x - this.px, e.y - this.py) < 300) e.hp -= 8;
      if (e.hp <= 0) this.killEnemy(e);
    }
    for (const o of this.obstacles) {
      if (!o.alive) continue;
      if (hypot(o.x - this.px, o.y - this.py) < 280) {
        o.alive = false;
        this.burst(o.x, o.y, this.stage().accent, 6);
      }
    }
    if (this.boss && this.boss.hp > 0) {
      this.boss.hp -= 14;
      if (this.boss.hp <= 0) this.defeatBoss();
    }
    this.bombWave = 1;
    this.flash = 0.35;
    this.shake = 0.65;
    this.audio?.powerup?.('bomb');
    return true;
  }

  awardOrb(n = 1) {
    const count = Math.max(0, Math.floor(n));
    for (let i = 0; i < count; i++) {
      this.orbsCollected += 1;
      this.comboCount += 1;
      this.comboTimer = COMBO_GAP_SEC;
      const mult = Math.min(COMBO_MAX, this.comboCount);
      this.comboPeak = Math.max(this.comboPeak, mult);
      if (mult > 1) this.comboBonus += (mult - 1) * COMBO_STEP;
    }
    const cap = this.orbsCollected * (COMBO_MAX - 1) * COMBO_STEP;
    if (this.comboBonus > cap) this.comboBonus = cap;
    this.syncScore();
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const p = this.alloc(this.particles, 90);
      if (!p) return;
      const a = Math.random() * TWO_PI;
      const s = 30 + Math.random() * 110;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = 0.28 + Math.random() * 0.28;
      p.max = p.life;
      p.r = 1.2 + Math.random() * 2;
      p.color = color;
      p.alive = true;
    }
  }

  floatText(x, y, text, color) {
    this.floaters.push({ x, y, text, color, life: 0.8, vy: -28 });
    if (this.floaters.length > 8) this.floaters.shift();
  }

  fadeFx(dt) {
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) p.alive = false;
    }
    for (const ft of this.floaters) {
      ft.y += ft.vy * dt;
      ft.life -= dt;
    }
    this.floaters = this.floaters.filter((ft) => ft.life > 0);
  }

  syncScore() {
    this.score = computeScore(this.survivalMs, this.orbsCollected, this.comboBonus, this.nearMisses);
  }

  emitHud() {
    const stage = this.stage();
    const round = this.cycle > 0 ? ` +${this.cycle}` : '';
    let stageName = stage.name;
    if (this.phase === 'banner') stageName = this.banner || 'Stufe geschafft';
    else if (this.boss) stageName = `${stage.name} · ${stage.bossName}`;
    else if (this.phase === 'mid') stageName = `${stage.name} · Mitte`;
    this.onHud?.({
      score: this.score,
      lives: Math.max(0, this.lives),
      orbs: this.orbsCollected,
      time: this.survivalMs / 1000,
      combo: Math.min(COMBO_MAX, this.comboCount),
      weapon: this.weapon,
      weaponLabel: JET_WEAPONS[this.weapon] || 'Einzel',
      stage: this.stageIndex + 1,
      stageCount: JET_STAGES.length,
      stageName: `${stageName}${round}`,
      cycle: this.cycle,
      shield: this.shield,
      slow: this.slowT,
      magnet: this.magnetT,
      overdrive: this.overT,
      drone: this.droneT,
      bombs: this.bombs,
      tutorial: this.tutorial,
      bosses: this.bossesCleared,
    });
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.lives = 0;
    this.syncScore();
    this.burst(this.px, this.py, '#ff2bd6', 24);
    this.burst(this.px, this.py, '#00f0ff', 12);
    this.shake = 1;
    this.flash = 0.6;
    this.emitHud();
    clearTimeout(this._overTimer);
    this._overTimer = setTimeout(() => {
      const result = this.buildResult();
      this.stop();
      this.onGameOver?.(result);
    }, 680);
  }

  buildResult() {
    this.syncScore();
    const survivalMs = Math.floor(this.survivalMs);
    const stage = this.stage();
    return {
      game: 'jet',
      score: this.score,
      survivalMs,
      orbs: this.orbsCollected,
      comboBonus: this.comboBonus,
      nearMisses: this.nearMisses,
      difficulty: this.difficultyId,
      daily: false,
      comboPeak: this.comboPeak,
      stage: this.stageIndex + 1,
      stageCount: JET_STAGES.length,
      stageName: stage.name,
      bossesCleared: this.bossesCleared,
      kills: this.kills,
      weapon: this.weapon,
      cycle: this.cycle,
      formula: formatJetFormula(survivalMs, this.orbsCollected, this.comboBonus, this.nearMisses, this.score),
    };
  }

  drawIdle() {
    if (!this.w) this.resize();
    this.scrollT += 1.4;
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx?.save || !this.w) return;
    const stage = this.stage();
    let ox = 0;
    let oy = 0;
    if (this.shake > 0) {
      const amp = 6 * this.shake;
      ox = (Math.random() - 0.5) * amp;
      oy = (Math.random() - 0.5) * amp * 0.6;
    }
    ctx.save();
    ctx.translate(ox, oy);
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, stage.sky[0]);
    g.addColorStop(0.45, stage.sky[1]);
    g.addColorStop(1, stage.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(-8, -8, this.w + 16, this.h + 16);
    this.drawBackdrop(ctx, stage);
    for (const s of this.stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = stage.accent;
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    for (const o of this.obstacles) if (o.alive) this.drawObstacle(ctx, o, stage);
    for (const p of this.pickups) if (p.alive) this.drawPickup(ctx, p);
    for (const e of this.enemies) if (e.alive) this.drawEnemy(ctx, e, stage);
    if (this.boss) this.drawBoss(ctx, this.boss, stage);
    for (const b of this.eBullets) if (b.alive) this.drawEBullet(ctx, b, stage);
    if (this.weapon === 5) this.drawBeam(ctx, stage);
    for (const b of this.pBullets) if (b.alive) this.drawPBullet(ctx, b, stage);
    this.drawPlayer(ctx, stage);
    for (const p of this.particles) {
      if (!p.alive) continue;
      ctx.globalAlpha = Math.max(0, p.life / (p.max || 0.4));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    ctx.globalAlpha = 1;
    ctx.font = '700 12px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const ft of this.floaters) {
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;
    if (this.sandstorm > 0) {
      ctx.fillStyle = `rgba(120, 60, 16, ${Math.min(0.55, this.sandstorm * 0.28)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (this.lightning > 0 && stage.id === 'storm') {
      ctx.strokeStyle = `rgba(210, 255, 220, ${Math.min(1, this.lightning * 8)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let x = this.w * (0.2 + (this.scrollT % 1) * 0.6);
      ctx.moveTo(x, 0);
      for (let y = 0; y < this.h; y += 28) {
        x += Math.sin(y + this.scrollT) * 16;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (this.bombWave > 0) {
      ctx.strokeStyle = `rgba(255, 200, 120, ${this.bombWave})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.px, this.py, (1 - this.bombWave) * Math.max(this.w, this.h), 0, TWO_PI);
      ctx.stroke();
    }
    if (this.boss && this.boss.hp > 0) this.drawBossBar(ctx, stage);
    if (this.introT > 0) this.drawIntro(ctx, stage);
    if (this.tutorial > 0.2 && this.bossesCleared === 0 && this.stageIndex === 0 && this.cycle === 0) {
      ctx.globalAlpha = Math.min(1, this.tutorial);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const y = this.h - 54;
      ctx.fillRect(16, y - 16, this.w - 32, 28);
      ctx.fillStyle = '#e8f0ff';
      ctx.font = '600 12px Segoe UI, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Ziehen = fliegen · Auto-Feuer · Einsammeln = stärker', this.w * 0.5, y);
      ctx.globalAlpha = 1;
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.45, this.flash * 0.55)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.restore();
  }

  drawBackdrop(ctx, stage) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const y = ((i * (this.h / 4) + this.scrollT * 0.55) % (this.h + 80)) - 40;
      const x = ((i * 67) % Math.max(1, this.w - 30)) + 8;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = stage.fog;
      if (stage.id === 'city') {
        ctx.fillRect(x, y, 26, 48);
        ctx.fillStyle = stage.accent;
        ctx.fillRect(x + 4, y + 6, 6, 4);
        ctx.fillRect(x + 14, y + 16, 6, 4);
      } else if (stage.id === 'desert') {
        ctx.beginPath();
        ctx.moveTo(x, y + 20);
        ctx.lineTo(x + 28, y);
        ctx.lineTo(x + 56, y + 20);
        ctx.fill();
      } else if (stage.id === 'ice') {
        ctx.beginPath();
        ctx.moveTo(x + 10, y);
        ctx.lineTo(x + 20, y + 28);
        ctx.lineTo(x, y + 28);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x + 12, y + 12, 10 + (i % 3), 0, TWO_PI);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawPlayer(ctx, stage) {
    if (this.invuln > 0 && Math.floor(this.invuln * 14) % 2 === 0) return;
    const { px, py } = this;
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = '#041018';
    ctx.strokeStyle = stage.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(12, 12);
    ctx.lineTo(0, 6);
    ctx.lineTo(-12, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = stage.fog;
    ctx.fillRect(-3, 8, 6, 8 + Math.sin(this.scrollT * 0.4) * 2);
    if (this.muzzle > 0) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(-2, -24, 4, 8);
    }
    if (this.shield > 0) {
      ctx.strokeStyle = `rgba(122, 247, 255, ${0.45 + this.shield * 0.2})`;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.restore();
    if (this.droneT > 0) {
      const dx = Math.cos(this.droneAng) * 26;
      const dy = Math.sin(this.droneAng) * 16 - 8;
      ctx.fillStyle = '#3dff9a';
      ctx.beginPath();
      ctx.arc(px + dx, py + dy, 4.5, 0, TWO_PI);
      ctx.fill();
    }
  }

  drawEnemy(ctx, e, stage) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = '#140810';
    ctx.strokeStyle = stage.enemy;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (e.kind === 'drone') {
      ctx.arc(0, 0, e.r, 0, TWO_PI);
    } else {
      ctx.moveTo(0, 12);
      ctx.lineTo(11, -10);
      ctx.lineTo(0, -4);
      ctx.lineTo(-11, -10);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawObstacle(ctx, o, stage) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.spin || 0);
    ctx.fillStyle = stage.fog;
    ctx.globalAlpha = 0.85;
    if (o.kind === 'shard') {
      ctx.beginPath();
      ctx.moveTo(0, -o.h);
      ctx.lineTo(o.w * 0.4, o.h * 0.4);
      ctx.lineTo(-o.w * 0.4, o.h * 0.3);
      ctx.fill();
    } else if (o.kind === 'mine') {
      ctx.beginPath();
      ctx.arc(0, 0, o.r, 0, TWO_PI);
      ctx.fill();
    } else {
      ctx.fillRect(-o.w * 0.5, -o.h * 0.5, o.w, o.h);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawPickup(ctx, p) {
    const spec = JET_PICKUPS[p.kind] || JET_PICKUPS.weapon;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = spec.color;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = spec.color;
    ctx.font = '700 9px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spec.label, 0, 3);
    ctx.restore();
  }

  drawPBullet(ctx, b, stage) {
    ctx.fillStyle = this.weapon === 5 ? '#fff' : stage.accent;
    ctx.fillRect(b.x - 1.5, b.y - 6, 3, this.weapon === 5 ? 16 : 10);
  }

  drawBeam(ctx, stage) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = stage.accent;
    ctx.fillRect(this.px - 2, 0, 4, this.py - 16);
    ctx.globalAlpha = 1;
  }

  drawEBullet(ctx, b, stage) {
    ctx.fillStyle = b.homing ? '#ffe566' : stage.fog;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TWO_PI);
    ctx.fill();
  }

  drawBoss(ctx, b, stage) {
    if (b.kind === 'wyrm' && !b.visible) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = stage.fog;
      ctx.beginPath();
      ctx.arc(b.nextX || b.x, b.y + 10, 10, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = '#0a0610';
    ctx.strokeStyle = stage.accent;
    ctx.lineWidth = 2;
    if (b.kind === 'carrier') {
      ctx.fillRect(-b.hw, -18, b.hw * 2, 36);
      ctx.strokeRect(-b.hw, -18, b.hw * 2, 36);
      ctx.fillStyle = stage.fog;
      ctx.fillRect(-b.hw + 8, -8, 16, 10);
      ctx.fillRect(b.hw - 24, -8, 16, 10);
    } else if (b.kind === 'wyrm') {
      ctx.beginPath();
      ctx.ellipse(0, 0, b.hw, 16, 0, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = stage.fog;
      ctx.fillRect(-6, -4, 8, 8);
    } else if (b.kind === 'frost') {
      ctx.beginPath();
      ctx.arc(0, 0, 28, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = stage.fog;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 22);
      ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -28);
      ctx.lineTo(b.hw, 16);
      ctx.lineTo(0, 6);
      ctx.lineTo(-b.hw, 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    if (b.kind === 'carrier') this.drawCarrierLaser(ctx, b);
    if (b.kind === 'frost') {
      for (const lane of b.lanes) {
        ctx.fillStyle = `rgba(180, 230, 255, ${0.12 + Math.min(0.2, lane.life * 0.05)})`;
        ctx.fillRect(lane.x - lane.w * 0.5, 0, lane.w, this.h);
      }
    }
    if (b.kind === 'titan') {
      for (const pillar of b.pillars) this.drawTitanPillar(ctx, pillar, b);
    }
  }

  drawCarrierLaser(ctx, b) {
    if (b.laser !== 'warn' && b.laser !== 'hot') return;
    const width = b.laserW || this.carrierLaserWidth();
    const x = b.laserX;
    const dir = b.laserDir || 1;
    ctx.save();
    if (b.laser === 'warn') {
      const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(b.t * 14));
      ctx.globalAlpha = 0.16 + 0.22 * pulse;
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(x - width, 0, width * 2, this.h);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#ffe566';
      ctx.lineWidth = 2;
      ctx.setLineDash?.([9, 7]);
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, this.h);
      ctx.stroke();
      ctx.setLineDash?.([]);
      ctx.fillStyle = '#ffe566';
      ctx.font = '700 12px Segoe UI, system-ui, sans-serif';
      ctx.textAlign = 'center';
      const labelX = clamp(x + dir * 48, 40, this.w - 40);
      ctx.fillText('ACHTUNG', labelX, Math.max(96, this.h * 0.2));
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 4; i++) {
        const y = this.h * (0.32 + i * 0.12);
        ctx.beginPath();
        ctx.moveTo(x + dir * 12, y);
        ctx.lineTo(x + dir * 22, y + 6);
        ctx.lineTo(x + dir * 12, y + 12);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // Halo is wider than the core on purpose: only `width` deals damage.
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(x - width * 0.5 - 8, 0, width + 16, this.h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ff2d55';
      ctx.fillRect(x - width * 0.5, 0, width, this.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff6f8';
      ctx.fillRect(x - 1.25, 0, 2.5, this.h);
    }
    ctx.restore();
  }

  drawTitanPillar(ctx, pillar, b) {
    const hot = pillar.age >= pillar.warn;
    const x = pillar.x - pillar.w * 0.5;
    ctx.save();
    if (!hot) {
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin((pillar.age + b.t) * 12));
      ctx.globalAlpha = 0.28 + 0.45 * pulse;
      ctx.strokeStyle = '#c9a6ff';
      ctx.lineWidth = 2;
      ctx.setLineDash?.([8, 6]);
      ctx.strokeRect(x + 1, 0, Math.max(1, pillar.w - 2), this.h);
      ctx.setLineDash?.([]);
      ctx.globalAlpha = 0.12 * pulse;
      ctx.fillStyle = '#c9a6ff';
      ctx.fillRect(x, 0, pillar.w, this.h);
    } else {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#39ff9a';
      ctx.fillRect(x, 0, pillar.w, this.h);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#eafff4';
      ctx.fillRect(pillar.x - 1.5, 0, 3, this.h);
    }
    ctx.restore();
  }

  drawBossBar(ctx, stage) {
    const b = this.boss;
    const w = Math.min(220, this.w - 40);
    const x = (this.w - w) / 2;
    const y = 70;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, w, 8);
    ctx.fillStyle = stage.accent;
    ctx.fillRect(x, y, w * clamp(b.hp / b.maxHp, 0, 1), 8);
    ctx.fillStyle = '#e8f0ff';
    ctx.font = '700 11px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.name, this.w * 0.5, y - 4);
  }

  drawIntro(ctx, stage) {
    ctx.globalAlpha = Math.min(1, this.introT);
    ctx.fillStyle = '#e8f0ff';
    ctx.font = '800 20px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const title =
      this.phase === 'banner'
        ? this.banner || 'Stufe geschafft'
        : this.phase === 'boss' && this.boss
          ? `${stage.name} · ${this.boss.name}`
          : this.phase === 'mid'
            ? `${stage.name} · Mitte`
            : stage.name;
    ctx.fillText(title, this.w * 0.5, this.h * 0.42);
    ctx.globalAlpha = 1;
  }
}
