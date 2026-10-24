/**
 * Orbit Rush – tiny Express leaderboard API (v1.3)
 *
 * Local / demo store: ../data/scores.json (single process).
 * Production store: Cloudflare D1 via worker/api.js (same /api/scores contract).
 * See server/PRODUCTION.md and DEPLOY.md.
 *
 * Score = floor(t)×10 + orbs×100 + comboBonus + nearMisses×75
 * Optional difficulty: einfach | mittel | schwer | baba
 */
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MIN_MS_BETWEEN_SUBMITS,
  pruneScores,
  START_RATE_MAX,
  RUN_MAX_AGE_MS,
  RATE_WINDOW_MS,
  validatePostBody,
  validateScoresQuery,
  normalizeRunRequest,
  selectBoard,
  findRecentDuplicate,
  boardQueryForPost,
  rankOf,
  hashClientKey,
  evaluateStoredRun,
} from '../shared/scores.js';
import { signRunToken, verifyRunToken } from '../shared/run-token.js';
import { handleAerger } from '../worker/aerger-api.js';
import { createFileAergerStore } from './aerger-file-store.js';
import { handleDuel } from '../worker/duel-api.js';
import { createFileDuelStore } from './duel-file-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const RUNS_FILE = process.env.RUNS_FILE || path.join(DATA_DIR, 'runs.json');
const PORT = Number(process.env.PORT || 8787);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, '[]', 'utf8');

const app = express();
app.set('trust proxy', false);
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(cors({ origin: true }));
app.use(express.json({ limit: '8kb' }));

/** Socket peer only. A client-supplied X-Forwarded-For must not open a new bucket. */
function peerIp(req) {
  const raw = req.socket?.remoteAddress || '';
  const ip = String(raw).replace(/^::ffff:/, '').trim();
  return ip || 'unknown';
}

const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => peerIp(req),
  validate: { trustProxy: false, xForwardedForHeader: false },
  message: { error: 'Too many requests' },
});
// Ärger and Duel poll on their own in-memory limiters. The score limiter
// stays at 30/min so leaderboard spam protection does not change.
app.use('/api/', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/aerger')) return next();
  if (req.originalUrl.startsWith('/api/duel')) return next();
  // Round starts have their own budget so a game open does not trip the score limiter.
  if (req.originalUrl.startsWith('/api/run/start')) return next();
  return limiter(req, res, next);
});

const aergerStore = createFileAergerStore(
  process.env.AERGER_FILE || path.join(DATA_DIR, 'aerger-rooms.json')
);
const duelStore = createFileDuelStore(process.env.DUEL_FILE || path.join(DATA_DIR, 'duel-rooms.json'));

app.use('/api/aerger', async (req, res) => {
  try {
    const response = await handleAerger(expressToRequest(req), aergerStore);
    await sendWebResponse(res, response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.use('/api/duel', async (req, res) => {
  try {
    const response = await handleDuel(expressToRequest(req), duelStore);
    await sendWebResponse(res, response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

function expressToRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  headers.delete('cf-connecting-ip');
  headers.delete('x-forwarded-for');
  headers.set('cf-connecting-ip', peerIp(req));
  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  return new Request(`http://127.0.0.1${req.originalUrl}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
  });
}

async function sendWebResponse(res, response) {
  const buf = Buffer.from(await response.arrayBuffer());
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(buf);
}

/** Recent submit fingerprints for double-submit / spam guard */
const recentSubmits = new Map(); // key -> timestamp
const startHits = new Map(); // ip -> { windowStart, hits }

function newRunSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readRunStore() {
  try {
    const data = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'));
    if (!data || typeof data !== 'object' || typeof data.secret !== 'string' || !data.secret) {
      throw new Error('missing secret');
    }
    if (!data.runs || typeof data.runs !== 'object') data.runs = {};
    return data;
  } catch {
    const data = { secret: newRunSecret(), runs: {} };
    writeRunStore(data);
    return data;
  }
}

function writeRunStore(data) {
  const tmp = RUNS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, RUNS_FILE);
}

function bumpStartLimit(ip, now) {
  const row = startHits.get(ip) || { windowStart: now, hits: 0 };
  if (now - row.windowStart >= RATE_WINDOW_MS) {
    row.windowStart = now;
    row.hits = 0;
  }
  row.hits += 1;
  startHits.set(ip, row);
  return row.hits;
}

function readScores() {
  try {
    const raw = fs.readFileSync(SCORES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeScores(scores) {
  const tmp = SCORES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(scores, null, 2), 'utf8');
  fs.renameSync(tmp, SCORES_FILE);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'orbit-rush-api', version: '1.5' });
});

app.get('/api/scores', (req, res) => {
  const parsed = validateScoresQuery(new URL(req.originalUrl, 'http://local').searchParams);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
  const top = selectBoard(readScores(), parsed);
  res.json({
    scores: top,
    difficulty: parsed.difficulty || 'all',
    mode: parsed.mode || 'all',
    dailyDate: parsed.dailyDate || null,
    game: parsed.game || 'rush',
  });
});

app.post('/api/run/start', async (req, res) => {
  const parsed = normalizeRunRequest(req.body);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
  const now = Date.now();
  const ip = peerIp(req);
  if (bumpStartLimit(ip, now) > START_RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  const store = readRunStore();
  for (const [id, row] of Object.entries(store.runs)) {
    if (Number(row.expiresAt) < now) delete store.runs[id];
  }
  const runId = crypto.randomUUID();
  const { game, difficulty, mode, dailyDate } = parsed.value;
  store.runs[runId] = {
    game,
    difficulty,
    mode,
    dailyDate,
    startedAt: now,
    expiresAt: now + RUN_MAX_AGE_MS,
    consumedAt: null,
    fingerprint: null,
  };
  writeRunStore(store);
  try {
    const token = await signRunToken(store.secret, {
      id: runId,
      game,
      difficulty,
      mode,
      dailyDate,
      startedAt: now,
    });
    res.json({ ok: true, runId, token, game, difficulty, mode, dailyDate, startedAt: now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Run signing unavailable' });
  }
});

app.post('/api/scores', async (req, res) => {
  const parsed = validatePostBody(req.body);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
  const value = parsed.value;

  const key = await hashClientKey(peerIp(req));
  const now = Date.now();
  const last = recentSubmits.get(key) || 0;
  if (now - last < MIN_MS_BETWEEN_SUBMITS) {
    return res.status(429).json({ error: 'Slow down' });
  }

  const store = readRunStore();
  const verified = await verifyRunToken(store.secret, req.body?.runToken);
  if (!verified.ok) return res.status(400).json({ error: verified.error });
  const row = store.runs[verified.claims.id] || null;
  let verdict = evaluateStoredRun(row, verified.claims, value, now);
  if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });
  if (!verdict.duplicate) {
    if (row.consumedAt) return res.status(400).json({ error: 'Run already submitted' });
    row.consumedAt = now;
    row.fingerprint = verdict.fingerprint;
    writeRunStore(store);
  }

  const scores = readScores();
  const board = boardQueryForPost(value);
  const dup = verdict.duplicate
    ? { ts: Number(row?.consumedAt) || now }
    : findRecentDuplicate(scores, value, key, now);
  if (dup) {
    recentSubmits.set(key, now);
    const ranked = selectBoard(scores, board);
    return res.json({
      ok: true,
      duplicate: true,
      rank: rankOf(ranked, { name: value.name, score: value.score, ts: dup.ts }),
      scores: ranked,
    });
  }

  const entry = { ...value, ts: now, key };
  scores.push(entry);
  const trimmed = pruneScores(scores);
  writeScores(trimmed);
  recentSubmits.set(key, now);

  for (const [k, t] of recentSubmits) {
    if (now - t > 120_000) recentSubmits.delete(k);
  }

  const sameDiff = selectBoard(trimmed, board);
  res.json({
    ok: true,
    rank: rankOf(sameDiff, { name: value.name, score: value.score, ts: entry.ts }),
    scores: sameDiff,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Orbit Rush API on http://127.0.0.1:${PORT}`);
});
