/**
 * Orbit Duel HTTP API.
 * Cloudflare Workers Free: plain HTTP + D1. No Durable Objects, WebSockets, or Queues.
 * Polls read the row and project the ball in memory. Writes happen for points,
 * serves, forfeits, throttled paddle moves, and rare cleanup.
 * Rate limits live in this isolate's memory so a poll does not burn a D1 write.
 */
import { sanitizeName } from '../shared/scores.js';
import {
  ROOM_TTL_MS,
  applyClock,
  applyHeartbeat,
  applyJoin,
  applyLeave,
  applyPaddle,
  applyReady,
  applyRematch,
  createLobby,
  normalizeRoomCode,
  pollDelayMs,
  publicState,
} from '../shared/duel.js';

const POLL_LIMIT = 800;
const MUTATION_LIMIT = 800;
const ROOM_MUTATION_LIMIT = 1200;
const WINDOW_MS = 60_000;

const buckets = new Map();

function allow(key, limit) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (buckets.size > 4000) {
    for (const [id, value] of buckets) {
      if (now - value.start >= WINDOW_MS) buckets.delete(id);
    }
  }
  return bucket.count <= limit;
}

export function resetDuelRateLimits() {
  buckets.clear();
}

function clientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, If-None-Match, X-Duel-Secret',
    'Access-Control-Expose-Headers': 'ETag',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function json(body, status, request, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...extra,
    },
  });
}

function etagFor(version) {
  return `W/"${version}"`;
}

function etagMatches(header, version) {
  if (!header) return false;
  const needle = String(version);
  return header.split(',').some((part) => part.trim().replace(/^W\//, '').replaceAll('"', '') === needle);
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let out = '';
  for (const b of arr) out += b.toString(16).padStart(2, '0');
  return out;
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  let out = '';
  for (const b of arr) out += alphabet[b % alphabet.length];
  return out;
}

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 4096) return { error: json({ error: 'too-large', message: 'Zu groß.' }, 413, request) };
  try {
    const text = await request.text();
    if (text.length > 4096) return { error: json({ error: 'too-large', message: 'Zu groß.' }, 413, request) };
    return { body: text ? JSON.parse(text) : {} };
  } catch {
    return { error: json({ error: 'json', message: 'Ungültiges JSON.' }, 400, request) };
  }
}

function secretFrom(request, body) {
  const header = request.headers.get('X-Duel-Secret');
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (typeof body?.secret === 'string') return body.secret.trim();
  return '';
}

function versionFrom(body) {
  const version = body?.version;
  return Number.isInteger(version) && version >= 1 ? version : null;
}

function envelope(room, secret, now, view = room.state) {
  const status = view?.status || room.state?.status;
  return {
    ok: true,
    code: room.code,
    version: room.version,
    updatedAt: room.updatedAt,
    serverNow: now,
    pollMs: pollDelayMs(status),
    state: publicState(view, secret),
  };
}

function stale(room, request, secret, now = Date.now()) {
  return json(
    {
      error: 'stale',
      message: 'Stand ist veraltet.',
      ...envelope(room, secret, now),
    },
    409,
    request,
    { ETag: etagFor(room.version) }
  );
}

async function loadFresh(store, code, request) {
  const room = await store.get(code);
  if (!room) return { error: json({ error: 'not-found', message: 'Raum nicht gefunden.' }, 404, request) };
  if (Date.now() - room.updatedAt > ROOM_TTL_MS) {
    await store.remove(code);
    return { error: json({ error: 'expired', message: 'Raum ist abgelaufen.' }, 404, request) };
  }
  return { room };
}

async function projectRoom(store, room) {
  let current = room;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = Date.now();
    const projected = applyClock(current.state, now);
    if (!projected.dirty) return { room: current, view: projected.state, now };
    const saved = await store.cas(current.code, current.version, projected.state, now);
    if (saved) {
      const savedRoom = {
        ...current,
        version: current.version + 1,
        state: projected.state,
        updatedAt: now,
      };
      return { room: savedRoom, view: projected.state, now };
    }
    const fresh = await store.get(current.code);
    if (!fresh) return { missing: true };
    current = fresh;
  }
  const now = Date.now();
  const projected = applyClock(current.state, now);
  return { room: current, view: projected.state, now };
}

async function commit(store, request, code, expectedVersion, secret, reducer) {
  const loaded = await loadFresh(store, code, request);
  if (loaded.error) return loaded.error;
  const { room } = loaded;
  if (room.version !== expectedVersion) return stale(room, request, secret);
  const now = Date.now();
  const clock = applyClock(room.state, now);
  const result = reducer(clock.state, now);
  if (!result.ok) {
    if (clock.dirty) {
      const saved = await store.cas(code, room.version, clock.state, now);
      if (!saved) {
        const fresh = await store.get(code);
        if (!fresh) return json({ error: 'not-found', message: 'Raum nicht gefunden.' }, 404, request);
        return stale(fresh, request, secret);
      }
      return json(
        {
          error: result.error,
          message: result.message,
          ...envelope({ ...room, version: room.version + 1, state: clock.state, updatedAt: now }, secret, now),
        },
        result.status,
        request,
        { ETag: etagFor(room.version + 1) }
      );
    }
    return json(
      { error: result.error, message: result.message, ...envelope(room, secret, now, clock.state) },
      result.status,
      request,
      { ETag: etagFor(room.version) }
    );
  }
  if (result.unchanged && !clock.dirty) {
    return json(envelope(room, secret, now, result.state), 200, request, { ETag: etagFor(room.version) });
  }
  const nextState = result.state;
  const saved = await store.cas(code, room.version, nextState, now);
  if (!saved) {
    const fresh = await store.get(code);
    if (!fresh) return json({ error: 'not-found', message: 'Raum nicht gefunden.' }, 404, request);
    return stale(fresh, request, secret);
  }
  return json(
    envelope({ ...room, version: room.version + 1, state: nextState, updatedAt: now }, secret, now),
    200,
    request,
    { ETag: etagFor(room.version + 1) }
  );
}

async function commitRetry(store, request, code, secret, reducer) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadFresh(store, code, request);
    if (loaded.error) return loaded.error;
    const { room } = loaded;
    const now = Date.now();
    const result = reducer(room.state, now);
    if (!result.ok) {
      return json(
        { error: result.error, message: result.message, ...envelope(room, secret, now) },
        result.status,
        request,
        { ETag: etagFor(room.version) }
      );
    }
    if (result.unchanged) {
      return json(envelope(room, secret, now, result.state), 200, request, { ETag: etagFor(room.version) });
    }
    const saved = await store.cas(code, room.version, result.state, now);
    if (!saved) continue;
    return json(
      envelope({ ...room, version: room.version + 1, state: result.state, updatedAt: now }, secret, now),
      200,
      request,
      { ETag: etagFor(room.version + 1) }
    );
  }
  const fresh = await store.get(code);
  if (!fresh) return json({ error: 'not-found', message: 'Raum nicht gefunden.' }, 404, request);
  return stale(fresh, request, secret);
}

function routeOf(pathname) {
  const match = pathname.match(/^\/api\/duel\/([a-z]+)(?:\/([A-Za-z0-9]+))?$/);
  if (!match) return null;
  return { action: match[1], code: match[2] ? normalizeRoomCode(match[2]) : '' };
}

function liveBall(state) {
  return state?.status === 'playing';
}

export async function handleDuel(request, store) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const route = routeOf(url.pathname);
  if (!route) return json({ error: 'not-found', message: 'Unbekannt.' }, 404, request);

  const ip = clientIp(request);
  const isPoll = request.method === 'GET' && route.action === 'room';
  if (isPoll) {
    if (!allow(`poll:${ip}`, POLL_LIMIT)) {
      return json({ error: 'rate', message: 'Zu viele Anfragen.' }, 429, request);
    }
  } else if (request.method === 'POST') {
    if (!allow(`mut:${ip}`, MUTATION_LIMIT)) {
      return json({ error: 'rate', message: 'Zu viele Anfragen.' }, 429, request);
    }
  } else {
    return json({ error: 'method', message: 'Methode nicht erlaubt.' }, 405, request);
  }

  if (Math.random() < 0.05) {
    try {
      await store.deleteExpired(Date.now() - ROOM_TTL_MS);
    } catch (err) {
      console.error('duel cleanup', err);
    }
  }

  if (isPoll) {
    if (!route.code) return json({ error: 'code', message: 'Raumcode ungültig.' }, 400, request);
    const loaded = await loadFresh(store, route.code, request);
    if (loaded.error) return loaded.error;
    const projected = await projectRoom(store, loaded.room);
    if (projected.missing) return json({ error: 'not-found', message: 'Raum nicht gefunden.' }, 404, request);
    const { room, view, now } = projected;
    const secret = secretFrom(request, null);
    const skipCache = liveBall(view);
    if (!skipCache && etagMatches(request.headers.get('If-None-Match'), room.version)) {
      return new Response(null, {
        status: 304,
        headers: { ...corsHeaders(request), ETag: etagFor(room.version) },
      });
    }
    const since = Number(url.searchParams.get('since'));
    if (!skipCache && Number.isInteger(since) && since === room.version) {
      return json(
        {
          ok: true,
          unchanged: true,
          code: room.code,
          version: room.version,
          serverNow: now,
          pollMs: pollDelayMs(view.status),
        },
        200,
        request,
        { ETag: etagFor(room.version) }
      );
    }
    return json(envelope(room, secret, now, view), 200, request, { ETag: etagFor(room.version) });
  }

  const parsed = await readJson(request);
  if (parsed.error) return parsed.error;
  const body = parsed.body || {};
  const secret = secretFrom(request, body);

  if (route.action === 'create') {
    const name = sanitizeName(body.name || '');
    const made = createLobby({ name, secret: randomHex(16), now: Date.now() });
    if (!made.ok) return json({ error: made.error, message: made.message }, made.status, request);
    const hostSecret = made.state.seats[0].secret;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const now = Date.now();
      const room = {
        code: randomCode(),
        version: 1,
        state: made.state,
        updatedAt: now,
        createdAt: now,
      };
      const inserted = await store.insert(room);
      if (!inserted) continue;
      return json({ ...envelope(room, hostSecret, now), secret: hostSecret }, 200, request, {
        ETag: etagFor(1),
      });
    }
    return json({ error: 'code', message: 'Raumcode kollidiert. Nochmal.' }, 503, request);
  }

  const code = normalizeRoomCode(body.code || '');
  if (!code) return json({ error: 'code', message: 'Raumcode ungültig.' }, 400, request);
  if (!allow(`room:${code}`, ROOM_MUTATION_LIMIT)) {
    return json({ error: 'rate', message: 'Zu viele Züge in diesem Raum.' }, 429, request);
  }

  if (route.action === 'join') {
    const version = versionFrom(body);
    if (!version) return json({ error: 'version', message: 'Version fehlt.' }, 400, request);
    const name = sanitizeName(body.name || '');
    const guestSecret = secret || randomHex(16);
    const response = await commit(store, request, code, version, guestSecret, (state, now) =>
      applyJoin(state, { name, secret: guestSecret, now })
    );
    if (response.status === 200) {
      const payload = await response.clone().json();
      payload.secret = guestSecret;
      return json(payload, 200, request, { ETag: etagFor(payload.version) });
    }
    return response;
  }

  if (!secret) return json({ error: 'secret', message: 'Secret fehlt.' }, 400, request);

  if (route.action === 'paddle') {
    const paddle = Number(body.paddle);
    if (!Number.isFinite(paddle)) return json({ error: 'paddle', message: 'Paddle fehlt.' }, 400, request);
    return commitRetry(store, request, code, secret, (state, now) => applyPaddle(state, secret, paddle, now));
  }

  if (route.action === 'heartbeat') {
    return commitRetry(store, request, code, secret, (state, now) => applyHeartbeat(state, secret, now));
  }

  const version = versionFrom(body);
  if (!version) return json({ error: 'version', message: 'Version fehlt.' }, 400, request);

  const reducers = {
    ready: (state, now) => applyReady(state, secret, now),
    leave: (state, now) => applyLeave(state, secret, now),
    rematch: (state, now) => applyRematch(state, secret, now),
  };
  const reducer = reducers[route.action];
  if (!reducer) return json({ error: 'not-found', message: 'Unbekannt.' }, 404, request);
  return commit(store, request, code, version, secret, reducer);
}
