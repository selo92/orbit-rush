/**
 * Stable local player: display name + opaque client id.
 * Shared by Orbit Rush and Orbit Mirror.
 * Name key stays `orbit-rush-name` so existing pilots are recognized.
 */
import { sanitizeName } from '../shared/scores.js';

export const LS_NAME = 'orbit-rush-name';
export const LS_CLIENT_ID = 'orbit-rush-client-id';

const CLIENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let memoryClientId = '';
let memoryName = '';

function randomUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getOrCreateClientId() {
  try {
    const existing = localStorage.getItem(LS_CLIENT_ID) || '';
    if (CLIENT_ID_RE.test(existing)) {
      const id = existing.toLowerCase();
      memoryClientId = id;
      return id;
    }
    const id = randomUuid().toLowerCase();
    localStorage.setItem(LS_CLIENT_ID, id);
    memoryClientId = id;
    return id;
  } catch {
    if (!memoryClientId || !CLIENT_ID_RE.test(memoryClientId)) {
      memoryClientId = randomUuid().toLowerCase();
    }
    return memoryClientId;
  }
}

export function loadPlayerName() {
  try {
    const saved = sanitizeName(localStorage.getItem(LS_NAME) || '');
    memoryName = saved;
    return saved;
  } catch {
    return sanitizeName(memoryName);
  }
}

export function savePlayerName(name) {
  const clean = sanitizeName(name);
  memoryName = clean;
  try {
    if (clean) localStorage.setItem(LS_NAME, clean);
    else localStorage.removeItem(LS_NAME);
  } catch {
    /* private mode / quota */
  }
  return clean;
}

/**
 * Own row when the stable id matches.
 * Older rows have no id: fall back to the saved display name.
 * A different id never matches on name alone.
 */
export function isOwnRow(row, identity) {
  if (!row || !identity) return false;
  const id = typeof identity.clientId === 'string' ? identity.clientId.toLowerCase() : '';
  const rowId = typeof row.clientId === 'string' ? row.clientId.toLowerCase() : '';
  if (id && rowId) return id === rowId;
  const name = sanitizeName(identity.name || '');
  return !rowId && !!name && row.name === name;
}
