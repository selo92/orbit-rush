/**
 * Orbit Duel — two-paddle neon pong / air hockey.
 * Pure functions. No sockets, no timers. The Worker stores one JSON blob per room.
 *
 * The server owns the ball. A poll projects the ball forward in memory and only
 * writes D1 when a point, a serve, a forfeit, or a throttled paddle move happens.
 * Clients may draw ahead from the last snapshot; points come from the server.
 *
 * Rules:
 * - Host paddle is the bottom, guest paddle is the top. Each client flips the
 *   view so their own paddle stays at the bottom of the screen.
 * - First to 7. The player who missed receives the next serve.
 * - Both seats press ready. The match counts down, then the ball is live.
 * - A seat with no heartbeat for 70s is abandoned. During a match that is a forfeit.
 */

export const WIN_SCORE = 7;
export const BALL_R = 0.022;
export const PADDLE_W = 0.3;
export const PADDLE_H = 0.028;
export const PADDLE_INSET = 0.055;
export const BALL_SPEED = 0.52;
export const MAX_BALL_SPEED = 0.8;
export const SPEED_GAIN = 1.04;
export const COUNTDOWN_MS = 3000;
export const SERVE_DELAY_MS = 900;
export const POLL_MS_LOBBY = 1600;
export const POLL_MS_PLAY = 220;
export const PADDLE_MIN_INTERVAL_MS = 240;
export const PADDLE_EPSILON = 0.008;
export const HEARTBEAT_MS = 12_000;
export const ABANDON_MS = 70_000;
export const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
export const PREDICT_MS = 450;

const STEP_MS = 16;
const MAX_SIM_MS = 2000;
const MAX_ANGLE = 1.0;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function pollDelayMs(status) {
  if (status === 'playing' || status === 'countdown') return POLL_MS_PLAY;
  if (status === 'finished') return 1000;
  return POLL_MS_LOBBY;
}

export function normalizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(code) ? code : '';
}

export function clampPaddle(x) {
  const half = PADDLE_W / 2;
  const n = Number(x);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1 - half, Math.max(half, n));
}

export function paddleCenterY(role) {
  return role === 'guest' ? PADDLE_INSET : 1 - PADDLE_INSET;
}

export function paddleFaceY(role) {
  const half = PADDLE_H / 2;
  const center = paddleCenterY(role);
  return role === 'guest' ? center + half : center - half;
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

function emptySeat(role) {
  return {
    role,
    occupied: false,
    name: null,
    secret: null,
    host: role === 'host',
    ready: false,
    abandoned: false,
    paddle: 0.5,
    lastSeen: 0,
    lastPaddleAt: 0,
  };
}

function clearSeat(seat) {
  const role = seat.role;
  Object.assign(seat, emptySeat(role));
}

function touch(seat, now) {
  seat.lastSeen = now;
  seat.abandoned = false;
}

function stillBall(now) {
  return { x: 0.5, y: 0.5, vx: 0, vy: 0, t: now };
}

export function createLobby({ name, secret, now }) {
  const clean = typeof name === 'string' ? name : '';
  if (!clean) return fail(400, 'name', 'Name fehlt (max. 16).');
  if (!secret || typeof secret !== 'string') return fail(400, 'secret', 'Secret fehlt.');
  const host = emptySeat('host');
  host.occupied = true;
  host.name = clean;
  host.secret = secret;
  host.host = true;
  host.lastSeen = now;
  return {
    ok: true,
    state: {
      status: 'lobby',
      phase: 'wait',
      seats: [host, emptySeat('guest')],
      score: [0, 0],
      winner: null,
      notice: null,
      rally: 0,
      matchSeq: 0,
      serve: 'host',
      serveAt: 0,
      countdownEndsAt: 0,
      ball: stillBall(now),
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

export function applyJoin(state, { name, secret, now }) {
  if (!state || state.status !== 'lobby') return fail(409, 'started', 'Spiel läuft schon.');
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
  seat.host = idx === 0;
  seat.ready = false;
  seat.abandoned = false;
  seat.paddle = 0.5;
  seat.lastSeen = now;
  seat.lastPaddleAt = 0;
  return { ok: true, state: next, seat: idx };
}

function bothReady(state) {
  return state.seats.length === 2 && state.seats.every((seat) => seat.occupied && !seat.abandoned && seat.ready);
}

export function applyReady(state, secret, now) {
  if (!state || state.status !== 'lobby') return fail(409, 'started', 'Spiel läuft schon.');
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  const next = clone(state);
  const seat = next.seats[who.index];
  touch(seat, now);
  seat.ready = true;
  if (!bothReady(next)) return { ok: true, state: next };
  next.status = 'countdown';
  next.phase = 'wait';
  next.countdownEndsAt = now + COUNTDOWN_MS;
  next.matchSeq = (state.matchSeq || 0) + 1;
  next.score = [0, 0];
  next.winner = null;
  next.notice = null;
  next.rally = 0;
  next.serve = 'host';
  next.serveAt = 0;
  next.ball = stillBall(now);
  return { ok: true, state: next };
}

function reflect(ball, paddleX, vySign) {
  const half = PADDLE_W / 2;
  const offset = Math.max(-1, Math.min(1, (ball.x - paddleX) / half));
  let speed = Math.hypot(ball.vx, ball.vy) * SPEED_GAIN;
  if (speed < BALL_SPEED) speed = BALL_SPEED;
  if (speed > MAX_BALL_SPEED) speed = MAX_BALL_SPEED;
  const angle = offset * MAX_ANGLE;
  ball.vx = Math.sin(angle) * speed;
  ball.vy = vySign * Math.cos(angle) * speed;
}

function overlap(ballX, paddleX) {
  const px = clampPaddle(paddleX);
  return Math.abs(ballX - px) <= PADDLE_W / 2 + BALL_R * 0.25;
}

function scorePoint(state, scorer, now) {
  const idx = scorer === 'guest' ? 1 : 0;
  const score = [state.score[0] || 0, state.score[1] || 0];
  score[idx] += 1;
  state.score = score;
  state.serve = scorer === 'host' ? 'guest' : 'host';
  state.notice = 'point';
  if (score[idx] >= WIN_SCORE) {
    state.status = 'finished';
    state.winner = scorer;
    state.phase = 'done';
    state.notice = 'win';
    state.ball = stillBall(now);
    return;
  }
  state.phase = 'wait';
  state.serveAt = now + SERVE_DELAY_MS;
  state.ball = stillBall(now);
}

function launch(state, now, rng) {
  const towardHost = state.serve !== 'guest';
  const dir = towardHost ? 1 : -1;
  const unit = Number(rng());
  const roll = Number.isFinite(unit) ? Math.min(0.999999, Math.max(0, unit)) : 0.5;
  const angle = (roll - 0.5) * 0.9;
  const speed = BALL_SPEED;
  state.ball = {
    x: 0.5,
    y: 0.5,
    vx: Math.sin(angle) * speed * 0.85,
    vy: dir * Math.max(0.55, Math.cos(angle)) * speed,
    t: now,
  };
  state.phase = 'live';
  state.rally = (state.rally || 0) + 1;
  state.notice = null;
}

/**
 * Integrate the live ball. `stopOnScore` freezes the ball on the goal line
 * without awarding a point — clients use that so only the server counts.
 */
export function stepBall(state, now, opts = {}) {
  const stopOnScore = !!opts.stopOnScore;
  if (state.status !== 'playing' || state.phase !== 'live' || !state.ball) return { scored: false };
  let t = state.ball.t || now;
  if (now <= t) return { scored: false };
  const end = Math.min(now, t + MAX_SIM_MS);
  let guard = 0;
  while (t < end - 0.01 && guard < 200) {
    guard += 1;
    const dtMs = Math.min(STEP_MS, end - t);
    const dt = dtMs / 1000;
    const ball = state.ball;
    let x = ball.x + ball.vx * dt;
    let y = ball.y + ball.vy * dt;
    if (x < BALL_R) {
      x = BALL_R;
      ball.vx = Math.abs(ball.vx);
    } else if (x > 1 - BALL_R) {
      x = 1 - BALL_R;
      ball.vx = -Math.abs(ball.vx);
    }
    const guestFace = paddleFaceY('guest');
    const hostFace = paddleFaceY('host');
    if (ball.vy < 0 && ball.y >= guestFace - 0.0001 && y <= guestFace) {
      const guest = state.seats[1];
      if (guest && overlap(x, guest.paddle)) {
        ball.x = x;
        reflect(ball, clampPaddle(guest.paddle), 1);
        y = guestFace + BALL_R + 0.006;
      }
    } else if (ball.vy > 0 && ball.y <= hostFace + 0.0001 && y >= hostFace) {
      const host = state.seats[0];
      if (host && overlap(x, host.paddle)) {
        ball.x = x;
        reflect(ball, clampPaddle(host.paddle), -1);
        y = hostFace - BALL_R - 0.006;
      }
    }
    if (y < BALL_R * 0.45) {
      if (stopOnScore) {
        ball.x = x;
        ball.y = BALL_R * 0.45;
        ball.t = t + dtMs;
        return { scored: true, held: true };
      }
      scorePoint(state, 'host', t + dtMs);
      return { scored: true };
    }
    if (y > 1 - BALL_R * 0.45) {
      if (stopOnScore) {
        ball.x = x;
        ball.y = 1 - BALL_R * 0.45;
        ball.t = t + dtMs;
        return { scored: true, held: true };
      }
      scorePoint(state, 'guest', t + dtMs);
      return { scored: true };
    }
    ball.x = x;
    ball.y = y;
    t += dtMs;
    ball.t = t;
  }
  return { scored: false };
}

function forfeit(state, now) {
  const alive = state.seats.filter((seat) => seat.occupied && !seat.abandoned);
  state.status = 'finished';
  state.phase = 'done';
  state.notice = 'forfeit';
  state.winner = alive.length === 1 ? alive[0].role : null;
  state.ball = stillBall(now);
}

function stamp(state) {
  return `${state.status}|${state.phase}|${state.score?.[0]}|${state.score?.[1]}|${state.rally}|${state.winner}|${state.notice}`;
}

export function applyClock(state, now, rng = Math.random) {
  if (!state) return { dirty: false, state };
  const next = clone(state);
  let dirty = false;
  if (next.status === 'lobby' || next.status === 'countdown' || next.status === 'playing') {
    for (const seat of next.seats) {
      if (!seat.occupied || seat.abandoned) continue;
      if (seat.lastSeen && now - seat.lastSeen > ABANDON_MS) {
        seat.abandoned = true;
        dirty = true;
      }
    }
  }
  if (next.status === 'lobby') {
    for (const seat of next.seats) {
      if (seat.abandoned) {
        clearSeat(seat);
        dirty = true;
      }
    }
    return { dirty, state: next };
  }
  if (next.status === 'countdown' || next.status === 'playing') {
    const alive = next.seats.filter((seat) => seat.occupied && !seat.abandoned);
    if (alive.length < 2) {
      forfeit(next, now);
      return { dirty: true, state: next };
    }
  }
  if (next.status === 'countdown' && now >= next.countdownEndsAt) {
    next.status = 'playing';
    next.serve = 'host';
    launch(next, now, rng);
    return { dirty: true, state: next };
  }
  if (next.status === 'playing' && next.phase === 'wait' && now >= (next.serveAt || 0)) {
    launch(next, now, rng);
    return { dirty: true, state: next };
  }
  if (next.status === 'playing' && next.phase === 'live') {
    const before = stamp(next);
    stepBall(next, now);
    if (stamp(next) !== before) dirty = true;
    return { dirty, state: next };
  }
  return { dirty, state: next };
}

export function applyPaddle(state, secret, paddle, now) {
  if (!state || (state.status !== 'lobby' && state.status !== 'countdown' && state.status !== 'playing')) {
    return fail(409, 'not-playing', 'Runde läuft nicht.');
  }
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  const clock = applyClock(state, now);
  const next = clock.state;
  const seat = next.seats[who.index];
  if (!seat?.occupied) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (seat.abandoned) return fail(403, 'abandoned', 'Sitz ist freigegeben.');
  if (next.status === 'finished') {
    return clock.dirty
      ? { ok: true, state: next, unchanged: false }
      : { ok: true, unchanged: true, state: next };
  }
  const clamped = clampPaddle(paddle);
  const delta = Math.abs(clamped - (seat.paddle ?? 0.5));
  const tooSoon = now - (seat.lastPaddleAt || 0) < PADDLE_MIN_INTERVAL_MS;
  const moved = delta >= PADDLE_EPSILON && !tooSoon;
  touch(seat, now);
  if (!moved && !clock.dirty) return { ok: true, unchanged: true, state: next };
  if (moved) {
    seat.paddle = clamped;
    seat.lastPaddleAt = now;
  }
  return { ok: true, state: next, unchanged: false };
}

export function applyHeartbeat(state, secret, now) {
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  const clock = applyClock(state, now);
  const next = clock.state;
  const seat = next.seats[who.index];
  if (!seat?.occupied) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (!clock.dirty && now - (seat.lastSeen || 0) < HEARTBEAT_MS) {
    return { ok: true, unchanged: true, state: next };
  }
  touch(seat, now);
  return { ok: true, state: next, unchanged: false };
}

export function applyLeave(state, secret, now) {
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  const next = clone(state);
  const seat = next.seats[who.index];
  if (next.status === 'lobby' || next.status === 'finished') {
    const wasHost = seat.role === 'host';
    clearSeat(seat);
    if (wasHost && next.seats[1].occupied) {
      const guest = next.seats[1];
      next.seats[0] = {
        ...guest,
        role: 'host',
        host: true,
      };
      next.seats[1] = emptySeat('guest');
    }
    return { ok: true, state: next };
  }
  seat.abandoned = true;
  seat.lastSeen = 0;
  const clock = applyClock(next, now);
  return { ok: true, state: clock.state };
}

export function applyRematch(state, secret, now) {
  if (!state || state.status !== 'finished') return fail(409, 'not-over', 'Die Runde ist noch nicht zu Ende.');
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  const next = clone(state);
  for (const seat of next.seats) {
    if (!seat.occupied || seat.abandoned) {
      clearSeat(seat);
      continue;
    }
    seat.ready = false;
    seat.abandoned = false;
    seat.paddle = 0.5;
    seat.lastPaddleAt = 0;
    seat.lastSeen = now;
  }
  if (!next.seats[0].occupied && next.seats[1].occupied) {
    const guest = next.seats[1];
    next.seats[0] = { ...guest, role: 'host', host: true };
    next.seats[1] = emptySeat('guest');
  }
  next.status = 'lobby';
  next.phase = 'wait';
  next.score = [0, 0];
  next.winner = null;
  next.notice = null;
  next.rally = 0;
  next.serve = 'host';
  next.serveAt = 0;
  next.countdownEndsAt = 0;
  next.ball = stillBall(now);
  return { ok: true, state: next };
}

export function publicState(state, secret) {
  if (!state) return null;
  return {
    status: state.status,
    phase: state.phase,
    score: [state.score?.[0] || 0, state.score?.[1] || 0],
    target: WIN_SCORE,
    winner: state.winner,
    notice: state.notice,
    rally: state.rally || 0,
    matchSeq: state.matchSeq || 0,
    serve: state.serve,
    serveAt: state.serveAt || 0,
    countdownEndsAt: state.countdownEndsAt || 0,
    ball: state.ball
      ? {
          x: state.ball.x,
          y: state.ball.y,
          vx: state.ball.vx,
          vy: state.ball.vy,
          t: state.ball.t,
        }
      : stillBall(0),
    seats: state.seats.map((seat) => ({
      role: seat.role,
      name: seat.name,
      occupied: !!seat.occupied,
      host: !!seat.host,
      ready: !!seat.ready,
      abandoned: !!seat.abandoned,
      paddle: clampPaddle(seat.paddle ?? 0.5),
      you: !!(secret && seat.secret && secretEquals(seat.secret, secret)),
    })),
  };
}

/** Draw-ahead from a public snapshot. Does not award points. */
export function projectLive(state, now, myRole, myPaddle) {
  if (!state || state.status !== 'playing' || state.phase !== 'live' || !state.ball) return state;
  const next = clone(state);
  if ((myRole === 'host' || myRole === 'guest') && Number.isFinite(myPaddle)) {
    const seat = next.seats.find((item) => item.role === myRole);
    if (seat) seat.paddle = clampPaddle(myPaddle);
  }
  const cap = Math.min(now, (next.ball.t || now) + PREDICT_MS);
  stepBall(next, cap, { stopOnScore: true });
  return next;
}

function straight(rng) {
  return () => (typeof rng === 'function' ? rng() : 0.5);
}

function lobbyPair(now) {
  const host = createLobby({ name: 'Host', secret: 'host-secret', now });
  if (!host.ok) throw new Error(host.error);
  const joined = applyJoin(host.state, { name: 'Gast', secret: 'guest-secret', now });
  if (!joined.ok) throw new Error(joined.error);
  return joined.state;
}

export function selfCheck() {
  if (!CODE_RE.test('ABC234')) throw new Error('sample code should be valid');
  if (normalizeRoomCode('ab c2 34') !== 'ABC234') throw new Error('code normalizes');
  if (normalizeRoomCode('OOOOOO') !== '') throw new Error('ambiguous letters are rejected');
  if (clampPaddle(-2) !== PADDLE_W / 2) throw new Error('paddle clamps low');
  if (clampPaddle(9) !== 1 - PADDLE_W / 2) throw new Error('paddle clamps high');
  if (pollDelayMs('playing') !== POLL_MS_PLAY || pollDelayMs('lobby') !== POLL_MS_LOBBY) {
    throw new Error('poll cadence');
  }

  const now = 1_700_000_000_000;
  const alone = createLobby({ name: 'Host', secret: 'host-secret', now });
  const early = applyReady(alone.state, 'host-secret', now);
  if (early.state.status !== 'lobby') throw new Error('one player cannot start');
  const paired = lobbyPair(now);
  const hostReady = applyReady(paired, 'host-secret', now);
  if (hostReady.state.status !== 'lobby' || !hostReady.state.seats[0].ready) {
    throw new Error('host ready waits for the guest');
  }
  const guestReady = applyReady(hostReady.state, 'guest-secret', now);
  if (guestReady.state.status !== 'countdown' || guestReady.state.matchSeq !== 1) {
    throw new Error('both ready starts the countdown');
  }
  const held = applyClock(guestReady.state, guestReady.state.countdownEndsAt - 1, straight(() => 0.5));
  if (held.state.status !== 'countdown') throw new Error('countdown holds until the timestamp');
  const started = applyClock(guestReady.state, guestReady.state.countdownEndsAt, straight(() => 0.5));
  if (started.state.status !== 'playing' || started.state.phase !== 'live' || started.state.rally !== 1) {
    throw new Error('countdown launches one rally');
  }
  if (started.state.ball.vy <= 0) throw new Error('first serve goes toward the host');
  const again = applyClock(started.state, started.state.ball.t + 120, straight(() => 0.1));
  if (again.state.rally !== 1) throw new Error('a live rally is not re-rolled');
  if (again.dirty) throw new Error('plain ball motion is not a write');
  if (Math.abs(again.state.ball.y - started.state.ball.y) < 0.01) throw new Error('the ball moves');

  const pub = publicState(started.state, 'host-secret');
  if (JSON.stringify(pub).includes('host-secret')) throw new Error('secret stays off the public state');
  if (!pub.seats[0].you || pub.seats[1].you) throw new Error('you flag follows the secret');
  if (pub.target !== WIN_SCORE) throw new Error('public target');

  let rally = started.state;
  rally.ball = { x: 0.5, y: 0.5, vx: 0, vy: BALL_SPEED, t: now + 10_000 };
  rally.seats[0].paddle = 0.5;
  rally.seats[1].paddle = 0.5;
  rally.seats[0].lastSeen = now + 10_000;
  rally.seats[1].lastSeen = now + 10_000;
  rally.score = [0, 0];
  rally.phase = 'live';
  rally.status = 'playing';
  let cursor = rally;
  let flipped = false;
  for (let i = 0; i < 40; i += 1) {
    const prevVy = cursor.ball.vy;
    const stepped = applyClock(cursor, cursor.ball.t + 200);
    cursor = stepped.state;
    if (cursor.status !== 'playing') throw new Error('a centered rally should not score');
    if (prevVy > 0 && cursor.ball.vy < 0) flipped = true;
  }
  if (!flipped) throw new Error('the host paddle should bounce a straight ball');

  let match = started.state;
  match.score = [0, 0];
  match.status = 'playing';
  match.seats[0].lastSeen = now + 20_000;
  match.seats[1].lastSeen = now + 20_000;
  const missAt = now + 20_000;
  for (let i = 0; i < WIN_SCORE; i += 1) {
    match.phase = 'live';
    match.status = 'playing';
    match.ball = { x: 0.85, y: 0.8, vx: 0, vy: 1.2, t: missAt };
    match.seats[0].paddle = 0.15;
    match.seats[1].paddle = 0.5;
    const stepped = applyClock(match, missAt + 500);
    match = stepped.state;
  }
  if (match.status !== 'finished' || match.winner !== 'guest' || match.score[1] !== WIN_SCORE) {
    throw new Error(`guest should win 7, got ${match.status} ${match.winner} ${match.score}`);
  }
  if (match.score[0] !== 0) throw new Error('host should still be on zero');

  const predicted = projectLive(
    { ...publicState(started.state, 'guest-secret'), ball: { x: 0.85, y: 0.8, vx: 0, vy: 1.2, t: missAt }, phase: 'live', status: 'playing', score: [0, 0] },
    missAt + 500,
    'guest',
    0.5
  );
  if (predicted.score[1] !== 0 || predicted.status !== 'playing') {
    throw new Error('client projection must not award the point');
  }

  const bounced = applyClock(
    {
      ...started.state,
      score: [3, 3],
      phase: 'live',
      status: 'playing',
      ball: { x: 0.5, y: 0.7, vx: 0, vy: 0.9, t: missAt },
      seats: started.state.seats.map((seat, index) => ({
        ...seat,
        paddle: 0.5,
        lastSeen: missAt,
        lastPaddleAt: 0,
      })),
    },
    missAt + 400
  );
  if (bounced.state.score[0] + bounced.state.score[1] !== 6) throw new Error('a hit is not a point');
  if (!(bounced.state.ball.vy < 0)) throw new Error('host hit sends the ball back up');

  const third = applyJoin(paired, { name: 'C', secret: 'other-secret', now });
  if (third.ok) throw new Error('a third player cannot join');
  const rematch = applyRematch(match, 'guest-secret', missAt + 1000);
  if (!rematch.ok || rematch.state.status !== 'lobby' || rematch.state.seats[1].ready) {
    throw new Error('rematch returns to the lobby');
  }
  const paddle = applyPaddle(guestReady.state, 'host-secret', 0.8, now);
  if (!paddle.ok || Math.abs(paddle.state.seats[0].paddle - 0.8) > 0.001) throw new Error('paddle stores');
  const spam = applyPaddle(paddle.state, 'host-secret', 0.2, now + 20);
  if (!spam.unchanged) throw new Error('paddle writes are throttled');
  const left = applyLeave(paired, 'host-secret', now);
  if (!left.ok || left.state.seats[0].name !== 'Gast' || left.state.seats[0].role !== 'host') {
    throw new Error('guest becomes host when the host leaves the lobby');
  }
  const staleSeat = lobbyPair(now);
  staleSeat.status = 'playing';
  staleSeat.phase = 'live';
  staleSeat.seats[1].lastSeen = now - ABANDON_MS - 1;
  const gone = applyClock(staleSeat, now);
  if (gone.state.status !== 'finished' || gone.state.winner !== 'host' || gone.state.notice !== 'forfeit') {
    throw new Error('an abandoned guest forfeits');
  }

  if (CODE_ALPHABET.length < 30) throw new Error('alphabet');
}
