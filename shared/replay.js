/**
 * Replace client-claimed stats with a server replay for games that have one.
 * Hunt and Mahjong must match the replay exactly. Other games keep the
 * plausibility caps.
 */
import { replayHunt } from './hunt-sim.js';
import { replayMahjong } from './mahjong-replay.js';

function sameStats(claimed, replay) {
  return (
    claimed.score === replay.score &&
    claimed.survivalMs === replay.survivalMs &&
    claimed.orbs === replay.orbs &&
    claimed.comboBonus === replay.comboBonus &&
    claimed.nearMisses === replay.nearMisses
  );
}

/**
 * @param {{ game?: string, difficulty?: string, seed?: number|null }} claims
 * @param {object} body
 * @param {object} value
 */
export function applyReplay(claims, body, value) {
  if (!claims || claims.game !== value.game) {
    return { ok: false, status: 400, error: 'Run does not match this score' };
  }
  if (value.game === 'hunt') {
    if (!Number.isInteger(claims.seed)) return { ok: false, status: 400, error: 'Hunt replay invalid' };
    const played = replayHunt(claims.seed, value.difficulty, body?.huntLog);
    if (!played.ok) return { ok: false, status: 400, error: played.error || 'Hunt replay invalid' };
    if (!sameStats(value, played)) return { ok: false, status: 400, error: 'Score does not match this run' };
    return {
      ok: true,
      value: {
        ...value,
        score: played.score,
        survivalMs: played.survivalMs,
        orbs: played.orbs,
        comboBonus: played.comboBonus,
        nearMisses: played.nearMisses,
      },
    };
  }
  if (value.game === 'mahjong') {
    if (!Number.isInteger(claims.seed)) return { ok: false, status: 400, error: 'Mahjong replay invalid' };
    const played = replayMahjong(claims.seed, value.difficulty, body?.mahjongLog);
    if (!played.ok) return { ok: false, status: 400, error: played.error || 'Mahjong replay invalid' };
    if (!sameStats(value, played)) return { ok: false, status: 400, error: 'Score does not match this run' };
    return {
      ok: true,
      value: {
        ...value,
        score: played.score,
        survivalMs: played.survivalMs,
        orbs: played.orbs,
        comboBonus: played.comboBonus,
        nearMisses: played.nearMisses,
      },
    };
  }
  return { ok: true, value };
}
