/**
 * Orbit Pulse — tap and hold neon circles on the beat.
 *
 * Music comes from `public/pulse-music/manifest.json`. Each difficulty has its
 * own files (quieter LUFS → Einfach, louder → Baba). A run plays that
 * difficulty's primary track, or a random alt. Daily Beat picks from
 * `dailyPool` with a UTC-date seed and always charts Schwer. A 0–3% playback
 * rate nudge is optional color; it is not how difficulty changes the song.
 *
 * Hits map onto the shared Rush formula so `game=pulse` passes the server check:
 * survivalMs ≈ run length, orbs ≈ perfect + good, comboBonus from perfect
 * streaks, nearMisses ≈ Good.
 */
import { computeScore, COMBO_STEP, COMBO_MAX, NEAR_MISS_POINTS } from './game.js';
import { normalizeDifficulty } from './difficulty.js';
import { hashSeed, mulberry32 } from './rng.js';

const TWO_PI = Math.PI * 2;
const LANE_COLORS = ['#00f0ff', '#ff2bd6', '#8b5cff', '#ffe566'];

/**
 * @type {Record<'einfach'|'mittel'|'schwer'|'baba', object>}
 */
export const PULSE_DIFFICULTIES = {
  einfach: {
    id: 'einfach',
    label: 'Einfach',
    blurb: 'Weite Fenster · ruhiger Beat · wenige Holds',
    lanes: 3,
    beatEvery: 2,
    skip: 0.08,
    offbeat: 0,
    holdChance: 0.08,
    laneJump: 0.28,
    perfectMs: 130,
    goodMs: 240,
    travelSec: 1.9,
    syncMax: 100,
    missDrain: 9,
    perfectHeal: 7,
    goodHeal: 3,
    burstMisses: 6,
    burstWindow: 7,
    comboEvery: 5,
  },
  mittel: {
    id: 'mittel',
    label: 'Mittel',
    blurb: 'Dichter · erste Holds · normaler Takt',
    lanes: 4,
    beatEvery: 1,
    skip: 0.22,
    offbeat: 0.04,
    holdChance: 0.16,
    laneJump: 0.42,
    perfectMs: 100,
    goodMs: 180,
    travelSec: 1.45,
    syncMax: 100,
    missDrain: 14,
    perfectHeal: 5,
    goodHeal: 2,
    burstMisses: 5,
    burstWindow: 6,
    comboEvery: 4,
  },
  schwer: {
    id: 'schwer',
    label: 'Schwer',
    blurb: 'Enger Takt · mehr Holds · Bahnwechsel',
    lanes: 4,
    beatEvery: 1,
    skip: 0.08,
    offbeat: 0.14,
    holdChance: 0.28,
    laneJump: 0.58,
    perfectMs: 72,
    goodMs: 128,
    travelSec: 1.15,
    syncMax: 100,
    missDrain: 20,
    perfectHeal: 4,
    goodHeal: 2,
    burstMisses: 4,
    burstWindow: 4.5,
    comboEvery: 3,
  },
  baba: {
    id: 'baba',
    label: 'Baba',
    blurb: '⚠ Extrem · enge Fenster · viele Holds',
    lanes: 4,
    beatEvery: 1,
    skip: 0.02,
    offbeat: 0.28,
    holdChance: 0.4,
    laneJump: 0.74,
    perfectMs: 48,
    goodMs: 88,
    travelSec: 0.88,
    syncMax: 100,
    missDrain: 28,
    perfectHeal: 3,
    goodHeal: 1,
    burstMisses: 3,
    burstWindow: 3.5,
    comboEvery: 2,
  },
};

/** Daily Beat is always the Schwer chart. The track still comes from dailyPool. */
export const PULSE_DAILY_DIFFICULTY = 'schwer';

/** @param {unknown} id */
export function getPulseDifficulty(id) {
  return PULSE_DIFFICULTIES[normalizeDifficulty(id)];
}

/**
 * Subtle speed color only. Difficulty itself picks a different file.
 * @param {string} file
 */
export function pulsePlaybackRate(file) {
  const n = hashSeed(`orbit-pulse-rate:${file}`) % 31;
  return 1 + n / 1000;
}

export function pulseTrackUrl(file) {
  return `/pulse-music/${file}`;
}

/**
 * Primary (roll < 0.5) or a random alt. Daily ignores the roll and uses the date.
 * @param {object} manifest
 * @param {{ difficulty?: string, daily?: boolean, dailyDate?: string, rng?: () => number }} [opts]
 */
export function selectPulseTrack(manifest, opts = {}) {
  const daily = !!opts.daily;
  if (daily) {
    const pool = Array.isArray(manifest?.dailyPool) ? manifest.dailyPool : [];
    const date = opts.dailyDate || '1970-01-01';
    const rng = mulberry32(hashSeed(`orbit-pulse-daily:${date}`));
    const file = pool[Math.floor(rng() * pool.length)] || '';
    return {
      file,
      meta: manifest?.tracks?.[file] || null,
      difficulty: PULSE_DAILY_DIFFICULTY,
      daily: true,
      dailyDate: date,
    };
  }
  const id = normalizeDifficulty(opts.difficulty);
  const list = manifest?.byDifficulty?.[id] || [];
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  let file = list[0] || '';
  if (list.length > 1 && rng() >= 0.5) {
    file = list[1 + Math.floor(rng() * (list.length - 1))];
  }
  return {
    file,
    meta: manifest?.tracks?.[file] || null,
    difficulty: id,
    daily: false,
    dailyDate: null,
  };
}

/**
 * Beat grid from BPM + duration. Seed is difficulty + track id + optional daily date.
 * Notes before the travel window are skipped so the first circle can approach.
 * @param {{ bpm: number, durationSec: number, difficulty: string, trackId: string, dailyDate?: string }} spec
 */
export function buildBeatChart(spec) {
  const cfg = getPulseDifficulty(spec.difficulty);
  const bpm = Math.max(40, Number(spec.bpm) || 110);
  const durationSec = Math.max(4, Number(spec.durationSec) || 30);
  const beat = 60 / bpm;
  const seed = hashSeed(
    `orbit-pulse-chart:${cfg.id}:${spec.trackId || 'track'}:${spec.dailyDate || 'free'}`
  );
  const rng = mulberry32(seed);
  const minTime = cfg.travelSec * 0.92;
  const end = Math.max(minTime + beat, durationSec - 0.85);
  /** @type {{ time: number, lane: number, hold: boolean, endTime: number }[]} */
  const notes = [];
  let lane = Math.floor(rng() * cfg.lanes);

  const overlaps = (laneIndex, time, endTime) =>
    notes.some(
      (n) => n.lane === laneIndex && time < n.endTime + 0.16 && endTime > n.time - 0.16
    );

  const place = (time) => {
    if (time < minTime || time > end) return;
    let next = lane;
    if (rng() < cfg.laneJump && cfg.lanes > 1) {
      const jump = 1 + Math.floor(rng() * (cfg.lanes - 1));
      next = (lane + jump) % cfg.lanes;
    }
    const wantHold = rng() < cfg.holdChance;
    let holdBeats = wantHold ? (rng() < 0.35 ? 2 : 1) : 0;
    let endTime = time + holdBeats * beat;
    if (holdBeats > 0 && endTime > end) {
      holdBeats = 0;
      endTime = time;
    }
    if (overlaps(next, time, endTime)) {
      if (overlaps(lane, time, time)) return;
      next = lane;
      holdBeats = 0;
      endTime = time;
    }
    notes.push({
      time,
      lane: next,
      hold: holdBeats > 0,
      endTime: holdBeats > 0 ? endTime : time,
    });
    lane = next;
  };

  let index = 0;
  for (let t = 0; t <= end; t += beat, index++) {
    const onGrid = index % cfg.beatEvery === 0;
    if (onGrid && rng() >= cfg.skip) place(t);
    if (cfg.offbeat > 0 && rng() < cfg.offbeat) place(t + beat * 0.5);
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  return { notes, bpm, beatSec: beat, travelSec: cfg.travelSec, lanes: cfg.lanes, durationSec };
}

/**
 * @param {object} manifest
 * @param {{ difficulty?: string, daily?: boolean, dailyDate?: string, rng?: () => number }} [opts]
 */
export function preparePulseRun(manifest, opts = {}) {
  const picked = selectPulseTrack(manifest, opts);
  const meta = picked.meta || {};
  const chart = buildBeatChart({
    bpm: Number(meta.bpmEstimate) || 110,
    durationSec: Number(meta.durationSec) || 55,
    difficulty: picked.difficulty,
    trackId: picked.file || 'track',
    dailyDate: picked.daily ? picked.dailyDate || '' : '',
  });
  return {
    ...picked,
    url: pulseTrackUrl(picked.file),
    playbackRate: pulsePlaybackRate(picked.file || 'track'),
    chart,
  };
}

/** @param {number} deltaMs @param {string|{ perfectMs: number, goodMs: number }} difficultyOrCfg */
export function judgeHit(deltaMs, difficultyOrCfg) {
  const cfg =
    typeof difficultyOrCfg === 'string' || difficultyOrCfg == null
      ? getPulseDifficulty(difficultyOrCfg)
      : difficultyOrCfg;
  const ad = Math.abs(Number(deltaMs) || 0);
  if (ad <= cfg.perfectMs) return 'perfect';
  if (ad <= cfg.goodMs) return 'good';
  return 'miss';
}

/** @param {number} combo @param {{ comboEvery: number }} cfg */
export function pulseMultiplier(combo, cfg) {
  const n = Math.max(0, Math.floor(combo) || 0);
  if (n <= 0) return 1;
  const every = Math.max(1, cfg?.comboEvery || 4);
  return Math.min(COMBO_MAX, 1 + Math.floor((n - 1) / every));
}

/**
 * @param {object} stats
 * @param {'perfect'|'good'|'miss'} judgment
 * @param {object} cfg
 */
export function applyPulseHit(stats, judgment, cfg) {
  const next = {
    orbs: Math.max(0, Math.floor(stats.orbs) || 0),
    combo: Math.max(0, Math.floor(stats.combo) || 0),
    comboBonus: Math.max(0, Math.floor(stats.comboBonus) || 0),
    nearMisses: Math.max(0, Math.floor(stats.nearMisses) || 0),
    sync: Number.isFinite(stats.sync) ? stats.sync : cfg.syncMax,
    survivalMs: Math.max(0, Math.floor(stats.survivalMs) || 0),
    comboPeak: Math.max(1, Math.floor(stats.comboPeak) || 1),
    perfects: Math.max(0, Math.floor(stats.perfects) || 0),
    goods: Math.max(0, Math.floor(stats.goods) || 0),
    misses: Math.max(0, Math.floor(stats.misses) || 0),
  };
  if (judgment === 'miss') {
    next.combo = 0;
    next.sync = Math.max(0, next.sync - cfg.missDrain);
    next.misses += 1;
  } else {
    next.orbs += 1;
    if (judgment === 'good') {
      next.nearMisses += 1;
      next.goods += 1;
      next.sync = Math.min(cfg.syncMax, next.sync + cfg.goodHeal);
    } else {
      next.perfects += 1;
      next.combo += 1;
      const mult = pulseMultiplier(next.combo, cfg);
      next.comboPeak = Math.max(next.comboPeak, mult);
      if (mult > 1) next.comboBonus += (mult - 1) * COMBO_STEP;
      next.sync = Math.min(cfg.syncMax, next.sync + cfg.perfectHeal);
    }
  }
  next.score = computeScore(next.survivalMs, next.orbs, next.comboBonus, next.nearMisses);
  return next;
}

/** Sync empty, or too many misses inside the burst window. */
export function pulseShouldFail(stats, now, cfg) {
  if ((Number(stats.sync) || 0) <= 0) return true;
  const windowSec = cfg.burstWindow;
  const recent = (stats.missTimes || []).filter((t) => now - t <= windowSec && now - t >= 0);
  return recent.length >= cfg.burstMisses;
}

export function formatPulseFormula(survivalMs, orbs, comboBonus, nearMisses, score) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  const parts = [`${t}s × 10`, `${o} Treffer × 100`];
  if (cb > 0) parts.push(`Combo +${cb}`);
  if (nm > 0) parts.push(`${nm} Gut × ${NEAR_MISS_POINTS}`);
  return `${parts.join(' + ')} = ${score ?? computeScore(survivalMs, orbs, cb, nm)}`;
}

let manifestPromise = null;
let cachedManifest = null;

export function preloadPulseManifest() {
  if (cachedManifest) return Promise.resolve(cachedManifest);
  if (!manifestPromise) {
    manifestPromise = fetch('/pulse-music/manifest.json')
      .then((res) => {
        if (!res.ok) throw new Error('pulse manifest');
        return res.json();
      })
      .then((data) => {
        cachedManifest = data;
        return data;
      })
      .catch((err) => {
        manifestPromise = null;
        throw err;
      });
  }
  return manifestPromise;
}

export class PulseGame {
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
    this.difficultyId = 'mittel';
    this.cfg = getPulseDifficulty('mittel');
    this._bound = false;
    this._overTimer = 0;
    this._forcedTime = null;
    this.stars = [];
    this.resetState();
  }

  /** @param {unknown} id */
  setDifficulty(id) {
    this.difficultyId = normalizeDifficulty(id);
    this.cfg = getPulseDifficulty(this.difficultyId);
  }

  resetState() {
    const cfg = this.cfg || getPulseDifficulty('mittel');
    this.notes = [];
    this.particles = [];
    this.floatTexts = [];
    this.orbsCollected = 0;
    this.survivalMs = 0;
    this.score = 0;
    this.comboBonus = 0;
    this.nearMisses = 0;
    this.combo = 0;
    this.comboPeak = 1;
    this.perfects = 0;
    this.goods = 0;
    this.misses = 0;
    this.sync = cfg.syncMax;
    this.missTimes = [];
    this.alive = true;
    this.cleared = false;
    this.daily = false;
    this.dailyDate = null;
    this.trackFile = '';
    this.trackUrl = '';
    this.playbackRate = 1;
    this.durationSec = 55;
    this.travelSec = cfg.travelSec;
    this.beatSec = 60 / 110;
    this._fallbackTime = 0;
    this.shake = 0;
    this.flash = 0;
    this.focusLane = 0;
    this.held = [false, false, false, false];
    this.keys = [false, false, false, false];
    this.pointers = new Map();
    this.hitY = 0;
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
    this.hitY = Math.min(this.h * 0.78, this.h - 108);
    if (this.stars.length === 0) this.seedStars();
  }

  seedStars() {
    this.stars = [];
    for (let i = 0; i < 56; i++) {
      this.stars.push({
        x: Math.random() * (this.w || 390),
        y: Math.random() * (this.h || 800),
        r: 0.4 + Math.random() * 1.4,
        a: 0.25 + Math.random() * 0.6,
        tw: 0.5 + Math.random() * 2,
        ph: Math.random() * TWO_PI,
      });
    }
  }

  laneCount() {
    return this.cfg?.lanes || 4;
  }

  laneX(index) {
    const n = this.laneCount();
    const pad = Math.max(36, this.w * 0.1);
    const span = Math.max(1, this.w - pad * 2);
    if (n === 1) return this.w / 2;
    return pad + (span * index) / (n - 1);
  }

  laneAt(clientX) {
    const rect = this.canvas.getBoundingClientRect?.() || { left: 0, width: this.w || 1 };
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * this.w;
    let best = 0;
    let bestD = Infinity;
    const n = this.laneCount();
    for (let i = 0; i < n; i++) {
      const d = Math.abs(this.laneX(i) - x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  songTime() {
    if (this._forcedTime != null) return this._forcedTime;
    const t = this.audio?.clipTime?.();
    if (typeof t === 'number' && t > 0.001) return t;
    return this._fallbackTime;
  }

  /**
   * @param {{ difficulty?: string, daily?: boolean, dailyDate?: string, manifest?: object, rng?: () => number, silent?: boolean }} [opts]
   */
  start(opts = {}) {
    const diff = opts.daily ? PULSE_DAILY_DIFFICULTY : opts.difficulty || this.difficultyId;
    this.setDifficulty(diff);
    clearTimeout(this._overTimer);
    this.resetState();
    this.resize();
    this.daily = !!opts.daily;
    this.dailyDate = opts.daily ? opts.dailyDate || null : null;
    this.bindInput();
    this.running = true;
    this.paused = false;
    this.alive = true;
    this.lastTs = 0;
    this._fallbackTime = 0;
    const arm = (manifest) => {
      if (!this.running) return;
      const run = preparePulseRun(manifest, {
        difficulty: this.difficultyId,
        daily: this.daily,
        dailyDate: this.dailyDate || '',
        rng: opts.rng,
      });
      this.trackFile = run.file;
      this.trackUrl = run.url;
      this.playbackRate = run.playbackRate;
      this.durationSec = run.chart.durationSec;
      this.travelSec = run.chart.travelSec;
      this.beatSec = run.chart.beatSec;
      this.notes = run.chart.notes.map((n) => ({
        ...n,
        resolved: false,
        holding: false,
        judgment: null,
        flash: 0,
      }));
      if (!opts.silent) {
        this.audio?.stopMusic?.();
        this.audio?.playClip?.(run.url, { playbackRate: run.playbackRate });
      }
      this.syncScore();
      this.emitHud();
    };
    if (opts.manifest) arm(opts.manifest);
    else if (cachedManifest) arm(cachedManifest);
    else {
      preloadPulseManifest()
        .then((manifest) => arm(manifest))
        .catch(() => {
          /* Chart still runs on the fallback clock if the pack is missing. */
        });
    }
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
    this.audio?.stopClip?.();
    this.notes = [];
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
  }

  setPaused(p) {
    this.paused = !!p;
    if (this.paused) {
      this.held = [false, false, false, false];
      this.keys = [false, false, false, false];
      this.pointers.clear();
      this.audio?.pauseClip?.();
    } else if (this.running && this.alive) {
      this.audio?.resumeClip?.();
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
    if (!this.paused && dt > 0 && this.alive) this.update(dt);
    else if (!this.alive) this.fadeFx(Math.max(0, dt));
    this.draw();
    if (this.running) this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    if (this._forcedTime == null) {
      const media = this.audio?.clipTime?.();
      if (typeof media === 'number' && media > 0.001) this._fallbackTime = media;
      else this._fallbackTime += dt;
    }
    const now = this.songTime();
    this.survivalMs = Math.max(0, Math.floor(now * 1000));
    this.resolveNotes(now);
    this.syncScore();
    if (this.alive && pulseShouldFail({ sync: this.sync, missTimes: this.missTimes }, now, this.cfg)) {
      this.finish('sync');
    } else if (this.alive && this.trackFinished(now)) {
      this.finish('clear');
    }
    this.fadeFx(dt);
    this.emitHud();
  }

  trackFinished(now) {
    if (this.audio?.clipEnded?.()) return true;
    return this.notes.length > 0 && now >= this.durationSec - 0.05;
  }

  resolveNotes(now) {
    const goodSec = this.cfg.goodMs / 1000;
    for (const note of this.notes) {
      if (note.resolved) continue;
      if (note.holding && now >= note.endTime) {
        this.commit(note, note.judgment || 'good', now);
        continue;
      }
      if (!note.holding && now > note.time + goodSec) {
        this.commit(note, 'miss', now);
      }
    }
  }

  tryHit(lane) {
    if (!this.alive || this.paused) return;
    const index = Math.floor(lane);
    if (index < 0 || index >= this.laneCount()) return;
    this.focusLane = index;
    const now = this.songTime();
    const goodSec = this.cfg.goodMs / 1000;
    let best = null;
    let bestAbs = Infinity;
    for (const note of this.notes) {
      if (note.resolved || note.holding || note.lane !== index) continue;
      const delta = now - note.time;
      if (delta < -goodSec || delta > goodSec) continue;
      const ad = Math.abs(delta);
      if (ad < bestAbs) {
        best = note;
        bestAbs = ad;
      }
    }
    if (!best) return;
    const judgment = judgeHit((now - best.time) * 1000, this.cfg);
    if (judgment === 'miss') return;
    if (best.hold) {
      best.holding = true;
      best.judgment = judgment;
      best.flash = 0.25;
      return;
    }
    this.commit(best, judgment, now);
  }

  tryRelease(lane) {
    if (!this.alive) return;
    const index = Math.floor(lane);
    const now = this.songTime();
    const goodSec = this.cfg.goodMs / 1000;
    for (const note of this.notes) {
      if (note.resolved || !note.holding || note.lane !== index) continue;
      const early = note.endTime - now;
      if (early > goodSec) this.commit(note, 'miss', now);
      else this.commit(note, note.judgment || 'good', now);
    }
  }

  commit(note, judgment, now) {
    if (note.resolved) return;
    note.resolved = true;
    note.holding = false;
    note.judgment = judgment;
    note.flash = 0.35;
    const x = this.laneX(note.lane);
    if (judgment === 'miss') {
      this.missTimes.push(now);
      this.audio?.hit?.();
      this.shake = Math.max(this.shake, 0.7);
      this.flash = 0.4;
      this.floatText(x, this.hitY - 36, 'DANEBEN', '#ff4d6d');
    } else if (judgment === 'good') {
      this.audio?.nearMiss?.();
      this.floatText(x, this.hitY - 36, 'GUT', '#ffe566');
      this.burst(x, this.hitY, LANE_COLORS[note.lane] || '#ffe566', 8);
    } else {
      const mult = pulseMultiplier(this.combo + 1, this.cfg);
      this.audio?.collect?.(mult);
      if (mult >= 4) this.audio?.combo?.(mult);
      this.floatText(x, this.hitY - 42, mult > 1 ? `PERFEKT x${mult}` : 'PERFEKT', '#7dffa8');
      this.burst(x, this.hitY, '#7dffa8', 12);
    }
    const next = applyPulseHit(
      {
        orbs: this.orbsCollected,
        combo: this.combo,
        comboBonus: this.comboBonus,
        nearMisses: this.nearMisses,
        sync: this.sync,
        survivalMs: Math.floor(now * 1000),
        comboPeak: this.comboPeak,
        perfects: this.perfects,
        goods: this.goods,
        misses: this.misses,
      },
      judgment,
      this.cfg
    );
    this.orbsCollected = next.orbs;
    this.combo = next.combo;
    this.comboBonus = next.comboBonus;
    this.nearMisses = next.nearMisses;
    this.sync = next.sync;
    this.survivalMs = next.survivalMs;
    this.comboPeak = next.comboPeak;
    this.perfects = next.perfects;
    this.goods = next.goods;
    this.misses = next.misses;
    this.score = next.score;
  }

  syncScore() {
    this.score = computeScore(this.survivalMs, this.orbsCollected, this.comboBonus, this.nearMisses);
  }

  multiplier() {
    return pulseMultiplier(this.combo, this.cfg);
  }

  emitHud() {
    this.onHud?.({
      score: this.score,
      orbs: this.orbsCollected,
      time: this.survivalMs / 1000,
      combo: this.multiplier(),
      comboCount: this.combo,
      sync: this.sync,
      syncMax: this.cfg.syncMax,
      difficulty: this.difficultyId,
      daily: this.daily,
      dailyDate: this.dailyDate,
      cleared: this.cleared,
    });
  }

  finish(reason) {
    if (!this.alive) return;
    this.alive = false;
    this.cleared = reason === 'clear';
    this.syncScore();
    this.audio?.pauseClip?.();
    if (this.cleared) this.audio?.powerup?.('shield');
    else {
      this.shake = 1;
      this.flash = 0.55;
    }
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
      game: 'pulse',
      score: this.score,
      survivalMs,
      orbs: this.orbsCollected,
      comboBonus: this.comboBonus,
      nearMisses: this.nearMisses,
      difficulty: this.daily ? PULSE_DAILY_DIFFICULTY : this.difficultyId,
      daily: this.daily,
      dailyDate: this.daily ? this.dailyDate : null,
      comboPeak: this.comboPeak,
      perfects: this.perfects,
      goods: this.goods,
      misses: this.misses,
      cleared: this.cleared,
      trackFile: this.trackFile,
      formula: formatPulseFormula(
        survivalMs,
        this.orbsCollected,
        this.comboBonus,
        this.nearMisses,
        this.score
      ),
    };
  }

  fadeFx(dt) {
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.flash = Math.max(0, this.flash - dt * 1.5);
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
      const s = 24 + Math.random() * 80;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.3 + Math.random() * 0.25,
        r: 1.2 + Math.random() * 1.6,
        color,
      });
    }
  }

  floatText(x, y, text, color) {
    this.floatTexts.push({ x, y, text, color, life: 0.65, vy: -32 });
  }

  yAt(time, now) {
    const approach = (time - now) / Math.max(0.2, this.travelSec || this.cfg.travelSec);
    const spawnY = -28;
    return this.hitY - approach * (this.hitY - spawnY);
  }

  bindInput() {
    if (this._bound) return;
    this._onKeyDown = (e) => {
      if (!this.running || this.paused) return;
      const lane = laneFromCode(e.code);
      if (lane != null) {
        e.preventDefault();
        if (lane >= this.laneCount()) return;
        if (e.repeat) return;
        this.keys[lane] = true;
        this.held[lane] = true;
        this.tryHit(lane);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        const focus = Math.min(this.focusLane, this.laneCount() - 1);
        this.keys[focus] = true;
        this.held[focus] = true;
        this.tryHit(focus);
        return;
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const dir = e.code === 'ArrowLeft' ? -1 : 1;
        const n = this.laneCount();
        this.focusLane = (this.focusLane + dir + n) % n;
      }
    };
    this._onKeyUp = (e) => {
      const lane = laneFromCode(e.code);
      if (lane != null) {
        this.keys[lane] = false;
        if (![...this.pointers.values()].includes(lane)) {
          this.held[lane] = false;
          this.tryRelease(lane);
        }
        return;
      }
      if (e.code === 'Space') {
        const focus = Math.min(this.focusLane, this.laneCount() - 1);
        this.keys[focus] = false;
        if (![...this.pointers.values()].includes(focus)) {
          this.held[focus] = false;
          this.tryRelease(focus);
        }
      }
    };
    this._onPointerDown = (e) => {
      if (!this.running || this.paused) return;
      const lane = this.laneAt(e.clientX);
      this.pointers.set(e.pointerId, lane);
      this.held[lane] = true;
      this.focusLane = lane;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.tryHit(lane);
    };
    this._onPointerUp = (e) => {
      const lane = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (lane == null) return;
      if (!this.keys[lane] && ![...this.pointers.values()].includes(lane)) {
        this.held[lane] = false;
        this.tryRelease(lane);
      }
    };
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerUp);
    this._bound = true;
  }

  unbindInput() {
    if (!this._bound) return;
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    this.canvas.removeEventListener('pointercancel', this._onPointerUp);
    this.held = [false, false, false, false];
    this.keys = [false, false, false, false];
    this.pointers.clear();
    this._bound = false;
  }

  drawIdle() {
    if (!this.w) this.resize();
    const prev = this._fallbackTime;
    this._fallbackTime = (performance.now() / 1000) % 8;
    this.draw();
    this._fallbackTime = prev;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.w) return;
    const { w, h } = this;
    let ox = 0;
    let oy = 0;
    if (this.shake > 0) {
      ox = (Math.random() - 0.5) * this.shake * 8;
      oy = (Math.random() - 0.5) * this.shake * 5;
    }
    ctx.save();
    ctx.translate(ox, oy);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#070816');
    g.addColorStop(0.55, '#120818');
    g.addColorStop(1, '#050510');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, w + 40, h + 40);

    const t = performance.now() / 1000;
    for (const s of this.stars) {
      ctx.globalAlpha = s.a * (0.45 + 0.55 * Math.sin(t * s.tw + s.ph));
      ctx.fillStyle = '#f4e9ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const now = this._forcedTime != null ? this._forcedTime : this.songTime();
    const beat = this.beatSec || 0.5;
    const phase = beat > 0 ? (now % beat) / beat : 0;
    const pulse = 1 + (1 - phase) * 0.08;
    const n = this.laneCount();
    const ringR = Math.max(22, Math.min(34, w / (n + 3)));

    for (let i = 0; i < n; i++) {
      const x = this.laneX(i);
      const color = LANE_COLORS[i] || '#00f0ff';
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 72);
      ctx.lineTo(x, this.hitY);
      ctx.stroke();

      const focused = i === this.focusLane;
      ctx.beginPath();
      ctx.arc(x, this.hitY, ringR * (focused ? pulse : 1), 0, TWO_PI);
      ctx.strokeStyle = color;
      ctx.globalAlpha = focused ? 0.95 : 0.55;
      ctx.lineWidth = focused ? 4 : 2.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = focused ? 18 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      if (this.held[i]) {
        ctx.beginPath();
        ctx.arc(x, this.hitY, ringR * 0.55, 0, TWO_PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    for (const note of this.notes) {
      if (note.resolved && (note.flash || 0) <= 0) continue;
      const x = this.laneX(note.lane);
      const color = LANE_COLORS[note.lane] || '#00f0ff';
      const headY = note.holding ? this.hitY : this.yAt(note.time, now);
      const tailY = this.yAt(note.endTime, now);
      if (!note.holding && headY > this.hitY + ringR + 30) continue;
      if (headY < -80 && tailY < -80) continue;
      ctx.globalAlpha = note.resolved ? Math.max(0, note.flash || 0) : 1;
      if (note.hold) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(x, Math.min(headY, tailY));
        ctx.lineTo(x, Math.max(headY, tailY));
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, tailY, 7, 0, TWO_PI);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, headY, note.hold ? ringR * 0.72 : ringR * 0.78, 0, TWO_PI);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.globalAlpha = note.resolved ? Math.max(0, note.flash || 0) : 0.92;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, headY, 5, 0, TWO_PI);
      ctx.fillStyle = '#fff';
      ctx.fill();
      if (note.flash) note.flash = Math.max(0, note.flash - 0.02);
    }

    const syncFrac = Math.max(0, Math.min(1, this.sync / (this.cfg.syncMax || 100)));
    const barW = Math.min(w - 48, 280);
    const barX = (w - barW) / 2;
    const barY = Math.min(h - 36, this.hitY + ringR + 28);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(barX, barY, barW, 6);
    ctx.fillStyle = syncFrac < 0.35 ? '#ff4d6d' : '#00f0ff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;
    ctx.fillRect(barX, barY, barW * syncFrac, 6);
    ctx.shadowBlur = 0;

    const mult = this.multiplier();
    const meterW = barW;
    const seg = meterW / 4;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i < mult - 1 ? '#ff2bd6' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(barX + i * seg + 2, barY + 12, seg - 4, 4);
    }

    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life * 2);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, TWO_PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const ft of this.floatTexts) {
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.fillStyle = ft.color;
      ctx.font = '700 14px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 77, 109, ${this.flash * 0.35})`;
      ctx.fillRect(-20, -20, w + 40, h + 40);
    }
    ctx.restore();
  }
}

function laneFromCode(code) {
  if (code === 'KeyA' || code === 'Digit1') return 0;
  if (code === 'KeyS' || code === 'Digit2') return 1;
  if (code === 'KeyD' || code === 'Digit3') return 2;
  if (code === 'KeyF' || code === 'Digit4') return 3;
  return null;
}
