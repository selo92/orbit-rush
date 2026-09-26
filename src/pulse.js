/**
 * Orbit Pulse — tap and hold neon circles on the beat.
 *
 * Music comes from `public/pulse-music/manifest.json`. Each difficulty has its
 * own files (quieter LUFS → Einfach, louder → Baba). A normal run plays that
 * pool in order, easiest first, and a clear starts the next track a little
 * harder. Daily Beat stays one track from `dailyPool` (UTC-date seed) and
 * always charts Schwer. A 0–3% playback rate nudge is optional color; it is
 * not how difficulty changes the song.
 *
 * Charts follow `public/pulse-music/beatmaps/<track>.json` (`beatTimes` from
 * t=0 of that mp3). Judgment reads the playing clip's currentTime. BPM is only
 * a label — the grid is never rebuilt from it.
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

/** Pause after a cleared stage before the next track starts. */
export const PULSE_STAGE_GAP_MS = 1100;

/** Pause after the last track of a chained run, before the results screen. */
export const PULSE_RUN_CLEAR_MS = 1000;

const PULSE_TIER_ORDER = ['einfach', 'mittel', 'schwer', 'baba'];

/**
 * Added to `HTMLMediaElement.currentTime` when judging. A small negative value
 * absorbs tap latency so a hit on the audible kick still lands in the window.
 * @type {number} seconds
 */
export const PULSE_AUDIO_OFFSET_SEC = -0.02;

/** Onsets at least this strong may add accents. Off-grid ones only on Schwer/Baba. */
export const PULSE_STRONG_ONSET = 0.55;

/** @param {unknown} id */
export function getPulseDifficulty(id) {
  return PULSE_DIFFICULTIES[normalizeDifficulty(id)];
}

/**
 * Lower is easier. Fewer beats per second first, then a quieter LUFS.
 * Density leads so the next song in a pool is busier, not only louder.
 * @param {object|null|undefined} meta
 */
export function pulseTrackEase(meta) {
  const lufs = Number(meta?.lufs);
  const duration = Math.max(1, Number(meta?.durationSec) || 1);
  const density = (Number(meta?.beatCount) || 0) / duration;
  const loud = Number.isFinite(lufs) ? lufs : 0;
  return density * 1000 + loud;
}

/**
 * One difficulty's tracks, easiest → harder. Stays inside that pool.
 * @param {object} manifest
 * @param {string} difficulty
 */
export function orderPulsePool(manifest, difficulty) {
  const id = normalizeDifficulty(difficulty);
  const list = Array.isArray(manifest?.byDifficulty?.[id]) ? [...manifest.byDifficulty[id]] : [];
  list.sort((a, b) => {
    const delta = pulseTrackEase(manifest?.tracks?.[a]) - pulseTrackEase(manifest?.tracks?.[b]);
    if (delta !== 0) return delta;
    return String(a).localeCompare(String(b));
  });
  return list;
}

/**
 * Display name. Manifest `title` wins; otherwise "Einfach 1" from the file name.
 * @param {string} file
 * @param {object|null|undefined} [meta]
 */
export function pulseTrackTitle(file, meta) {
  const custom = typeof meta?.title === 'string' ? meta.title.trim() : '';
  if (custom) return custom;
  const base = String(file || '')
    .split('/')
    .pop()
    .replace(/\.mp3$/i, '');
  const match = /^(einfach|mittel|schwer|baba)-(\d+)$/i.exec(base);
  if (!match) return base || 'Track';
  const labels = { einfach: 'Einfach', mittel: 'Mittel', schwer: 'Schwer', baba: 'Baba' };
  return `${labels[match[1].toLowerCase()]} ${match[2]}`;
}

/**
 * Named-tier chart plus a small step per cleared stage.
 * Stage 0 matches the tier. Later stages stay short of the next tier.
 * @param {string} difficulty
 * @param {number} stageIndex 0-based
 */
export function pulseStageConfig(difficulty, stageIndex) {
  const base = getPulseDifficulty(difficulty);
  const step = Math.max(0, Math.floor(Number(stageIndex) || 0));
  const cfg = { ...base, stage: step };
  if (step <= 0) return cfg;
  const tier = PULSE_TIER_ORDER.indexOf(base.id);
  const next =
    tier >= 0 && tier < PULSE_TIER_ORDER.length - 1 ? PULSE_DIFFICULTIES[PULSE_TIER_ORDER[tier + 1]] : null;

  const windowFloor = (value, nextValue, raw) => {
    if (typeof nextValue !== 'number' || !(nextValue < value)) return raw;
    return Math.max(nextValue + (value - nextValue) * 0.35, raw);
  };

  const perfectRaw = next
    ? base.perfectMs - 6 * step
    : Math.max(base.perfectMs * 0.75, base.perfectMs - 4 * step);
  const goodRaw = next ? base.goodMs - 10 * step : Math.max(base.goodMs * 0.75, base.goodMs - 6 * step);
  const travelRaw = next
    ? base.travelSec - 0.07 * step
    : Math.max(base.travelSec * 0.78, base.travelSec - 0.04 * step);
  cfg.perfectMs = Math.round(windowFloor(base.perfectMs, next?.perfectMs, perfectRaw));
  cfg.goodMs = Math.round(windowFloor(base.goodMs, next?.goodMs, goodRaw));
  cfg.travelSec = +windowFloor(base.travelSec, next?.travelSec, travelRaw).toFixed(3);

  let drain = base.missDrain + step;
  if (next && next.missDrain > base.missDrain) {
    const gapCap = Math.floor(next.missDrain - (next.missDrain - base.missDrain) * 0.35 + 1e-9);
    drain = Math.min(drain, gapCap, next.missDrain - 1);
    if (drain < base.missDrain) drain = base.missDrain;
  }
  cfg.missDrain = drain;

  const holdRaw = base.holdChance + 0.025 * step;
  const holdCap = next
    ? next.holdChance - (next.holdChance - base.holdChance) * 0.35
    : Math.min(0.55, base.holdChance + 0.12);
  cfg.holdChance = +Math.min(holdRaw, holdCap).toFixed(3);

  const jumpRaw = base.laneJump + 0.035 * step;
  const jumpCap = next
    ? next.laneJump - (next.laneJump - base.laneJump) * 0.35
    : Math.min(0.92, base.laneJump + 0.12);
  cfg.laneJump = +Math.min(jumpRaw, jumpCap).toFixed(3);

  if (step >= 2) {
    const reduced = Math.max(1, base.perfectHeal - 1);
    cfg.perfectHeal = next ? Math.max(next.perfectHeal + 1, reduced) : reduced;
  }

  const burstRaw = base.burstWindow * (1 - 0.04 * step);
  const burstFloor = next
    ? next.burstWindow + (base.burstWindow - next.burstWindow) * 0.35
    : base.burstWindow * 0.78;
  cfg.burstWindow = +Math.max(burstFloor, burstRaw).toFixed(2);
  return cfg;
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

/** Manifest stores `public/pulse-music/beatmaps/<name>.json`. The page loads the URL. */
export function pulseBeatmapUrl(ref) {
  const name = String(ref || '')
    .split('/')
    .filter(Boolean)
    .pop();
  if (!name || !name.endsWith('.json')) return '';
  return `/pulse-music/beatmaps/${name}`;
}

/**
 * Stage track inside one difficulty, easiest first. Daily ignores the chain
 * and picks one file from `dailyPool` with the UTC date.
 * @param {object} manifest
 * @param {{ difficulty?: string, stage?: number, daily?: boolean, dailyDate?: string, rng?: () => number }} [opts]
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
      stage: 0,
      stageCount: 1,
    };
  }
  const id = normalizeDifficulty(opts.difficulty);
  const list = orderPulsePool(manifest, id);
  const requested = Math.max(0, Math.floor(Number(opts.stage) || 0));
  const stage = list.length ? Math.min(requested, list.length - 1) : 0;
  const file = list[stage] || '';
  return {
    file,
    meta: manifest?.tracks?.[file] || null,
    difficulty: id,
    daily: false,
    dailyDate: null,
    stage,
    stageCount: list.length,
  };
}

/**
 * Median gap of an analyzed beat grid, used only as a display/travel hint.
 * @param {number[]} times
 */
function medianBeatSec(times) {
  if (!times || times.length < 2) return 0.5;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] || 0.5;
}

/**
 * Tap/hold chart locked to analyzed `beatTimes` (seconds from audio t=0).
 * Einfach keeps every `beatEvery` beat. Schwer/Baba may add strong onsets.
 * Holds start on a chosen hit and end on a later beatTimes entry (~1–2 bars).
 * A missing beatmap yields an empty chart — BPM is never used to invent hits.
 * Stage 0 is the tier chart. Later stages keep those hits and add more
 * `beatTimes` from the same map, with slightly more holds and lane changes.
 * @param {{ beatTimes?: number[], onsetTimes?: number[], onsetStrengths?: number[], bpm?: number, durationSec?: number, difficulty: string, trackId: string, dailyDate?: string, stage?: number }} spec
 */
export function buildBeatChart(spec) {
  const stage = Math.max(0, Math.floor(Number(spec.stage) || 0));
  const cfg = pulseStageConfig(spec.difficulty, stage);
  const base = getPulseDifficulty(spec.difficulty);
  const durationSec = Math.max(0, Number(spec.durationSec) || 0);
  const raw = Array.isArray(spec.beatTimes) ? spec.beatTimes : [];
  /** @type {number[]} */
  const grid = [];
  for (const value of raw) {
    const t = Number(value);
    if (!Number.isFinite(t) || t < 0) continue;
    if (durationSec > 0 && t > durationSec + 0.02) continue;
    if (grid.length && t - grid[grid.length - 1] < 0.04) continue;
    grid.push(t);
  }
  const beatSec = medianBeatSec(grid);
  const bpm = Number(spec.bpm) || 0;
  if (grid.length === 0) {
    return { notes: [], bpm, beatSec, travelSec: cfg.travelSec, lanes: cfg.lanes, durationSec };
  }

  const seed = hashSeed(
    `orbit-pulse-chart:${base.id}:${spec.trackId || 'track'}:${spec.dailyDate || 'free'}`
  );
  const rng = mulberry32(seed);
  /** @type {Set<number>} */
  const chosen = new Set();
  for (let i = 0; i < grid.length; i++) {
    if (i % base.beatEvery !== 0) continue;
    if (rng() < base.skip) continue;
    chosen.add(i);
  }
  if (stage > 0) {
    const room = [];
    for (let i = 0; i < grid.length; i++) if (!chosen.has(i)) room.push(i);
    const want = Math.min(room.length, Math.max(stage, Math.round(room.length * 0.08 * stage)));
    for (let k = 0; k < want; k++) {
      const index = Math.min(room.length - 1, Math.floor(((k + 0.5) * room.length) / want));
      chosen.add(room[index]);
    }
  }

  /** @type {number[]} */
  const extras = [];
  const allowOffbeat = cfg.id === 'schwer' || cfg.id === 'baba';
  const onsetTimes = Array.isArray(spec.onsetTimes) ? spec.onsetTimes : [];
  const onsetStrengths = Array.isArray(spec.onsetStrengths) ? spec.onsetStrengths : [];
  if (allowOffbeat) {
    const count = Math.min(onsetTimes.length, onsetStrengths.length);
    for (let k = 0; k < count; k++) {
      const t = Number(onsetTimes[k]);
      const strength = Number(onsetStrengths[k]);
      if (!(strength >= PULSE_STRONG_ONSET) || !Number.isFinite(t) || t < grid[0]) continue;
      if (durationSec > 0 && t > durationSec) continue;
      let nearest = 0;
      let nearestD = Infinity;
      for (let i = 0; i < grid.length; i++) {
        const d = Math.abs(grid[i] - t);
        if (d < nearestD) {
          nearestD = d;
          nearest = i;
        }
      }
      if (nearestD <= 0.08) {
        chosen.add(nearest);
        continue;
      }
      if (rng() < cfg.offbeat) extras.push(t);
    }
  }

  /** @type {{ time: number, beatIndex: number }[]} */
  const events = [];
  for (const index of chosen) events.push({ time: grid[index], beatIndex: index });
  for (const time of extras) events.push({ time, beatIndex: -1 });
  events.sort((a, b) => a.time - b.time || a.beatIndex - b.beatIndex);

  /** @type {{ time: number, lane: number, hold: boolean, endTime: number }[]} */
  const notes = [];
  let lane = Math.floor(rng() * cfg.lanes);
  const overlaps = (laneIndex, time, endTime) =>
    notes.some(
      (n) => n.lane === laneIndex && time < n.endTime + 0.12 && endTime > n.time - 0.12
    );

  const holdEnd = (ev, steps) => {
    let endIndex = -1;
    if (ev.beatIndex >= 0) endIndex = Math.min(grid.length - 1, ev.beatIndex + steps);
    else {
      const after = grid.findIndex((b) => b > ev.time + 0.05);
      if (after >= 0) endIndex = Math.min(grid.length - 1, after + steps - 1);
    }
    if (endIndex < 0) return ev.time;
    const end = grid[endIndex];
    return end > ev.time + 0.15 ? end : ev.time;
  };

  for (const ev of events) {
    let next = lane;
    if (rng() < cfg.laneJump && cfg.lanes > 1) {
      const jump = 1 + Math.floor(rng() * (cfg.lanes - 1));
      next = (lane + jump) % cfg.lanes;
    }
    const wantHold = rng() < cfg.holdChance;
    const steps = wantHold ? (rng() < 0.35 ? 8 : 4) : 0;
    const endTime = wantHold ? holdEnd(ev, steps) : ev.time;
    const tryPlace = (laneIndex, end) => {
      const hold = end > ev.time + 0.05;
      const resolvedEnd = hold ? end : ev.time;
      if (overlaps(laneIndex, ev.time, resolvedEnd)) return false;
      notes.push({ time: ev.time, lane: laneIndex, hold, endTime: resolvedEnd });
      lane = laneIndex;
      return true;
    };
    if (tryPlace(next, endTime)) continue;
    if (endTime !== ev.time && tryPlace(next, ev.time)) continue;
    for (let l = 0; l < cfg.lanes; l++) {
      if (tryPlace(l, ev.time)) break;
    }
  }

  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  return { notes, bpm, beatSec, travelSec: cfg.travelSec, lanes: cfg.lanes, durationSec, stage };
}

/**
 * @param {object} manifest
 * @param {{ difficulty?: string, stage?: number, daily?: boolean, dailyDate?: string, rng?: () => number, beatmap?: object }} [opts]
 */
export function preparePulseRun(manifest, opts = {}) {
  const picked = selectPulseTrack(manifest, opts);
  const meta = picked.meta || {};
  const beatmap = opts.beatmap || null;
  const stage = picked.daily ? 0 : picked.stage || 0;
  const chart = buildBeatChart({
    beatTimes: beatmap?.beatTimes,
    onsetTimes: beatmap?.onsetTimes,
    onsetStrengths: beatmap?.onsetStrengths,
    bpm: Number(beatmap?.bpm) || Number(meta.bpmEstimate) || 0,
    durationSec: Number(beatmap?.durationSec) || Number(meta.durationSec) || 0,
    difficulty: picked.difficulty,
    trackId: picked.file || 'track',
    dailyDate: picked.daily ? picked.dailyDate || '' : '',
    stage,
  });
  return {
    ...picked,
    stage,
    stageCount: picked.daily ? 1 : picked.stageCount || 0,
    title: pulseTrackTitle(picked.file, picked.meta),
    url: pulseTrackUrl(picked.file),
    beatmapUrl: pulseBeatmapUrl(meta.beatmap),
    playbackRate: pulsePlaybackRate(picked.file || 'track'),
    chart,
    profile: pulseStageConfig(picked.difficulty, stage),
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
/** @type {Map<string, object>} */
const beatmapCache = new Map();
/** @type {Map<string, Promise<object>>} */
const beatmapPromises = new Map();

/** @param {string} ref manifest beatmap path or URL */
export function preloadPulseBeatmap(ref) {
  const url = pulseBeatmapUrl(ref);
  if (!url || typeof fetch !== 'function') return Promise.resolve(null);
  if (beatmapCache.has(url)) return Promise.resolve(beatmapCache.get(url));
  if (!beatmapPromises.has(url)) {
    const pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('pulse beatmap');
        return res.json();
      })
      .then((data) => {
        beatmapCache.set(url, data);
        return data;
      })
      .catch((err) => {
        beatmapPromises.delete(url);
        throw err;
      });
    beatmapPromises.set(url, pending);
  }
  return beatmapPromises.get(url);
}

/** Test hook: store a beatmap without fetching it. */
export function primePulseBeatmap(ref, data) {
  const url = pulseBeatmapUrl(ref);
  if (!url || !data) return;
  beatmapCache.set(url, data);
}

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
        const tracks = data?.tracks || {};
        for (const meta of Object.values(tracks)) {
          if (meta?.beatmap) preloadPulseBeatmap(meta.beatmap).catch(() => {});
        }
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
    this.trackTitle = '';
    this.trackUrl = '';
    this.playbackRate = 1;
    this.durationSec = 55;
    this.travelSec = cfg.travelSec;
    this.beatSec = 60 / 110;
    this.stageIndex = 0;
    this.stageCount = 1;
    this.stageFiles = [];
    this.bankedSurvivalMs = 0;
    this._stageBanked = false;
    this.celebrating = false;
    this.celebration = null;
    this.manifestRef = null;
    this.runSilent = false;
    this._openingBeatmap = null;
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
    if (this.audio?.hasClip?.()) {
      const t = this.audio.clipTime?.();
      const media = typeof t === 'number' && Number.isFinite(t) ? t : 0;
      return media + PULSE_AUDIO_OFFSET_SEC;
    }
    return this._fallbackTime;
  }

  /**
   * @param {{ difficulty?: string, daily?: boolean, dailyDate?: string, manifest?: object, beatmap?: object, rng?: () => number, silent?: boolean }} [opts]
   */
  start(opts = {}) {
    const diff = opts.daily ? PULSE_DAILY_DIFFICULTY : opts.difficulty || this.difficultyId;
    this.setDifficulty(diff);
    clearTimeout(this._overTimer);
    this.resetState();
    this.resize();
    this.daily = !!opts.daily;
    this.dailyDate = opts.daily ? opts.dailyDate || null : null;
    this.runSilent = !!opts.silent;
    this._openingBeatmap = opts.beatmap || null;
    this.bindInput();
    this.running = true;
    this.paused = false;
    this.alive = true;
    this.lastTs = 0;
    this._fallbackTime = 0;
    this._runToken = (this._runToken || 0) + 1;
    const token = this._runToken;
    const boot = (manifest) => {
      if (!this.running || this._runToken !== token) return;
      this.manifestRef = manifest;
      if (this.daily) {
        const picked = selectPulseTrack(manifest, {
          daily: true,
          dailyDate: this.dailyDate || '',
        });
        this.stageFiles = picked.file ? [picked.file] : [];
      } else {
        this.stageFiles = orderPulsePool(manifest, this.difficultyId);
      }
      this.stageCount = Math.max(1, this.stageFiles.length);
      this.beginStage(0, token);
    };
    if (opts.manifest) boot(opts.manifest);
    else if (cachedManifest) boot(cachedManifest);
    else {
      preloadPulseManifest()
        .then((manifest) => boot(manifest))
        .catch(() => {
          /* No chart until a beatmap exists. The fallback clock is only for tests. */
        });
    }
    this.syncScore();
    this.emitHud();
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    if (typeof requestAnimationFrame === 'function') {
      this.raf = requestAnimationFrame((t) => this.loop(t));
    }
  }

  /**
   * Load one stage without wiping the run score.
   * @param {number} index
   * @param {number} token
   */
  beginStage(index, token) {
    const file = this.stageFiles[index] || '';
    const meta = this.manifestRef?.tracks?.[file] || null;
    const stageForChart = this.daily ? 0 : index;
    this.stageIndex = index;
    this.cfg = pulseStageConfig(this.daily ? PULSE_DAILY_DIFFICULTY : this.difficultyId, stageForChart);
    this.sync = this.cfg.syncMax;
    this.combo = 0;
    this.missTimes = [];
    this.notes = [];
    this.held = [false, false, false, false];
    this.keys = [false, false, false, false];
    this.pointers.clear();
    this._fallbackTime = 0;
    this._forcedTime = null;
    this._stageBanked = false;
    this.alive = true;
    this.cleared = false;
    this.celebrating = false;
    this.celebration = null;
    this.trackFile = file;
    this.trackTitle = pulseTrackTitle(file, meta);
    this.trackUrl = pulseTrackUrl(file);
    this.playbackRate = pulsePlaybackRate(file || 'track');
    this.durationSec = Number(meta?.durationSec) || this.durationSec;
    this.travelSec = this.cfg.travelSec;
    this.survivalMs = this.bankedSurvivalMs;
    if (!this.runSilent && file) {
      this.audio?.stopMusic?.();
      this.audio?.playClip?.(this.trackUrl, { playbackRate: this.playbackRate });
    }
    const applyChart = (beatmap) => {
      if (!this.running || this._runToken !== token) return;
      if (this.stageIndex !== index || this.trackFile !== file) return;
      const chart = buildBeatChart({
        beatTimes: beatmap?.beatTimes,
        onsetTimes: beatmap?.onsetTimes,
        onsetStrengths: beatmap?.onsetStrengths,
        bpm: Number(beatmap?.bpm) || Number(meta?.bpmEstimate) || 0,
        durationSec: Number(beatmap?.durationSec) || Number(meta?.durationSec) || 0,
        difficulty: this.daily ? PULSE_DAILY_DIFFICULTY : this.difficultyId,
        trackId: file || 'track',
        dailyDate: this.daily ? this.dailyDate || '' : '',
        stage: stageForChart,
      });
      this.durationSec = chart.durationSec || this.durationSec;
      this.travelSec = chart.travelSec;
      this.beatSec = chart.beatSec;
      this.notes = chart.notes.map((n) => ({
        ...n,
        resolved: false,
        holding: false,
        judgment: null,
        flash: 0,
      }));
      this.syncScore();
      this.emitHud();
    };
    const cached = beatmapCache.get(pulseBeatmapUrl(meta?.beatmap));
    if (index === 0 && this._openingBeatmap) applyChart(this._openingBeatmap);
    else if (cached) applyChart(cached);
    else if (meta?.beatmap) {
      preloadPulseBeatmap(meta.beatmap)
        .then((beatmap) => applyChart(beatmap))
        .catch(() => applyChart(null));
    } else applyChart(null);
    this.syncScore();
    this.emitHud();
  }

  totalSurvivalMs(now) {
    return this.bankedSurvivalMs + Math.max(0, Math.floor(Number(now) * 1000) || 0);
  }

  /** Fold this stage's clock into the run once, without shrinking the score. */
  bankStageTime() {
    if (this._stageBanked) return;
    this._stageBanked = true;
    const live = Math.max(0, this.songTime());
    const capped = this.durationSec > 0 ? Math.min(live, this.durationSec) : live;
    const ms = Math.max(0, Math.floor(capped * 1000));
    const already = Math.max(0, this.survivalMs - this.bankedSurvivalMs);
    this.bankedSurvivalMs += Math.max(ms, already);
  }

  /**
   * @param {number} ms
   * @param {() => void} fn
   */
  scheduleAfter(ms, fn) {
    clearTimeout(this._overTimer);
    const token = this._runToken;
    const fire = () => {
      if (!this.running || this._runToken !== token) return;
      if (this.paused) {
        this._overTimer = setTimeout(fire, 200);
        return;
      }
      fn();
    };
    this._overTimer = setTimeout(fire, ms);
  }

  advanceStage() {
    if (!this.running || this.daily) return;
    if (this.stageIndex + 1 >= this.stageCount) return;
    this.bankStageTime();
    const token = this._runToken;
    this.beginStage(this.stageIndex + 1, token);
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
    const mediaClock = this._forcedTime == null && !!this.audio?.hasClip?.();
    if (!mediaClock && this._forcedTime == null) this._fallbackTime += dt;
    const now = this.songTime();
    this.survivalMs = this.totalSurvivalMs(now);
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
        survivalMs: this.totalSurvivalMs(now),
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
      stage: this.stageIndex + 1,
      stageCount: this.stageCount,
      trackTitle: this.trackTitle,
      trackFile: this.trackFile,
      celebrating: this.celebrating,
    });
  }

  finish(reason) {
    if (!this.alive) return;
    this.alive = false;
    this.cleared = reason === 'clear';
    this.syncScore();
    this.audio?.pauseClip?.();
    const chained = !this.daily && this.stageCount > 1;
    const advancing = this.cleared && chained && this.stageIndex + 1 < this.stageCount;
    if (this.cleared) this.audio?.powerup?.('shield');
    else {
      this.shake = 1;
      this.flash = 0.55;
    }
    if (advancing) {
      this.celebrating = true;
      this.celebration = {
        kind: 'advance',
        title: 'LEVEL GESCHAFFT',
        sub: `Weiter · Level ${this.stageIndex + 2}`,
      };
    } else if (this.cleared && chained) {
      this.celebrating = true;
      this.celebration = {
        kind: 'done',
        title: 'RUN GESCHAFFT',
        sub: `Level ${this.stageCount}/${this.stageCount}`,
      };
    } else {
      this.celebrating = false;
      this.celebration = null;
    }
    this.emitHud();
    const gap = Number.isFinite(this.stageGapMs)
      ? this.stageGapMs
      : advancing
        ? PULSE_STAGE_GAP_MS
        : this.cleared && chained
          ? PULSE_RUN_CLEAR_MS
          : 650;
    this.scheduleAfter(gap, () => {
      if (advancing) {
        this.advanceStage();
        return;
      }
      const result = this.buildResult();
      this.stop();
      this.onGameOver?.(result);
    });
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
      trackTitle: this.trackTitle,
      stage: this.stageIndex + 1,
      stageCount: this.stageCount,
      stagesCleared: this.cleared ? this.stageIndex + 1 : this.stageIndex,
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
    if (this.celebration) {
      ctx.fillStyle = 'rgba(5, 5, 16, 0.62)';
      ctx.fillRect(-20, -20, w + 40, h + 40);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7dffa8';
      ctx.font = '700 28px Segoe UI, sans-serif';
      ctx.fillText(this.celebration.title, w / 2, h * 0.42);
      ctx.fillStyle = '#ffe566';
      ctx.font = '600 16px Segoe UI, sans-serif';
      ctx.fillText(this.celebration.sub, w / 2, h * 0.42 + 36);
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
