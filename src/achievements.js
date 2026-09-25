/**
 * Orbit Rush – achievements (v1.3)
 */

/** @typedef {{
 *   id: string,
 *   title: string,
 *   desc: string,
 * }} AchievementDef */

/** @type {AchievementDef[]} */
export const ACHIEVEMENTS = [
  {
    id: 'first_orb',
    title: 'First Orb',
    desc: 'Collect your first orb.',
  },
  {
    id: 'combo_x5',
    title: 'Combo x5',
    desc: 'Reach a x5 combo in one run.',
  },
  {
    id: 'near_miss_10',
    title: 'Graze Master',
    desc: 'Score 10 near-misses in a single run.',
  },
  {
    id: 'survive_60',
    title: 'One Minute',
    desc: 'Survive 60 seconds in one run.',
  },
  {
    id: 'baba_clear',
    title: 'Baba Survivor',
    desc: 'Finish any Baba run (any score).',
  },
  {
    id: 'daily_win',
    title: 'Daily Pilot',
    desc: 'Complete today’s Daily Challenge once.',
  },
];

export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map((a) => a.id);

const LS_ACH = 'orbit-rush-achievements-v1';

export function loadAchievements() {
  try {
    const raw = localStorage.getItem(LS_ACH);
    const data = raw ? JSON.parse(raw) : {};
    if (!data || typeof data !== 'object') return {};
    /** @type {Record<string, number>} */
    const out = {};
    for (const id of ACHIEVEMENT_IDS) {
      if (data[id]) out[id] = Number(data[id]) || Date.now();
    }
    return out;
  } catch {
    return {};
  }
}

/** @param {Record<string, number>} map */
export function saveAchievements(map) {
  try {
    localStorage.setItem(LS_ACH, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Evaluate run stats and return newly unlocked achievement ids.
 * @param {Record<string, number>} current
 * @param {{
 *   orbs: number,
 *   comboPeak: number,
 *   nearMisses: number,
 *   survivalMs: number,
 *   difficulty: string,
 *   daily?: boolean,
 * }} stats
 * @returns {string[]}
 */
export function checkUnlocks(current, stats) {
  const newly = [];
  const tryUnlock = (id) => {
    if (!current[id]) newly.push(id);
  };

  if (stats.orbs >= 1) tryUnlock('first_orb');
  if (stats.comboPeak >= 5) tryUnlock('combo_x5');
  if (stats.nearMisses >= 10) tryUnlock('near_miss_10');
  if (stats.survivalMs >= 60_000) tryUnlock('survive_60');
  if (stats.difficulty === 'baba') tryUnlock('baba_clear');
  if (stats.daily) tryUnlock('daily_win');

  return newly;
}

/**
 * Apply unlocks; returns list of newly unlocked defs.
 * @param {string[]} ids
 */
export function unlockMany(ids) {
  const map = loadAchievements();
  const now = Date.now();
  /** @type {AchievementDef[]} */
  const unlocked = [];
  for (const id of ids) {
    if (!ACHIEVEMENT_IDS.includes(id)) continue;
    if (map[id]) continue;
    map[id] = now;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (def) unlocked.push(def);
  }
  if (unlocked.length) saveAchievements(map);
  return unlocked;
}

export function getAchievement(id) {
  return ACHIEVEMENTS.find((a) => a.id === id) || null;
}

export function unlockedSet() {
  return new Set(Object.keys(loadAchievements()));
}
