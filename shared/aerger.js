/**
 * Orbit Ärger — classic Mensch ärgere dich nicht / Ludo rules.
 * Pure functions. No sockets, no timers. The Worker stores one JSON blob per room.
 *
 * Rule choices (v1):
 * - 4 fixed seats: red, blue, yellow, green. Each occupied seat has 4 tokens.
 * - Shared track is 40 fields. Each color starts 10 fields apart.
 * - A 6 is required to leave the yard onto your own start field. The player
 *   chooses among legal moves (bringing a token out is not forced).
 * - Rolling a 6 grants another roll, but three 6s in a row end the turn after
 *   the third move so a hot streak cannot soft-lock the room.
 * - A 6 with no legal move does not grant another roll; the turn passes.
 * - You may pass opponent tokens. Landing exactly on one sends it back to the
 *   yard, unless it stands on its own start field (the only safe track field).
 * - You cannot pass or land on your own token.
 * - Home is 4 private fields. Entry and the last field need an exact count;
 *   overshooting is illegal.
 * - No extra turn for a capture (only for a 6, under the cap above).
 * - Turns with no legal move are passed. Abandoned seats and a 45s idle turn
 *   are skipped. A seat with no heartbeat for 90s is marked abandoned.
 * - First color with all 4 tokens in home wins. The match then stops.
 */

export const COLORS = ['red', 'blue', 'yellow', 'green'];

export const COLOR_LABEL = {
  red: 'Rot',
  blue: 'Blau',
  yellow: 'Gelb',
  green: 'Grün',
};

export const START_INDEX = { red: 0, blue: 10, yellow: 20, green: 30 };

export const TRACK_LEN = 40;
export const HOME_LEN = 4;
export const TOKENS_PER = 4;
export const MAX_CONSECUTIVE_SIXES = 3;
export const TURN_TIMEOUT_MS = 45_000;
export const ABANDON_MS = 90_000;
export const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
export const POLL_MS = 1800;
export const HEARTBEAT_MS = 20_000;

/** 11×11 board. Track walks counter-clockwise from red's start. */
export const TRACK_CELLS = [
  [4, 0], [4, 1], [4, 2], [4, 3], [4, 4],
  [3, 4], [2, 4], [1, 4], [0, 4], [0, 5],
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6],
  [4, 7], [4, 8], [4, 9], [4, 10], [5, 10],
  [6, 10], [6, 9], [6, 8], [6, 7], [6, 6],
  [7, 6], [8, 6], [9, 6], [10, 6], [10, 5],
  [10, 4], [9, 4], [8, 4], [7, 4], [6, 4],
  [6, 3], [6, 2], [6, 1], [6, 0], [5, 0],
];

export const HOME_CELLS = {
  red: [[5, 1], [5, 2], [5, 3], [5, 4]],
  blue: [[1, 5], [2, 5], [3, 5], [4, 5]],
  yellow: [[5, 9], [5, 8], [5, 7], [5, 6]],
  green: [[9, 5], [8, 5], [7, 5], [6, 5]],
};

export const YARD_CELLS = {
  red: [[1, 1], [1, 2], [2, 1], [2, 2]],
  blue: [[1, 8], [1, 9], [2, 8], [2, 9]],
  yellow: [[8, 8], [8, 9], [9, 8], [9, 9]],
  green: [[8, 1], [8, 2], [9, 1], [9, 2]],
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(code) ? code : '';
}

export function rollDie(rng = Math.random) {
  const n = Number(rng());
  const unit = Number.isFinite(n) ? Math.min(0.999999, Math.max(0, n)) : Math.random();
  return 1 + Math.floor(unit * 6);
}

function clone(state) {
  return structuredClone(state);
}

function fail(status, error, message) {
  return { ok: false, status, error, message };
}

function secretEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function emptySeat(color) {
  return {
    color,
    occupied: false,
    name: null,
    secret: null,
    host: false,
    abandoned: false,
    lastSeen: 0,
    sixes: 0,
  };
}

export function yardTokens() {
  return [0, 1, 2, 3].map((pos) => ({ zone: 'yard', pos }));
}

function clearSeat(seat) {
  const color = seat.color;
  Object.assign(seat, emptySeat(color));
}

export function createLobby({ name, secret, now }) {
  const clean = typeof name === 'string' ? name : '';
  if (!clean) return fail(400, 'name', 'Name fehlt (max. 16).');
  if (!secret || typeof secret !== 'string') return fail(400, 'secret', 'Secret fehlt.');
  const seats = COLORS.map((color, i) => {
    const seat = emptySeat(color);
    if (i === 0) {
      seat.occupied = true;
      seat.name = clean;
      seat.secret = secret;
      seat.host = true;
      seat.lastSeen = now;
    }
    return seat;
  });
  const tokens = { red: yardTokens(), blue: [], yellow: [], green: [] };
  return {
    ok: true,
    state: {
      status: 'lobby',
      seats,
      tokens,
      turn: 0,
      phase: 'roll',
      dice: null,
      legal: [],
      winner: null,
      notice: null,
      sixes: 0,
      turnStartedAt: now,
    },
  };
}

function findSeat(state, secret) {
  const index = state.seats.findIndex(
    (seat) => seat.occupied && seat.secret && secretEquals(seat.secret, secret)
  );
  if (index < 0) return null;
  return { index, seat: state.seats[index] };
}

function touch(seat, now) {
  seat.lastSeen = now;
  seat.abandoned = false;
}

export function applyJoin(state, { name, secret, now }) {
  if (!state || state.status !== 'lobby') {
    return fail(409, 'started', 'Spiel läuft schon.');
  }
  if (!name) return fail(400, 'name', 'Name fehlt (max. 16).');
  if (!secret) return fail(400, 'secret', 'Secret fehlt.');
  const existing = findSeat(state, secret);
  const next = clone(state);
  if (existing) {
    touch(next.seats[existing.index], now);
    return { ok: true, state: next, seat: existing.index };
  }
  const idx = next.seats.findIndex((seat) => !seat.occupied);
  if (idx < 0) return fail(409, 'full', 'Raum ist voll.');
  const seat = next.seats[idx];
  seat.occupied = true;
  seat.name = name;
  seat.secret = secret;
  seat.host = false;
  seat.abandoned = false;
  seat.lastSeen = now;
  seat.sixes = 0;
  next.tokens[seat.color] = yardTokens();
  return { ok: true, state: next, seat: idx };
}

function activeSeats(state) {
  return state.seats.filter((seat) => seat.occupied && !seat.abandoned);
}

export function applyStart(state, secret, now) {
  if (!state || state.status !== 'lobby') return fail(409, 'started', 'Spiel läuft schon.');
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (!who.seat.host) return fail(403, 'not-host', 'Nur der Host startet.');
  const next = clone(state);
  for (const seat of next.seats) {
    if (seat.abandoned) {
      next.tokens[seat.color] = [];
      clearSeat(seat);
    }
  }
  const active = activeSeats(next);
  if (active.length < 2) return fail(409, 'need-players', 'Mindestens 2 Spieler.');
  if (active.length > 4) return fail(409, 'full', 'Höchstens 4 Spieler.');
  for (const seat of next.seats) {
    seat.sixes = 0;
    if (seat.occupied) {
      next.tokens[seat.color] = yardTokens();
      seat.lastSeen = now;
    } else {
      next.tokens[seat.color] = [];
    }
  }
  const first = next.seats.findIndex((seat) => seat.occupied);
  next.status = 'playing';
  next.turn = first;
  next.phase = 'roll';
  next.dice = null;
  next.legal = [];
  next.winner = null;
  next.notice = null;
  next.sixes = 0;
  next.turnStartedAt = now;
  return { ok: true, state: next };
}

function trackOccupants(state) {
  const map = new Map();
  for (const color of COLORS) {
    const list = state.tokens[color] || [];
    list.forEach((token, index) => {
      if (token.zone !== 'track') return;
      const abs = (START_INDEX[color] + token.pos) % TRACK_LEN;
      map.set(abs, { color, token: index, safe: token.pos === 0 });
    });
  }
  return map;
}

export function legalMoves(state, color, dice) {
  const moves = [];
  const tokens = state.tokens[color] || [];
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) return moves;
  const occ = trackOccupants(state);
  tokens.forEach((token, index) => {
    if (token.zone === 'yard') {
      if (dice !== 6) return;
      const abs = START_INDEX[color];
      const hit = occ.get(abs);
      if (hit && hit.color === color) return;
      let capture = null;
      if (hit && hit.color !== color) {
        if (hit.safe) return;
        capture = { color: hit.color, token: hit.token };
      }
      moves.push({ token: index, to: { zone: 'track', pos: 0 }, capture });
      return;
    }
    if (token.zone !== 'track' && token.zone !== 'home') return;
    const from = token.zone === 'home' ? TRACK_LEN + token.pos : token.pos;
    const dest = from + dice;
    if (dest > TRACK_LEN + HOME_LEN - 1) return;
    let capture = null;
    for (let step = from + 1; step <= dest; step += 1) {
      if (step <= TRACK_LEN - 1) {
        const abs = (START_INDEX[color] + step) % TRACK_LEN;
        const hit = occ.get(abs);
        if (!hit) continue;
        if (hit.color === color && hit.token !== index) return;
        if (hit.color === color) return;
        if (step === dest) {
          if (hit.safe) return;
          capture = { color: hit.color, token: hit.token };
        }
      } else {
        const homePos = step - TRACK_LEN;
        const blocked = tokens.some(
          (other, otherIndex) =>
            otherIndex !== index && other.zone === 'home' && other.pos === homePos
        );
        if (blocked) return;
      }
    }
    const to =
      dest >= TRACK_LEN
        ? { zone: 'home', pos: dest - TRACK_LEN }
        : { zone: 'track', pos: dest };
    moves.push({ token: index, to, capture });
  });
  return moves;
}

function freeYardSlot(tokens, ignoreIndex = -1) {
  const used = new Set();
  tokens.forEach((token, index) => {
    if (index === ignoreIndex || token.zone !== 'yard') return;
    used.add(token.pos);
  });
  for (let i = 0; i < TOKENS_PER; i += 1) {
    if (!used.has(i)) return i;
  }
  return 0;
}

function applyChosen(state, color, move) {
  if (move.capture) {
    const list = state.tokens[move.capture.color];
    const victim = list[move.capture.token];
    const slot = freeYardSlot(list, move.capture.token);
    victim.zone = 'yard';
    victim.pos = slot;
  }
  const token = state.tokens[color][move.token];
  token.zone = move.to.zone;
  token.pos = move.to.pos;
}

function hasWon(state, color) {
  const list = state.tokens[color] || [];
  return list.length === TOKENS_PER && list.every((token) => token.zone === 'home');
}

function advanceTurn(state, now) {
  const total = state.seats.length;
  for (let step = 1; step <= total; step += 1) {
    const idx = (state.turn + step) % total;
    const seat = state.seats[idx];
    if (seat.occupied && !seat.abandoned) {
      state.turn = idx;
      state.phase = 'roll';
      state.legal = [];
      state.sixes = seat.sixes || 0;
      state.turnStartedAt = now;
      return true;
    }
  }
  state.status = 'stalled';
  state.phase = 'done';
  state.legal = [];
  return false;
}

function passTurn(state, now, notice) {
  const current = state.seats[state.turn];
  if (current) current.sixes = 0;
  state.notice = notice;
  advanceTurn(state, now);
}

export function applyRoll(state, secret, now, rng = Math.random) {
  if (!state || state.status !== 'playing') return fail(409, 'not-playing', 'Runde läuft nicht.');
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (who.seat.abandoned) return fail(403, 'abandoned', 'Sitz ist freigegeben.');
  if (state.turn !== who.index) return fail(403, 'turn', 'Du bist nicht dran.');
  if (state.phase !== 'roll') return fail(409, 'phase', 'Erst ziehen, dann würfeln.');
  const next = clone(state);
  const seat = next.seats[who.index];
  touch(seat, now);
  const dice = rollDie(rng);
  seat.sixes = dice === 6 ? (seat.sixes || 0) + 1 : 0;
  next.dice = dice;
  next.sixes = seat.sixes;
  next.turnStartedAt = now;
  const moves = legalMoves(next, seat.color, dice);
  if (moves.length === 0) {
    passTurn(next, now, 'no-move');
    return { ok: true, state: next };
  }
  next.phase = 'move';
  next.legal = moves;
  next.notice = null;
  return { ok: true, state: next };
}

export function applyMove(state, secret, tokenIndex, now) {
  if (!state || state.status !== 'playing') return fail(409, 'not-playing', 'Runde läuft nicht.');
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (state.turn !== who.index) return fail(403, 'turn', 'Du bist nicht dran.');
  if (state.phase !== 'move') return fail(409, 'phase', 'Erst würfeln.');
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex >= TOKENS_PER) {
    return fail(400, 'token', 'Keine gültige Figur.');
  }
  const color = who.seat.color;
  const moves = legalMoves(state, color, state.dice);
  const chosen = moves.find((move) => move.token === tokenIndex);
  if (!chosen) return fail(409, 'illegal', 'Der Zug ist nicht erlaubt.');
  const next = clone(state);
  const seat = next.seats[who.index];
  touch(seat, now);
  applyChosen(next, color, chosen);
  next.legal = [];
  if (hasWon(next, color)) {
    next.status = 'finished';
    next.winner = color;
    next.phase = 'done';
    next.notice = 'win';
    next.sixes = seat.sixes;
    return { ok: true, state: next };
  }
  if (next.dice === 6 && seat.sixes < MAX_CONSECUTIVE_SIXES) {
    next.phase = 'roll';
    next.notice = chosen.capture ? 'capture' : null;
    next.turnStartedAt = now;
    next.sixes = seat.sixes;
    return { ok: true, state: next };
  }
  const notice = seat.sixes >= MAX_CONSECUTIVE_SIXES ? 'six-cap' : chosen.capture ? 'capture' : null;
  seat.sixes = 0;
  passTurn(next, now, notice);
  return { ok: true, state: next };
}

export function applyLeave(state, secret, now) {
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  const next = clone(state);
  const seat = next.seats[who.index];
  if (next.status === 'lobby' || next.status === 'finished' || next.status === 'stalled') {
    const wasHost = seat.host;
    next.tokens[seat.color] = [];
    clearSeat(seat);
    if (wasHost) {
      const replacement = next.seats.find((item) => item.occupied);
      if (replacement) replacement.host = true;
    }
    return { ok: true, state: next };
  }
  seat.abandoned = true;
  seat.lastSeen = 0;
  if (next.turn === who.index) {
    passTurn(next, now, 'timeout');
  }
  return { ok: true, state: next };
}

export function applyKick(state, secret, seatIndex, now) {
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (!who.seat.host) return fail(403, 'not-host', 'Nur der Host wirft raus.');
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= state.seats.length) {
    return fail(400, 'seat', 'Sitz gibt es nicht.');
  }
  if (seatIndex === who.index) return fail(409, 'self', 'Dich selbst kannst du nicht rauswerfen.');
  const next = clone(state);
  const target = next.seats[seatIndex];
  if (!target.occupied) return fail(409, 'empty', 'Der Sitz ist schon leer.');
  if (next.status === 'playing' && !target.abandoned && now - target.lastSeen < 30_000) {
    return fail(409, 'present', 'Spieler ist noch da.');
  }
  if (next.status === 'lobby' || next.status === 'finished' || next.status === 'stalled') {
    next.tokens[target.color] = [];
    clearSeat(target);
    return { ok: true, state: next };
  }
  target.abandoned = true;
  target.lastSeen = 0;
  if (next.turn === seatIndex) passTurn(next, now, 'timeout');
  return { ok: true, state: next };
}

export function applyHeartbeat(state, secret, now) {
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (who.seat.abandoned === false && now - who.seat.lastSeen < 15_000) {
    return { ok: true, state, unchanged: true };
  }
  const next = clone(state);
  touch(next.seats[who.index], now);
  return { ok: true, state: next, unchanged: false };
}

export function applyRematch(state, secret, now) {
  if (!state || (state.status !== 'finished' && state.status !== 'stalled')) {
    return fail(409, 'not-over', 'Die Runde ist noch nicht zu Ende.');
  }
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (!who.seat.host) return fail(403, 'not-host', 'Nur der Host startet nochmal.');
  const next = clone(state);
  for (const seat of next.seats) {
    seat.sixes = 0;
    if (!seat.occupied || seat.abandoned) {
      next.tokens[seat.color] = [];
      clearSeat(seat);
    } else {
      next.tokens[seat.color] = yardTokens();
      seat.lastSeen = now;
    }
  }
  if (!next.seats.some((seat) => seat.host && seat.occupied)) {
    const replacement = next.seats.find((seat) => seat.occupied);
    if (replacement) replacement.host = true;
  }
  next.status = 'lobby';
  next.turn = 0;
  next.phase = 'roll';
  next.dice = null;
  next.legal = [];
  next.winner = null;
  next.notice = null;
  next.sixes = 0;
  next.turnStartedAt = now;
  return { ok: true, state: next };
}

export function applyIdle(state, now) {
  if (!state || (state.status !== 'lobby' && state.status !== 'playing')) {
    return { changed: false, state };
  }
  const next = clone(state);
  let changed = false;
  for (const seat of next.seats) {
    if (!seat.occupied || seat.abandoned) continue;
    if (seat.lastSeen && now - seat.lastSeen > ABANDON_MS) {
      seat.abandoned = true;
      changed = true;
    }
  }
  if (next.status === 'playing') {
    const seat = next.seats[next.turn];
    const gone = !seat || !seat.occupied || seat.abandoned;
    const timed = now - next.turnStartedAt >= TURN_TIMEOUT_MS;
    if (gone || timed) {
      passTurn(next, now, 'timeout');
      changed = true;
    }
  }
  return { changed, state: changed ? next : state };
}

export function publicState(state, secret) {
  if (!state) return null;
  return {
    status: state.status,
    turn: state.turn,
    phase: state.phase,
    dice: state.dice,
    legal: (state.legal || []).map((move) => ({
      token: move.token,
      to: move.to,
      capture: move.capture ? { color: move.capture.color, token: move.capture.token } : null,
    })),
    winner: state.winner,
    notice: state.notice,
    sixes: state.sixes || 0,
    turnStartedAt: state.turnStartedAt,
    seats: state.seats.map((seat) => ({
      color: seat.color,
      name: seat.name,
      occupied: !!seat.occupied,
      host: !!seat.host,
      abandoned: !!seat.abandoned,
      you: !!(secret && seat.secret && secretEquals(seat.secret, secret)),
    })),
    tokens: state.tokens,
  };
}

export function tokenCell(color, token) {
  if (!token) return null;
  if (token.zone === 'yard') return YARD_CELLS[color][token.pos] || null;
  if (token.zone === 'home') return HOME_CELLS[color][token.pos] || null;
  const abs = (START_INDEX[color] + token.pos) % TRACK_LEN;
  return TRACK_CELLS[abs];
}

export function assertBoard(state) {
  const seen = new Set();
  for (const color of COLORS) {
    const home = new Set();
    const yard = new Set();
    const list = state.tokens[color] || [];
    if (list.length !== 0 && list.length !== TOKENS_PER) {
      throw new Error(`${color} token count ${list.length}`);
    }
    list.forEach((token, index) => {
      if (token.zone === 'track') {
        if (token.pos < 0 || token.pos >= TRACK_LEN) throw new Error('bad track pos');
        const abs = (START_INDEX[color] + token.pos) % TRACK_LEN;
        const key = `t${abs}`;
        if (seen.has(key)) throw new Error(`overlap ${key}`);
        seen.add(key);
      } else if (token.zone === 'home') {
        if (token.pos < 0 || token.pos >= HOME_LEN) throw new Error('bad home');
        if (home.has(token.pos)) throw new Error(`${color} home overlap`);
        home.add(token.pos);
      } else if (token.zone === 'yard') {
        if (yard.has(token.pos)) throw new Error(`${color} yard overlap ${index}`);
        yard.add(token.pos);
      } else {
        throw new Error(`bad zone ${token.zone}`);
      }
    });
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic two-player playout used by smoke tests. */
export function simulateMatch(seed = 1) {
  const now0 = 1_700_000_000_000;
  const host = createLobby({ name: 'Host', secret: 'host-secret', now: now0 });
  if (!host.ok) throw new Error(host.error);
  const joined = applyJoin(host.state, { name: 'Gast', secret: 'guest-secret', now: now0 });
  if (!joined.ok) throw new Error(joined.error);
  const started = applyStart(joined.state, 'host-secret', now0);
  if (!started.ok) throw new Error(started.error);
  let state = started.state;
  const rng = mulberry32(seed);
  let plies = 0;
  let clock = now0;
  while (state.status === 'playing' && plies < 4000) {
    plies += 1;
    clock += 1000;
    const seat = state.seats[state.turn];
    const rolled = applyRoll(state, seat.secret, clock, rng);
    if (!rolled.ok) throw new Error(`roll ${rolled.error}`);
    state = rolled.state;
    assertBoard(state);
    if (state.status !== 'playing') break;
    if (state.phase === 'move') {
      const choice = state.legal[Math.floor(rng() * state.legal.length)];
      const moved = applyMove(state, seat.secret, choice.token, clock);
      if (!moved.ok) throw new Error(`move ${moved.error}`);
      state = moved.state;
      assertBoard(state);
    }
  }
  return { state, plies };
}

/** Rules + a few scripted positions. Throws if v1 behaviour drifts. */
export function selfCheck() {
  const problems = layoutProblems();
  if (problems.length) throw new Error(`board layout: ${problems.join(', ')}`);
  for (const seed of [1, 2, 7]) {
    const played = simulateMatch(seed);
    if (played.state.status !== 'finished' || !played.state.winner) {
      throw new Error(`seed ${seed} did not finish`);
    }
  }
  const now = 5_000_000;
  const die = (n) => () => (n - 1) / 6 + 0.0001;
  let rolled = applyRoll(
    applyStart(
      applyJoin(createLobby({ name: 'A', secret: 'h', now }).state, { name: 'B', secret: 'g', now }).state,
      'h',
      now
    ).state,
    'h',
    now,
    die(1)
  );
  if (rolled.state.notice !== 'no-move' || rolled.state.turn !== 1) {
    throw new Error('a 1 should pass when every token is in the yard');
  }
  const paired = applyStart(
    applyJoin(createLobby({ name: 'A', secret: 'h', now }).state, { name: 'B', secret: 'g', now }).state,
    'h',
    now
  ).state;
  rolled = applyRoll(paired, 'h', now, die(6));
  if (!rolled.ok) throw new Error('host should be able to roll after start');
  if (rolled.state.phase !== 'move') throw new Error('a 6 from the yard should be playable');
  let moved = applyMove(rolled.state, 'h', 0, now);
  if (moved.state.tokens.red[0].zone !== 'track' || moved.state.phase !== 'roll' || moved.state.turn !== 0) {
    throw new Error('first 6 should leave the yard and grant another roll');
  }
  for (let i = 0; i < 2; i += 1) {
    const again = applyRoll(moved.state, 'h', now, die(6));
    const token = again.state.legal.find((move) => move.token === 0).token;
    moved = applyMove(again.state, 'h', token, now);
  }
  if (moved.state.turn !== 1 || moved.state.notice !== 'six-cap') {
    throw new Error('third consecutive 6 should pass the turn');
  }
  let state = applyStart(
    applyJoin(createLobby({ name: 'A', secret: 'h', now }).state, { name: 'B', secret: 'g', now }).state,
    'h',
    now
  ).state;
  state.tokens.red[0] = { zone: 'track', pos: 3 };
  state.tokens.blue[0] = { zone: 'track', pos: 32 };
  state.turn = 1;
  rolled = applyRoll(state, 'g', now, die(1));
  if (!rolled.state.legal.some((move) => move.token === 0 && move.capture)) {
    throw new Error('expected a capture');
  }
  moved = applyMove(rolled.state, 'g', 0, now);
  if (moved.state.tokens.red[0].zone !== 'yard') throw new Error('capture should send the token back to the yard');
  assertBoard(moved.state);
  state.tokens.red[0] = { zone: 'track', pos: 0 };
  state.tokens.blue[0] = { zone: 'track', pos: 29 };
  if (legalMoves(state, 'blue', 1).some((move) => move.token === 0)) {
    throw new Error('a token on its own start field is safe');
  }
  state.tokens.red[1] = { zone: 'track', pos: 1 };
  if (legalMoves(state, 'red', 1).some((move) => move.token === 0)) {
    throw new Error('a token cannot pass its own token');
  }
  state.tokens.red[0] = { zone: 'home', pos: 2 };
  if (legalMoves(state, 'red', 3).some((move) => move.token === 0)) {
    throw new Error('overshooting home is illegal');
  }
  if (!legalMoves(state, 'red', 1).some((move) => move.token === 0 && move.to.zone === 'home' && move.to.pos === 3)) {
    throw new Error('exact count should enter the last home field');
  }
}

export function layoutProblems() {
  const problems = [];
  const seen = new Set();
  const mark = (cell, label) => {
    const key = `${cell[0]},${cell[1]}`;
    if (cell[0] < 0 || cell[0] > 10 || cell[1] < 0 || cell[1] > 10) problems.push(`off ${label}`);
    if (seen.has(key)) problems.push(`overlap ${key} ${label}`);
    seen.add(key);
  };
  if (TRACK_CELLS.length !== TRACK_LEN) problems.push('track length');
  TRACK_CELLS.forEach((cell, i) => mark(cell, `track ${i}`));
  for (const color of COLORS) {
    if (HOME_CELLS[color].length !== HOME_LEN) problems.push(`home ${color}`);
    if (YARD_CELLS[color].length !== TOKENS_PER) problems.push(`yard ${color}`);
    HOME_CELLS[color].forEach((cell) => mark(cell, `home ${color}`));
    YARD_CELLS[color].forEach((cell) => mark(cell, `yard ${color}`));
    if (START_INDEX[color] % 10 !== 0) problems.push(`start ${color}`);
  }
  for (let i = 0; i < TRACK_CELLS.length; i += 1) {
    const a = TRACK_CELLS[i];
    const b = TRACK_CELLS[(i + 1) % TRACK_CELLS.length];
    const dist = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (dist !== 1) problems.push(`gap ${i}`);
  }
  return problems;
}
