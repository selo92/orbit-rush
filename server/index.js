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
app.use('/api/', limiter);

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
  res.json({ ok: true, service: 'orbit-rush-api', version: '1.3' });
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
