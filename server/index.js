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
  STORE_CAP,
  MIN_MS_BETWEEN_SUBMITS,
  validatePostBody,
  validateScoresQuery,
  selectBoard,
  findRecentDuplicate,
  boardQueryForPost,
  rankOf,
  hashClientKey,
} from '../shared/scores.js';
import { handleAerger } from '../worker/aerger-api.js';
import { createFileAergerStore } from './aerger-file-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const PORT = Number(process.env.PORT || 8787);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, '[]', 'utf8');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '8kb' }));

const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});
// Ärger polls about every 1–2s and has its own in-memory limiter. The score limiter
// stays at 30/min so leaderboard spam protection does not change.
app.use('/api/', (req, res, next) => {
  if (req.originalUrl.startsWith('/api/aerger')) return next();
  return limiter(req, res, next);
});

const aergerStore = createFileAergerStore(
  process.env.AERGER_FILE || path.join(DATA_DIR, 'aerger-rooms.json')
);

app.use('/api/aerger', async (req, res) => {
  try {
    const response = await handleAerger(expressToRequest(req), aergerStore);
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
  if (!headers.has('x-forwarded-for')) {
    headers.set('x-forwarded-for', req.ip || req.socket?.remoteAddress || 'unknown');
  }
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
  res.json({ ok: true, service: 'orbit-rush-api', version: '1.4' });
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

app.post('/api/scores', async (req, res) => {
  const parsed = validatePostBody(req.body);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
  const value = parsed.value;

  const key = await hashClientKey(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const last = recentSubmits.get(key) || 0;
  if (now - last < MIN_MS_BETWEEN_SUBMITS) {
    return res.status(429).json({ error: 'Slow down' });
  }

  const scores = readScores();
  const dup = findRecentDuplicate(scores, value, key, now);
  const board = boardQueryForPost(value);
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
  scores.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const trimmed = scores.slice(0, STORE_CAP);
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
