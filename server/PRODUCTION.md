# Production leaderboard

Local demo still uses Express and a JSON file:

```bash
npm run start:api   # http://127.0.0.1:8787  →  data/scores.json
npm run dev         # Vite proxies /api to that process
```

Production does **not** use `data/scores.json`. The game and the API share one Cloudflare origin:

- Static files: `npm run build` → `dist/`, served as Worker assets
- `GET/POST /api/scores` and `GET /api/health`: `worker/index.js` → `worker/api.js`
- Rows live in **D1** database `orbit-rush-scores` (SQLite). One global table, top **500** kept, responses are the top **50**
- Names are sanitized (max 16), scores capped at **750_000**, run stats must match the score formula, POSTs are limited to one per 2 seconds per IP hash and 30 API calls per minute
- Optional `clientId` (UUID v4) is stored on the row. Older rows leave it null. See `migrations/0002_client_id.sql`

The JSON contract matches `server/index.js`. The frontend calls same-origin `/api` when `VITE_API_BASE` is empty.

Deploy steps: [DEPLOY.md](../DEPLOY.md).
