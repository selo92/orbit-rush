/**
 * Request helpers shared by the Worker and the local Express adapter.
 * Client IP is the Cloudflare header only. X-Forwarded-For is client-controlled
 * and must not mint a fresh rate-limit bucket.
 */

/** Enough concurrent tables for a busy evening, not an unbounded D1 fill. */
export const MAX_LIVE_ROOMS = 80;
export const ROOM_CREATE_LIMIT = 8;

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Document policy for the arcade shell. API JSON does not need this. */
export const DOCUMENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const IP_RE = /^[0-9a-fA-F:.]+$/;

/**
 * @param {{ headers?: { get?: (name: string) => string|null } }} request
 */
export function clientIpFromRequest(request) {
  const cf = request?.headers?.get?.('cf-connecting-ip');
  if (typeof cf === 'string') {
    const ip = cf.trim();
    if (ip && ip.length <= 64 && IP_RE.test(ip)) return ip;
  }
  return 'unknown';
}

/** 32 hex chars, the shape randomHex(16) mints. Anything weaker is discarded. */
export function normalizeSeatSecret(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^[0-9a-f]{32}$/.test(s) ? s : '';
}

/** Unit interval from the Web Crypto CSPRNG. Dice and serves must not use Math.random. */
export function cryptoUnit() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/**
 * Read a request body without buffering past `limit`, even when Content-Length is absent.
 * @param {Request} request
 * @param {number} limit
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number }>}
 */
export async function readLimitedBody(request, limit) {
  const declared = Number(request.headers?.get?.('content-length') || 0);
  if (Number.isFinite(declared) && declared > limit) return { ok: false, status: 413 };
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const parts = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
        return { ok: false, status: 413 };
      }
      parts.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const bytes = parts.length === 1 ? parts[0] : concatBytes(parts);
  return { ok: true, text: new TextDecoder().decode(bytes) };
}
