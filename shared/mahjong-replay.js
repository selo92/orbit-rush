/**
 * Replay a Mahjong clear from the seed on the run token.
 * The log is the layout plus matches, undos, and shuffles. Combo and blitz
 * use the elapsed timestamps in that log, which cannot run ahead of the
 * server clock (checked by the caller via the settled survival... no:
 * packMahjongScore invents survival from the blitz count). The structural
 * check is the board: only free, matching tiles on this deal count.
 */
import { mulberry32 } from '../src/rng.js';
import { MahjongGame, normalizeLayout } from '../src/mahjong.js';

const MAX_LOG_CHARS = 8000;
const MAX_OPS = 400;
const MAX_ELAPSED_MS = 30 * 60 * 1000;

/**
 * @param {unknown} log
 */
export function decodeMahjongLog(log) {
  if (typeof log !== 'string' || !log || log.length > MAX_LOG_CHARS) {
    return { ok: false, error: 'Mahjong replay invalid' };
  }
  const parts = log.split(';');
  const layout = normalizeLayout(parts[0]);
  if (parts[0] !== layout) return { ok: false, error: 'Mahjong replay invalid' };
  if (parts.length - 1 > MAX_OPS) return { ok: false, error: 'Mahjong replay invalid' };
  /** @type {Array<{ t: 'm', a: number, b: number, ms: number } | { t: 'u' } | { t: 's' }>} */
  const ops = [];
  let lastMs = 0;
  for (let i = 1; i < parts.length; i++) {
    const piece = parts[i];
    if (piece === 'u') {
      ops.push({ t: 'u' });
      continue;
    }
    if (piece === 's') {
      ops.push({ t: 's' });
      continue;
    }
    const match = /^m(\d+),(\d+),(\d+)$/.exec(piece);
    if (!match) return { ok: false, error: 'Mahjong replay invalid' };
    const ms = Number(match[3]);
    if (ms < lastMs || ms > MAX_ELAPSED_MS) return { ok: false, error: 'Mahjong replay invalid' };
    lastMs = ms;
    ops.push({ t: 'm', a: Number(match[1]), b: Number(match[2]), ms });
  }
  return { ok: true, layout, ops };
}

/**
 * @param {number} seed
 * @param {string} difficulty
 * @param {unknown} log
 */
export function replayMahjong(seed, difficulty, log) {
  const decoded = decodeMahjongLog(log);
  if (!decoded.ok) return decoded;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return { ok: false, error: 'Mahjong replay invalid' };
  }
  const game = new MahjongGame();
  game.start({
    layout: decoded.layout,
    difficulty,
    rng: mulberry32(seed >>> 0),
  });
  for (const op of decoded.ops) {
    if (op.t === 'u') {
      if (!game.undo().ok) return { ok: false, error: 'Mahjong replay invalid' };
      continue;
    }
    if (op.t === 's') {
      if (!game.shuffle(false).ok) return { ok: false, error: 'Mahjong replay invalid' };
      continue;
    }
    const gap = op.ms - game.elapsedMs;
    if (gap < -1 || gap > MAX_ELAPSED_MS) return { ok: false, error: 'Mahjong replay invalid' };
    if (gap > 0) game.advance(gap / 1000);
    const first = game.select(op.a);
    if (first.type === 'blocked' || first.type === 'missing' || first.type === 'idle') {
      return { ok: false, error: 'Mahjong replay invalid' };
    }
    const second = game.select(op.b);
    if (second.type !== 'match' && second.type !== 'win') {
      return { ok: false, error: 'Mahjong replay invalid' };
    }
  }
  if (!game.won) return { ok: false, error: 'Mahjong replay invalid' };
  const packed = game.packed();
  return { ok: true, ...packed };
}
