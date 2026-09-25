/**
 * Leaderboard client: API first, localStorage fallback for offline demo.
 * v1.3: optional mode (normal|daily) + dailyDate filter/tag
 */

import { normalizeDifficulty, DEFAULT_DIFFICULTY } from './difficulty.js';
import { isValidDailyDate } from './rng.js';

const LS_KEY = 'orbit-rush-scores-v1';
const MAX_NAME = 16;
const TOP_N = 50;

export function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[<>&"'`\\/]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME);
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLocal(scores) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(scores.slice(0, 500)));
  } catch {
    /* ignore quota */
  }
}

function normalizeMode(m) {
  return m === 'daily' ? 'daily' : 'normal';
}

/**
 * @param {object[]} scores
 * @param {{ difficulty?: string, mode?: string, dailyDate?: string }} [filter]
 */
function rankLocal(scores, filter = {}) {
  let list = [...scores];
  const mode = filter.mode ? normalizeMode(filter.mode) : null;
  const dailyDate = filter.dailyDate && isValidDailyDate(filter.dailyDate) ? filter.dailyDate : null;
  const difficulty =
    filter.difficulty && filter.difficulty !== 'all'
      ? normalizeDifficulty(filter.difficulty)
      : null;

  if (mode === 'daily') {
    list = list.filter((e) => normalizeMode(e.mode) === 'daily');
    if (dailyDate) list = list.filter((e) => e.dailyDate === dailyDate);
  } else {
    // Normal / difficulty boards exclude daily entries
    if (mode === 'normal' || difficulty) {
      list = list.filter((e) => normalizeMode(e.mode) !== 'daily');
    }
    if (difficulty) {
      list = list.filter(
        (e) => normalizeDifficulty(e.difficulty || DEFAULT_DIFFICULTY) === difficulty
      );
    }
  }

  return list
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .slice(0, TOP_N)
    .map((e, i) => ({
      rank: i + 1,
      name: e.name,
      score: e.score,
      ts: e.ts,
      difficulty: normalizeDifficulty(e.difficulty || DEFAULT_DIFFICULTY),
      mode: normalizeMode(e.mode),
      dailyDate: e.dailyDate || null,
    }));
}

const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');

async function api(path, opts) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/json',
      ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Fetch scores.
 * @param {string|{ difficulty?: string, mode?: string, dailyDate?: string }} [filterOrDifficulty]
 */
export async function fetchScores(filterOrDifficulty) {
  /** @type {{ difficulty?: string, mode?: string, dailyDate?: string }} */
  let filter = {};
  if (typeof filterOrDifficulty === 'string') {
    filter = { difficulty: filterOrDifficulty };
  } else if (filterOrDifficulty && typeof filterOrDifficulty === 'object') {
    filter = filterOrDifficulty;
  }

  const params = new URLSearchParams();
  if (filter.mode === 'daily') {
    params.set('mode', 'daily');
    if (filter.dailyDate) params.set('dailyDate', filter.dailyDate);
  } else if (filter.difficulty && filter.difficulty !== 'all') {
    params.set('difficulty', normalizeDifficulty(filter.difficulty));
  }
  const q = params.toString() ? `?${params}` : '';

  try {
    const data = await api(`/api/scores${q}`);
    if (Array.isArray(data.scores)) return { scores: data.scores, source: 'api' };
  } catch {
    /* fall through */
  }
  return { scores: rankLocal(readLocal(), filter), source: 'local' };
}

/**
 * Submit score. Returns { rank, scores, source, duplicate? }
 */
export async function submitScore({
  name,
  score,
  survivalMs,
  orbs,
  comboBonus = 0,
  nearMisses = 0,
  difficulty = DEFAULT_DIFFICULTY,
  mode = 'normal',
  dailyDate,
}) {
  const clean = sanitizeName(name);
  if (!clean) throw new Error('Name required');
  const normalizedMode = normalizeMode(mode);
  const payload = {
    name: clean,
    score: Math.floor(Number(score)),
    survivalMs: Math.floor(Number(survivalMs) || 0),
    orbs: Math.floor(Number(orbs) || 0),
    comboBonus: Math.floor(Number(comboBonus) || 0),
    nearMisses: Math.floor(Number(nearMisses) || 0),
    difficulty: normalizeDifficulty(difficulty),
    mode: normalizedMode,
  };
  if (normalizedMode === 'daily') {
    if (!dailyDate || !isValidDailyDate(dailyDate)) {
      throw new Error('dailyDate required for daily mode (YYYY-MM-DD)');
    }
    payload.dailyDate = dailyDate;
  }

  try {
    const data = await api('/api/scores', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const local = readLocal();
    if (
      !local.some(
        (e) =>
          e.name === payload.name &&
          e.score === payload.score &&
          e.difficulty === payload.difficulty &&
          normalizeMode(e.mode) === payload.mode &&
          (payload.mode !== 'daily' || e.dailyDate === payload.dailyDate) &&
          Date.now() - e.ts < 10_000
      )
    ) {
      local.push({ ...payload, ts: Date.now() });
      writeLocal(local);
    }
    return {
      rank: data.rank,
      scores: data.scores,
      source: 'api',
      duplicate: !!data.duplicate,
    };
  } catch (e) {
    const local = readLocal();
    const now = Date.now();
    const dup = local.find(
      (x) =>
        x.name === payload.name &&
        x.score === payload.score &&
        x.difficulty === payload.difficulty &&
        normalizeMode(x.mode) === payload.mode &&
        (payload.mode !== 'daily' || x.dailyDate === payload.dailyDate) &&
        now - x.ts < 10_000
    );
    if (!dup) {
      local.push({ ...payload, ts: now });
      writeLocal(local);
    }
    const ranked = rankLocal(local, {
      mode: payload.mode,
      dailyDate: payload.dailyDate,
      difficulty: payload.mode === 'daily' ? undefined : payload.difficulty,
    });
    const rank =
      ranked.findIndex(
        (x) =>
          x.name === payload.name &&
          x.score === payload.score &&
          x.difficulty === payload.difficulty &&
          x.mode === payload.mode
      ) + 1 || null;
    return {
      rank,
      scores: ranked,
      source: 'local',
      fallback: true,
      error: e.message,
    };
  }
}
