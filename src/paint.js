/**
 * Orbit Paint — region paint-by-number.
 * Pictures are original shaped regions (SVG paths), lazy-loaded from /paint.
 * A region's number is its palette index (1-based). Filling sticks only when
 * the selected number matches. Progress is a 0/1 mask stored locally.
 */
import { dailyRng } from './rng.js';
import { CATEGORIES, PICTURES } from './paint-manifest.js';

export { CATEGORIES, PICTURES };

export const STORAGE_KEY = 'orbit-paint-v2';
export const LEGACY_KEY = 'orbit-paint-v1';

const DIFFICULTY = {
  leicht: 'Leicht',
  mittel: 'Mittel',
  schwer: 'Schwer',
};

export function difficultyLabel(id) {
  return DIFFICULTY[id] || id;
}

export function categoryLabel(id) {
  return CATEGORIES.find((entry) => entry.id === id)?.title || id;
}

/** @param {string} id */
export function pictureById(id) {
  return PICTURES.find((picture) => picture.id === id) || null;
}

/** @param {{ regions?: unknown[], regionCount?: number }} picture */
export function regionCountOf(picture) {
  if (picture?.regions) return picture.regions.length;
  return picture?.regionCount || 0;
}

/**
 * Bild des Tages: stable pick from the built-in gallery for a UTC date.
 * @param {string} dateStr YYYY-MM-DD
 * @param {readonly {id: string}[]} [list]
 */
export function dailyPicture(dateStr, list = PICTURES) {
  const rng = dailyRng(`orbit-paint:${dateStr}`);
  const index = Math.floor(rng() * list.length) % list.length;
  return list[index];
}

/** @param {string} dateStr */
export function formatDailyLabel(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dt);
}

/** @param {number} ms */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Faster than a relaxed par (0.8s per region) scores above 1000.
 * @param {number} elapsedMs
 * @param {number} regions
 */
export function completionScore(elapsedMs, regions) {
  const ms = Math.max(1000, Math.floor(Number(elapsedMs) || 0));
  const par = Math.max(1, Math.floor(regions)) * 800;
  return Math.max(50, Math.min(9999, Math.round((par / ms) * 1000)));
}

/**
 * @param {{ regions: { n: number }[] }} picture
 * @param {Uint8Array} filled
 * @param {number} index
 * @param {number} color
 * @returns {'painted'|'filled'|'wrong'|'out'}
 */
export function paintRegion(picture, filled, index, color) {
  if (!picture?.regions || index < 0 || index >= picture.regions.length) return 'out';
  if (filled[index]) return 'filled';
  if (picture.regions[index].n !== color) return 'wrong';
  filled[index] = 1;
  return 'painted';
}

/** @param {{ regions: { n: number }[] }} picture @param {Uint8Array} filled @param {number} color */
export function colorDone(picture, filled, color) {
  let any = false;
  for (let i = 0; i < picture.regions.length; i++) {
    if (picture.regions[i].n !== color) continue;
    any = true;
    if (!filled[i]) return false;
  }
  return any;
}

/** @param {{ regions?: { n: number }[], regionCount?: number }} picture @param {Uint8Array} filled */
export function isComplete(picture, filled) {
  const len = regionCountOf(picture);
  if (!filled || filled.length !== len || !len) return false;
  for (let i = 0; i < len; i++) if (!filled[i]) return false;
  return true;
}

/** @param {{ colors: { hex: string, name: string }[], regions: { n: number }[] }} picture @param {Uint8Array} filled */
export function colorProgress(picture, filled) {
  const totals = new Uint16Array(picture.colors.length);
  const done = new Uint16Array(picture.colors.length);
  for (let i = 0; i < picture.regions.length; i++) {
    const k = picture.regions[i].n - 1;
    if (k < 0 || k >= totals.length) continue;
    totals[k] += 1;
    if (filled[i]) done[k] += 1;
  }
  return picture.colors.map((color, idx) => ({
    n: idx + 1,
    hex: color.hex,
    name: color.name,
    total: totals[idx],
    done: done[idx],
    complete: totals[idx] > 0 && done[idx] === totals[idx],
  }));
}

/** @param {{ regions?: unknown[], regionCount?: number }} picture @param {Uint8Array} filled */
export function filledCount(picture, filled) {
  let n = 0;
  const len = Math.min(regionCountOf(picture), filled?.length || 0);
  for (let i = 0; i < len; i++) if (filled[i]) n += 1;
  return n;
}

/**
 * Next open region of a color, in picture order, wrapping after `after`.
 * @param {{ regions: { n: number, x: number, y: number }[] }} picture
 * @param {Uint8Array} filled
 * @param {number} color
 * @param {number} [after]
 */
export function hintTarget(picture, filled, color, after = -1) {
  /** @type {number[]} */
  const open = [];
  for (let i = 0; i < picture.regions.length; i++) {
    if (picture.regions[i].n === color && !filled[i]) open.push(i);
  }
  if (!open.length) return null;
  const next = open.find((i) => i > after);
  const index = next == null ? open[0] : next;
  const region = picture.regions[index];
  return { index, x: region.x, y: region.y };
}

/** @param {{ colors: { hex: string, name: string }[], regions: { n: number }[] }} picture @param {Uint8Array} filled @param {number} [prefer] */
export function firstOpenColor(picture, filled, prefer = 0) {
  const progress = colorProgress(picture, filled);
  if (prefer) {
    const current = progress.find((entry) => entry.n === prefer && !entry.complete);
    if (current) return prefer;
  }
  const open = progress.find((entry) => !entry.complete);
  return open ? open.n : progress[0]?.n || 1;
}

/** @param {Uint8Array} filled */
export function maskToString(filled) {
  let out = '';
  for (let i = 0; i < filled.length; i++) out += filled[i] ? '1' : '0';
  return out;
}

/** @param {string} str @param {number} length */
export function stringToMask(str, length) {
  if (typeof str !== 'string' || str.length !== length) return null;
  const mask = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const ch = str[i];
    if (ch !== '0' && ch !== '1') return null;
    mask[i] = ch === '1' ? 1 : 0;
  }
  return mask;
}

export function emptyStore() {
  return { v: 2, pics: {} };
}

/** v1 tile masks are a different picture model and are ignored. */
export function parseStore(raw) {
  if (!raw || typeof raw !== 'string') return emptyStore();
  try {
    const data = JSON.parse(raw);
    if (!data || data.v !== 2 || !data.pics || typeof data.pics !== 'object') return emptyStore();
    return { v: 2, pics: data.pics };
  } catch {
    return emptyStore();
  }
}

/** True when the retired tile save actually painted something. */
export function legacyHasProgress(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const data = JSON.parse(raw);
    const pics = data?.pics;
    if (!pics || typeof pics !== 'object') return false;
    return Object.values(pics).some((slot) => typeof slot?.mask === 'string' && slot.mask.includes('1'));
  } catch {
    return false;
  }
}

/**
 * @param {ReturnType<typeof emptyStore>} store
 * @param {{ id: string, regions?: unknown[], regionCount?: number }} picture
 */
export function readPictureState(store, picture) {
  const slot = store?.pics?.[picture.id];
  const len = regionCountOf(picture);
  const mask = stringToMask(slot?.mask, len) || new Uint8Array(len);
  const elapsedMs = Math.max(0, Math.floor(Number(slot?.elapsedMs) || 0));
  const bestMs = slot?.bestMs == null ? null : Math.max(0, Math.floor(Number(slot.bestMs)));
  const bestScore = slot?.bestScore == null ? null : Math.max(0, Math.floor(Number(slot.bestScore)));
  return {
    mask,
    elapsedMs,
    bestMs: Number.isFinite(bestMs) ? bestMs : null,
    bestScore: Number.isFinite(bestScore) ? bestScore : null,
    done: isComplete(picture, mask),
  };
}

/**
 * @param {ReturnType<typeof emptyStore>} store
 * @param {{ id: string }} picture
 * @param {{ mask: Uint8Array, elapsedMs: number, bestMs: number | null, bestScore: number | null }} state
 */
export function writePictureState(store, picture, state) {
  return {
    v: 2,
    pics: {
      ...store.pics,
      [picture.id]: {
        mask: maskToString(state.mask),
        elapsedMs: Math.max(0, Math.floor(state.elapsedMs || 0)),
        bestMs: state.bestMs,
        bestScore: state.bestScore,
      },
    },
  };
}

/**
 * @param {{ elapsedMs: number, bestMs: number | null, bestScore: number | null }} state
 * @param {{ regions?: unknown[], regionCount?: number }} picture
 */
export function finishState(state, picture) {
  const elapsedMs = Math.max(0, Math.floor(state.elapsedMs || 0));
  const score = completionScore(elapsedMs, regionCountOf(picture));
  const previous = state.bestMs;
  const isBest = previous == null || elapsedMs <= previous;
  const bestMs = previous == null ? elapsedMs : Math.min(previous, elapsedMs);
  const bestScore = state.bestScore == null ? score : Math.max(state.bestScore, score);
  return { elapsedMs, score, bestMs, bestScore, isBest };
}

function probePicture() {
  return {
    id: 'probe',
    title: 'Probe',
    category: 'mandala',
    difficulty: 'leicht',
    regionCount: 4,
    colors: [
      { hex: '#112233', name: 'A' },
      { hex: '#445566', name: 'B' },
    ],
    regions: [
      { n: 1, d: 'M0 0 Z', x: 10, y: 12, r: 8 },
      { n: 1, d: 'M1 0 Z', x: 30, y: 12, r: 8 },
      { n: 2, d: 'M2 0 Z', x: 50, y: 12, r: 8 },
      { n: 1, d: 'M3 0 Z', x: 70, y: 12, r: 8 },
    ],
  };
}

export function selfCheck() {
  if (PICTURES.length < 12 || PICTURES.length > 16) {
    throw new Error(`expected 12–16 pictures, got ${PICTURES.length}`);
  }
  const ids = new Set();
  const cats = new Set();
  for (const picture of PICTURES) {
    if (ids.has(picture.id)) throw new Error(`duplicate ${picture.id}`);
    ids.add(picture.id);
    cats.add(picture.category);
    if (!DIFFICULTY[picture.difficulty]) throw new Error(`${picture.id} difficulty`);
    if (picture.regionCount < 80 || picture.regionCount > 400) {
      throw new Error(`${picture.id} region count ${picture.regionCount}`);
    }
    if (picture.colorCount < 6) throw new Error(`${picture.id} palette`);
    const box = String(picture.viewBox).split(/[\s,]+/).map(Number);
    if (!(box[2] > 0) || !(box[3] > 0)) throw new Error(`${picture.id} viewBox`);
  }
  if (!cats.has('mandala') || !cats.has('manga') || !cats.has('maerchen')) {
    throw new Error('missing a picture category');
  }

  const probe = probePicture();
  const filled = new Uint8Array(probe.regions.length);
  if (paintRegion(probe, filled, 2, 1) !== 'wrong') throw new Error('wrong number must not fill');
  if (filled[2] !== 0) throw new Error('wrong fill stuck');
  if (paintRegion(probe, filled, 2, 2) !== 'painted') throw new Error('matching number fills');
  if (paintRegion(probe, filled, 2, 2) !== 'filled') throw new Error('second tap stays filled');
  if (paintRegion(probe, filled, -1, 1) !== 'out') throw new Error('outside is out');
  if (paintRegion(probe, filled, 99, 1) !== 'out') throw new Error('high index is out');

  const run = new Uint8Array(probe.regions.length);
  if (paintRegion(probe, run, 0, 1) !== 'painted') throw new Error('drag start');
  if (paintRegion(probe, run, 1, 1) !== 'painted') throw new Error('drag continues on the same number');
  if (paintRegion(probe, run, 2, 1) !== 'wrong') throw new Error('drag does not leak');
  if (!colorDone(probe, run, 1)) {
    if (paintRegion(probe, run, 3, 1) !== 'painted') throw new Error('last cell of a color');
  }
  if (!colorDone(probe, run, 1)) throw new Error('color completes');
  if (colorDone(probe, run, 2)) throw new Error('other color still open');

  const all = new Uint8Array(probe.regions.length);
  for (let i = 0; i < all.length; i++) {
    if (paintRegion(probe, all, i, probe.regions[i].n) !== 'painted') throw new Error('full fill');
  }
  if (!isComplete(probe, all)) throw new Error('complete picture');
  if (!colorProgress(probe, all).every((entry) => entry.complete)) throw new Error('every color completes');

  const partial = new Uint8Array(probe.regions.length);
  const hintA = hintTarget(probe, partial, 1, -1);
  const hintB = hintTarget(probe, partial, 1, hintA.index);
  if (!hintA || !hintB || hintB.index <= hintA.index) throw new Error('hint walks forward');
  if (hintA.x !== probe.regions[hintA.index].x) throw new Error('hint uses the region label');
  partial[hintA.index] = 1;
  const hintC = hintTarget(probe, partial, 1, hintA.index);
  if (!hintC || hintC.index === hintA.index) throw new Error('hint skips filled regions');
  if (firstOpenColor(probe, all) !== 1) throw new Error('finished picture keeps a color');
  const fresh = new Uint8Array(probe.regions.length);
  fresh[0] = 1;
  if (colorDone(probe, fresh, 1)) throw new Error('one region does not finish a color');

  const fast = completionScore(20_000, 100);
  const slow = completionScore(60_000, 100);
  if (!(fast > slow)) throw new Error('faster time scores higher');
  if (completionScore(0, 10) !== completionScore(1000, 10)) throw new Error('score floors tiny times');

  const day = dailyPicture('2026-10-03');
  const again = dailyPicture('2026-10-03');
  if (day.id !== again.id || !pictureById(day.id)) throw new Error('daily picture is stable');
  if (formatDailyLabel('2026-10-03') !== '3. Oktober') throw new Error('daily label');
  if (formatDuration(65_400) !== '1:05') throw new Error('duration format');

  const mask = maskToString(all);
  const back = stringToMask(mask, all.length);
  if (!back || back.some((bit, i) => bit !== all[i])) throw new Error('mask roundtrip');
  if (stringToMask('01', all.length) !== null) throw new Error('short mask rejected');
  if (stringToMask('2'.repeat(all.length), all.length) !== null) throw new Error('bad mask rejected');

  let store = emptyStore();
  store = writePictureState(store, probe, {
    mask: all,
    elapsedMs: 12_000,
    bestMs: 12_000,
    bestScore: completionScore(12_000, probe.regions.length),
  });
  const read = readPictureState(store, probe);
  if (!read.done || read.elapsedMs !== 12_000 || read.bestMs !== 12_000) throw new Error('state roundtrip');
  const finished = finishState({ elapsedMs: 20_000, bestMs: 12_000, bestScore: 100 }, probe);
  if (finished.isBest || finished.bestMs !== 12_000) throw new Error('slower run keeps the best time');
  const better = finishState({ elapsedMs: 9_000, bestMs: 12_000, bestScore: 100 }, probe);
  if (!better.isBest || better.bestMs !== 9_000 || !(better.score > 100)) throw new Error('faster run is a best');
  if (readPictureState(parseStore('{'), probe).done) throw new Error('bad json is an empty picture');
  if (readPictureState(parseStore('{"v":2,"pics":{"probe":{"mask":"nope"}}}'), probe).mask[0] !== 0) {
    throw new Error('corrupt mask is ignored');
  }
  const v1 = '{"v":1,"pics":{"herz":{"mask":"1111","elapsedMs":9}}}';
  if (readPictureState(parseStore(v1), probe).mask.some((bit) => bit)) {
    throw new Error('v1 tile progress is not imported');
  }
  if (!legacyHasProgress(v1)) throw new Error('v1 progress is detectable');
  if (legacyHasProgress('{"v":1,"pics":{"herz":{"mask":"0000"}}}')) throw new Error('blank v1 is not progress');
  if (legacyHasProgress('{')) throw new Error('broken legacy is ignored');

  return true;
}
