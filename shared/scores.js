/**
 * Shared leaderboard rules for the local Express API and the Cloudflare Worker.
 * Keep error strings and checks aligned with the v1.3 contract.
 */

export const MAX_SCORE = 750_000;
export const MAX_NAME = 16;
export const TOP_N = 50;
/** Legacy global ceiling. Retention is per board now; this stays as a hard backstop. */
export const STORE_CAP = 500;
/** Visible boards are 50 deep. Keep a cushion, then drop the rest on the next submit. */
export const BOARD_KEEP = 120;
/** One network can post a household of scores, not the whole board. */
export const PER_CLIENT_KEEP = 8;
/** Direct D1 rows. Never pruned. client_key or client_id may carry this marker. */
export const OWNER_CLIENT_KEY = 'owner-entry';
export const MIN_MS_BETWEEN_SUBMITS = 2_000;
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 30;
/** Separate budget so opening a round does not eat the leaderboard limit. */
export const START_RATE_MAX = 20;
/** Hourly budgets. Per-minute windows reset too fast to stop a token farm. */
export const HOUR_MS = 60 * 60 * 1000;
export const START_HOUR_IP = 90;
export const START_HOUR_CLIENT = 40;
export const SUBMIT_HOUR_IP = 48;
export const SUBMIT_HOUR_CLIENT = 16;
/** Client survival may lead the server clock by a short start/submit race. */
export const SURVIVAL_TOLERANCE_MS = 2_500;
/** A paused endless run can sit; a day-old token cannot be cashed in. */
export const RUN_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Same token + same stats can refresh the duplicate response. A different body cannot. */
export const RUN_REPLAY_WINDOW_MS = 15_000;
export const NEAR_MISS_POINTS = 75;
export const COMBO_STEP = 50;
export const COMBO_MAX = 5;

export const DIFFICULTY_ENUM = new Set(['einfach', 'mittel', 'schwer', 'baba']);
export const DEFAULT_DIFFICULTY = 'mittel';
export const MODE_ENUM = new Set(['normal', 'daily']);
export const GAME_ENUM = new Set(['rush', 'mirror', 'drift', 'pulse', 'jet', 'dash', 'hunt', 'mahjong']);
export const DEFAULT_GAME = 'rush';
export const GAME_ERROR = 'Invalid game (rush|mirror|drift|pulse|jet|dash|hunt|mahjong)';

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

/** UTC calendar day. Daily submits may be yesterday, today, or tomorrow. */
export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function dailyDateAllowed(dailyDate, now = Date.now()) {
  if (!isValidDailyDate(dailyDate)) return false;
  const today = utcDay(now);
  return (
    dailyDate === today ||
    dailyDate === utcDay(now - 86_400_000) ||
    dailyDate === utcDay(now + 86_400_000)
  );
}

export function isOwnerScore(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const key = entry.key || entry.client_key || '';
  const id = entry.clientId || entry.client_id || '';
  return key === OWNER_CLIENT_KEY || id === OWNER_CLIENT_KEY;
}

/** Board identity used for retention. Daily boards ignore difficulty. */
export function boardPartition(entry) {
  const game = normalizeGame(entry?.game);
  const mode = normalizeMode(entry?.mode);
  const daily = mode === 'daily' ? String(entry?.dailyDate || entry?.daily_date || '') : '';
  const difficulty = mode === 'daily' ? '' : normalizeDifficulty(entry?.difficulty);
  return `${game}|${mode}|${difficulty}|${daily}`;
}

function byScoreThenTime(a, b) {
  return b.score - a.score || a.ts - b.ts;
}

/**
 * Drop flooded rows. Owner markers stay. Each client keeps a few best scores
 * per board, and each board keeps BOARD_KEEP non-owner rows.
 * @param {object[]} scores
 */
export function pruneScores(scores) {
  const list = Array.isArray(scores) ? scores : [];
  const owners = [];
  const rest = [];
  for (const entry of list) {
    if (isOwnerScore(entry)) owners.push(entry);
    else rest.push(entry);
  }
  const byClient = new Map();
  for (const entry of rest) {
    const ck = `${entry.key || entry.client_key || ''}|${boardPartition(entry)}`;
    if (!byClient.has(ck)) byClient.set(ck, []);
    byClient.get(ck).push(entry);
  }
  const capped = [];
  for (const rows of byClient.values()) {
    rows.sort(byScoreThenTime);
    capped.push(...rows.slice(0, PER_CLIENT_KEEP));
  }
  const byBoard = new Map();
  for (const entry of capped) {
    const bk = boardPartition(entry);
    if (!byBoard.has(bk)) byBoard.set(bk, []);
    byBoard.get(bk).push(entry);
  }
  const kept = [...owners];
  for (const rows of byBoard.values()) {
    rows.sort(byScoreThenTime);
    kept.push(...rows.slice(0, BOARD_KEEP));
  }
  return kept;
}

const BANNED_NAME_FRAGMENTS = [
  'fuck',
  'shit',
  'bitch',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'cunt',
  'whore',
  'ficken',
  'hurensohn',
  'wichser',
  'schlampe',
  'fotze',
  'arschloch',
  'scheisse',
  'hitler',
  'nazi',
  'nutte',
];

/**
 * Strip HTML, controls, bidi/zero-width, and lookalike format chars.
 * Only Latin letters, digits, and a little punctuation remain, so a Cyrillic
 * homoglyph cannot impersonate a Latin name. Empty means "reject this name".
 */
export function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  let s = name.normalize('NFKC');
  s = s
    .replace(/[<>&"'`\\/]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFE00-\uFE0F\uFEFF]/g, '')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
  if (!s) return '';
  if (!/^[\p{Script=Latin}\p{Nd} .'_!?+-]+$/u.test(s)) return '';
  if (!/[\p{Script=Latin}\p{Nd}]/u.test(s)) return '';
  return s;
}

/** Lowercased letters only, so "f.u.c.k" and "SCHLAMPE" still match. */
export function isBannedName(name) {
  const flat = String(name || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
  if (!flat) return false;
  return BANNED_NAME_FRAGMENTS.some((word) => flat.includes(word));
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function inspectName(raw) {
  const name = sanitizeName(typeof raw === 'string' ? raw : '');
  if (!name) return { ok: false, error: 'Name required (1–16 chars)' };
  if (isBannedName(name)) return { ok: false, error: 'Name not allowed' };
  return { ok: true, name };
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
 * game: 'rush' | 'mirror' | 'drift' | 'pulse' | 'jet' | 'dash' | 'hunt' | 'mahjong' (missing = rush). Boards are never mixed.
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

/**
 * Spawn-rate ceilings from the client, with headroom so a real round still
 * submits. Hunt is not endless: einfach 120s, mittel 90s, schwer 68s
 * (src/hunt.js HUNT_DIFFICULTIES). Live Mittel tops are about 43k (owner
 * 43247, next human 40725) with roughly 120–160 orbs. Absolute caps are the
 * ceiling for a full round; orbs and points also scale with survivalMs so a
 * fresh token cannot be cashed as a max-cap score. The forged 58400 / 450-orb
 * posts sit above these caps.
 *
 * Rush/Mirror orb timers bottom out around 0.35–0.55s (src/game.js, src/mirror.js).
 * Drift rings are every 84 units at a baba speed cap near 112 (src/drift.js).
 * Dash ring chance times the gap/speed cap stays under ~1.2/s (src/dash.js).
 * Jet waves are ~0.7s before difficulty multipliers, plus a boss lump of 8
 * (src/jet.js). Pulse charts peak around a few notes per second across a
 * chained playlist (public/pulse-music/manifest.json). Mahjong pairs cannot
 * exceed a 144-tile set (src/mahjong.js validatePositions).
 */
const HUNT_CAPS = {
  einfach: {
    maxSurvivalMs: 120_750,
    orbsPerSec: 1.9,
    orbGrace: 18,
    nearPerSec: 1.3,
    nearGrace: 12,
    scorePerSec: 500,
    scoreGrace: 2800,
    maxOrbs: 220,
    maxNear: 150,
    maxScore: 58_000,
  },
  mittel: {
    maxSurvivalMs: 90_750,
    orbsPerSec: 2.05,
    orbGrace: 16,
    nearPerSec: 1.35,
    nearGrace: 12,
    scorePerSec: 560,
    scoreGrace: 3000,
    maxOrbs: 200,
    maxNear: 130,
    maxScore: 52_000,
  },
  schwer: {
    maxSurvivalMs: 68_750,
    orbsPerSec: 2.3,
    orbGrace: 14,
    nearPerSec: 1.5,
    nearGrace: 10,
    scorePerSec: 640,
    scoreGrace: 2400,
    maxOrbs: 170,
    maxNear: 110,
    maxScore: 46_000,
  },
};

const PULSE_MAX_SURVIVAL_MS = {
  einfach: 4 * 55_000 + 60_000,
  mittel: 6 * 70_000 + 80_000,
  schwer: 4 * 85_000 + 60_000,
  baba: 6 * 100_000 + 80_000,
  daily: 130_000,
};

const RATE_CAPS = {
  rush: { maxSurvivalMs: 90 * 60 * 1000, orbsPerSec: 2.6, orbGrace: 10, nearPerSec: 2.4, nearGrace: 12, scorePerSec: 1100, scoreGrace: 1600 },
  mirror: { maxSurvivalMs: 90 * 60 * 1000, orbsPerSec: 2.2, orbGrace: 8, nearPerSec: 2.2, nearGrace: 12, scorePerSec: 980, scoreGrace: 1400 },
  drift: { maxSurvivalMs: 60 * 60 * 1000, orbsPerSec: 1.9, orbGrace: 8, nearPerSec: 1.6, nearGrace: 10, scorePerSec: 860, scoreGrace: 1200 },
  pulse: { maxSurvivalMs: 15 * 60 * 1000, orbsPerSec: 5.2, orbGrace: 16, nearPerSec: 5.2, nearGrace: 16, scorePerSec: 2200, scoreGrace: 2000 },
  jet: { maxSurvivalMs: 60 * 60 * 1000, orbsPerSec: 4.8, orbGrace: 20, nearPerSec: 4.4, nearGrace: 14, scorePerSec: 2000, scoreGrace: 2500 },
  dash: { maxSurvivalMs: 45 * 60 * 1000, orbsPerSec: 1.8, orbGrace: 8, nearPerSec: 2.4, nearGrace: 10, scorePerSec: 900, scoreGrace: 1200 },
};

/**
 * Endless modes have no replay. Ceilings are about 10% above the best live D1
 * row on 2026-10-24, rounded up. A later honest record past the ceiling is
 * rejected until this table is raised. Grades with no rows use that game's
 * highest observed score so they are not a softer farm lane. Mirror has no
 * rows and shares Rush einfach. Baba Rush has no rows and shares einfach.
 */
const SCORE_CEILING = {
  rush: { einfach: 7600, mittel: 4100, schwer: 2800, baba: 7600 },
  mirror: { einfach: 7600, mittel: 7600, schwer: 7600, baba: 7600 },
  drift: { einfach: 18800, mittel: 6400, schwer: 18800, baba: 18800 },
  pulse: { einfach: 91000, mittel: 91000, schwer: 49000, baba: 91000 },
  jet: { einfach: 28000, mittel: 47000, schwer: 30000, baba: 47000 },
  dash: { einfach: 29000, mittel: 80000, schwer: 80000, baba: 80000 },
};

const MAHJONG_CAPS = {
  maxSurvivalMs: 60_000,
  maxOrbs: 72,
  /** A full 72-pair clear tops out near 28k in the shared formula. */
  maxScore: 30_000,
};

function rateCap(seconds, perSec, grace) {
  return Math.floor(grace + Math.max(0, seconds) * perSec);
}

/**
 * @param {{ game: string, difficulty: string, mode: string, survivalMs: number, orbs: number, comboBonus: number, nearMisses: number, score: number }} value
 * @returns {string|null}
 */
export function plausibilityError(value) {
  const sec = Math.floor(value.survivalMs / 1000);
  if (value.game === 'hunt') {
    const cap = HUNT_CAPS[value.difficulty] || HUNT_CAPS.mittel;
    // Replay recomputes the score. These are only a sanity ceiling above a
    // perfect autoplay of the sim, so a forged million still dies here.
    if (value.survivalMs > cap.maxSurvivalMs) return 'Survival too long';
    if (value.orbs > 900) return 'Orb count too high';
    if (value.nearMisses > 900) return 'Near-miss count too high';
    if (value.score > 160_000) return 'Score too high for this run';
  } else if (value.game === 'mahjong') {
    if (value.survivalMs > MAHJONG_CAPS.maxSurvivalMs) return 'Survival too long';
    if (value.orbs > MAHJONG_CAPS.maxOrbs) return 'Orb count too high';
    if (value.nearMisses > value.orbs) return 'Near-miss count too high';
    if (value.score > MAHJONG_CAPS.maxScore) return 'Score too high for this run';
  } else {
    const cap = RATE_CAPS[value.game] || RATE_CAPS.rush;
    let maxSurvival = cap.maxSurvivalMs;
    if (value.game === 'pulse') {
      maxSurvival =
        value.mode === 'daily'
          ? PULSE_MAX_SURVIVAL_MS.daily
          : PULSE_MAX_SURVIVAL_MS[value.difficulty] || PULSE_MAX_SURVIVAL_MS.baba;
    }
    if (value.survivalMs > maxSurvival) return 'Survival too long';
    if (value.orbs > rateCap(sec, cap.orbsPerSec, cap.orbGrace)) return 'Orb count too high';
    if (value.nearMisses > rateCap(sec, cap.nearPerSec, cap.nearGrace)) return 'Near-miss count too high';
    if (value.score > rateCap(sec, cap.scorePerSec, cap.scoreGrace)) return 'Score too high for this run';
    const ceiling = SCORE_CEILING[value.game]?.[value.difficulty];
    if (ceiling && value.score > ceiling) return 'Score too high for this run';
  }

  const maxComboBonus = value.orbs * (COMBO_MAX - 1) * COMBO_STEP;
  if (value.comboBonus > maxComboBonus) return 'Combo bonus too high';
  const expected = computeExpected(value.survivalMs, value.orbs, value.comboBonus, value.nearMisses);
  if (value.score > expected + 50 || value.score < expected - 5) {
    return 'Score inconsistent with run';
  }
  return null;
}

/** Whole counts only. Sub-millisecond clock noise still rounds. */
function readCount(raw, label, { required = false } = {}) {
  if (raw == null || raw === '') {
    if (required) return { ok: false, error: `Invalid ${label}` };
    return { ok: true, value: 0 };
  }
  if (typeof raw === 'boolean') return { ok: false, error: `Invalid ${label}` };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `Invalid ${label}` };
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) > 0.001) return { ok: false, error: `Invalid ${label}` };
  return { ok: true, value: rounded };
}

/**
 * Game, difficulty, and mode shared by POST /api/run/start and POST /api/scores.
 * Hunt and Mahjong have no Baba grade; the clients fold that into Mittel.
 */
export function normalizeRunRequest(body) {
  const reqBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  let game = DEFAULT_GAME;
  if (reqBody.game != null && reqBody.game !== '') {
    const rawGame = String(reqBody.game).toLowerCase().trim();
    if (!GAME_ENUM.has(rawGame)) {
      return { ok: false, status: 400, error: GAME_ERROR };
    }
    game = rawGame;
  }

  let mode = 'normal';
  if (reqBody.mode != null && reqBody.mode !== '') {
    const rawMode = String(reqBody.mode).toLowerCase().trim();
    if (!MODE_ENUM.has(rawMode)) {
      return { ok: false, status: 400, error: 'Invalid mode (normal|daily)' };
    }
    mode = normalizeMode(rawMode);
  }

  let difficulty = DEFAULT_DIFFICULTY;
  if (reqBody.difficulty != null && reqBody.difficulty !== '') {
    const raw = String(reqBody.difficulty).toLowerCase().trim();
    const leicht = raw === 'leicht' && (game === 'hunt' || game === 'mahjong');
    if (!DIFFICULTY_ENUM.has(raw) && !leicht) {
      return { ok: false, status: 400, error: 'Invalid difficulty (einfach|mittel|schwer|baba)' };
    }
    difficulty = leicht ? 'einfach' : raw;
  }

  let dailyDate = null;
  if (mode === 'daily') {
    const rawDate = reqBody.dailyDate != null ? String(reqBody.dailyDate).trim() : '';
    if (!isValidDailyDate(rawDate)) {
      return { ok: false, status: 400, error: 'dailyDate required for daily mode (YYYY-MM-DD)' };
    }
    if (!dailyDateAllowed(rawDate)) {
      return { ok: false, status: 400, error: 'dailyDate is outside the play window' };
    }
    dailyDate = rawDate;
    difficulty = 'schwer';
  }
  if ((game === 'hunt' || game === 'mahjong') && difficulty === 'baba') difficulty = 'mittel';

  return { ok: true, value: { game, difficulty, mode, dailyDate } };
}

export function validatePostBody(body) {
  const reqBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const run = normalizeRunRequest(reqBody);
  if (!run.ok) return run;

  const clientParsed = normalizeClientId(reqBody.clientId);
  if (!clientParsed.ok) {
    return { ok: false, status: 400, error: 'Invalid clientId' };
  }

  const named = inspectName(reqBody.name);
  if (!named.ok) return { ok: false, status: 400, error: named.error };
  const name = named.name;

  const scoreParsed = readCount(reqBody.score, 'score', { required: true });
  if (!scoreParsed.ok) return { ok: false, status: 400, error: 'Invalid score' };
  const survivalParsed = readCount(reqBody.survivalMs, 'survival');
  if (!survivalParsed.ok) return { ok: false, status: 400, error: 'Invalid survival' };
  const orbsParsed = readCount(reqBody.orbs, 'orbs');
  if (!orbsParsed.ok) return { ok: false, status: 400, error: 'Invalid orbs' };
  const comboParsed = readCount(reqBody.comboBonus, 'combo');
  if (!comboParsed.ok) return { ok: false, status: 400, error: 'Invalid combo' };
  const nearParsed = readCount(reqBody.nearMisses, 'near-misses');
  if (!nearParsed.ok) return { ok: false, status: 400, error: 'Invalid near-misses' };

  const score = scoreParsed.value;
  if (score > MAX_SCORE) {
    return { ok: false, status: 400, error: 'Score too high' };
  }

  const value = {
    name,
    score,
    survivalMs: survivalParsed.value,
    orbs: orbsParsed.value,
    comboBonus: comboParsed.value,
    nearMisses: nearParsed.value,
    difficulty: run.value.difficulty,
    mode: run.value.mode,
    dailyDate: run.value.dailyDate,
    clientId: clientParsed.clientId,
    game: run.value.game,
  };
  const why = plausibilityError(value);
  if (why) return { ok: false, status: 400, error: why };
  return { ok: true, value };
}

export function runFingerprint(value) {
  return [
    value.name,
    value.score,
    value.survivalMs,
    value.orbs,
    value.comboBonus,
    value.nearMisses,
    value.difficulty,
    value.mode,
    value.dailyDate || '',
    value.game,
  ].join('|');
}

/**
 * Minimum server-side age of a run before these stats are believable.
 * Mahjong's submitted survivalMs is a small synthetic pad (packMahjongScore),
 * so a full board still has to have existed for a moment.
 */
export function minRunElapsedMs(value) {
  const fromClock = Math.max(0, value.survivalMs - SURVIVAL_TOLERANCE_MS);
  if (value.game !== 'mahjong') return fromClock;
  const fromPairs = Math.max(0, value.orbs - 16) * 250;
  return Math.max(fromClock, fromPairs);
}

/** @param {number} startedAt @param {object} value @param {number} now */
export function runClockError(startedAt, value, now) {
  const elapsed = now - Number(startedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(elapsed)) return 'Run clock invalid';
  if (elapsed < -SURVIVAL_TOLERANCE_MS || elapsed > RUN_MAX_AGE_MS) return 'Run expired';
  if (minRunElapsedMs(value) > elapsed) return 'Run faster than the server clock';
  if (value.survivalMs > elapsed + SURVIVAL_TOLERANCE_MS) return 'Run faster than the server clock';
  return null;
}

export function runMatchError(claims, value) {
  if (!claims) return 'Run token invalid';
  if (claims.game !== value.game || claims.difficulty !== value.difficulty || claims.mode !== value.mode) {
    return 'Run does not match this score';
  }
  if ((claims.dailyDate || null) !== (value.dailyDate || null)) return 'Run does not match this score';
  return null;
}

/**
 * @param {{ game?: string, difficulty?: string, mode?: string, dailyDate?: string|null, startedAt?: number, expiresAt?: number, consumedAt?: number|null, fingerprint?: string|null }|null} row
 * @param {{ game: string, difficulty: string, mode: string, dailyDate: string|null }} claims
 * @param {object} value
 * @param {number} now
 */
export function evaluateStoredRun(row, claims, value, now) {
  if (!row) return { ok: false, status: 400, error: 'Run not found' };
  if (
    row.game !== claims.game ||
    row.difficulty !== claims.difficulty ||
    row.mode !== claims.mode ||
    (row.dailyDate || null) !== (claims.dailyDate || null)
  ) {
    return { ok: false, status: 400, error: 'Run token invalid' };
  }
  const match = runMatchError(claims, value);
  if (match) return { ok: false, status: 400, error: match };
  if (Number(row.expiresAt) < now) return { ok: false, status: 400, error: 'Run expired' };
  const clock = runClockError(Number(row.startedAt), value, now);
  if (clock) return { ok: false, status: 400, error: clock };
  const fingerprint = runFingerprint(value);
  if (row.consumedAt) {
    const age = now - Number(row.consumedAt);
    if (row.fingerprint === fingerprint && age >= 0 && age <= RUN_REPLAY_WINDOW_MS) {
      return { ok: true, duplicate: true, fingerprint };
    }
    return { ok: false, status: 400, error: 'Run already submitted' };
  }
  return { ok: true, duplicate: false, fingerprint };
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
