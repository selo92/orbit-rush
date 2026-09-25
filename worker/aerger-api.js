/**
 * Orbit Ärger HTTP API.
 * Cloudflare Workers Free: plain HTTP + D1. No Durable Objects, WebSockets, or Queues.
 * Polls are reads. Writes happen on mutations, a throttled heartbeat, turn skips, and rare cleanup.
 * Rate limits live in this isolate's memory so a poll does not burn a D1 write.
 */
import { sanitizeName } from '../shared/scores.js';
import {
  POLL_MS,
  ROOM_TTL_MS,
  applyHeartbeat,
  applyIdle,
  applyJoin,
  applyKick,
  applyLeave,
  applyMove,
  applyRematch,
  applyRoll,
  applyStart,
  createLobby,
  normalizeRoomCode,
  publicState,
} from '../shared/aerger.js';

// In-memory only — a poll never writes D1. 360/min covers a same-IP table
// while three spectators poll at 1s during someone else's roll (~213/min).
const POLL_LIMIT = 360;
const MUTATION_LIMIT = 240;
const ROOM_MUTATION_LIMIT = 120;
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

export function resetAergerRateLimits() {
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
    'Access-Control-Allow-Headers': 'Content-Type, Accept, If-None-Match, X-Aerger-Secret',
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
  const header = request.headers.get('X-Aerger-Secret');
  if (typeof header === 'string' && header.trim()) return header.trim();
  if (typeof body?.secret === 'string') return body.secret.trim();
  return '';
}

function versionFrom(body) {
  const version = body?.version;
  return Number.isInteger(version) && version >= 1 ? version : null;
}

function envelope(room, secret, now = room.updatedAt) {
  return {
    ok: true,
    code: room.code,
    version: room.version,
    updatedAt: now,
    pollMs: POLL_MS,
    state: publicState(room.state, secret),
  };
}

function stale(room, request, secret) {
  return json(
    {
      error: 'stale',
      message: 'Stand ist veraltet.',
      ...envelope(room, secret),
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

async function commit(store, request, code, expectedVersion, secret, reducer) {
  const loaded = await loadFresh(store, code, request);
  if (loaded.error) return loaded.error;
  const { room } = loaded;
  if (room.version !== expectedVersion) return stale(room, request, secret);
  const now = Date.now();
  const idled = applyIdle(room.state, now);
  const result = reducer(idled.state, now);
  if (!result.ok) {
    if (idled.changed) {
      const saved = await store.cas(code, room.version, idled.state, now);
      if (!saved) {
        const fresh = await store.get(code);
        if (!fresh) return json({ error: 'not-found', message: 'Raum nicht gefunden.' }, 404, request);
        return stale(fresh, request, secret);
      }
      return json(
        {
          error: result.error,
          message: result.message,
          ...envelope({ ...room, version: room.version + 1, state: idled.state }, secret, now),
        },
        result.status,
        request,
        { ETag: etagFor(room.version + 1) }
      );
    }
    return json(
      {
        error: result.error,
        message: result.message,
        ...envelope(room, secret),
      },
      result.status,
      request,
      { ETag: etagFor(room.version) }
    );
  }
  if (result.unchanged) {
    return json(envelope(room, secret), 200, request, { ETag: etagFor(room.version) });
  }
  const saved = await store.cas(code, room.version, result.state, now);
  if (!saved) {
    const fresh = await store.get(code);
    if (!fresh) return json({ error: 'not-found', message: 'Raum nicht gefunden.' }, 404, request);
    return stale(fresh, request, secret);
  }
  return json(
    envelope({ ...room, version: room.version + 1, state: result.state, updatedAt: now }, secret, now),
    200,
    request,
    { ETag: etagFor(room.version + 1) }
  );
}

function routeOf(pathname) {
  const match = pathname.match(/^\/api\/aerger\/([a-z]+)(?:\/([A-Za-z0-9]+))?$/);
  if (!match) return null;
  return { action: match[1], code: match[2] ? normalizeRoomCode(match[2]) : '' };
}

export async function handleAerger(request, store) {
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
      console.error('aerger cleanup', err);
    }
  }

  if (isPoll) {
    if (!route.code) return json({ error: 'code', message: 'Raumcode ungültig.' }, 400, request);
    const loaded = await loadFresh(store, route.code, request);
    if (loaded.error) return loaded.error;
    let { room } = loaded;
    const now = Date.now();
    const idled = applyIdle(room.state, now);
    if (idled.changed) {
      const saved = await store.cas(room.code, room.version, idled.state, now);
      if (saved) {
        room = { ...room, version: room.version + 1, state: idled.state, updatedAt: now };
      } else {
        const fresh = await store.get(room.code);
        if (fresh) room = fresh;
      }
    }
    const secret = secretFrom(request, null);
    if (etagMatches(request.headers.get('If-None-Match'), room.version)) {
      return new Response(null, {
        status: 304,
        headers: { ...corsHeaders(request), ETag: etagFor(room.version) },
      });
    }
    const since = Number(url.searchParams.get('since'));
    if (Number.isInteger(since) && since === room.version) {
      return json(
        { ok: true, unchanged: true, code: room.code, version: room.version, pollMs: POLL_MS },
        200,
        request,
        { ETag: etagFor(room.version) }
      );
    }
    return json(envelope(room, secret), 200, request, { ETag: etagFor(room.version) });
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
      return json(
        { ...envelope(room, hostSecret), secret: hostSecret },
        200,
        request,
        { ETag: etagFor(1) }
      );
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
  const version = versionFrom(body);
  if (!version && route.action !== 'heartbeat') {
    return json({ error: 'version', message: 'Version fehlt.' }, 400, request);
  }

  if (route.action === 'heartbeat') {
    const loaded = await loadFresh(store, code, request);
    if (loaded.error) return loaded.error;
    const now = Date.now();
    const idled = applyIdle(loaded.room.state, now);
    const beat = applyHeartbeat(idled.state, secret, now);
    if (!beat.ok) {
      return json({ error: beat.error, message: beat.message }, beat.status, request);
    }
    if (!idled.changed && beat.unchanged) {
      return json(envelope(loaded.room, secret), 200, request, { ETag: etagFor(loaded.room.version) });
    }
    const next = beat.unchanged ? idled.state : beat.state;
    const saved = await store.cas(code, loaded.room.version, next, now);
    if (!saved) {
      const fresh = await store.get(code);
      if (!fresh) return json({ error: 'not-found', message: 'Raum nicht gefunden.' }, 404, request);
      return json(envelope(fresh, secret), 200, request, { ETag: etagFor(fresh.version) });
    }
    return json(
      envelope({ ...loaded.room, version: loaded.room.version + 1, state: next }, secret, now),
      200,
      request,
      { ETag: etagFor(loaded.room.version + 1) }
    );
  }

  const reducers = {
    start: (state, now) => applyStart(state, secret, now),
    roll: (state, now) => applyRoll(state, secret, now),
    move: (state, now) => applyMove(state, secret, body.token, now),
    leave: (state, now) => applyLeave(state, secret, now),
    kick: (state, now) => applyKick(state, secret, body.seat, now),
    rematch: (state, now) => applyRematch(state, secret, now),
  };
  const reducer = reducers[route.action];
  if (!reducer) return json({ error: 'not-found', message: 'Unbekannt.' }, 404, request);
  return commit(store, request, code, version, secret, reducer);
}
