/**
 * Same-origin production host: Vite build (ASSETS) + /api leaderboard (D1).
 */
import { DOCUMENT_CSP, SECURITY_HEADERS } from '../shared/http.js';
import { handleApi } from './api.js';

function hardenAsset(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  const type = headers.get('content-type') || '';
  if (type.includes('text/html')) headers.set('Content-Security-Policy', DOCUMENT_CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env.DB, env);
    }
    if (env.ASSETS) return hardenAsset(await env.ASSETS.fetch(request));
    return hardenAsset(new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
  },
};
