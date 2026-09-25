# Deploy Orbit Rush

German: Ein Cloudflare-Konto reicht. Danach liegt das Spiel und die Bestenliste auf **derselben** öffentlichen `*.workers.dev`-Adresse (kein IP-Filter, kein extra API-Host).

## Preview already uploaded

`wrangler deploy --temporary` uploaded this build to:

https://orbit-rush.boom-cheek.workers.dev

D1 database `orbit-rush-scores` (`df2c2202-6de0-4862-923e-added8921924`) holds the rows. Cloudflare deletes that temporary account at **2026-09-25 01:54 UTC** unless it is claimed. The claim URL is a bearer token (anyone with it owns the account), so it is **not** stored in this public repository. It was shown only in the agent handoff.

From the deploy host, that `workers.dev` URL returned a Cloudflare managed challenge (`cf-mitigated: challenge`) to both curl and Chrome, so it is not confirmed as an open, ungated play URL. After you claim the account, open **Workers & Pages → orbit-rush** and turn off Bot Fight / I'm Under Attack if the challenge is still there.

If the preview is already gone, use the steps below on your own account. `npm run deploy` creates a new D1 database and rewrites `database_id` in `wrangler.toml`.

English: one free Cloudflare account hosts the Vite build and the D1 leaderboard on the same origin. This repo does not contain a live URL until you deploy.

## 1. Cloudflare account

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. Open **Workers & Pages**. If asked, register a `workers.dev` subdomain (any name you like).
3. Do **not** put the Worker behind Cloudflare Access or an IP allowlist. The game must stay publicly playable.

## 2. Log in from this repo

```bash
npm install
npx wrangler login
```

`wrangler login` opens a browser and stores a token on your machine. Nothing from that login is committed.

## 3. Deploy

```bash
npm run deploy
```

That command:

1. Runs `npm run smoke` and `npm run smoke:worker`
2. Builds `dist/`
3. Creates the D1 database `orbit-rush-scores` if it does not exist
4. Writes the database id into `wrangler.toml` (the id is not a secret; you can commit it)
5. Applies `migrations/0001_init.sql` on the remote database
6. Runs `wrangler deploy`

The last lines include the public URL, shaped like:

```text
https://orbit-rush.<your-subdomain>.workers.dev
```

Open that URL on a phone. Submit a score, refresh, and confirm it is still there. Then paste the real URL into the README section **Spielen**.

`VITE_API_BASE` stays empty so the page calls `/api/scores` on that same host.

## 4. Optional: deploy from GitHub Actions

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token (see below) |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID on the Workers overview (right sidebar) |

Token: <https://dash.cloudflare.com/profile/api-tokens> → **Create Token** → **Custom token**

- Account → **Workers Scripts** → Edit
- Account → **D1** → Edit
- Account resources → Include → your account

Then **Actions → Deploy Cloudflare → Run workflow**.

## 5. What you do not need

- No Render/Railway/Fly process
- No Localtunnel
- No `data/scores.json` on the server
- No paid plan for a small public board (Workers + D1 free tier)

If the Worker name `orbit-rush` is already used in your account, change `name` in `wrangler.toml` and deploy again.
