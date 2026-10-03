/**
 * Orbit Paint — paint-by-number pictures and rules.
 * Grids are original pixel art authored for this game (no external assets).
 * A cell's digit is its palette number (1-based). Filling only sticks when
 * the selected number matches. Progress is a 0/1 mask the UI stores locally.
 */
import { dailyRng } from './rng.js';

/**
 * @typedef {{ hex: string, name: string }} PaintColor
 * @typedef {{
 *   id: string,
 *   title: string,
 *   difficulty: 'leicht' | 'mittel' | 'schwer',
 *   colors: PaintColor[],
 *   cols: number,
 *   rows: number,
 *   cells: Uint8Array,
 * }} PaintPicture
 */

const DIFFICULTY = {
  leicht: 'Leicht',
  mittel: 'Mittel',
  schwer: 'Schwer',
};

/**
 * @param {{ id: string, title: string, difficulty: 'leicht'|'mittel'|'schwer', colors: PaintColor[], rows: string[] }} spec
 * @returns {PaintPicture}
 */
function definePicture(spec) {
  const rows = spec.rows;
  if (!rows.length) throw new Error(`${spec.id} has no rows`);
  const cols = rows[0].length;
  if (cols < 8 || rows.length < 8) throw new Error(`${spec.id} is too small`);
  const cells = new Uint8Array(cols * rows.length);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    if (row.length !== cols) {
      throw new Error(`${spec.id} row ${y} is ${row.length}, expected ${cols}`);
    }
    for (let x = 0; x < cols; x++) {
      const n = row.charCodeAt(x) - 48;
      if (n < 1 || n > spec.colors.length) {
        throw new Error(`${spec.id} bad color '${row[x]}' at ${x},${y}`);
      }
      cells[y * cols + x] = n;
    }
  }
  const used = new Set(cells);
  for (let n = 1; n <= spec.colors.length; n++) {
    if (!used.has(n)) throw new Error(`${spec.id} never uses color ${n}`);
  }
  for (const color of spec.colors) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color.hex)) {
      throw new Error(`${spec.id} bad hex ${color.hex}`);
    }
  }
  if (!DIFFICULTY[spec.difficulty]) throw new Error(`${spec.id} bad difficulty`);
  return Object.freeze({
    id: spec.id,
    title: spec.title,
    difficulty: spec.difficulty,
    colors: Object.freeze(spec.colors.map((color) => Object.freeze({ ...color }))),
    cols,
    rows: rows.length,
    cells,
  });
}

/** @type {PaintPicture[]} */
export const PICTURES = Object.freeze([
  definePicture({
    id: 'herz',
    title: 'Herz',
    difficulty: 'leicht',
    colors: [
      { hex: '#140818', name: 'Nacht' },
      { hex: '#ff2b6a', name: 'Herz' },
      { hex: '#ffd0e4', name: 'Glanz' },
    ],
    rows: [
      '111111111111',
      '112211112211',
      '122321222221',
      '122222222221',
      '122222222221',
      '112222222211',
      '111222222111',
      '111122221111',
      '111112211111',
      '111111211111',
      '111111111111',
      '111111111111',
    ],
  }),
  definePicture({
    id: 'mond',
    title: 'Mond',
    difficulty: 'leicht',
    colors: [
      { hex: '#070714', name: 'All' },
      { hex: '#d8e8ff', name: 'Stern' },
      { hex: '#6e6e9a', name: 'Schatten' },
      { hex: '#f4f1ff', name: 'Mond' },
    ],
    rows: [
      '111111111111',
      '111144441111',
      '111444444211',
      '114444433311',
      '144444333111',
      '144443331111',
      '144444333111',
      '114444433311',
      '111444444111',
      '111144441111',
      '111111211111',
      '111111111111',
    ],
  }),
  definePicture({
    id: 'pilz',
    title: 'Pilz',
    difficulty: 'leicht',
    colors: [
      { hex: '#1a1030', name: 'Himmel' },
      { hex: '#1e8a45', name: 'Wiese' },
      { hex: '#f3e2c4', name: 'Stiel' },
      { hex: '#e23a4a', name: 'Hut' },
      { hex: '#fff4ea', name: 'Tupfen' },
    ],
    rows: [
      '111111111111',
      '111144444111',
      '111445544411',
      '114455445541',
      '144444444441',
      '144444444441',
      '111444444111',
      '111113331111',
      '111113331111',
      '111113331111',
      '111113331111',
      '112222222211',
      '122222222221',
      '222222222222',
    ],
  }),
  definePicture({
    id: 'sonne',
    title: 'Sonne',
    difficulty: 'leicht',
    colors: [
      { hex: '#100818', name: 'All' },
      { hex: '#ff7a32', name: 'Strahlen' },
      { hex: '#ffd24a', name: 'Sonne' },
      { hex: '#fff3b0', name: 'Kern' },
    ],
    rows: [
      '1111111111111111',
      '1111111212111111',
      '1111112222111111',
      '1111123333211111',
      '1121233443321211',
      '1112334444332111',
      '1223344444433221',
      '1123344444433211',
      '1112334444332111',
      '1121233443321211',
      '1111123333211111',
      '1111112222111111',
      '1111111212111111',
      '1111111111111111',
      '1111111111111111',
      '1111111111111111',
    ],
  }),
  definePicture({
    id: 'rakete',
    title: 'Rakete',
    difficulty: 'mittel',
    colors: [
      { hex: '#12082a', name: 'Himmel' },
      { hex: '#ffb15a', name: 'Flamme' },
      { hex: '#fff1a8', name: 'Feuer' },
      { hex: '#e8eef8', name: 'Rumpf' },
      { hex: '#3ec8ff', name: 'Fenster' },
      { hex: '#ff2bd6', name: 'Flosse' },
    ],
    rows: [
      '111111111111',
      '111111441111',
      '111114444111',
      '111144444411',
      '111145544111',
      '111145544111',
      '111144444411',
      '111144444411',
      '111144444411',
      '116644444661',
      '166444444661',
      '111144444111',
      '111113333111',
      '111112222111',
      '111111221111',
      '111111111111',
    ],
  }),
  definePicture({
    id: 'fisch',
    title: 'Fisch',
    difficulty: 'mittel',
    colors: [
      { hex: '#062033', name: 'Wasser' },
      { hex: '#1a6a8a', name: 'Schimmer' },
      { hex: '#ff8a3a', name: 'Körper' },
      { hex: '#ffe0a8', name: 'Bauch' },
      { hex: '#ff4d9a', name: 'Flosse' },
      { hex: '#141018', name: 'Auge' },
    ],
    rows: [
      '1111111111111111',
      '1121111111111211',
      '1111115533331111',
      '1111153333333111',
      '1115333336333311',
      '1153333333334411',
      '1133333333344411',
      '1115333333333111',
      '1111153333331111',
      '1111111551111111',
      '1121111111111211',
      '2222222222222222',
    ],
  }),
  definePicture({
    id: 'komet',
    title: 'Komet',
    difficulty: 'mittel',
    colors: [
      { hex: '#080818', name: 'All' },
      { hex: '#9ad7ff', name: 'Stern' },
      { hex: '#3a2068', name: 'Schweif' },
      { hex: '#c9b6ff', name: 'Licht' },
      { hex: '#fff6c8', name: 'Kern' },
    ],
    rows: [
      '1111111111111111',
      '1111111111111411',
      '1111111111114411',
      '1111111111144411',
      '1111111111444111',
      '1111111133444111',
      '1111113344451111',
      '1111334445111111',
      '1113344411111111',
      '1133441111112111',
      '1334111111111111',
      '1341111111111111',
      '1111111111111111',
      '1112111111111211',
    ],
  }),
  definePicture({
    id: 'orbit',
    title: 'Orbit',
    difficulty: 'mittel',
    colors: [
      { hex: '#070714', name: 'All' },
      { hex: '#c9e7ff', name: 'Stern' },
      { hex: '#4a2078', name: 'Schatten' },
      { hex: '#c44bff', name: 'Planet' },
      { hex: '#ffb0f0', name: 'Glanz' },
      { hex: '#5cefff', name: 'Ring' },
    ],
    rows: [
      '111111111111111111',
      '111111111211111111',
      '111111666666111111',
      '111166666666661111',
      '111663344443366111',
      '116664455544466611',
      '166644555554446661',
      '166644444444446661',
      '116664444444466611',
      '111663344443366111',
      '111166666666661111',
      '111111666666111111',
      '111111111111111111',
      '111211111111111211',
    ],
  }),
  definePicture({
    id: 'blume',
    title: 'Blume',
    difficulty: 'mittel',
    colors: [
      { hex: '#140818', name: 'Nacht' },
      { hex: '#3dff9a', name: 'Blatt' },
      { hex: '#1f8a4a', name: 'Stiel' },
      { hex: '#ff4fa3', name: 'Blüte' },
      { hex: '#ffd0ea', name: 'Hell' },
      { hex: '#ffe566', name: 'Mitte' },
    ],
    rows: [
      '1111111111111111',
      '1111114444111111',
      '1111144554411111',
      '1111445555441111',
      '1111446666441111',
      '1144446666444411',
      '1455446666445541',
      '1455444444445541',
      '1144444333444411',
      '1111144333441111',
      '1111114334111111',
      '1111112332111111',
      '1111122222211111',
      '1111221111221111',
      '1112211111122111',
      '1122111111112211',
    ],
  }),
  definePicture({
    id: 'alien',
    title: 'Alien',
    difficulty: 'mittel',
    colors: [
      { hex: '#090614', name: 'All' },
      { hex: '#7dff6a', name: 'Haut' },
      { hex: '#24963a', name: 'Schatten' },
      { hex: '#f4fff0', name: 'Auge' },
      { hex: '#140818', name: 'Pupille' },
      { hex: '#ff4ad8', name: 'Fühler' },
      { hex: '#1a1028', name: 'Mund' },
    ],
    rows: [
      '1111111111111111',
      '1111116161111111',
      '1111116261111111',
      '1111112221111111',
      '1111122222111111',
      '1111222222211111',
      '1112244224422111',
      '1112255225522111',
      '1111222222211111',
      '1111222772211111',
      '1111122222211111',
      '1111122222211111',
      '1111112222111111',
      '1111132222311111',
      '1111111111111111',
      '1111111111111111',
    ],
  }),
  definePicture({
    id: 'katze',
    title: 'Katze',
    difficulty: 'schwer',
    colors: [
      { hex: '#160818', name: 'Nacht' },
      { hex: '#ffb15a', name: 'Fell' },
      { hex: '#c46a22', name: 'Streifen' },
      { hex: '#ff6a8a', name: 'Ohr' },
      { hex: '#1a1020', name: 'Auge' },
      { hex: '#fff6d0', name: 'Glanz' },
      { hex: '#ff4d6d', name: 'Nase' },
      { hex: '#ffe6c4', name: 'Brust' },
    ],
    rows: [
      '11111111111111111111',
      '11112211111111122111',
      '11114221111111242111',
      '11112221111111222111',
      '11112222222222222111',
      '11112225622265222111',
      '11112222277222222111',
      '11112222222222222111',
      '11112228888822222111',
      '11111222222222221111',
      '11111223333332221111',
      '11111122333322211111',
      '11111112222222111111',
      '11111112211222111111',
      '11111113311331111111',
      '11111111111111111111',
    ],
  }),
  definePicture({
    id: 'station',
    title: 'Station',
    difficulty: 'schwer',
    colors: [
      { hex: '#070714', name: 'All' },
      { hex: '#c9dcff', name: 'Stern' },
      { hex: '#5c6c80', name: 'Rumpf' },
      { hex: '#d5e2ee', name: 'Hülle' },
      { hex: '#3ad7ff', name: 'Fenster' },
      { hex: '#ffd24a', name: 'Solar' },
      { hex: '#ff2bd6', name: 'Bake' },
    ],
    rows: [
      '11111111111111111111',
      '11111111117111111111',
      '11111111114111111111',
      '11666611144411166661',
      '16666644444444666611',
      '11111114455441111111',
      '11111114444441111111',
      '11111111444411111111',
      '11111111333311111111',
      '11111111141111111111',
      '11121111111111111211',
      '11111111111111111111',
      '11111111111111111111',
      '11111111112111111111',
      '11111111111111111111',
      '11111111111111111111',
    ],
  }),
]);

export const STORAGE_KEY = 'orbit-paint-v1';

export function difficultyLabel(id) {
  return DIFFICULTY[id] || id;
}

/** @param {string} id */
export function pictureById(id) {
  return PICTURES.find((picture) => picture.id === id) || null;
}

/**
 * Bild des Tages: stable pick from the built-in gallery for a UTC date.
 * @param {string} dateStr YYYY-MM-DD
 * @param {readonly PaintPicture[]} [list]
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
 * Faster than a relaxed par (0.8s per cell) scores above 1000.
 * @param {number} elapsedMs
 * @param {number} cells
 */
export function completionScore(elapsedMs, cells) {
  const ms = Math.max(1000, Math.floor(Number(elapsedMs) || 0));
  const par = Math.max(1, Math.floor(cells)) * 800;
  return Math.max(50, Math.min(9999, Math.round((par / ms) * 1000)));
}

/**
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
export function lineCells(x0, y0, x1, y1) {
  /** @type {{x:number,y:number}[]} */
  const cells = [];
  let x = x0 | 0;
  let y = y0 | 0;
  const tx = x1 | 0;
  const ty = y1 | 0;
  const dx = Math.abs(tx - x);
  const dy = Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    cells.push({ x, y });
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (cells.length > 4096) break;
  }
  return cells;
}

/**
 * @param {PaintPicture} picture
 * @param {Uint8Array} filled
 * @param {number} x
 * @param {number} y
 * @param {number} color
 * @returns {'painted'|'filled'|'wrong'|'out'}
 */
export function paintCell(picture, filled, x, y, color) {
  if (x < 0 || y < 0 || x >= picture.cols || y >= picture.rows) return 'out';
  const i = y * picture.cols + x;
  if (filled[i]) return 'filled';
  if (picture.cells[i] !== color) return 'wrong';
  filled[i] = 1;
  return 'painted';
}

/**
 * @param {PaintPicture} picture
 * @param {Uint8Array} filled
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} color
 */
export function applyStroke(picture, filled, x0, y0, x1, y1, color) {
  let painted = 0;
  let wrong = 0;
  /** @type {{x:number,y:number}[]} */
  const wrongCells = [];
  for (const cell of lineCells(x0, y0, x1, y1)) {
    const result = paintCell(picture, filled, cell.x, cell.y, color);
    if (result === 'painted') painted += 1;
    else if (result === 'wrong') {
      wrong += 1;
      wrongCells.push(cell);
    }
  }
  return {
    painted,
    wrong,
    wrongCells,
    colorDone: colorDone(picture, filled, color),
    pictureDone: isComplete(picture, filled),
  };
}

/** @param {PaintPicture} picture @param {Uint8Array} filled @param {number} color */
export function colorDone(picture, filled, color) {
  for (let i = 0; i < picture.cells.length; i++) {
    if (picture.cells[i] === color && !filled[i]) return false;
  }
  return true;
}

/** @param {PaintPicture} picture @param {Uint8Array} filled */
export function isComplete(picture, filled) {
  if (!filled || filled.length !== picture.cells.length) return false;
  for (let i = 0; i < filled.length; i++) if (!filled[i]) return false;
  return picture.cells.length > 0;
}

/** @param {PaintPicture} picture @param {Uint8Array} filled */
export function colorProgress(picture, filled) {
  const totals = new Uint16Array(picture.colors.length);
  const done = new Uint16Array(picture.colors.length);
  for (let i = 0; i < picture.cells.length; i++) {
    const k = picture.cells[i] - 1;
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

/** @param {PaintPicture} picture @param {Uint8Array} filled */
export function filledCount(picture, filled) {
  let n = 0;
  const len = Math.min(picture.cells.length, filled.length);
  for (let i = 0; i < len; i++) if (filled[i]) n += 1;
  return n;
}

/**
 * Next hint cell for a color, in reading order, wrapping after `after`.
 * @param {PaintPicture} picture
 * @param {Uint8Array} filled
 * @param {number} color
 * @param {number} [after]
 */
export function hintTarget(picture, filled, color, after = -1) {
  /** @type {number[]} */
  const open = [];
  for (let i = 0; i < picture.cells.length; i++) {
    if (picture.cells[i] === color && !filled[i]) open.push(i);
  }
  if (!open.length) return null;
  const next = open.find((i) => i > after);
  const index = next == null ? open[0] : next;
  return {
    index,
    x: index % picture.cols,
    y: Math.floor(index / picture.cols),
  };
}

/** @param {PaintPicture} picture @param {Uint8Array} filled @param {number} [prefer] */
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
  return { v: 1, pics: {} };
}

/** @param {string | null | undefined} raw */
export function parseStore(raw) {
  if (!raw || typeof raw !== 'string') return emptyStore();
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.pics || typeof data.pics !== 'object') {
      return emptyStore();
    }
    return { v: 1, pics: data.pics };
  } catch {
    return emptyStore();
  }
}

/**
 * @param {ReturnType<typeof emptyStore>} store
 * @param {PaintPicture} picture
 */
export function readPictureState(store, picture) {
  const slot = store?.pics?.[picture.id];
  const len = picture.cols * picture.rows;
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
 * @param {PaintPicture} picture
 * @param {{ mask: Uint8Array, elapsedMs: number, bestMs: number | null, bestScore: number | null }} state
 */
export function writePictureState(store, picture, state) {
  return {
    v: 1,
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
 * @param {PaintPicture} picture
 */
export function finishState(state, picture) {
  const elapsedMs = Math.max(0, Math.floor(state.elapsedMs || 0));
  const score = completionScore(elapsedMs, picture.cols * picture.rows);
  const previous = state.bestMs;
  const isBest = previous == null || elapsedMs <= previous;
  const bestMs = previous == null ? elapsedMs : Math.min(previous, elapsedMs);
  const bestScore = state.bestScore == null ? score : Math.max(state.bestScore, score);
  return { elapsedMs, score, bestMs, bestScore, isBest };
}

export function selfCheck() {
  if (PICTURES.length < 8 || PICTURES.length > 12) {
    throw new Error(`expected 8–12 pictures, got ${PICTURES.length}`);
  }
  const ids = new Set();
  for (const picture of PICTURES) {
    if (ids.has(picture.id)) throw new Error(`duplicate ${picture.id}`);
    ids.add(picture.id);
    if (picture.cells.length !== picture.cols * picture.rows) {
      throw new Error(`${picture.id} cell count`);
    }
    const progress = colorProgress(picture, new Uint8Array(picture.cells.length));
    if (progress.some((entry) => entry.done !== 0 || entry.total < 1)) {
      throw new Error(`${picture.id} empty color`);
    }
  }

  const herz = pictureById('herz');
  if (!herz) throw new Error('missing herz');
  const filled = new Uint8Array(herz.cells.length);
  const bg = herz.cells[0];
  let other = -1;
  let otherAt = 0;
  for (let i = 0; i < herz.cells.length; i++) {
    if (herz.cells[i] !== bg) {
      other = herz.cells[i];
      otherAt = i;
      break;
    }
  }
  const ox = otherAt % herz.cols;
  const oy = Math.floor(otherAt / herz.cols);
  if (paintCell(herz, filled, ox, oy, bg) !== 'wrong') throw new Error('wrong number must not fill');
  if (filled[otherAt] !== 0) throw new Error('wrong fill stuck');
  if (paintCell(herz, filled, ox, oy, other) !== 'painted') throw new Error('matching number fills');
  if (paintCell(herz, filled, ox, oy, other) !== 'filled') throw new Error('second tap stays filled');
  if (paintCell(herz, filled, -1, 0, bg) !== 'out') throw new Error('outside is out');

  const run = new Uint8Array(herz.cells.length);
  const stroke = applyStroke(herz, run, 0, 0, herz.cols - 1, 0, herz.cells[0]);
  if (stroke.painted < 2) throw new Error('drag paints a run of the selected number');
  if (run.some((bit, i) => bit && herz.cells[i] !== herz.cells[0])) {
    throw new Error('stroke leaked into another number');
  }

  const all = new Uint8Array(herz.cells.length);
  for (let i = 0; i < all.length; i++) {
    const x = i % herz.cols;
    const y = Math.floor(i / herz.cols);
    if (paintCell(herz, all, x, y, herz.cells[i]) !== 'painted') throw new Error('full fill');
  }
  if (!isComplete(herz, all)) throw new Error('complete picture');
  const doneProg = colorProgress(herz, all);
  if (!doneProg.every((entry) => entry.complete)) throw new Error('every color completes');

  const partial = new Uint8Array(herz.cells.length);
  const hintA = hintTarget(herz, partial, 1, -1);
  const hintB = hintTarget(herz, partial, 1, hintA.index);
  if (!hintA || !hintB || hintB.index <= hintA.index) throw new Error('hint walks forward');
  partial[hintA.index] = 1;
  const hintC = hintTarget(herz, partial, 1, hintA.index);
  if (!hintC || hintC.index === hintA.index) throw new Error('hint skips filled cells');
  if (firstOpenColor(herz, all, 1) !== 1 && colorDone(herz, all, 1)) {
    /* color 1 is done; first open falls through to color 1 only if none remain */
  }
  if (firstOpenColor(herz, all) !== 1) throw new Error('finished picture keeps a color');
  const fresh = new Uint8Array(herz.cells.length);
  fresh[0] = 1;
  if (colorDone(herz, fresh, herz.cells[0])) {
    /* only if color 0's cell count is 1, which it is not */
    throw new Error('one cell does not finish a color');
  }

  if (lineCells(0, 0, 2, 0).length !== 3) throw new Error('horizontal line');
  if (lineCells(0, 0, 0, 0).length !== 1) throw new Error('point line');

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
  store = writePictureState(store, herz, {
    mask: all,
    elapsedMs: 12_000,
    bestMs: 12_000,
    bestScore: completionScore(12_000, herz.cells.length),
  });
  const read = readPictureState(store, herz);
  if (!read.done || read.elapsedMs !== 12_000 || read.bestMs !== 12_000) throw new Error('state roundtrip');
  const finished = finishState({ elapsedMs: 20_000, bestMs: 12_000, bestScore: 100 }, herz);
  if (finished.isBest || finished.bestMs !== 12_000) throw new Error('slower run keeps the best time');
  const better = finishState({ elapsedMs: 9_000, bestMs: 12_000, bestScore: 100 }, herz);
  if (!better.isBest || better.bestMs !== 9_000 || !(better.score > 100)) throw new Error('faster run is a best');
  if (readPictureState(parseStore('{'), herz).done) throw new Error('bad json is an empty picture');
  if (readPictureState(parseStore('{"pics":{"herz":{"mask":"nope"}}}'), herz).mask[0] !== 0) {
    throw new Error('corrupt mask is ignored');
  }

  return true;
}
