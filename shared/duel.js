/**
 * Orbit Duel — two-paddle neon pong / air hockey.
 * Pure functions. No sockets, no timers. The Worker stores one JSON blob per room.
 *
 * The server owns the ball. A poll projects the ball forward in memory and only
 * writes D1 when a point, a serve, a forfeit, or a throttled paddle move happens.
 * Clients draw ahead from the last snapshot in real time; points come from the server.
 * Hits are swept against the paddle face (the ball cannot tunnel through),
 * and a paddle update is applied before that catch-up step. A miss inside
 * HIT_GRACE_MS can still be saved when the blocking paddle arrives.
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
export const POLL_MS_PLAY = 120;
export const PADDLE_MIN_INTERVAL_MS = 240;
export const PADDLE_FAST_INTERVAL_MS = 100;
export const PADDLE_EPSILON = 0.008;
export const HIT_GRACE_MS = 240;
export const HEARTBEAT_MS = 12_000;
export const ABANDON_MS = 70_000;
export const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
export const PREDICT_MS = 900;

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

/** Ball-center Y where the ball's surface meets the inner paddle face. */
export function contactPlaneY(role) {
  return role === 'guest' ? paddleFaceY('guest') + BALL_R : paddleFaceY('host') - BALL_R;
}

/** Guest view mirrors Y so their paddle stays at the bottom. X is not flipped. */
export function viewY(y, role) {
  return role === 'guest' ? 1 - y : y;
}

export function paddleCovers(ballX, paddleX) {
  return Math.abs(ballX - clampPaddle(paddleX)) <= PADDLE_W / 2 + BALL_R;
}

/** Faster writes only while the ball is coming at this paddle, so blocks land in D1. */
export function paddleWriteIntervalMs(state, role) {
  if (role !== 'host' && role !== 'guest') return PADDLE_MIN_INTERVAL_MS;
  const miss = state?.lastMiss;
  if (miss?.defender === role) {
    const waiting = state.phase === 'wait' && state.notice === 'point';
    const falseWin = state.status === 'finished' && state.notice === 'win';
    if ((waiting || falseWin) && state.openSave == null) return PADDLE_FAST_INTERVAL_MS;
  }
  const save = state?.openSave;
  if (save?.defender === role) return PADDLE_FAST_INTERVAL_MS;
  const ball = state?.ball;
  if (!ball || state.status !== 'playing' || state.phase !== 'live') return PADDLE_MIN_INTERVAL_MS;
  const toward = role === 'guest' ? ball.vy < 0 : ball.vy > 0;
  if (!toward) return PADDLE_MIN_INTERVAL_MS;
  if (Math.abs(ball.y - contactPlaneY(role)) <= 0.38) return PADDLE_FAST_INTERVAL_MS;
  return PADDLE_MIN_INTERVAL_MS;
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

function crossU(y0, y1, plane) {
  if (y1 === y0) return null;
  const u = (plane - y0) / (y1 - y0);
  if (u < -0.0001 || u > 1.0001) return null;
  return Math.min(1, Math.max(0, u));
}

function noteCheckpoint(state) {
  const ball = state.ball;
  if (!ball || state.phase !== 'live' || state.status !== 'playing') return;
  const top = contactPlaneY('guest') + 0.2;
  const bot = contactPlaneY('host') - 0.2;
  if (ball.y <= top || ball.y >= bot) return;
  state.checkpoint = {
    ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, t: ball.t },
    score: [state.score?.[0] || 0, state.score?.[1] || 0],
    rally: state.rally || 0,
    serve: state.serve,
  };
}

function paddleHitOnSegment(state, x0, y0, x1, y1, vy) {
  if (vy < 0) {
    const plane = contactPlaneY('guest');
    const u = crossU(y0, y1, plane);
    if (u == null || y0 < plane - 0.0001) return null;
    const x = x0 + (x1 - x0) * u;
    const paddleX = clampPaddle(state.seats[1]?.paddle ?? 0.5);
    if (!paddleCovers(x, paddleX)) return null;
    return { u, x, plane, paddleX, vySign: 1 };
  }
  if (vy > 0) {
    const plane = contactPlaneY('host');
    const u = crossU(y0, y1, plane);
    if (u == null || y0 > plane + 0.0001) return null;
    const x = x0 + (x1 - x0) * u;
    const paddleX = clampPaddle(state.seats[0]?.paddle ?? 0.5);
    if (!paddleCovers(x, paddleX)) return null;
    return { u, x, plane, paddleX, vySign: -1 };
  }
  return null;
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
  state.lastMiss = null;
}

const GOAL_TOP = BALL_R * 0.45;
const GOAL_BOTTOM = 1 - BALL_R * 0.45;

function placeMiss(state, defender, x, crossAt, opts, now) {
  const scorer = defender === 'host' ? 'guest' : 'host';
  const plane = contactPlaneY(defender);
  const heldX = Math.min(1 - BALL_R, Math.max(BALL_R, x));
  if (opts.stopOnScore) {
    state.ball.x = heldX;
    state.ball.y = defender === 'guest' ? GOAL_TOP : GOAL_BOTTOM;
    state.ball.t = crossAt;
    return { scored: true, held: true };
  }
  // Keep the miss in memory until the grace window ends so a late paddle
  // write can still replay the rally. This view is not a D1 write by itself.
  if (now < crossAt + HIT_GRACE_MS) {
    const outward = defender === 'guest' ? 1 : -1;
    state.ball.x = heldX;
    state.ball.y = plane + outward * 0.002;
    state.ball.t = crossAt;
    return { scored: false, deferred: true };
  }
  state.lastMiss = { defender, x: heldX, at: crossAt, scorer };
  scorePoint(state, scorer, crossAt);
  return { scored: true };
}

/**
 * Integrate the live ball. `stopOnScore` freezes the ball on the goal line
 * without awarding a point — clients use that so only the server counts.
 * Paddle contact is swept, so a step that jumps past the face still hits
 * at the crossing x instead of the x after the step.
 */
export function stepBall(state, now, opts = {}) {
  if (state.status !== 'playing' || state.phase !== 'live' || !state.ball) return { scored: false };
  let t = state.ball.t || now;
  if (now <= t) return { scored: false };
  const end = Math.min(now, t + MAX_SIM_MS);
  let guard = 0;
  while (t < end - 0.01 && guard < 400) {
    guard += 1;
    noteCheckpoint(state);
    const dtMs = Math.min(STEP_MS, end - t);
    const dt = dtMs / 1000;
    const ball = state.ball;
    const x0 = ball.x;
    const y0 = ball.y;
    const vx = ball.vx;
    const vy = ball.vy;
    let x1 = x0 + vx * dt;
    let y1 = y0 + vy * dt;
    let used = dt;

    if (x1 < BALL_R && vx < 0 && x0 > BALL_R) {
      const u = (BALL_R - x0) / (x1 - x0);
      if (u >= 0 && u < 1) {
        x1 = BALL_R;
        y1 = y0 + (y1 - y0) * u;
        used = dt * u;
      }
    } else if (x1 > 1 - BALL_R && vx > 0 && x0 < 1 - BALL_R) {
      const u = (1 - BALL_R - x0) / (x1 - x0);
      if (u >= 0 && u < 1) {
        x1 = 1 - BALL_R;
        y1 = y0 + (y1 - y0) * u;
        used = dt * u;
      }
    }

    const hit = paddleHitOnSegment(state, x0, y0, x1, y1, vy);
    if (hit) {
      ball.x = hit.x;
      ball.y = hit.plane;
      reflect(ball, hit.paddleX, hit.vySign);
      ball.y = hit.plane + hit.vySign * 0.0015;
      const advMs = Math.max(1, used * hit.u * 1000);
      t += advMs;
      ball.t = t;
      continue;
    }

    const reachedGoal =
      (vy < 0 && y1 <= GOAL_TOP) || (vy > 0 && y1 >= GOAL_BOTTOM);
    if (reachedGoal) {
      const defender = vy < 0 ? 'guest' : 'host';
      const plane = contactPlaneY(defender);
      const uPlane = crossU(y0, y1, plane);
      const u = uPlane == null ? 1 : uPlane;
      const crossAt = t + Math.max(0, used * u * 1000);
      const result = placeMiss(state, defender, x0 + (x1 - x0) * u, crossAt, opts, now);
      return result;
    }

    const wall = used < dt - 1e-6;
    ball.x = x1;
    ball.y = y1;
    if (wall) {
      if (x1 <= BALL_R + 1e-5) ball.vx = Math.abs(vx);
      else if (x1 >= 1 - BALL_R - 1e-5) ball.vx = -Math.abs(vx);
    } else if (x1 < BALL_R) {
      ball.x = BALL_R;
      ball.vx = Math.abs(vx);
    } else if (x1 > 1 - BALL_R) {
      ball.x = 1 - BALL_R;
      ball.vx = -Math.abs(vx);
    }
    const advMs = Math.max(wall ? 1 : 0, used * 1000);
    t += advMs || dtMs;
    ball.t = t;
  }
  return { scored: false };
}

function tryUndoMiss(state, role, now) {
  const miss = state.lastMiss;
  const cp = state.checkpoint;
  if (!miss || miss.defender !== role || !cp?.ball) return false;
  if (now - miss.at > HIT_GRACE_MS) return false;
  const waiting = state.phase === 'wait' && state.notice === 'point' && now < (state.serveAt || 0);
  const falseWin = state.status === 'finished' && state.notice === 'win' && state.winner === miss.scorer;
  if (!waiting && !falseWin) return false;
  const paddle = role === 'guest' ? state.seats[1]?.paddle : state.seats[0]?.paddle;
  if (!paddleCovers(miss.x, paddle)) return false;
  const trial = clone(state);
  trial.status = 'playing';
  trial.phase = 'live';
  trial.notice = null;
  trial.winner = null;
  trial.score = [cp.score[0] || 0, cp.score[1] || 0];
  trial.rally = cp.rally || 0;
  trial.serve = cp.serve || 'host';
  trial.serveAt = 0;
  trial.ball = { x: cp.ball.x, y: cp.ball.y, vx: cp.ball.vx, vy: cp.ball.vy, t: cp.ball.t };
  trial.lastMiss = null;
  stepBall(trial, now);
  const away = role === 'guest' ? trial.ball?.vy > 0 : trial.ball?.vy < 0;
  if (trial.status !== 'playing' || trial.phase !== 'live' || !away) return false;
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, trial);
  return true;
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
  if (
    !state ||
    (state.status !== 'lobby' && state.status !== 'countdown' && state.status !== 'playing' && state.status !== 'finished')
  ) {
    return fail(409, 'not-playing', 'Runde läuft nicht.');
  }
  const who = findSeat(state, secret);
  if (!who) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  const next = clone(state);
  const seat = next.seats[who.index];
  if (!seat?.occupied) return fail(403, 'not-seated', 'Du sitzt nicht in diesem Raum.');
  if (seat.abandoned) return fail(403, 'abandoned', 'Sitz ist freigegeben.');
  touch(seat, now);
  const clamped = clampPaddle(paddle);
  const interval = paddleWriteIntervalMs(next, seat.role);
  const delta = Math.abs(clamped - (seat.paddle ?? 0.5));
  const tooSoon = now - (seat.lastPaddleAt || 0) < interval;
  const moved = delta >= PADDLE_EPSILON && !tooSoon;
  // The new face is in place before the catch-up step, so this request
  // collides with where the paddle is now, not where it was last write.
  if (moved) {
    seat.paddle = clamped;
    seat.lastPaddleAt = now;
  }
  if (tryUndoMiss(next, seat.role, now)) return { ok: true, state: next, unchanged: false };
  if (next.status === 'finished') return { ok: true, unchanged: true, state: next };
  const clock = applyClock(next, now);
  const result = clock.state;
  if (!moved && !clock.dirty) return { ok: true, unchanged: true, state: result };
  return { ok: true, state: result, unchanged: false };
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
    checkpoint: state.checkpoint?.ball
      ? {
          ball: {
            x: state.checkpoint.ball.x,
            y: state.checkpoint.ball.y,
            vx: state.checkpoint.ball.vx,
            vy: state.checkpoint.ball.vy,
            t: state.checkpoint.ball.t,
          },
          score: [state.checkpoint.score?.[0] || 0, state.checkpoint.score?.[1] || 0],
          rally: state.checkpoint.rally || 0,
          serve: state.checkpoint.serve || 'host',
        }
      : null,
    openSave: openSaveOf(state),
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

function openSaveOf(state) {
  const miss = state?.lastMiss;
  if (!miss || !Number.isFinite(miss.at)) return null;
  const until = miss.at + HIT_GRACE_MS;
  const waiting = state.phase === 'wait' && state.notice === 'point';
  const falseWin = state.status === 'finished' && state.notice === 'win' && state.winner === miss.scorer;
  if (!waiting && !falseWin) return null;
  return { defender: miss.defender, x: miss.x, until };
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

/**
 * While the server is still inside the save window, the defender keeps
 * drawing the rally from the pre-contact checkpoint instead of the reset ball.
 */
export function projectDefense(state, now, role, paddle) {
  if (!state?.checkpoint?.ball || (role !== 'host' && role !== 'guest')) return state;
  const next = clone(state);
  next.status = 'playing';
  next.phase = 'live';
  next.notice = null;
  next.winner = null;
  next.score = [state.checkpoint.score?.[0] || 0, state.checkpoint.score?.[1] || 0];
  next.rally = state.checkpoint.rally || state.rally || 0;
  next.serve = state.checkpoint.serve || state.serve;
  next.ball = { ...state.checkpoint.ball };
  next.lastMiss = null;
  next.openSave = null;
  const seat = next.seats.find((item) => item.role === role);
  if (seat && Number.isFinite(paddle)) seat.paddle = clampPaddle(paddle);
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

  if (viewY(paddleCenterY('guest'), 'guest') < 0.9) throw new Error('guest view keeps their paddle at the bottom');
  if (viewY(paddleCenterY('host'), 'guest') > 0.1) throw new Error('guest view puts the host paddle at the top');
  if (viewY(0.25, 'host') !== 0.25) throw new Error('host view does not flip y');

  const edgeX = 0.5 + PADDLE_W / 2 + BALL_R * 0.6;
  let edge = started.state;
  edge.ball = { x: edgeX, y: 0.7, vx: 0, vy: 0.9, t: missAt + 30_000 };
  edge.phase = 'live';
  edge.status = 'playing';
  edge.score = [0, 0];
  edge.seats[0].paddle = 0.5;
  edge.seats[1].paddle = 0.5;
  edge.seats[0].lastSeen = missAt + 30_000;
  edge.seats[1].lastSeen = missAt + 30_000;
  const edged = applyClock(edge, missAt + 30_400);
  if (edged.state.score[0] + edged.state.score[1] !== 0) throw new Error('ball radius should still meet the paddle');
  if (!(edged.state.ball.vy < 0)) throw new Error('an edge hit bounces');

  let sweep = started.state;
  const plane = contactPlaneY('host');
  sweep = {
    ...started.state,
    phase: 'live',
    status: 'playing',
    score: [0, 0],
    ball: { x: 0.5 + 0.16, y: plane - 0.002, vx: 4, vy: 1, t: missAt + 40_000 },
    seats: started.state.seats.map((seat, index) => ({
      ...seat,
      paddle: 0.5,
      lastSeen: missAt + 40_000,
      lastPaddleAt: 0,
    })),
  };
  const swept = applyClock(sweep, missAt + 40_000 + 32);
  if (swept.state.score[1] !== 0 || !(swept.state.ball.vy < 0)) {
    throw new Error('a fast diagonal step must hit at the crossing, not past the paddle');
  }

  const lateT = missAt + 50_000;
  const late = {
    ...started.state,
    phase: 'live',
    status: 'playing',
    score: [1, 1],
    ball: { x: 0.8, y: 0.86, vx: 0, vy: 0.7, t: lateT },
    seats: started.state.seats.map((seat, index) => ({
      ...seat,
      paddle: index === 0 ? 0.2 : 0.5,
      lastSeen: lateT,
      lastPaddleAt: 0,
    })),
  };
  const blocked = applyPaddle(late, 'host-secret', 0.8, lateT + 150);
  if (!blocked.ok || blocked.state.score[0] + blocked.state.score[1] !== 2) {
    throw new Error('paddle is applied before the ball steps, so the block counts');
  }
  if (!(blocked.state.ball.vy < 0)) throw new Error('late paddle still sends the ball back');

  const fromMid = {
    ...late,
    ball: { x: 0.8, y: 0.5, vx: 0, vy: 0.7, t: lateT },
  };
  const grace = applyClock(fromMid, lateT + 620);
  if (grace.dirty || grace.state.score[1] !== 1 || grace.state.phase !== 'live') {
    throw new Error('a fresh miss waits inside the grace window and is not written');
  }
  const committed = applyClock(fromMid, lateT + 1200);
  if (committed.state.score[1] !== 2 || !committed.state.lastMiss || !committed.state.checkpoint?.ball) {
    throw new Error('the miss counts after the grace window');
  }
  const undone = applyPaddle(committed.state, 'host-secret', 0.8, committed.state.lastMiss.at + 100);
  if (!undone.ok || undone.state.score[1] !== 1 || undone.state.phase !== 'live' || !(undone.state.ball.vy < 0)) {
    throw new Error('a paddle that covers the miss inside the grace window restores the rally');
  }

  const far = applyPaddle(blocked.state, 'host-secret', 0.42, blocked.state.ball.t + 30);
  if (!far.unchanged && Math.abs((far.state.seats[0].paddle ?? 0) - blocked.state.seats[0].paddle) > 0.02) {
    throw new Error('paddle writes stay slow while the ball is leaving');
  }
  const approaching = {
    ...blocked.state,
    ball: { ...blocked.state.ball, y: contactPlaneY('host') - 0.2, vy: 0.6, t: blocked.state.ball.t },
    seats: blocked.state.seats.map((seat, index) => ({
      ...seat,
      lastPaddleAt: blocked.state.ball.t,
    })),
  };
  const quick = applyPaddle(approaching, 'host-secret', clampPaddle(approaching.seats[0].paddle + 0.05), approaching.ball.t + 120);
  if (!quick.ok || quick.unchanged) throw new Error('approaching paddle writes are accepted inside 120ms');

  if (CODE_ALPHABET.length < 30) throw new Error('alphabet');
}
