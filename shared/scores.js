/**
 * Shared leaderboard rules for the local Express API and the Cloudflare Worker.
 * Keep error strings and checks aligned with the v1.3 contract.
 */

export const MAX_SCORE = 750_000;
export const MAX_NAME = 16;
export const TOP_N = 50;
export const STORE_CAP = 500;
export const MIN_MS_BETWEEN_SUBMITS = 2_000;
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 30;
export const NEAR_MISS_POINTS = 75;
export const COMBO_STEP = 50;
export const COMBO_MAX = 5;

export const DIFFICULTY_ENUM = new Set(['einfach', 'mittel', 'schwer', 'baba']);
export const DEFAULT_DIFFICULTY = 'mittel';
export const MODE_ENUM = new Set(['normal', 'daily']);
export const GAME_ENUM = new Set(['rush', 'mirror', 'drift']);
export const DEFAULT_GAME = 'rush';
export const GAME_ERROR = 'Invalid game (rush|mirror|drift)';

export function normalizeMode(m) {
  return m === 'daily' ? 'daily' : 'normal';
}

/** Missing or unknown values stay on the Rush board so older rows and clients keep working. */
export function normalizeGame(g) {
  const s = typeof g === 'string' ? g.toLowerCase().trim() : '';
  if (GAME_ENUM.has(s)) return s;
  return DEFAULT_GAME;
}

export function isValidDailyDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, mo, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Strip HTML/control chars, trim, max length */
export function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  let s = name
    .replace(/[<>&"'`\\/]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_NAME);
  s = s.replace(/\s+/g, ' ');
  return s;
}

export function normalizeDifficulty(d) {
  const s = typeof d === 'string' ? d.toLowerCase().trim() : '';
  if (DIFFICULTY_ENUM.has(s)) return s;
  return DEFAULT_DIFFICULTY;
}

export function computeExpected(survivalMs, orbs, comboBonus, nearMisses) {
  const t = Math.floor(Math.max(0, survivalMs) / 1000);
  const o = Math.floor(Math.max(0, orbs));
  const cb = Math.floor(Math.max(0, comboBonus));
  const nm = Math.floor(Math.max(0, nearMisses));
  return t * 10 + o * 100 + cb + nm * NEAR_MISS_POINTS;
}

/** UUID v4 from the browser. Missing means an older client. */
const CLIENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * @param {unknown} raw
 * @returns {{ ok: true, clientId: string|null } | { ok: false }}
 */
export function normalizeClientId(raw) {
  if (raw == null || raw === '') return { ok: true, clientId: null };
  if (typeof raw !== 'string') return { ok: false };
  const clientId = raw.trim().toLowerCase();
  if (!CLIENT_ID_RE.test(clientId)) return { ok: false };
  return { ok: true, clientId };
}

export function mapRow(e, i) {
  const id = normalizeClientId(e.clientId ?? e.client_id ?? null);
  return {
    rank: i + 1,
    name: e.name,
    score: e.score,
    ts: e.ts,
    difficulty: normalizeDifficulty(e.difficulty),
    mode: normalizeMode(e.mode),
    dailyDate: e.dailyDate || null,
    clientId: id.ok ? id.clientId : null,
    game: normalizeGame(e.game),
  };
}

/**
 * Same filtering as GET /api/scores.
 * mode: 'daily' | 'normal' | null (null = no mode query)
 * difficulty: enum | null (null = all)
 * game: 'rush' | 'mirror' | 'drift' (missing = rush). Boards are never mixed.
 */
export function selectBoard(scores, { mode = null, dailyDate = null, difficulty = null, game = null } = {}) {
  let list = Array.isArray(scores) ? [...scores] : [];
  const boardGame = normalizeGame(game);
  list = list.filter((e) => normalizeGame(e.game) === boardGame);
  if (mode === 'daily') {
    list = list.filter((e) => normalizeMode(e.mode) === 'daily');
    if (dailyDate) list = list.filter((e) => e.dailyDate === dailyDate);
  } else if (mode === 'normal' || difficulty) {
    list = list.filter((e) => normalizeMode(e.mode) !== 'daily');
    if (difficulty) {
      list = list.filter((e) => normalizeDifficulty(e.difficulty) === difficulty);
    }
  }
  return list
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .slice(0, TOP_N)
    .map(mapRow);
}

export function rankOf(rows, { name, score, ts }) {
  const rank = rows.findIndex((e) => e.name === name && e.score === score && e.ts === ts) + 1;
  return rank || null;
}

export function validateScoresQuery(searchParams) {
  const modeRaw = typeof searchParams.get('mode') === 'string' ? searchParams.get('mode').toLowerCase().trim() : '';
  const dailyDateRaw = searchParams.get('dailyDate') ? String(searchParams.get('dailyDate')).trim() : '';
  const filterRaw = searchParams.get('difficulty') ? String(searchParams.get('difficulty')) : '';
  const gameRaw = searchParams.get('game') ? String(searchParams.get('game')).toLowerCase().trim() : '';

  if (modeRaw && !MODE_ENUM.has(modeRaw)) {
    return { ok: false, status: 400, error: 'Invalid mode (normal|daily)' };
  }
  if (dailyDateRaw && !isValidDailyDate(dailyDateRaw)) {
    return { ok: false, status: 400, error: 'Invalid dailyDate (YYYY-MM-DD)' };
  }
  if (filterRaw && filterRaw !== 'all' && !DIFFICULTY_ENUM.has(filterRaw.toLowerCase().trim())) {
    return { ok: false, status: 400, error: 'Invalid difficulty filter' };
  }
  if (gameRaw && !GAME_ENUM.has(gameRaw)) {
    return { ok: false, status: 400, error: GAME_ERROR };
  }

  const mode = modeRaw ? normalizeMode(modeRaw) : null;
  const dailyDate = dailyDateRaw || null;
  const difficulty = filterRaw && filterRaw !== 'all' ? normalizeDifficulty(filterRaw) : null;
  const game = gameRaw ? normalizeGame(gameRaw) : DEFAULT_GAME;
  return { ok: true, mode, dailyDate, difficulty, game };
}

export function validatePostBody(body) {
  const reqBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  let difficulty = DEFAULT_DIFFICULTY;
  if (reqBody.difficulty != null && reqBody.difficulty !== '') {
    const raw = String(reqBody.difficulty).toLowerCase().trim();
    if (!DIFFICULTY_ENUM.has(raw)) {
      return { ok: false, status: 400, error: 'Invalid difficulty (einfach|mittel|schwer|baba)' };
    }
    difficulty = raw;
  }

  let mode = 'normal';
  let dailyDate = null;
  if (reqBody.mode != null && reqBody.mode !== '') {
    const rawMode = String(reqBody.mode).toLowerCase().trim();
    if (!MODE_ENUM.has(rawMode)) {
      return { ok: false, status: 400, error: 'Invalid mode (normal|daily)' };
    }
    mode = normalizeMode(rawMode);
  }
  if (mode === 'daily') {
    const rawDate = reqBody.dailyDate != null ? String(reqBody.dailyDate).trim() : '';
    if (!isValidDailyDate(rawDate)) {
      return { ok: false, status: 400, error: 'dailyDate required for daily mode (YYYY-MM-DD)' };
    }
    dailyDate = rawDate;
    difficulty = 'schwer';
  }

  let game = DEFAULT_GAME;
  if (reqBody.game != null && reqBody.game !== '') {
    const rawGame = String(reqBody.game).toLowerCase().trim();
    if (!GAME_ENUM.has(rawGame)) {
      return { ok: false, status: 400, error: GAME_ERROR };
    }
    game = rawGame;
  }

  const clientParsed = normalizeClientId(reqBody.clientId);
  if (!clientParsed.ok) {
    return { ok: false, status: 400, error: 'Invalid clientId' };
  }

  const name = sanitizeName(reqBody.name);
  const score = Number(reqBody.score);
  const survivalMs = Number(reqBody.survivalMs ?? 0);
  const orbs = Number(reqBody.orbs ?? 0);
  const comboBonus = Number(reqBody.comboBonus ?? 0);
  const nearMisses = Number(reqBody.nearMisses ?? 0);

  if (!name || name.length < 1) {
    return { ok: false, status: 400, error: 'Name required (1–16 chars)' };
  }
  if (!Number.isFinite(score) || score < 0 || score !== Math.floor(score)) {
    return { ok: false, status: 400, error: 'Invalid score' };
  }
  if (score > MAX_SCORE) {
    return { ok: false, status: 400, error: 'Score too high' };
  }

  if (
    Number.isFinite(survivalMs) &&
    survivalMs >= 0 &&
    Number.isFinite(orbs) &&
    orbs >= 0 &&
    Number.isFinite(comboBonus) &&
    comboBonus >= 0 &&
    Number.isFinite(nearMisses) &&
    nearMisses >= 0
  ) {
    const maxComboBonus = Math.floor(orbs) * (COMBO_MAX - 1) * COMBO_STEP;
    if (comboBonus > maxComboBonus + 1) {
      return { ok: false, status: 400, error: 'Combo bonus too high' };
    }
    const maxNear = Math.max(8, Math.floor(survivalMs / 1000) * 4 + 10);
    if (nearMisses > maxNear) {
      return { ok: false, status: 400, error: 'Near-miss count too high' };
    }
    const expected = computeExpected(survivalMs, orbs, comboBonus, nearMisses);
    if (score > expected + 50 || score < expected - 5) {
      return { ok: false, status: 400, error: 'Score inconsistent with run' };
    }
  }

  return {
    ok: true,
    value: {
      name,
      score,
      survivalMs: Math.max(0, Math.floor(survivalMs) || 0),
      orbs: Math.max(0, Math.floor(orbs) || 0),
      comboBonus: Math.max(0, Math.floor(comboBonus) || 0),
      nearMisses: Math.max(0, Math.floor(nearMisses) || 0),
      difficulty,
      mode,
      dailyDate,
      clientId: clientParsed.clientId,
      game,
    },
  };
}

export function findRecentDuplicate(scores, value, key, now) {
  return scores.find(
    (e) =>
      e.name === value.name &&
      e.score === value.score &&
      e.key === key &&
      normalizeDifficulty(e.difficulty) === value.difficulty &&
      normalizeMode(e.mode) === value.mode &&
      (value.mode !== 'daily' || e.dailyDate === value.dailyDate) &&
      normalizeGame(e.game) === normalizeGame(value.game) &&
      now - e.ts < 10_000
  );
}

export function boardQueryForPost(value) {
  const game = normalizeGame(value.game);
  if (value.mode === 'daily') {
    return { mode: 'daily', dailyDate: value.dailyDate, difficulty: null, game };
  }
  return { mode: 'normal', dailyDate: null, difficulty: value.difficulty, game };
}

/** SHA-256 hex prefix, same 16 chars as the local Express server. */
export async function hashClientKey(ip) {
  const data = new TextEncoder().encode(String(ip ?? 'unknown'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
