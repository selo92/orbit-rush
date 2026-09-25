/**
 * Orbit Rush – craft color / trail palettes (v1.3)
 */

/** @typedef {'cyan'|'magenta'|'gold'|'baba'} SkinId */

/**
 * @type {Record<SkinId, {
 *   id: SkinId,
 *   label: string,
 *   craft: string,
 *   craftRgb: string,
 *   accent: string,
 *   trail: string,
 *   glow: string,
 *   unlock: string,
 * }>}
 */
export const SKINS = {
  cyan: {
    id: 'cyan',
    label: 'Neon Cyan',
    craft: '#00f0ff',
    craftRgb: '0, 240, 255',
    accent: '#ff2bd6',
    trail: '#00f0ff',
    glow: '#00f0ff',
    unlock: 'default',
  },
  magenta: {
    id: 'magenta',
    label: 'Hot Magenta',
    craft: '#ff2bd6',
    craftRgb: '255, 43, 214',
    accent: '#00f0ff',
    trail: '#ff6be0',
    glow: '#ff2bd6',
    unlock: 'first_orb',
  },
  gold: {
    id: 'gold',
    label: 'Solar Gold',
    craft: '#ffe566',
    craftRgb: '255, 229, 102',
    accent: '#ff8c42',
    trail: '#ffe566',
    glow: '#ffe566',
    unlock: 'survive_60',
  },
  baba: {
    id: 'baba',
    label: 'Baba Hazard',
    craft: '#ff4d6d',
    craftRgb: '255, 77, 109',
    accent: '#ffe566',
    trail: '#ff8a9a',
    glow: '#ff4d6d',
    unlock: 'baba_clear',
  },
};

export const SKIN_IDS = /** @type {const} */ (['cyan', 'magenta', 'gold', 'baba']);
export const DEFAULT_SKIN = 'cyan';

const LS_SKIN = 'orbit-rush-skin';

/** @param {unknown} id */
export function normalizeSkin(id) {
  const s = typeof id === 'string' ? id.toLowerCase().trim() : '';
  if (SKIN_IDS.includes(/** @type {SkinId} */ (s))) {
    return /** @type {SkinId} */ (s);
  }
  return DEFAULT_SKIN;
}

/** @param {SkinId|string} id */
export function getSkin(id) {
  return SKINS[normalizeSkin(id)];
}

export function loadSavedSkin() {
  try {
    return normalizeSkin(localStorage.getItem(LS_SKIN) || DEFAULT_SKIN);
  } catch {
    return DEFAULT_SKIN;
  }
}

/** @param {SkinId|string} id */
export function saveSkin(id) {
  const s = normalizeSkin(id);
  try {
    localStorage.setItem(LS_SKIN, s);
  } catch {
    /* ignore */
  }
  return s;
}

/**
 * Whether a skin is unlocked given achievement set + optional PB map.
 * @param {SkinId|string} id
 * @param {Set<string>|string[]} unlockedAchievements
 * @param {{ getBest?: (diff: string) => number }} [ctx]
 */
export function isSkinUnlocked(id, unlockedAchievements, ctx) {
  const skin = getSkin(id);
  if (skin.unlock === 'default') return true;
  const set =
    unlockedAchievements instanceof Set
      ? unlockedAchievements
      : new Set(unlockedAchievements || []);
  if (set.has(skin.unlock)) return true;
  // Soft unlock: gold also if any difficulty PB ≥ 1500
  if (skin.id === 'gold' && ctx?.getBest) {
    for (const d of ['einfach', 'mittel', 'schwer', 'baba']) {
      if ((ctx.getBest(d) || 0) >= 1500) return true;
    }
  }
  return false;
}
