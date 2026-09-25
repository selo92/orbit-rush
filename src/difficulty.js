/**
 * Orbit Rush – difficulty presets (v1.2)
 * Labels (DE): Einfach, Mittel, Schwer, Baba
 */

/** @typedef {'einfach'|'mittel'|'schwer'|'baba'} DifficultyId */

export const DIFFICULTY_IDS = /** @type {const} */ (['einfach', 'mittel', 'schwer', 'baba']);

export const DEFAULT_DIFFICULTY = 'mittel';

/**
 * Scaling relative to Mittel (current v1.1 baseline).
 * Higher astRate / astSpeed / angVel / ramp = harder.
 * Higher orbInterval / powerInterval / lower powerChance = scarcer rewards.
 *
 * @type {Record<DifficultyId, {
 *   id: DifficultyId,
 *   label: string,
 *   blurb: string,
 *   astRate: number,
 *   astSpeed: number,
 *   astSize: number,
 *   orbInterval: number,
 *   orbMax: number,
 *   powerChance: number,
 *   powerInterval: number,
 *   rampDivisor: number,
 *   rampCap: number,
 *   angVelBase: number,
 *   angVelRamp: number,
 *   rSpan: number,
 *   startAstDelay: number,
 * }>}
 */
export const DIFFICULTIES = {
  einfach: {
    id: 'einfach',
    label: 'Einfach',
    blurb: 'Slower debris · more orbs',
    astRate: 0.72,
    astSpeed: 0.78,
    astSize: 0.9,
    orbInterval: 0.78,
    orbMax: 6,
    powerChance: 0.72,
    powerInterval: 0.8,
    rampDivisor: 58000,
    rampCap: 1.25,
    angVelBase: 1.15,
    angVelRamp: 0.38,
    rSpan: 1.08,
    startAstDelay: 1.15,
  },
  mittel: {
    id: 'mittel',
    label: 'Mittel',
    blurb: 'Classic balance',
    astRate: 1,
    astSpeed: 1,
    astSize: 1,
    orbInterval: 1,
    orbMax: 5,
    powerChance: 0.55,
    powerInterval: 1,
    rampDivisor: 45000,
    rampCap: 1.8,
    angVelBase: 1.35,
    angVelRamp: 0.55,
    rSpan: 1,
    startAstDelay: 0.8,
  },
  schwer: {
    id: 'schwer',
    label: 'Schwer',
    blurb: 'Faster · tighter · fewer orbs',
    astRate: 1.38,
    astSpeed: 1.28,
    astSize: 1.08,
    orbInterval: 1.28,
    orbMax: 4,
    powerChance: 0.38,
    powerInterval: 1.35,
    rampDivisor: 34000,
    rampCap: 2.25,
    angVelBase: 1.52,
    angVelRamp: 0.72,
    rSpan: 0.9,
    startAstDelay: 0.55,
  },
  baba: {
    id: 'baba',
    label: 'Baba',
    blurb: '⚠ Extreme · rare power-ups',
    astRate: 1.85,
    astSpeed: 1.58,
    astSize: 1.18,
    orbInterval: 1.65,
    orbMax: 3,
    powerChance: 0.2,
    powerInterval: 1.9,
    rampDivisor: 26000,
    rampCap: 2.9,
    angVelBase: 1.72,
    angVelRamp: 0.95,
    rSpan: 0.8,
    startAstDelay: 0.35,
  },
};

/** @param {unknown} id */
export function normalizeDifficulty(id) {
  const s = typeof id === 'string' ? id.toLowerCase().trim() : '';
  if (DIFFICULTY_IDS.includes(/** @type {DifficultyId} */ (s))) {
    return /** @type {DifficultyId} */ (s);
  }
  return DEFAULT_DIFFICULTY;
}

/** @param {DifficultyId|string} id */
export function getDifficulty(id) {
  return DIFFICULTIES[normalizeDifficulty(id)];
}

/** Short badge text for leaderboard rows */
export function difficultyBadge(id) {
  return getDifficulty(id).label;
}
