/**
 * Orbit Duel client. Polls GET /api/duel/room/:code.
 * Lobby polls slowly. A live rally polls faster and draws the ball ahead
 * from the snapshot timestamp, so a late poll does not freeze or smear it.
 * The poll also carries the paddle. Points stay server-side.
 * Hidden tabs pause. The pilot name is the same orbit-rush-name as the other games.
 */
import { loadPlayerName, savePlayerName } from './identity.js';
import {
  BALL_R,
  HEARTBEAT_MS,
  PADDLE_FAST_INTERVAL_MS,
  PADDLE_H,
  PADDLE_W,
  WIN_SCORE,
  clampPaddle,
  normalizeRoomCode,
  paddleCenterY,
  paddleCovers,
  paddleWriteIntervalMs,
  pollDelayMs,
  projectDefense,
  projectLive,
  viewY,
} from '../shared/duel.js';

const FIELD_INSET = 10;

const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');
const SS_KEY = 'orbit-duel-session';
const WINS_KEY = 'orbit-duel-wins';
const RECORDED_KEY = 'orbit-duel-recorded';

const $ = (id) => document.getElementById(id);

let live = false;
let pollTimer = 0;
let heartTimer = 0;
let sendTimer = 0;
let raf = 0;
let busy = false;
let code = '';
let secret = '';
let version = 0;
let state = null;
let showHub = () => {};
let playClick = () => {};
let localPaddle = 0.5;
let lastSent = 0.5;
let lastSendAt = 0;
let sendFlight = false;
let clockOffset = 0;
let clockReady = false;
let lastFrame = 0;
let snapPerf = 0;
let blend = null;
let dragging = false;
let paddleShown = [0.5, 0.5];
let paddleFrameAt = 0;
const keys = new Set();
const trail = [];

const stars = Array.from({ length: 36 }, (_, i) => ({
  x: ((i * 53) % 97) / 97,
  y: ((i * 29) % 89) / 89,
  r: (i % 3) * 0.4 + 0.6,
}));

function readSession() {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.code || !data?.secret) return null;
    return data;
  } catch {
    return null;
  }
}

function saveSession() {
  try {
    if (!code || !secret) return;
    sessionStorage.setItem(SS_KEY, JSON.stringify({ code, secret }));
  } catch {
    /* private mode */
  }
}

function clearSession() {
  code = '';
  secret = '';
  version = 0;
  state = null;
  lastSendAt = 0;
  snapPerf = 0;
  blend = null;
  paddleShown = [0.5, 0.5];
  paddleFrameAt = 0;
  trail.length = 0;
  try {
    sessionStorage.removeItem(SS_KEY);
  } catch {
    /* ignore */
  }
}

function readWins() {
  try {
    const n = Number(localStorage.getItem(WINS_KEY) || 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function renderWins() {
  const el = $('duel-wins');
  if (el) el.textContent = `Siege auf diesem Gerät: ${readWins()}`;
}

function noteWin() {
  if (!state || state.status !== 'finished' || !state.winner || !code) return;
  const me = mySeat();
  if (!me || me.role !== state.winner) return;
  const key = `${code}:${state.matchSeq || 0}`;
  try {
    if (sessionStorage.getItem(RECORDED_KEY) === key) return;
    sessionStorage.setItem(RECORDED_KEY, key);
    localStorage.setItem(WINS_KEY, String(readWins() + 1));
  } catch {
    /* ignore */
  }
  renderWins();
}

function showView(name) {
  for (const id of ['menu', 'lobby', 'match']) {
    const el = $(`duel-${id}`);
    if (el) el.classList.toggle('hidden', id !== name);
  }
}

function statusEl() {
  if (!$('duel-menu')?.classList.contains('hidden')) return $('duel-menu-status');
  if (!$('duel-lobby')?.classList.contains('hidden')) return $('duel-lobby-status');
  return $('duel-match-status');
}

function setStatus(text, kind = '') {
  const el = statusEl();
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('calm', kind === 'calm');
}

function mySeat() {
  return state?.seats?.find((seat) => seat.you) || null;
}

function otherSeat() {
  const me = mySeat();
  return state?.seats?.find((seat) => seat !== me && seat.occupied) || state?.seats?.find((seat) => !seat.you) || null;
}

function noteServerNow(serverNow) {
  if (!Number.isFinite(serverNow)) return;
  const sample = serverNow - Date.now();
  if (!clockReady) {
    clockOffset = sample;
    clockReady = true;
    return;
  }
  clockOffset = clockOffset * 0.85 + sample * 0.15;
}

function estimatedNow() {
  return Date.now() + clockOffset;
}

function renderNow() {
  if (!state?.ball || !snapPerf) return estimatedNow();
  return state.ball.t + (performance.now() - snapPerf);
}

function roleOf(source) {
  return source?.seats?.find((seat) => seat.you)?.role || null;
}

function projectState(source, now) {
  if (!source) return source;
  const role = roleOf(source);
  const save = source.openSave;
  if (
    save &&
    role &&
    save.defender === role &&
    source.checkpoint?.ball &&
    paddleCovers(save.x, localPaddle) &&
    now < save.until
  ) {
    return projectDefense(source, now, role, localPaddle);
  }
  return projectLive(source, now, role, localPaddle);
}

function noteProjectionError(prev, next) {
  if (!prev?.ball || !next?.ball || !snapPerf) {
    blend = null;
    return;
  }
  if (prev.rally !== next.rally || prev.phase !== next.phase || prev.status !== next.status) {
    blend = null;
    trail.length = 0;
    return;
  }
  const nowPerf = performance.now();
  const prevView = projectState(prev, prev.ball.t + (nowPerf - snapPerf));
  const nextView = projectState(next, next.ball.t);
  if (!prevView?.ball || !nextView?.ball) {
    blend = null;
    return;
  }
  const dx = prevView.ball.x - nextView.ball.x;
  const dy = prevView.ball.y - nextView.ball.y;
  const flipped =
    prevView.ball.vy * nextView.ball.vy < 0 &&
    Math.abs(prevView.ball.vy) > 0.05 &&
    Math.abs(nextView.ball.vy) > 0.05;
  if (flipped || Math.hypot(dx, dy) > 0.2) {
    blend = null;
    trail.length = 0;
    return;
  }
  blend = { x: dx, y: dy, born: nowPerf };
}

function applyEnvelope(data) {
  if (!data) return;
  const incoming = Number.isInteger(data.version) ? data.version : 0;
  if (incoming && version && incoming < version) return;
  noteServerNow(data.serverNow);
  if (data.secret) secret = data.secret;
  if (data.code) code = data.code;
  if (data.state) {
    const next = data.state;
    const renderT = state?.ball && snapPerf ? state.ball.t + (performance.now() - snapPerf) : 0;
    const sameRally =
      state?.ball &&
      next.ball &&
      next.rally === state.rally &&
      next.status === state.status &&
      next.phase === 'live' &&
      state.phase === 'live';
    const authoritative =
      !state?.ball ||
      next.phase !== 'live' ||
      next.status !== state.status ||
      next.rally !== state.rally ||
      (next.score?.[0] || 0) !== (state.score?.[0] || 0) ||
      (next.score?.[1] || 0) !== (state.score?.[1] || 0);
    const rewind = sameRally && !authoritative && Number(next.ball.t) < renderT - 40;
    if (rewind) {
      state = { ...next, ball: state.ball, checkpoint: next.checkpoint || state.checkpoint };
    } else {
      noteProjectionError(state, next);
      state = next;
      snapPerf = performance.now();
    }
  }
  if (incoming) version = incoming;
  saveSession();
  if (state && secret && state.status === 'lobby' && !state.seats.some((seat) => seat.you)) {
    clearSession();
    showView('menu');
    setStatus('Sitz ist frei.', 'error');
    return;
  }
  noteWin();
  render();
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (secret) headers['X-Duel-Secret'] = secret;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    cache: 'no-store',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 304) return { status: 304, data: { unchanged: true } };
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function pollOnce() {
  if (!code || document.hidden) return;
  const fast = state?.status === 'playing' || state?.status === 'countdown';
  const params = new URLSearchParams();
  if (!fast && version) params.set('since', String(version));
  if (fast) params.set('p', clampPaddle(localPaddle).toFixed(4));
  const query = params.toString();
  const { status, data } = await request(`/api/duel/room/${code}${query ? `?${query}` : ''}`);
  if (status === 304 || (data?.unchanged && !data?.state)) {
    noteServerNow(data?.serverNow);
    return;
  }
  if (status === 404) {
    clearSession();
    showView('menu');
    setStatus('Raum ist abgelaufen.', 'error');
    return;
  }
  if (status === 200 && data?.state) applyEnvelope(data);
}

function currentDelay() {
  const fromServer = Number(state?.pollMs);
  if (Number.isFinite(fromServer) && fromServer > 0) return fromServer;
  return pollDelayMs(state?.status);
}

function stopLoops() {
  clearTimeout(pollTimer);
  clearInterval(heartTimer);
  clearInterval(sendTimer);
  pollTimer = 0;
  heartTimer = 0;
  sendTimer = 0;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function schedulePoll(delay) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!live) return;
    try {
      await pollOnce();
    } catch {
      setStatus('API nicht erreichbar. npm run start:api', 'error');
    }
    if (!live) return;
    schedulePoll(currentDelay());
  }, delay);
}

function startLoops() {
  stopLoops();
  schedulePoll(40);
  heartTimer = setInterval(() => {
    if (live && !document.hidden) heartbeat();
  }, HEARTBEAT_MS);
  sendTimer = setInterval(() => {
    if (live && !document.hidden) sendPaddle();
  }, PADDLE_FAST_INTERVAL_MS);
  lastFrame = performance.now();
  raf = requestAnimationFrame(tick);
}

async function heartbeat() {
  if (!code || !secret) return;
  try {
    const { status, data } = await request('/api/duel/heartbeat', {
      method: 'POST',
      body: { code, secret },
    });
    if (status === 200 && data?.state) applyEnvelope(data);
  } catch {
    /* next poll retries */
  }
}

async function sendPaddle() {
  if (!code || !secret || !state || sendFlight) return;
  if (state.status !== 'countdown' && state.status !== 'playing' && !state.openSave) return;
  const role = roleOf(state);
  const interval = paddleWriteIntervalMs(state, role);
  if (Date.now() - lastSendAt < interval) return;
  const paddle = clampPaddle(localPaddle);
  const save = state.openSave;
  const defending = !!(save && save.defender === role && paddleCovers(save.x, paddle));
  if (Math.abs(paddle - lastSent) < 0.008 && !defending) return;
  sendFlight = true;
  lastSendAt = Date.now();
  try {
    const { status, data } = await request('/api/duel/paddle', {
      method: 'POST',
      body: { code, secret, paddle },
    });
    if (status === 200) {
      const me = data?.state?.seats?.find((seat) => seat.you);
      if (!data?.state || (me && Math.abs((me.paddle ?? paddle) - paddle) < 0.02)) lastSent = paddle;
      if (data?.state) applyEnvelope(data);
    }
  } catch {
    /* next interval retries */
  } finally {
    sendFlight = false;
  }
}

function requireName() {
  const name = ($('duel-name')?.value || '').trim().slice(0, 16);
  if (!name) {
    setStatus('Name fehlt (max. 16).', 'error');
    $('duel-name')?.focus();
    return '';
  }
  savePlayerName(name);
  return name;
}

async function createRoom() {
  if (busy) return;
  showView('menu');
  const name = requireName();
  if (!name) return;
  busy = true;
  setStatus('Raum wird erstellt…');
  try {
    const { status, data } = await request('/api/duel/create', {
      method: 'POST',
      body: { name },
    });
    if (status !== 200) {
      setStatus(data?.message || 'Raum konnte nicht erstellt werden.', 'error');
      return;
    }
    localPaddle = 0.5;
    lastSent = 0.5;
    lastSendAt = 0;
    applyEnvelope(data);
    setStatus('Code teilen. Der Gast tritt bei, dann tippt ihr beide Bereit.', 'calm');
  } catch {
    setStatus('API nicht erreichbar. npm run start:api', 'error');
  } finally {
    busy = false;
  }
}

async function postVersion(action, extra = {}) {
  let ver = version;
  let last = { status: 0, data: {} };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = await request(`/api/duel/${action}`, {
      method: 'POST',
      body: { code, secret, version: ver, ...extra },
    });
    if (last.status === 409 && last.data?.error === 'stale' && last.data.version) {
      ver = last.data.version;
      if (last.data.state) applyEnvelope(last.data);
      continue;
    }
    if (last.status === 200 && last.data?.state) applyEnvelope(last.data);
    return last;
  }
  return last;
}

async function joinRoom() {
  if (busy) return;
  showView('menu');
  const name = requireName();
  if (!name) return;
  const room = normalizeRoomCode($('duel-code')?.value || '');
  if (!room) {
    setStatus('Code: 6 Zeichen, ohne 0/O/1/I.', 'error');
    return;
  }
  busy = true;
  setStatus('Trete bei…');
  try {
    const peek = await request(`/api/duel/room/${room}`);
    if (peek.status !== 200 || !peek.data?.version) {
      setStatus(peek.data?.message || 'Raum nicht gefunden.', 'error');
      return;
    }
    let { status, data } = await request('/api/duel/join', {
      method: 'POST',
      body: { code: room, name, version: peek.data.version },
    });
    if (status === 409 && data?.error === 'stale' && data.version) {
      ({ status, data } = await request('/api/duel/join', {
        method: 'POST',
        body: { code: room, name, version: data.version },
      }));
    }
    if (status !== 200) {
      setStatus(data?.message || 'Beitreten fehlgeschlagen.', 'error');
      return;
    }
    localPaddle = 0.5;
    lastSent = 0.5;
    lastSendAt = 0;
    applyEnvelope(data);
    setStatus('Du bist drin. Tippe Bereit, wenn der andere da ist.', 'calm');
  } catch {
    setStatus('API nicht erreichbar. npm run start:api', 'error');
  } finally {
    busy = false;
  }
}

async function readyUp() {
  if (busy || !code || !secret) return;
  busy = true;
  setStatus('Bereit…');
  try {
    await pollOnce();
    const { status, data } = await postVersion('ready');
    if (status !== 200) {
      setStatus(data?.message || 'Klappt noch nicht.', 'error');
      return;
    }
    if (state?.status === 'lobby') schedulePoll(200);
  } catch {
    setStatus('API nicht erreichbar. npm run start:api', 'error');
  } finally {
    busy = false;
  }
}

async function rematch() {
  if (busy || !code || !secret) return;
  busy = true;
  try {
    const { status, data } = await postVersion('rematch');
    if (status !== 200) {
      setStatus(data?.message || 'Nochmal klappt noch nicht.', 'error');
      return;
    }
    localPaddle = 0.5;
    lastSent = 0.5;
    lastSendAt = 0;
    setStatus('Neue Runde. Beide wieder Bereit.', 'calm');
  } catch {
    setStatus('API nicht erreichbar. npm run start:api', 'error');
  } finally {
    busy = false;
  }
}

async function exitToHub() {
  if (code && secret && version) {
    try {
      await postVersion('leave');
    } catch {
      /* still leave the screen */
    }
  }
  clearSession();
  showView('menu');
  showHub();
}

async function copyCode() {
  if (!code) return;
  playClick();
  try {
    await navigator.clipboard.writeText(code);
    setStatus('Code kopiert.', 'calm');
  } catch {
    setStatus(code, 'calm');
  }
}

function seatLabel(seat) {
  const title = seat.role === 'host' ? 'Host' : 'Gast';
  if (!seat.occupied) return `${title} · offen`;
  const ready = seat.ready ? 'bereit' : 'wartet';
  const you = seat.you ? ' · du' : '';
  return `${title} · ${seat.name} · ${ready}${you}`;
}

function countdownLabel() {
  if (state?.status !== 'countdown') return '';
  const left = (state.countdownEndsAt || 0) - estimatedNow();
  if (left <= 0) return 'LOS';
  return String(Math.ceil(left / 1000));
}

function defendingSave() {
  const role = roleOf(state);
  const save = state?.openSave;
  if (!save || !role || save.defender !== role || !state.checkpoint?.ball) return false;
  if (!paddleCovers(save.x, localPaddle)) return false;
  return renderNow() < save.until;
}

function bannerText() {
  if (!state) return '';
  if (defendingSave() && state.status !== 'finished') return `Zuerst ${state.target || WIN_SCORE}`;
  if (state.status === 'countdown') {
    const label = countdownLabel();
    return label === 'LOS' ? 'Los!' : label;
  }
  if (state.status === 'finished') {
    const me = mySeat();
    const won = me && state.winner === me.role;
    if (state.notice === 'forfeit') return won ? 'Gegner ist weg. Du gewinnst.' : 'Verbindung weg.';
    return won ? 'Gewonnen' : 'Verloren';
  }
  if (state.notice === 'point') return 'Punkt!';
  if (state.status === 'playing') return `Zuerst ${state.target || WIN_SCORE}`;
  return '';
}

function renderLobby() {
  const codeEl = $('duel-lobby-code');
  if (codeEl) codeEl.textContent = code || '------';
  const list = $('duel-seats');
  if (list) {
    list.replaceChildren();
    for (const seat of state?.seats || []) {
      const li = document.createElement('li');
      li.className = `duel-seat${seat.you ? ' you' : ''}${seat.ready ? ' ready' : ''}`;
      li.textContent = seatLabel(seat);
      list.appendChild(li);
    }
  }
  const readyBtn = $('duel-ready');
  const me = mySeat();
  if (readyBtn) {
    const waiting = !me || me.ready;
    readyBtn.disabled = waiting;
    readyBtn.textContent = me?.ready ? 'WARTE…' : 'BEREIT';
  }
}

function renderMatchChrome() {
  const me = mySeat();
  const opp = otherSeat();
  const mine = me?.role === 'guest' ? 1 : 0;
  const theirs = mine === 0 ? 1 : 0;
  const board = defendingSave() && state.checkpoint?.score ? state.checkpoint.score : state?.score;
  const myScore = $('duel-my-score');
  const oppScore = $('duel-opp-score');
  const myName = $('duel-my-name');
  const oppName = $('duel-opp-name');
  if (myScore) myScore.textContent = String(board?.[mine] ?? 0);
  if (oppScore) oppScore.textContent = String(board?.[theirs] ?? 0);
  if (myName) myName.textContent = me?.name || 'Du';
  if (oppName) oppName.textContent = opp?.occupied ? opp.name : '…';
  const overlay = $('duel-overlay');
  const finished = state?.status === 'finished' && !defendingSave();
  overlay?.classList.toggle('hidden', !finished);
  if (finished) {
    const won = me && state.winner === me.role;
    const title = $('duel-overlay-title');
    const body = $('duel-overlay-body');
    if (title) title.textContent = won ? 'Gewonnen' : 'Verloren';
    if (body) {
      body.textContent =
        state.notice === 'forfeit'
          ? won
            ? 'Der andere ist weg.'
            : 'Du warst zu lange weg.'
          : `${state.score?.[0] ?? 0} : ${state.score?.[1] ?? 0} · zuerst ${state.target || WIN_SCORE}`;
    }
  }
}

function render() {
  if (!state || !code) {
    showView('menu');
    renderWins();
    return;
  }
  if (state.status === 'lobby') showView('lobby');
  else showView('match');
  renderLobby();
  renderMatchChrome();
  syncBanner();
}

function syncBanner() {
  const banner = $('duel-banner');
  if (!banner) return;
  const text = bannerText();
  if (banner.textContent !== text) banner.textContent = text;
}

function aimFromEvent(event) {
  const canvas = $('duel-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const fw = rect.width - FIELD_INSET * 2;
  if (fw <= 0) return;
  const x = (event.clientX - rect.left - FIELD_INSET) / fw;
  localPaddle = clampPaddle(x);
}

function stepKeys(dt) {
  if ($('duel-match')?.classList.contains('hidden')) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  let dir = 0;
  if (keys.has('l')) dir -= 1;
  if (keys.has('r')) dir += 1;
  if (!dir) return;
  localPaddle = clampPaddle(localPaddle + dir * 1.35 * dt);
}

function projected() {
  if (!state) return null;
  return projectState(state, renderNow());
}

function draw() {
  const canvas = $('duel-canvas');
  if (!canvas || canvas.clientWidth < 2) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const view = projected() || state;
  const guestView = mySeat()?.role === 'guest';
  const sy = (y) => viewY(y, guestView ? 'guest' : 'host');
  const inset = FIELD_INSET;
  const fw = cssW - inset * 2;
  const fh = cssH - inset * 2;
  const px = (x) => inset + x * fw;
  const py = (y) => inset + sy(y) * fh;

  const sky = ctx.createLinearGradient(0, 0, 0, cssH);
  sky.addColorStop(0, '#120818');
  sky.addColorStop(0.5, '#070714');
  sky.addColorStop(1, '#061820');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.save();
  ctx.globalAlpha = 0.55;
  for (const star of stars) {
    ctx.fillStyle = star.y > 0.5 ? '#7af6ff' : '#ff7ad9';
    ctx.fillRect(px(star.x), py(star.y), star.r, star.r);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, fw, fh);

  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(255, 43, 214, 0.45)';
  ctx.beginPath();
  ctx.moveTo(inset, py(0.5));
  ctx.lineTo(inset + fw, py(0.5));
  ctx.stroke();
  ctx.setLineDash([]);

  const me = mySeat();
  const drawPaddle = (role, x, mine) => {
    const cy = paddleCenterY(role);
    const pw = PADDLE_W * fw;
    const ph = Math.max(8, PADDLE_H * fh);
    const left = px(x) - pw / 2;
    const top = py(cy) - ph / 2;
    ctx.save();
    ctx.shadowColor = mine ? '#00f0ff' : '#ff2bd6';
    ctx.shadowBlur = 16;
    ctx.fillStyle = mine ? '#00f0ff' : '#ff2bd6';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(left, top, pw, ph, 6);
    else ctx.rect(left, top, pw, ph);
    ctx.fill();
    ctx.restore();
  };

  const frameNow = performance.now();
  const frameDt = paddleFrameAt ? Math.min(0.05, (frameNow - paddleFrameAt) / 1000) : 0.016;
  paddleFrameAt = frameNow;
  const ease = 1 - Math.exp(-frameDt / 0.045);
  const seats = view?.seats || state?.seats || [];
  for (const seat of seats) {
    const mine = seat.role === me?.role;
    const index = seat.role === 'guest' ? 1 : 0;
    if (!mine) paddleShown[index] += ((seat.paddle ?? 0.5) - paddleShown[index]) * ease;
    const x = mine ? localPaddle : paddleShown[index];
    if (seat.occupied || mine) drawPaddle(seat.role, x, mine);
  }

  const ball = view?.ball || state?.ball;
  if (ball) {
    let worldX = ball.x;
    let worldY = ball.y;
    if (blend) {
      const decay = Math.exp(-(performance.now() - blend.born) / 80);
      if (decay < 0.04) blend = null;
      else {
        worldX += blend.x * decay;
        worldY += blend.y * decay;
      }
    }
    const bx = px(worldX);
    const by = py(worldY);
    trail.push({ x: bx, y: by });
    if (trail.length > 7) trail.shift();
    const radius = Math.max(4, BALL_R * fh);
    trail.forEach((dot, index) => {
      ctx.globalAlpha = ((index + 1) / trail.length) * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, radius * 0.7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#f4fbff';
    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (state?.status === 'countdown') {
    ctx.fillStyle = '#f4fbff';
    ctx.font = '800 64px Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 18;
    ctx.fillText(countdownLabel() === 'LOS' ? 'LOS' : countdownLabel(), cssW / 2, cssH / 2);
    ctx.shadowBlur = 0;
  }
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (!live || document.hidden) return;
  if ($('duel-match')?.classList.contains('hidden')) return;
  const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
  lastFrame = now;
  stepKeys(dt);
  syncBanner();
  if (state && (state.status === 'playing' || state.status === 'finished' || state.status === 'countdown')) {
    renderMatchChrome();
  }
  draw();
}

function onKey(event, down) {
  if (!live) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const key = event.key;
  let dir = '';
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') dir = 'l';
  if (key === 'ArrowRight' || key === 'd' || key === 'D') dir = 'r';
  if (!dir) return;
  if ($('duel-match')?.classList.contains('hidden')) return;
  event.preventDefault();
  if (down) keys.add(dir);
  else keys.delete(dir);
}

function syncNameField() {
  const input = $('duel-name');
  if (!input) return;
  const saved = loadPlayerName();
  if (saved && !input.value) input.value = saved;
}

export function mountDuel({ onHub, audioClick }) {
  showHub = onHub;
  playClick = audioClick || (() => {});
  renderWins();
  $('duel-create')?.addEventListener('click', () => {
    playClick();
    createRoom();
  });
  $('duel-join')?.addEventListener('click', () => {
    playClick();
    joinRoom();
  });
  $('duel-ready')?.addEventListener('click', () => {
    playClick();
    readyUp();
  });
  $('duel-rematch')?.addEventListener('click', () => {
    playClick();
    rematch();
  });
  $('duel-copy')?.addEventListener('click', copyCode);
  $('duel-menu-hub')?.addEventListener('click', () => {
    playClick();
    showHub();
  });
  $('duel-lobby-hub')?.addEventListener('click', () => {
    playClick();
    exitToHub();
  });
  $('duel-match-hub')?.addEventListener('click', () => {
    playClick();
    exitToHub();
  });
  $('duel-lobby-leave')?.addEventListener('click', () => {
    playClick();
    exitToHub();
  });
  $('duel-leave')?.addEventListener('click', () => {
    playClick();
    exitToHub();
  });

  const canvas = $('duel-canvas');
  canvas?.addEventListener('pointerdown', (event) => {
    if (!live) return;
    dragging = true;
    canvas.setPointerCapture?.(event.pointerId);
    aimFromEvent(event);
    sendPaddle();
  });
  canvas?.addEventListener('pointermove', (event) => {
    if (!live) return;
    if (!dragging && !event.buttons && event.pointerType !== 'touch') return;
    aimFromEvent(event);
  });
  canvas?.addEventListener('pointerup', () => {
    dragging = false;
    sendPaddle();
  });
  canvas?.addEventListener('pointercancel', () => {
    dragging = false;
  });
  window.addEventListener('keydown', (event) => onKey(event, true));
  window.addEventListener('keyup', (event) => onKey(event, false));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => {
    if (!live) return;
    if (!document.hidden) pollOnce().catch(() => {});
  });

  return {
    pause() {
      live = false;
      keys.clear();
      stopLoops();
    },
    open() {
      live = true;
      syncNameField();
      renderWins();
      const saved = readSession();
      if (saved?.code && saved?.secret) {
        code = saved.code;
        secret = saved.secret;
        showView('lobby');
        setStatus('Verbinde…', 'calm');
        pollOnce()
          .catch(() => setStatus('API nicht erreichbar. npm run start:api', 'error'))
          .finally(() => {
            if (live) startLoops();
          });
        return;
      }
      showView('menu');
      setStatus('');
      startLoops();
    },
  };
}
