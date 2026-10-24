/**
 * HMAC run tokens for POST /api/scores.
 *
 * The signature binds the server-issued run id to game, difficulty, mode,
 * and daily date. Elapsed time is the runs.started_at column written at
 * POST /api/run/start, not anything in the client clock. There is no
 * client-side secret: a matching signature only proves this worker minted
 * the run. Plausibility lives in shared/scores.js.
 */

const TOKEN_VERSION = 'v1';

function bytesToB64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64UrlToBytes(input) {
  const raw = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = raw.length % 4 === 0 ? '' : '='.repeat(4 - (raw.length % 4));
  let binary;
  try {
    binary = atob(raw + pad);
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(mac);
}

/**
 * @param {string} secret
 * @param {{ id: string, game: string, difficulty: string, mode: string, dailyDate: string|null, startedAt: number, seed?: number }} claims
 */
export async function signRunToken(secret, claims) {
  const payload = {
    v: 1,
    id: claims.id,
    g: claims.game,
    d: claims.difficulty,
    m: claims.mode,
    dd: claims.dailyDate || '',
    t: claims.startedAt,
    s: claims.seed >>> 0,
  };
  const body = bytesToB64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256(secret, `${TOKEN_VERSION}.${body}`);
  return `${TOKEN_VERSION}.${body}.${bytesToB64Url(sig)}`;
}

/**
 * @param {string} secret
 * @param {unknown} token
 */
export async function verifyRunToken(secret, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 2048) {
    return { ok: false, error: 'Run token required' };
  }
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) {
    return { ok: false, error: 'Run token invalid' };
  }
  const payloadBytes = b64UrlToBytes(parts[1]);
  const sigBytes = b64UrlToBytes(parts[2]);
  if (!payloadBytes || !sigBytes) return { ok: false, error: 'Run token invalid' };
  let expected;
  try {
    expected = await hmacSha256(secret, `${TOKEN_VERSION}.${parts[1]}`);
  } catch {
    return { ok: false, error: 'Run token invalid' };
  }
  if (!timingSafeEqual(sigBytes, expected)) return { ok: false, error: 'Run token invalid' };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, error: 'Run token invalid' };
  }
  const id = payload && typeof payload.id === 'string' ? payload.id.toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return { ok: false, error: 'Run token invalid' };
  }
  if (!payload || payload.v !== 1) return { ok: false, error: 'Run token invalid' };
  return {
    ok: true,
    claims: {
      id,
      game: typeof payload.g === 'string' ? payload.g : '',
      difficulty: typeof payload.d === 'string' ? payload.d : '',
      mode: payload.m === 'daily' ? 'daily' : 'normal',
      dailyDate: payload.dd ? String(payload.dd) : null,
      startedAt: Number(payload.t),
      seed: Number.isInteger(payload.s) && payload.s >= 0 && payload.s <= 0xffffffff ? payload.s : null,
    },
  };
}

/**
 * Worker secret binding. Unset or blank falls through to the D1 key.
 * A present but short value fails closed so a typo cannot sign tokens.
 * @param {object} [env]
 */
export function readEnvRunSecret(env) {
  if (!env || env.RUN_TOKEN_SECRET == null) return { ok: true, secret: null };
  const raw = String(env.RUN_TOKEN_SECRET);
  if (!raw.trim()) return { ok: true, secret: null };
  const secret = raw.trim();
  if (secret.length < 16) {
    return { ok: false, error: 'RUN_TOKEN_SECRET shorter than 16 characters' };
  }
  return { ok: true, secret };
}
