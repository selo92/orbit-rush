/**
 * Orbit Mahjong — solitaire tile matching (Shanghai rules).
 *
 * A tile is free when nothing lies on it and its left side or its right side
 * is open. Flowers match any flower. Seasons match any season. Every deal is
 * built backwards from a cleared board, so a solution always exists.
 *
 * Points use the shared Rush formula so `game=mahjong` passes the D1 check.
 * Leicht is stored as `einfach`. Time on the clock is shown to the player;
 * the submitted seconds only unlock the blitz term and do not reward a slow clear.
 *
 *   score = floor(seconds) × 10 + pairs × 100 + comboBonus + blitz × 75
 */

import { computeScore, COMBO_MAX, COMBO_STEP, NEAR_MISS_POINTS } from './game.js';

export const TILE_W = 2;
export const TILE_H = 2;
export const GAME_ID = 'mahjong';

/** @typedef {'einfach'|'mittel'|'schwer'} MahjongDifficultyId */
/** @typedef {'small'|'medium'|'large'} MahjongSize */
/** @typedef {'dot'|'bamboo'|'char'|'wind'|'dragon'|'flower'|'season'} MahjongSuit */

/**
 * @type {Record<MahjongDifficultyId, {
 *   id: MahjongDifficultyId,
 *   label: string,
 *   blurb: string,
 *   hints: number,
 *   shuffles: number,
 *   size: MahjongSize,
 *   comboSec: number,
 *   blitzSec: number,
 *   attempts: number,
 * }>}
 */
export const MAHJONG_DIFFICULTIES = {
  einfach: {
    id: 'einfach',
    label: 'Leicht',
    blurb: 'Kleineres Brett · 6 Hinweise · 6 Mal mischen',
    hints: 6,
    shuffles: 6,
    size: 'small',
    comboSec: 5,
    blitzSec: 2.6,
    attempts: 4,
  },
  mittel: {
    id: 'mittel',
    label: 'Mittel',
    blurb: 'Mittleres Brett · 3 Hinweise · 3 Mal mischen',
    hints: 3,
    shuffles: 3,
    size: 'medium',
    comboSec: 3.4,
    blitzSec: 1.8,
    attempts: 3,
  },
  schwer: {
    id: 'schwer',
    label: 'Schwer',
    blurb: 'Großes Brett · 1 Hinweis · 1 Mal mischen',
    hints: 1,
    shuffles: 1,
    size: 'large',
    comboSec: 2.2,
    blitzSec: 1.15,
    attempts: 4,
  },
};

const DIFF_IDS = /** @type {const} */ (['einfach', 'mittel', 'schwer']);

/** @param {unknown} id */
export function normalizeMahjongDifficulty(id) {
  const s = typeof id === 'string' ? id.toLowerCase().trim() : '';
  if (s === 'leicht') return 'einfach';
  if (DIFF_IDS.includes(/** @type {MahjongDifficultyId} */ (s))) {
    return /** @type {MahjongDifficultyId} */ (s);
  }
  return 'mittel';
}

/** @param {unknown} id */
export function getMahjongDifficulty(id) {
  return MAHJONG_DIFFICULTIES[normalizeMahjongDifficulty(id)];
}

export const LAYOUTS = [
  {
    id: 'schildkroete',
    label: 'Schildkröte',
    blurb: 'Die klassische Schildkröte',
  },
  {
    id: 'pyramide',
    label: 'Pyramide',
    blurb: 'Stufen bis zur Spitze',
  },
  {
    id: 'drache',
    label: 'Drache',
    blurb: 'Kopf, Flügel, Schweif',
  },
  {
    id: 'festung',
    label: 'Festung',
    blurb: 'Mauern, Türme, Innenhof',
  },
  {
    id: 'schnell',
    label: 'Schnell',
    blurb: 'Kleines Brett fürs Handy',
  },
];

const LAYOUT_IDS = new Set(LAYOUTS.map((l) => l.id));

/** @param {unknown} id */
export function normalizeLayout(id) {
  const s = typeof id === 'string' ? id.toLowerCase().trim() : '';
  if (LAYOUT_IDS.has(s)) return s;
  return 'schildkroete';
}

/** @param {string} id */
export function layoutMeta(id) {
  return LAYOUTS.find((l) => l.id === normalizeLayout(id)) || LAYOUTS[0];
}

/**
 * @param {number} pairs
 * @param {number} comboBonus
 * @param {number} blitzes
 */
export function packMahjongScore(pairs, comboBonus, blitzes) {
  const orbs = Math.max(0, Math.floor(Number(pairs) || 0));
  const maxCombo = orbs * (COMBO_MAX - 1) * COMBO_STEP;
  let cb = Math.max(0, Math.floor(Number(comboBonus) || 0));
  if (cb > maxCombo) cb = maxCombo;
  let nm = Math.max(0, Math.floor(Number(blitzes) || 0));
  let seconds = 0;
  const cap = (s) => Math.max(8, s * 4 + 10);
  while (nm > cap(seconds) && seconds < 5000) seconds += 1;
  if (nm > cap(seconds)) nm = cap(seconds);
  const survivalMs = seconds * 1000;
  return {
    survivalMs,
    orbs,
    comboBonus: cb,
    nearMisses: nm,
    score: computeScore(survivalMs, orbs, cb, nm),
  };
}

/**
 * @param {number} survivalMs
 * @param {number} orbs
 * @param {number} comboBonus
 * @param {number} nearMisses
 * @param {number} [score]
 */
export function formatMahjongFormula(survivalMs, orbs, comboBonus, nearMisses, score) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  const parts = [];
  if (t > 0) parts.push(`${t}s × 10`);
  parts.push(`${o} Paare × 100`);
  if (cb > 0) parts.push(`Kette +${cb}`);
  if (nm > 0) parts.push(`${nm} Blitz × ${NEAR_MISS_POINTS}`);
  return `${parts.join(' + ')} = ${score ?? computeScore(survivalMs, orbs, cb, nm)}`;
}

/** @param {{ suit: string, rank: number }} a @param {{ suit: string, rank: number }} b */
export function facesMatch(a, b) {
  if (!a || !b) return false;
  if (a.suit === 'flower' && b.suit === 'flower') return true;
  if (a.suit === 'season' && b.suit === 'season') return true;
  return a.suit === b.suit && a.rank === b.rank;
}

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b */
export function rectsOverlap(a, b) {
  return a.x < b.x + TILE_W && a.x + TILE_W > b.x && a.y < b.y + TILE_H && a.y + TILE_H > b.y;
}

/** @param {{ x: number, y: number }} a @param {{ x: number, y: number }} b */
function yOverlap(a, b) {
  return a.y < b.y + TILE_H && a.y + TILE_H > b.y;
}

/**
 * Free when no remaining tile overlaps from a higher layer, and at least
 * one side (left or right) has no same-layer neighbour touching it.
 *
 * @param {{ id: number, x: number, y: number, z: number, removed?: boolean, coverIds?: number[], leftIds?: number[], rightIds?: number[] }} tile
 * @param {Array<{ id: number, x: number, y: number, z: number, removed?: boolean }>} tiles
 */
export function isFree(tile, tiles) {
  if (!tile || tile.removed) return false;
  if (tile.coverIds && tile.leftIds && tile.rightIds) {
    const byId = tileById(tiles);
    for (const id of tile.coverIds) {
      const other = byId.get(id);
      if (other && !other.removed) return false;
    }
    let leftOpen = true;
    for (const id of tile.leftIds) {
      const other = byId.get(id);
      if (other && !other.removed) {
        leftOpen = false;
        break;
      }
    }
    if (leftOpen) return true;
    for (const id of tile.rightIds) {
      const other = byId.get(id);
      if (other && !other.removed) return false;
    }
    return true;
  }
  for (const other of tiles) {
    if (!other || other === tile || other.removed || other.id === tile.id) continue;
    if (other.z > tile.z && rectsOverlap(other, tile)) return false;
  }
  let left = false;
  let right = false;
  for (const other of tiles) {
    if (!other || other === tile || other.removed || other.id === tile.id) continue;
    if (other.z !== tile.z || !yOverlap(other, tile)) continue;
    if (other.x + TILE_W === tile.x && other.x < tile.x) left = true;
    else if (tile.x + TILE_W === other.x && tile.x < other.x) right = true;
    if (left && right) break;
  }
  return !left || !right;
}

/** @param {Array<{ id: number }>} tiles */
function tileById(tiles) {
  if (tiles._byId && tiles._byId.size === tiles.length) return tiles._byId;
  const map = new Map();
  for (const tile of tiles) map.set(tile.id, tile);
  return map;
}

/**
 * @param {Array<{ id: number, x: number, y: number, z: number }>} tiles
 */
export function indexBlockers(tiles) {
  for (const tile of tiles) {
    tile.coverIds = [];
    tile.leftIds = [];
    tile.rightIds = [];
  }
  for (let i = 0; i < tiles.length; i++) {
    const a = tiles[i];
    for (let j = i + 1; j < tiles.length; j++) {
      const b = tiles[j];
      if (a.z !== b.z) {
        const upper = a.z > b.z ? a : b;
        const lower = a.z > b.z ? b : a;
        if (rectsOverlap(upper, lower)) lower.coverIds.push(upper.id);
      } else if (yOverlap(a, b)) {
        if (a.x + TILE_W === b.x) {
          b.leftIds.push(a.id);
          a.rightIds.push(b.id);
        } else if (b.x + TILE_W === a.x) {
          a.leftIds.push(b.id);
          b.rightIds.push(a.id);
        }
      }
    }
  }
  return tiles;
}

/**
 * @param {Array<{ suit: string, rank: number }>} a
 * @param {Array<{ suit: string, rank: number }>} b
 */
function pairKey(tile) {
  if (tile.suit === 'flower') return 'flower';
  if (tile.suit === 'season') return 'season';
  return `${tile.suit}:${tile.rank}`;
}

/** Full 144-tile set: three suits, winds, dragons, flowers, seasons. */
export function fullTileSet() {
  /** @type {{ suit: MahjongSuit, rank: number }[]} */
  const faces = [];
  for (const suit of /** @type {MahjongSuit[]} */ (['dot', 'bamboo', 'char'])) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let copy = 0; copy < 4; copy++) faces.push({ suit, rank });
    }
  }
  for (let rank = 1; rank <= 4; rank++) {
    for (let copy = 0; copy < 4; copy++) faces.push({ suit: 'wind', rank });
  }
  for (let rank = 1; rank <= 3; rank++) {
    for (let copy = 0; copy < 4; copy++) faces.push({ suit: 'dragon', rank });
  }
  for (let rank = 1; rank <= 4; rank++) faces.push({ suit: 'flower', rank });
  for (let rank = 1; rank <= 4; rank++) faces.push({ suit: 'season', rank });
  return faces;
}

/**
 * Even subset of the full set. Groups stay paired. Flowers and seasons stay
 * in the deal once the board is large enough to hold them.
 * @param {number} count
 */
export function facesForCount(count) {
  const n = Math.floor(count);
  if (n < 2 || n % 2 !== 0 || n > 144) {
    throw new Error(`Mahjong board must be an even size from 2 to 144 (got ${count})`);
  }
  /** @type {{ suit: MahjongSuit, rank: number, pairs: number, varied?: boolean }[]} */
  const catalog = [];
  catalog.push({ suit: 'flower', rank: 0, pairs: 2, varied: true });
  catalog.push({ suit: 'season', rank: 0, pairs: 2, varied: true });
  for (let rank = 1; rank <= 3; rank++) catalog.push({ suit: 'dragon', rank, pairs: 2 });
  for (let rank = 1; rank <= 4; rank++) catalog.push({ suit: 'wind', rank, pairs: 2 });
  for (const suit of /** @type {MahjongSuit[]} */ (['dot', 'bamboo', 'char'])) {
    for (let rank = 1; rank <= 9; rank++) catalog.push({ suit, rank, pairs: 2 });
  }

  const need = n / 2;
  const picked = [];
  const queues = catalog.map((entry) => ({ ...entry, left: entry.pairs }));
  while (picked.length < need) {
    let progressed = false;
    for (const entry of queues) {
      if (picked.length >= need) break;
      if (entry.left > 0) {
        picked.push(entry);
        entry.left -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  /** @type {{ suit: MahjongSuit, rank: number }[]} */
  const faces = [];
  let flower = 1;
  let season = 1;
  for (const entry of picked) {
    if (entry.suit === 'flower') {
      faces.push({ suit: 'flower', rank: flower++ }, { suit: 'flower', rank: flower++ });
    } else if (entry.suit === 'season') {
      faces.push({ suit: 'season', rank: season++ }, { suit: 'season', rank: season++ });
    } else {
      faces.push({ suit: entry.suit, rank: entry.rank }, { suit: entry.suit, rank: entry.rank });
    }
  }
  if (faces.length !== n) throw new Error(`deck built ${faces.length} faces for ${n}`);
  return faces;
}

/**
 * @param {Array<{ suit: string, rank: number }>} faces
 * @param {() => number} rng
 */
export function facePairs(faces, rng) {
  /** @type {Map<string, { suit: string, rank: number }[]>} */
  const pools = new Map();
  for (const face of faces) {
    const key = pairKey(face);
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(face);
  }
  /** @type {{ suit: string, rank: number }[][]} */
  const pairs = [];
  for (const pool of pools.values()) {
    if (pool.length % 2 !== 0) return null;
    const order = shuffle(pool, rng);
    for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
  }
  return shuffle(pairs, rng);
}

/** @param {any[]} list @param {() => number} rng */
function shuffle(list, rng) {
  const next = list.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = next[i];
    next[i] = next[j];
    next[j] = swap;
  }
  return next;
}

/**
 * Removal order that clears `positions`, or null when the geometry is locked.
 * The order is a forward solution: each pair is free at the moment it is taken.
 *
 * @param {Array<{ id: number, x: number, y: number, z: number }>} positions
 * @param {() => number} rng
 * @returns {number[][]|null}
 */
export function solveReverse(positions, rng) {
  const live = indexBlockers(positions.map((pos) => ({ ...pos, removed: false })));
  /** @type {number[][]} */
  const order = [];
  let remaining = live.length;
  while (remaining > 0) {
    const free = [];
    for (const tile of live) {
      if (!tile.removed && isFree(tile, live)) free.push(tile);
    }
    if (free.length < 2) return null;
    const a = free[Math.floor(rng() * free.length)];
    let bIndex = Math.floor(rng() * (free.length - 1));
    if (bIndex >= free.indexOf(a)) bIndex += 1;
    const b = free[bIndex];
    if (!b || b.id === a.id) return null;
    a.removed = true;
    b.removed = true;
    remaining -= 2;
    order.push([a.id, b.id]);
  }
  return order;
}

/**
 * @param {Array<{ id: number, x: number, y: number, z: number, suit?: string, rank?: number, removed?: boolean }>} tiles
 * @param {number[][]} solution
 */
export function replaySolution(tiles, solution) {
  const live = indexBlockers(
    tiles.map((tile) => ({
      id: tile.id,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      suit: tile.suit,
      rank: tile.rank,
      removed: false,
    }))
  );
  for (const pair of solution) {
    if (!pair || pair.length !== 2) return false;
    const a = live.find((tile) => tile.id === pair[0]);
    const b = live.find((tile) => tile.id === pair[1]);
    if (!a || !b || a.removed || b.removed) return false;
    if (!isFree(a, live) || !isFree(b, live)) return false;
    if (!facesMatch(a, b)) return false;
    a.removed = true;
    b.removed = true;
  }
  return live.every((tile) => tile.removed);
}

/**
 * @param {Array<{ id: number, x: number, y: number, z: number }>} positions
 * @param {Array<{ suit: string, rank: number }>} faces
 * @param {() => number} rng
 */
/**
 * @param {number[][]} order
 * @param {{ suit: string, rank: number }[][]} pairs
 * @param {Array<{ id: number, x: number, y: number, z: number }>} positions
 * @param {'einfach'|'mittel'|'schwer'} bias
 * @param {() => number} rng
 */
function orderFacePairs(order, pairs, positions, bias, rng) {
  const probe = indexBlockers(positions.map((pos) => ({ ...pos, removed: false })));
  const freeIds = new Set(probe.filter((tile) => isFree(tile, probe)).map((tile) => tile.id));
  const openingSlots = [];
  order.forEach((pair, index) => {
    if (freeIds.has(pair[0]) && freeIds.has(pair[1])) openingSlots.push(index);
  });
  const bag = shuffle(pairs, rng);
  /** @type {{ suit: string, rank: number }[][]} */
  const seq = new Array(order.length);
  if (bias === 'schwer') {
    const used = new Set();
    const unique = [];
    const rest = [];
    for (const pair of bag) {
      const key = pairKey(pair[0]);
      if (unique.length < openingSlots.length && !used.has(key)) {
        used.add(key);
        unique.push(pair);
      } else rest.push(pair);
    }
    while (unique.length < openingSlots.length && rest.length) unique.push(rest.pop());
    openingSlots.forEach((index, n) => {
      seq[index] = unique[n];
    });
    let cursor = 0;
    for (let i = 0; i < seq.length; i++) {
      if (!seq[i]) seq[i] = rest[cursor++];
    }
    return seq;
  }
  if (bias === 'einfach') {
    /** @type {Map<string, { suit: string, rank: number }[][]>} */
    const grouped = new Map();
    for (const pair of bag) {
      const key = pairKey(pair[0]);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(pair);
    }
    const dupes = [];
    const singles = [];
    for (const list of grouped.values()) {
      if (list.length > 1) dupes.push(...list);
      else singles.push(...list);
    }
    const prefer = dupes.concat(singles);
    openingSlots.forEach((index, n) => {
      seq[index] = prefer[n];
    });
    let cursor = openingSlots.length;
    for (let i = 0; i < seq.length; i++) {
      if (!seq[i]) seq[i] = prefer[cursor++];
    }
    return seq;
  }
  return bag;
}

/**
 * @param {Array<{ id: number, x: number, y: number, z: number }>} positions
 * @param {Array<{ suit: string, rank: number }>} faces
 * @param {() => number} rng
 * @param {'einfach'|'mittel'|'schwer'} [bias]
 */
export function buildSolved(positions, faces, rng, bias = 'mittel') {
  if (positions.length !== faces.length || positions.length % 2 !== 0) return null;
  const order = solveReverse(positions, rng);
  if (!order) return null;
  const pairs = facePairs(faces, rng);
  if (!pairs || pairs.length !== order.length) return null;
  const ordered = orderFacePairs(order, pairs, positions, bias, rng);
  /** @type {Map<number, { suit: string, rank: number }>} */
  const assigned = new Map();
  for (let i = 0; i < order.length; i++) {
    assigned.set(order[i][0], ordered[i][0]);
    assigned.set(order[i][1], ordered[i][1]);
  }
  const tiles = indexBlockers(
    positions.map((pos) => {
      const face = assigned.get(pos.id);
      return {
        id: pos.id,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        suit: face.suit,
        rank: face.rank,
        removed: false,
      };
    })
  );
  if (!replaySolution(tiles, order)) return null;
  return { tiles, solution: order };
}

function openingMatches(tiles) {
  const free = tiles.filter((tile) => !tile.removed && isFree(tile, tiles));
  let count = 0;
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (facesMatch(free[i], free[j])) count += 1;
    }
  }
  return count;
}

/**
 * @param {string} layoutId
 * @param {MahjongDifficultyId|string} difficulty
 * @param {() => number} rng
 */
export function createDeal(layoutId, difficulty, rng) {
  const diff = getMahjongDifficulty(difficulty);
  const positions = layoutPositions(layoutId, diff.size);
  const faces = facesForCount(positions.length);
  let best = null;
  const tries = diff.attempts;
  for (let i = 0; i < tries; i++) {
    const deal = buildSolved(positions, faces.map((face) => ({ ...face })), rng, diff.id);
    if (!deal) continue;
    const opening = openingMatches(deal.tiles);
    if (opening < 1) continue;
    const rank = diff.id === 'schwer' ? -opening : opening;
    if (!best || rank > best.rank) best = { deal, rank, opening };
    if (diff.id === 'einfach' && opening >= 4) break;
    if (diff.id === 'schwer' && opening <= 2) break;
  }
  if (!best) {
    throw new Error(`No solvable deal for ${layoutId}/${diff.id}`);
  }
  return {
    ...best.deal,
    opening: best.opening,
    layoutId: normalizeLayout(layoutId),
    difficulty: diff.id,
  };
}

function addGrid(out, z, x0, y0, cols, rows) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: x0 + c * TILE_W, y: y0 + r * TILE_H, z });
    }
  }
}

function stamp(art, z = 0, shift = 0) {
  const tiles = [];
  const lines = art.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
  lines.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '#') tiles.push({ x: c * TILE_W + shift, y: r * TILE_H + shift, z });
    }
  });
  return tiles;
}

function turtle(size) {
  const tiles = [];
  if (size === 'large') {
    const rows = [
      [0, 6, 12],
      [2, 4, 14],
      [4, 2, 16],
      [6, 2, 16],
      [8, 4, 14],
      [10, 6, 12],
    ];
    for (const [y, x0, count] of rows) addGrid(tiles, 0, x0, y, count, 1);
    tiles.push({ x: 0, y: 4, z: 0 }, { x: 0, y: 6, z: 0 }, { x: 34, y: 6, z: 0 });
    addGrid(tiles, 1, 11, 3, 8, 4);
    addGrid(tiles, 2, 13, 5, 6, 2);
    addGrid(tiles, 3, 15, 5, 4, 2);
    addGrid(tiles, 4, 17, 5, 2, 2);
    tiles.push({ x: 18, y: 6, z: 5 });
    return tiles;
  }
  if (size === 'medium') {
    const rows = [
      [0, 6, 10],
      [2, 4, 12],
      [4, 2, 14],
      [6, 2, 14],
      [8, 4, 12],
      [10, 6, 10],
    ];
    for (const [y, x0, count] of rows) addGrid(tiles, 0, x0, y, count, 1);
    tiles.push(
      { x: -2, y: 4, z: 0 },
      { x: 0, y: 4, z: 0 },
      { x: -2, y: 6, z: 0 },
      { x: 0, y: 6, z: 0 },
      { x: 30, y: 6, z: 0 }
    );
    addGrid(tiles, 1, 11, 4, 6, 3);
    addGrid(tiles, 2, 13, 4, 4, 2);
    addGrid(tiles, 3, 15, 4, 2, 2);
    tiles.push({ x: 16, y: 5, z: 4 });
    return tiles;
  }
  const rows = [
    [0, 4, 8],
    [2, 2, 10],
    [4, 0, 12],
    [6, 2, 10],
    [8, 4, 8],
  ];
  for (const [y, x0, count] of rows) addGrid(tiles, 0, x0, y, count, 1);
  tiles.push({ x: -4, y: 4, z: 0 }, { x: -2, y: 4, z: 0 }, { x: 24, y: 4, z: 0 });
  addGrid(tiles, 1, 7, 4, 6, 2);
  addGrid(tiles, 2, 9, 4, 4, 2);
  tiles.push({ x: 12, y: 5, z: 3 });
  return tiles;
}

function pyramid(size) {
  const tiles = [];
  const levels =
    size === 'large'
      ? [
          [0, 0, 12, 8],
          [1, 5, 5, 8, 4],
          [2, 9, 7, 4, 2],
          [3, 11, 7, 2, 2],
          [4, 11, 7, 2, 2],
        ]
      : size === 'medium'
        ? [
            [0, 0, 0, 10, 6],
            [1, 5, 3, 6, 4],
            [2, 7, 5, 4, 2],
            [3, 9, 5, 2, 2],
          ]
        : [
            [0, 0, 0, 8, 4],
            [1, 3, 1, 6, 3],
            [2, 5, 3, 4, 2],
            [3, 7, 3, 2, 2],
          ];
  if (size === 'large') {
    addGrid(tiles, 0, 0, 0, 12, 8);
    addGrid(tiles, 1, 5, 5, 8, 4);
    addGrid(tiles, 2, 9, 7, 4, 2);
    addGrid(tiles, 3, 11, 7, 2, 2);
    addGrid(tiles, 4, 11, 7, 2, 2);
    return tiles;
  }
  for (const level of levels) {
    const [z, x0, y0, cols, rows] = level;
    addGrid(tiles, z, x0, y0, cols, rows);
  }
  return tiles;
}

function fortress(size) {
  const tiles = [];
  const spec =
    size === 'large'
      ? { cols: 16, rows: 9, holeC: 8, holeR: 5, keepC: 6, keepR: 3, tower: 2, caps: true, banner: true }
      : size === 'medium'
        ? { cols: 12, rows: 8, holeC: 6, holeR: 4, keepC: 4, keepR: 2, tower: 2, caps: false, banner: false }
        : { cols: 10, rows: 6, holeC: 4, holeR: 2, keepC: 2, keepR: 2, tower: 1, caps: false, banner: false };
  const hx = Math.floor((spec.cols - spec.holeC) / 2);
  const hy = Math.floor((spec.rows - spec.holeR) / 2);
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const inHole = c >= hx && c < hx + spec.holeC && r >= hy && r < hy + spec.holeR;
      if (!inHole) tiles.push({ x: c * TILE_W, y: r * TILE_H, z: 0 });
    }
  }
  const kx = hx + Math.floor((spec.holeC - spec.keepC) / 2);
  const ky = hy + Math.floor((spec.holeR - spec.keepR) / 2);
  addGrid(tiles, 0, kx * TILE_W, ky * TILE_H, spec.keepC, spec.keepR);
  const corners = [
    [0, 0],
    [spec.cols - spec.tower, 0],
    [0, spec.rows - spec.tower],
    [spec.cols - spec.tower, spec.rows - spec.tower],
  ];
  for (const [c, r] of corners) {
    addGrid(tiles, 1, c * TILE_W + 1, r * TILE_H + 1, spec.tower, spec.tower);
    if (spec.caps) {
      tiles.push({
        x: c * TILE_W + spec.tower,
        y: r * TILE_H + spec.tower,
        z: 2,
      });
    }
  }
  if (spec.banner) {
    tiles.push({ x: kx * TILE_W + 3, y: ky * TILE_H + 1, z: 1 }, { x: kx * TILE_W + 7, y: ky * TILE_H + 1, z: 1 });
  }
  return tiles;
}

function dragon(size) {
  const tiles = [];
  if (size === 'large') {
    const body = stamp(`
......######............
....############........
..##################....
######################..
..##################....
....############........
......########..........
........####............
`);
    body.push({ x: -4, y: 6, z: 0 }, { x: -2, y: 6, z: 0 }, { x: 44, y: 6, z: 0 }, { x: 46, y: 6, z: 0 });
    tiles.push(...body);
    addGrid(tiles, 1, 5, 5, 5, 2);
    addGrid(tiles, 1, 25, 5, 5, 2);
    addGrid(tiles, 1, 15, 11, 6, 1);
    addGrid(tiles, 2, 13, 5, 6, 2);
    tiles.push({ x: 16, y: 6, z: 3 }, { x: 20, y: 6, z: 3 });
    return tiles;
  }
  if (size === 'medium') {
    const body = stamp(`
....######......
..##########....
##############..
..##########....
....######......
......####......
`);
    body.push({ x: -2, y: 4, z: 0 }, { x: 28, y: 4, z: 0 });
    tiles.push(...body);
    addGrid(tiles, 1, 5, 3, 4, 2);
    addGrid(tiles, 1, 17, 3, 4, 2);
    addGrid(tiles, 2, 11, 3, 4, 2);
    tiles.push({ x: 12, y: 4, z: 3 }, { x: 16, y: 4, z: 3 });
    return tiles;
  }
  const body = stamp(`
...######...
.##########.
############
..########..
....####....
`);
  body.push({ x: -2, y: 4, z: 0 }, { x: 24, y: 4, z: 0 });
  tiles.push(...body);
  addGrid(tiles, 1, 5, 3, 3, 2);
  addGrid(tiles, 1, 15, 3, 3, 2);
  return tiles;
}

function schnell(size) {
  const tiles = [];
  if (size === 'large') {
    addGrid(tiles, 0, 0, 0, 8, 4);
    addGrid(tiles, 1, 3, 1, 6, 3);
    addGrid(tiles, 2, 5, 3, 4, 2);
    addGrid(tiles, 3, 7, 3, 2, 2);
    return tiles;
  }
  if (size === 'medium') {
    addGrid(tiles, 0, 0, 0, 8, 3);
    addGrid(tiles, 1, 3, 1, 6, 2);
    addGrid(tiles, 2, 5, 1, 2, 2);
    return tiles;
  }
  addGrid(tiles, 0, 0, 0, 6, 3);
  addGrid(tiles, 1, 3, 1, 4, 2);
  addGrid(tiles, 2, 5, 3, 2, 1);
  return tiles;
}

const BUILDERS = {
  schildkroete: turtle,
  pyramide: pyramid,
  drache: dragon,
  festung: fortress,
  schnell,
};

/**
 * @param {string} layoutId
 * @param {MahjongSize} [size]
 */
export function layoutPositions(layoutId, size = 'large') {
  const id = normalizeLayout(layoutId);
  const key = size === 'small' || size === 'medium' || size === 'large' ? size : 'large';
  const built = BUILDERS[id](key).map((pos, index) => ({
    id: index,
    x: pos.x,
    y: pos.y,
    z: pos.z,
  }));
  const problem = validatePositions(built);
  if (problem) throw new Error(`${id}/${key}: ${problem}`);
  return built;
}

/**
 * @param {Array<{ id: number, x: number, y: number, z: number }>} tiles
 * @returns {string|null}
 */
export function validatePositions(tiles) {
  if (tiles.length < 2 || tiles.length % 2 !== 0) return `uneven tile count ${tiles.length}`;
  if (tiles.length > 144) return `more than a full set (${tiles.length})`;
  const ids = new Set();
  for (const tile of tiles) {
    if (ids.has(tile.id)) return `duplicate id ${tile.id}`;
    ids.add(tile.id);
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y) || !Number.isInteger(tile.z)) {
      return 'coordinates must be integers';
    }
  }
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i];
      const b = tiles[j];
      if (a.z === b.z && rectsOverlap(a, b)) return `overlap on layer ${a.z}`;
    }
  }
  for (const tile of tiles) {
    if (tile.z === 0) continue;
    const supported = tiles.some((other) => other.z < tile.z && rectsOverlap(other, tile));
    if (!supported) return `floating tile ${tile.id} on z ${tile.z}`;
  }
  return null;
}

/** @param {string} layoutId @param {string} difficulty */
export function bestKey(layoutId, difficulty) {
  return `orbit-mahjong-best-${normalizeLayout(layoutId)}-${normalizeMahjongDifficulty(difficulty)}`;
}

/**
 * @param {string} layoutId
 * @param {string} difficulty
 */
export function readBest(layoutId, difficulty) {
  try {
    const n = Number(localStorage.getItem(bestKey(layoutId, difficulty)));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {string} layoutId
 * @param {string} difficulty
 * @param {number} score
 */
export function writeBest(layoutId, difficulty, score) {
  const prev = readBest(layoutId, difficulty);
  const next = Math.max(0, Math.floor(Number(score) || 0));
  if (next <= prev) return { best: prev, record: false };
  try {
    localStorage.setItem(bestKey(layoutId, difficulty), String(next));
  } catch {
    /* ignore quota */
  }
  return { best: next, record: true };
}

/** Compact clear log: layout, then matches `m id,id,elapsedMs`, undo `u`, shuffle `s`. */
export function encodeMahjongLog(layout, ops) {
  const head = normalizeLayout(layout);
  const body = [];
  for (const op of ops || []) {
    if (!op || typeof op !== 'object') continue;
    if (op.t === 'm') body.push(`m${op.a|0},${op.b|0},${Math.max(0, op.ms|0)}`);
    else if (op.t === 'u') body.push('u');
    else if (op.t === 's') body.push('s');
  }
  return [head, ...body].join(';');
}

function cloneTile(tile) {
  return {
    id: tile.id,
    x: tile.x,
    y: tile.y,
    z: tile.z,
    suit: tile.suit,
    rank: tile.rank,
    removed: tile.removed,
    coverIds: tile.coverIds.slice(),
    leftIds: tile.leftIds.slice(),
    rightIds: tile.rightIds.slice(),
  };
}

export class MahjongGame {
  constructor() {
    this.rng = Math.random;
    this.tiles = [];
    this.solution = [];
    this.layoutId = 'schildkroete';
    this.difficultyId = /** @type {MahjongDifficultyId} */ ('mittel');
    this.diff = getMahjongDifficulty('mittel');
    this.selectedId = null;
    this.hintPair = null;
    this.hintsLeft = 0;
    this.shufflesLeft = 0;
    this.pairs = 0;
    this.combo = 0;
    this.comboBonus = 0;
    this.blitzes = 0;
    this.lastMatchAt = null;
    this.elapsedMs = 0;
    this.won = false;
    this.stuck = false;
    this.running = false;
    this.paused = false;
    this.undoStack = [];
    this.opening = 0;
    this.replayOps = [];
  }

  /**
   * @param {{ layout?: string, difficulty?: string, rng?: () => number }} [opts]
   */
  start(opts = {}) {
    this.rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    this.layoutId = normalizeLayout(opts.layout);
    this.difficultyId = normalizeMahjongDifficulty(opts.difficulty);
    this.diff = getMahjongDifficulty(this.difficultyId);
    const deal = createDeal(this.layoutId, this.difficultyId, this.rng);
    this.tiles = deal.tiles;
    this.solution = deal.solution;
    this.opening = deal.opening;
    this.selectedId = null;
    this.hintPair = null;
    this.hintsLeft = this.diff.hints;
    this.shufflesLeft = this.diff.shuffles;
    this.pairs = 0;
    this.combo = 0;
    this.comboBonus = 0;
    this.blitzes = 0;
    this.lastMatchAt = null;
    this.elapsedMs = 0;
    this.won = false;
    this.stuck = false;
    this.running = true;
    this.paused = false;
    this.undoStack = [];
    this.refreshStuck();
    return this.snapshot();
  }

  /** @param {number} id */
  tile(id) {
    return this.tiles.find((entry) => entry.id === id) || null;
  }

  liveTiles() {
    return this.tiles.filter((tile) => !tile.removed);
  }

  /** @param {number} id */
  isFreeId(id) {
    const tile = this.tile(id);
    return !!tile && isFree(tile, this.tiles);
  }

  freeTiles() {
    return this.tiles.filter((tile) => isFree(tile, this.tiles));
  }

  findMatches() {
    const free = this.freeTiles();
    /** @type {number[][]} */
    const pairs = [];
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        if (facesMatch(free[i], free[j])) pairs.push([free[i].id, free[j].id]);
      }
    }
    return pairs;
  }

  refreshStuck() {
    const live = this.liveTiles();
    this.won = live.length === 0;
    this.stuck = !this.won && this.findMatches().length === 0;
    if (this.won) this.running = false;
    return this.stuck;
  }

  /**
   * @param {number} id
   */
  select(id) {
    if (!this.running || this.paused || this.won) return { type: 'idle' };
    const tile = this.tile(id);
    if (!tile || tile.removed) return { type: 'missing' };
    if (!isFree(tile, this.tiles)) return { type: 'blocked', id };
    this.hintPair = null;
    if (this.selectedId == null) {
      this.selectedId = id;
      return { type: 'select', id };
    }
    if (this.selectedId === id) {
      this.selectedId = null;
      return { type: 'deselect', id };
    }
    const first = this.tile(this.selectedId);
    if (!first || first.removed || !isFree(first, this.tiles)) {
      this.selectedId = id;
      return { type: 'select', id };
    }
    if (!facesMatch(first, tile)) {
      this.selectedId = id;
      return { type: 'mismatch', id, previous: first.id };
    }
    this.pushUndo();
    first.removed = true;
    tile.removed = true;
    const dt =
      this.lastMatchAt == null ? Number.POSITIVE_INFINITY : (this.elapsedMs - this.lastMatchAt) / 1000;
    if (dt <= this.diff.comboSec) this.combo = Math.min(COMBO_MAX, this.combo + 1);
    else this.combo = 1;
    this.comboBonus += (this.combo - 1) * COMBO_STEP;
    if (this.combo >= 2 && dt <= this.diff.blitzSec) this.blitzes += 1;
    this.pairs += 1;
    this.lastMatchAt = this.elapsedMs;
    this.replayOps.push({
      t: 'm',
      a: first.id,
      b: tile.id,
      ms: Math.max(0, Math.round(this.elapsedMs)),
    });
    this.selectedId = null;
    this.refreshStuck();
    const packed = this.packed();
    return {
      type: this.won ? 'win' : 'match',
      ids: [first.id, tile.id],
      combo: this.combo,
      stuck: this.stuck,
      won: this.won,
      score: packed.score,
    };
  }

  hint() {
    if (!this.running || this.won) return { ok: false, reason: 'idle' };
    if (this.hintsLeft <= 0) return { ok: false, reason: 'empty' };
    const matches = this.findMatches();
    if (!matches.length) return { ok: false, reason: 'none' };
    this.hintsLeft -= 1;
    this.hintPair = matches[0].slice();
    this.selectedId = null;
    return { ok: true, pair: this.hintPair.slice(), left: this.hintsLeft };
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return { ok: false, reason: 'empty' };
    this.tiles = snap.tiles.map(cloneTile);
    this.solution = snap.solution.map((pair) => pair.slice());
    this.selectedId = null;
    this.hintPair = null;
    this.hintsLeft = snap.hintsLeft;
    this.shufflesLeft = snap.shufflesLeft;
    this.pairs = snap.pairs;
    this.combo = snap.combo;
    this.comboBonus = snap.comboBonus;
    this.blitzes = snap.blitzes;
    this.lastMatchAt = snap.lastMatchAt;
    this.won = false;
    this.running = true;
    this.refreshStuck();
    this.replayOps.push({ t: 'u' });
    return { ok: true, score: this.packed().score };
  }

  /**
   * Reshuffle is the escape when no pair is free. `force` is for tests that
   * want a new solvable pairing before the board is stuck.
   * @param {boolean} [force]
   */
  shuffle(force = false) {
    if (!this.running || this.won) return { ok: false, reason: 'idle' };
    if (this.shufflesLeft <= 0) return { ok: false, reason: 'empty' };
    if (!force && this.findMatches().length > 0) return { ok: false, reason: 'moves' };
    const live = this.liveTiles();
    if (live.length < 2) return { ok: false, reason: 'none' };
    const positions = live.map((tile) => ({ id: tile.id, x: tile.x, y: tile.y, z: tile.z }));
    const faces = live.map((tile) => ({ suit: tile.suit, rank: tile.rank }));
    const deal = buildSolved(positions, faces, this.rng, this.difficultyId);
    if (!deal) return { ok: false, reason: 'geometry' };
    this.pushUndo();
    const next = new Map(deal.tiles.map((tile) => [tile.id, tile]));
    this.tiles = this.tiles.map((tile) => {
      const updated = next.get(tile.id);
      if (!updated) return tile;
      return {
        ...tile,
        suit: updated.suit,
        rank: updated.rank,
        removed: false,
      };
    });
    indexBlockers(this.tiles);
    this.solution = deal.solution;
    this.shufflesLeft -= 1;
    this.selectedId = null;
    this.hintPair = null;
    this.refreshStuck();
    this.replayOps.push({ t: 's' });
    return { ok: true, left: this.shufflesLeft, score: this.packed().score };
  }

  /** @param {number} seconds */
  advance(seconds) {
    if (!this.running || this.paused || this.won) return;
    const dt = Number(seconds);
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.elapsedMs += dt * 1000;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  packed() {
    return packMahjongScore(this.pairs, this.comboBonus, this.blitzes);
  }

  snapshot() {
    const packed = this.packed();
    const live = this.liveTiles().length;
    return {
      layoutId: this.layoutId,
      layoutLabel: layoutMeta(this.layoutId).label,
      difficulty: this.difficultyId,
      difficultyLabel: this.diff.label,
      score: packed.score,
      survivalMs: packed.survivalMs,
      orbs: packed.orbs,
      comboBonus: packed.comboBonus,
      nearMisses: packed.nearMisses,
      pairs: this.pairs,
      remainingPairs: live / 2,
      combo: this.combo,
      hintsLeft: this.hintsLeft,
      shufflesLeft: this.shufflesLeft,
      elapsedMs: this.elapsedMs,
      won: this.won,
      stuck: this.stuck,
      selectedId: this.selectedId,
      hintPair: this.hintPair ? this.hintPair.slice() : null,
      canUndo: this.undoStack.length > 0,
    };
  }

  result() {
    const packed = this.packed();
    const snap = this.snapshot();
    return {
      game: GAME_ID,
      score: packed.score,
      survivalMs: packed.survivalMs,
      orbs: packed.orbs,
      comboBonus: packed.comboBonus,
      nearMisses: packed.nearMisses,
      difficulty: this.difficultyId,
      layout: this.layoutId,
      layoutLabel: snap.layoutLabel,
      mahjongLog: encodeMahjongLog(this.layoutId, this.replayOps),
      elapsedMs: this.elapsedMs,
      pairs: this.pairs,
      formula: formatMahjongFormula(
        packed.survivalMs,
        packed.orbs,
        packed.comboBonus,
        packed.nearMisses,
        packed.score
      ),
    };
  }

  pushUndo() {
    this.undoStack.push({
      tiles: this.tiles.map(cloneTile),
      solution: this.solution.map((pair) => pair.slice()),
      hintsLeft: this.hintsLeft,
      shufflesLeft: this.shufflesLeft,
      pairs: this.pairs,
      combo: this.combo,
      comboBonus: this.comboBonus,
      blitzes: this.blitzes,
      lastMatchAt: this.lastMatchAt,
    });
    if (this.undoStack.length > 80) this.undoStack.shift();
  }
}

/** Layout counts used by the smoke test. */
export function layoutCatalog() {
  /** @type {{ id: string, size: MahjongSize, count: number }[]} */
  const rows = [];
  for (const layout of LAYOUTS) {
    for (const size of /** @type {MahjongSize[]} */ (['small', 'medium', 'large'])) {
      rows.push({ id: layout.id, size, count: layoutPositions(layout.id, size).length });
    }
  }
  return rows;
}
