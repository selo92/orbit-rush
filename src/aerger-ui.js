/**
 * Orbit Ärger client. Polls GET /api/aerger/room/:code about every 1.8s.
 * Hidden tabs pause. Mutations send the room version; a 409 refetches.
 */
import { loadPlayerName, savePlayerName } from './identity.js';
import {
  COLOR_LABEL,
  HEARTBEAT_MS,
  POLL_MS,
  START_INDEX,
  TRACK_CELLS,
  HOME_CELLS,
  YARD_CELLS,
  normalizeRoomCode,
  tokenCell,
} from '../shared/aerger.js';

const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');
const SS_KEY = 'orbit-aerger-session';

const $ = (id) => document.getElementById(id);

const NOTICES = {
  'no-move': 'Kein Zug möglich. Nächster Spieler.',
  timeout: 'Zeit abgelaufen. Nächster Spieler.',
  'six-cap': 'Dreimal 6 — der Nächste ist dran.',
  capture: 'Rausgeworfen!',
};

let live = false;
let pollTimer = 0;
let heartTimer = 0;
let busy = false;
let code = '';
let secret = '';
let version = 0;
let state = null;
let showHub = () => {};
let playClick = () => {};

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
  try {
    sessionStorage.removeItem(SS_KEY);
  } catch {
    /* ignore */
  }
}

function showView(name) {
  for (const id of ['menu', 'lobby', 'table']) {
    const el = $(`aerger-${id}`);
    if (el) el.classList.toggle('hidden', id !== name);
  }
}

function statusEl() {
  if (!$('aerger-menu')?.classList.contains('hidden')) return $('aerger-menu-status');
  if (!$('aerger-lobby')?.classList.contains('hidden')) return $('aerger-lobby-status');
  return $('aerger-table-status');
}

function setStatus(text, kind = '') {
  const el = statusEl();
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('calm', kind === 'calm');
}

function youIndex() {
  if (!state) return -1;
  return state.seats.findIndex((seat) => seat.you);
}

function applyEnvelope(data) {
  if (!data) return;
  const incoming = Number.isInteger(data.version) ? data.version : 0;
  if (incoming && version && incoming < version) return;
  if (data.secret) secret = data.secret;
  if (data.code) code = data.code;
  if (incoming) version = incoming;
  if (data.state) state = data.state;
  saveSession();
  render();
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (secret) headers['X-Aerger-Secret'] = secret;
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

async function refresh() {
  if (!code) return;
  const { status, data } = await request(`/api/aerger/room/${code}`);
  if (status === 404) {
    setStatus('Raum ist weg.', 'error');
    clearSession();
    showView('menu');
    return;
  }
  if (status === 200 && data?.state) applyEnvelope(data);
}

async function poll() {
  if (!code || document.hidden) return;
  const since = version ? `?since=${version}` : '';
  const { status, data } = await request(`/api/aerger/room/${code}${since}`);
  if (status === 304 || data?.unchanged) return;
  if (status === 404) {
    clearSession();
    showView('menu');
    setStatus('Raum ist abgelaufen.', 'error');
    return;
  }
  if (status === 200 && data?.state) applyEnvelope(data);
}

function stopTimers() {
  clearTimeout(pollTimer);
  clearInterval(heartTimer);
  pollTimer = 0;
  heartTimer = 0;
}

function schedule() {
  clearTimeout(pollTimer);
  if (!live) return;
  pollTimer = setTimeout(async () => {
    if (!live) return;
    if (!document.hidden) {
      try {
        await poll();
      } catch {
        setStatus('Keine Verbindung. Gleich nochmal.', 'error');
      }
    }
    schedule();
  }, POLL_MS);
}

async function heartbeat() {
  if (!live || !code || !secret || document.hidden) return;
  try {
    const { status, data } = await request('/api/aerger/heartbeat', {
      method: 'POST',
      body: { code, secret },
    });
    if (status === 200 && data?.state && data.version !== version) applyEnvelope(data);
  } catch {
    /* next poll retries */
  }
}

function syncNameField() {
  const input = $('aerger-name');
  if (!input) return;
  const saved = loadPlayerName();
  if (saved && !input.value) input.value = saved;
}

function requireName() {
  const name = savePlayerName($('aerger-name')?.value || '');
  if (!name) {
    setStatus('Name fehlt (max. 16).', 'error');
    $('aerger-name')?.focus();
    return '';
  }
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
    const { status, data } = await request('/api/aerger/create', {
      method: 'POST',
      body: { name },
    });
    if (status !== 200) {
      setStatus(data?.message || 'Raum konnte nicht erstellt werden.', 'error');
      return;
    }
    applyEnvelope(data);
    setStatus('Code teilen. Wir pollen alle 2 Sekunden.', 'calm');
  } catch {
    setStatus('API nicht erreichbar. npm run start:api', 'error');
  } finally {
    busy = false;
  }
}

async function joinRoom() {
  if (busy) return;
  showView('menu');
  const name = requireName();
  if (!name) return;
  const room = normalizeRoomCode($('aerger-code')?.value || '');
  if (!room) {
    setStatus('Code: 6 Zeichen, ohne 0/O/1/I.', 'error');
    return;
  }
  busy = true;
  setStatus('Trete bei…');
  try {
    const peek = await request(`/api/aerger/room/${room}`);
    if (peek.status !== 200 || !peek.data?.version) {
      setStatus(peek.data?.message || 'Raum nicht gefunden.', 'error');
      return;
    }
    let { status, data } = await request('/api/aerger/join', {
      method: 'POST',
      body: { code: room, name, version: peek.data.version },
    });
    if (status === 409 && data?.error === 'stale' && data.version) {
      ({ status, data } = await request('/api/aerger/join', {
        method: 'POST',
        body: { code: room, name, version: data.version },
      }));
    }
    if (status !== 200) {
      setStatus(data?.message || 'Beitreten fehlgeschlagen.', 'error');
      return;
    }
    applyEnvelope(data);
    setStatus('Du bist drin.', 'calm');
  } catch {
    setStatus('API nicht erreichbar. npm run start:api', 'error');
  } finally {
    busy = false;
  }
}

async function mutate(action, extra = {}) {
  if (busy || !code || !secret || !version) return null;
  busy = true;
  try {
    let { status, data } = await request(`/api/aerger/${action}`, {
      method: 'POST',
      body: { code, secret, version, ...extra },
    });
    if (status === 409 && data?.error === 'stale') {
      if (data.state) applyEnvelope(data);
      else await refresh();
      ({ status, data } = await request(`/api/aerger/${action}`, {
        method: 'POST',
        body: { code, secret, version, ...extra },
      }));
    }
    if (data?.state) applyEnvelope(data);
    if (status !== 200) setStatus(data?.message || 'Zug abgelehnt.', 'error');
    else setStatus('');
    return { status, data };
  } catch {
    setStatus('Keine Verbindung.', 'error');
    return null;
  } finally {
    busy = false;
  }
}

async function exitToHub() {
  if (code && secret && version) {
    try {
      const first = await request('/api/aerger/leave', {
        method: 'POST',
        body: { code, secret, version },
      });
      if (first.status === 409 && first.data?.version) {
        await request('/api/aerger/leave', {
          method: 'POST',
          body: { code, secret, version: first.data.version },
        });
      }
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
    setStatus(`Code: ${code}`, 'calm');
  }
}

function paintBoardShell() {
  const board = $('aerger-board');
  if (!board || board.childElementCount) return;
  const kind = new Map();
  TRACK_CELLS.forEach((cell, index) => {
    kind.set(`${cell[0]},${cell[1]}`, { type: 'track', index });
  });
  for (const [color, cells] of Object.entries(HOME_CELLS)) {
    cells.forEach((cell) => kind.set(`${cell[0]},${cell[1]}`, { type: 'home', color }));
  }
  for (const [color, cells] of Object.entries(YARD_CELLS)) {
    cells.forEach((cell) => kind.set(`${cell[0]},${cell[1]}`, { type: 'yard', color }));
  }
  for (let row = 0; row < 11; row += 1) {
    for (let col = 0; col < 11; col += 1) {
      const el = document.createElement('div');
      const meta = kind.get(`${row},${col}`);
      el.className = 'aerger-cell';
      if (meta?.type === 'track') el.classList.add('track');
      if (meta?.type === 'home') el.classList.add('home', meta.color);
      if (meta?.type === 'yard') el.classList.add('yard', meta.color);
      if (row === 5 && col === 5) el.classList.add('center');
      board.append(el);
    }
  }
  for (const [color, index] of Object.entries(START_INDEX)) {
    const cell = TRACK_CELLS[index];
    const el = board.children[cell[0] * 11 + cell[1]];
    el.classList.add('start', color);
  }
}

function cellEl(coord) {
  if (!coord) return null;
  const board = $('aerger-board');
  return board?.children[coord[0] * 11 + coord[1]] || null;
}

function renderBoard() {
  paintBoardShell();
  const board = $('aerger-board');
  if (!board || !state) return;
  board.querySelectorAll('.aerger-token').forEach((node) => node.remove());
  board.querySelectorAll('.dest').forEach((node) => node.classList.remove('dest'));
  const you = state.seats[youIndex()];
  const myTurn = !!(you && state.status === 'playing' && state.phase === 'move' && state.seats[state.turn]?.you);
  const legal = new Set((myTurn ? state.legal : []).map((move) => move.token));
  if (myTurn) {
    const color = state.seats[state.turn].color;
    for (const move of state.legal) {
      cellEl(tokenCell(color, move.to))?.classList.add('dest');
    }
  }
  for (const seat of state.seats) {
    const list = state.tokens?.[seat.color] || [];
    list.forEach((token, index) => {
      const host = cellEl(tokenCell(seat.color, token));
      if (!host) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `aerger-token ${seat.color}`;
      btn.textContent = String(index + 1);
      const canMove = myTurn && seat.you && legal.has(index);
      btn.classList.toggle('legal', canMove);
      btn.disabled = !canMove;
      btn.setAttribute('aria-label', `${COLOR_LABEL[seat.color]} Figur ${index + 1}`);
      if (canMove) {
        btn.addEventListener('click', () => {
          playClick();
          mutate('move', { token: index });
        });
      }
      host.append(btn);
    });
  }
}

function renderMoves() {
  const box = $('aerger-moves');
  if (!box) return;
  box.replaceChildren();
  const me = youIndex();
  if (me < 0 || !state || state.status !== 'playing' || state.phase !== 'move' || state.turn !== me) return;
  const color = state.seats[me].color;
  for (const move of state.legal || []) {
    const token = state.tokens[color][move.token];
    const n = move.token + 1;
    let label = `Figur ${n} ziehen`;
    if (token?.zone === 'yard') label = `Figur ${n} raus`;
    else if (move.capture) label = `Figur ${n} schmeißen`;
    else if (move.to?.zone === 'home') label = `Figur ${n} ins Haus`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ghost aerger-move';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      playClick();
      mutate('move', { token: move.token });
    });
    box.append(btn);
  }
}

function renderSeats() {
  const list = $('aerger-seats');
  if (!list || !state) return;
  list.replaceChildren();
  const me = youIndex();
  const host = me >= 0 && state.seats[me].host;
  state.seats.forEach((seat, index) => {
    const li = document.createElement('li');
    li.className = `aerger-seat ${seat.color}`;
    if (seat.you) li.classList.add('you');
    const swatch = document.createElement('i');
    const label = document.createElement('span');
    const bits = [COLOR_LABEL[seat.color]];
    if (seat.occupied) bits.push(seat.name || 'Pilot');
    else bits.push('frei');
    if (seat.you) bits.push('du');
    if (seat.host) bits.push('Host');
    if (seat.abandoned) bits.push('weg');
    label.textContent = bits.join(' · ');
    li.append(swatch, label);
    if (host && seat.occupied && !seat.you && (state.status === 'lobby' || seat.abandoned)) {
      const kick = document.createElement('button');
      kick.type = 'button';
      kick.className = 'aerger-kick';
      kick.textContent = 'RAUS';
      kick.addEventListener('click', () => {
        playClick();
        mutate('kick', { seat: index });
      });
      li.append(kick);
    }
    list.append(li);
  });
}

function render() {
  if (!state) {
    showView('menu');
    return;
  }
  const view = state.status === 'lobby' ? 'lobby' : 'table';
  showView(view);
  const codeText = code || '------';
  if ($('aerger-lobby-code')) $('aerger-lobby-code').textContent = codeText;
  if ($('aerger-table-code')) $('aerger-table-code').textContent = codeText;
  if (view === 'lobby') {
    renderSeats();
    const active = state.seats.filter((seat) => seat.occupied && !seat.abandoned).length;
    const start = $('aerger-start');
    const me = youIndex();
    const isHost = me >= 0 && state.seats[me].host;
    if (start) {
      start.disabled = !isHost || active < 2;
      start.textContent = isHost ? `START · ${active}/4` : `WARTEN · ${active}/4`;
    }
    return;
  }
  renderBoard();
  renderMoves();
  const turnSeat = state.seats[state.turn];
  const mine = turnSeat?.you && state.status === 'playing';
  const turn = $('aerger-turn');
  if (turn) {
    if (state.status === 'finished' && state.winner) {
      const winner = state.seats.find((seat) => seat.color === state.winner);
      turn.textContent = `${COLOR_LABEL[state.winner]} gewinnt${winner?.name ? ` · ${winner.name}` : ''}`;
    } else if (state.status === 'stalled') {
      turn.textContent = 'Alle weg. Raum wartet.';
    } else if (turnSeat) {
      const who = `${COLOR_LABEL[turnSeat.color]}${turnSeat.name ? ` · ${turnSeat.name}` : ''}`;
      turn.textContent = mine ? `Du bist dran · ${who}` : `${who} ist dran`;
    }
  }
  const players = $('aerger-players');
  if (players) {
    players.textContent = state.seats
      .filter((seat) => seat.occupied)
      .map((seat) => `${COLOR_LABEL[seat.color]} ${seat.name || ''}`.trim())
      .join('  ·  ');
  }
  const dice = $('aerger-dice');
  if (dice) {
    dice.textContent = state.dice ? String(state.dice) : '–';
    dice.className = `aerger-dice ${turnSeat?.color || ''}`;
  }
  const notice = $('aerger-notice');
  if (notice) {
    const extra = mine && state.phase === 'roll' && state.sixes > 0 ? ` Sechser ${state.sixes}/3.` : '';
    notice.textContent = `${NOTICES[state.notice] || ''}${extra}`.trim();
  }
  const roll = $('aerger-roll');
  if (roll) {
    const canRoll = mine && state.phase === 'roll';
    roll.disabled = !canRoll || busy;
    roll.textContent = canRoll ? 'WÜRFELN' : 'WARTEN';
  }
  const win = $('aerger-win');
  const over = state.status === 'finished' || state.status === 'stalled';
  win?.classList.toggle('hidden', !over);
  if (over && $('aerger-win-title')) {
    if (state.status === 'finished' && state.winner) {
      const winner = state.seats.find((seat) => seat.color === state.winner);
      $('aerger-win-title').textContent = `${COLOR_LABEL[state.winner]} gewinnt`;
      $('aerger-win-body').textContent = winner?.name ? `${winner.name} schafft alle Figuren ins Haus.` : 'Alle Figuren im Haus.';
    } else {
      $('aerger-win-title').textContent = 'Runde steht';
      $('aerger-win-body').textContent = 'Niemand ist mehr am Zug.';
    }
  }
  const rematch = $('aerger-rematch');
  const me = youIndex();
  if (rematch) rematch.classList.toggle('hidden', !(over && me >= 0 && state.seats[me].host));
}

function onVisible() {
  if (!live) return;
  if (document.hidden) return;
  poll().catch(() => {});
  schedule();
}

export function mountAerger({ onHub, audioClick }) {
  showHub = onHub;
  playClick = audioClick || (() => {});
  paintBoardShell();
  $('aerger-create')?.addEventListener('click', () => {
    playClick();
    createRoom();
  });
  $('aerger-join')?.addEventListener('click', () => {
    playClick();
    joinRoom();
  });
  $('aerger-code')?.addEventListener('input', (event) => {
    const el = event.target;
    el.value = String(el.value || '')
      .toUpperCase()
      .replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '')
      .slice(0, 6);
  });
  $('aerger-start')?.addEventListener('click', () => {
    playClick();
    mutate('start');
  });
  $('aerger-roll')?.addEventListener('click', () => {
    const roll = $('aerger-roll');
    if (!roll || roll.disabled || busy) return;
    roll.disabled = true;
    playClick();
    mutate('roll');
  });
  $('aerger-rematch')?.addEventListener('click', () => {
    playClick();
    mutate('rematch');
  });
  $('aerger-copy')?.addEventListener('click', copyCode);
  $('aerger-copy-2')?.addEventListener('click', copyCode);
  $('aerger-menu-hub')?.addEventListener('click', () => {
    playClick();
    showHub();
  });
  $('aerger-lobby-hub')?.addEventListener('click', () => {
    playClick();
    exitToHub();
  });
  $('aerger-table-hub')?.addEventListener('click', () => {
    playClick();
    exitToHub();
  });
  $('aerger-leave')?.addEventListener('click', () => {
    playClick();
    exitToHub();
  });
  document.addEventListener('visibilitychange', onVisible);

  return {
    pause() {
      live = false;
      stopTimers();
    },
    open() {
      live = true;
      syncNameField();
      const saved = readSession();
      if (saved?.code && saved?.secret) {
        code = saved.code;
        secret = saved.secret;
        version = 0;
        refresh()
          .then(() => {
            if (state) setStatus('Wieder da.', 'calm');
          })
          .catch(() => setStatus('API nicht erreichbar.', 'error'));
      } else {
        state = null;
        showView('menu');
        setStatus('');
      }
      schedule();
      clearInterval(heartTimer);
      heartTimer = setInterval(heartbeat, HEARTBEAT_MS);
    },
  };
}
