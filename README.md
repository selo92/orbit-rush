# Orbit Rush

Neon-Skill-Game für kurze Runs und eine globale Top-50-Bestenliste. **v1.3**

Steuere den Orbit-Radius, sammle Orbs, weiche Asteroiden aus. Vor jedem Run: **Einfach · Mittel · Schwer · Baba**. Oder die **Daily Challenge** (feste Schwer-Seeds, gleiche Spawns für alle am selben UTC-Tag).

## English

**Orbit Rush** is a mobile-first Canvas 2D reflex game. You auto-orbit a planet and steer the radius with A/D, arrow keys, or a horizontal drag. Collect orbs, dodge debris, chain combos and near-misses, then submit a name to the top 50.

v1.3 adds a seeded **Daily** mode, six achievements, four craft skins, and a share button. `VITE_API_BASE` empty means the page calls `/api` on the same host. Local play uses `data/scores.json`. Production uses Cloudflare D1 on the same host: https://orbit-rush.selimv18.workers.dev

## Spielen

Lokal:

```bash
npm install
npm run start:api   # Terminal 1 — API :8787, Datei data/scores.json
npm run dev         # Terminal 2 — Spiel :5173, Proxy /api → 8787
```

Öffne **http://127.0.0.1:5173**.

Öffentlich (Spiel + Bestenliste, gleicher Host): **https://orbit-rush.selimv18.workers.dev**

Die Scores liegen in Cloudflare D1 (`orbit-rush-scores`, `ecd023bc-1557-4c28-b287-5f50f65ec8d9`), nicht in `data/scores.json`. `GET /` und `GET /api/scores` antworten mit 200.

```bash
npm run smoke         # Formel, Daily-Seed, Express-API
npm run smoke:worker  # derselbe Vertrag gegen die D1-SQL-Schicht
npm run build         # dist/ für den Worker
npm run playtest      # Headless-Chrome, braucht das Dev-Spiel auf :5173
```

## Schwierigkeit

PLAY öffnet die Auswahl (bleibt in `localStorage`). Persönliche Bestleistung **pro Schwierigkeit**.

| ID | Label | Gefühl |
|----|--------|--------|
| `einfach` | Einfach | Langsameres Debris, mehr Orbs, sanftere Rampe |
| `mittel` | Mittel | Klassische Balance (Standard) |
| `schwer` | Schwer | Schnellere Asteroiden, engerer Orbit, weniger Orbs |
| `baba` | **Baba** | Extrem: maximaler Druck, seltene Power-ups |

Die Bestenliste filtert All / Einfach / Mittel / Schwer / Baba / **Daily**.

## Daily, Achievements, Skins

```text
seed = hash("orbit-rush-daily:" + UTC_YYYY-MM-DD)
rng  = mulberry32(seed)   # nur Asteroiden / Orbs / Power-ups
```

Normale Runs nutzen `Math.random()`. Daily ist immer **Schwer**. HUD und Game-Over zeigen `Daily · Datum`. Lokale Bestleistung pro Datum. API-Felder: `mode: "daily"` und `dailyDate`.

| ID | Titel | Freischaltung |
|----|--------|----------------|
| `first_orb` | First Orb | Einen Orb sammeln |
| `combo_x5` | Combo x5 | x5-Combo in einem Run |
| `near_miss_10` | Graze Master | 10 Near-Misses in einem Run |
| `survive_60` | One Minute | 60 Sekunden überleben |
| `baba_clear` | Baba Survivor | Einen Baba-Run beenden |
| `daily_win` | Daily Pilot | Eine Daily Challenge beenden |

| Skin | Freischaltung |
|------|----------------|
| Neon Cyan | Standard |
| Hot Magenta | `first_orb` |
| Solar Gold | `survive_60` oder eine PB ≥ 1500 |
| Baba Hazard | `baba_clear` |

Near-Miss zählt nur, wenn du den Pass **mindestens 100 ms** überlebst. Game-Over **SHARE** nutzt die Web Share API, sonst die Zwischenablage.

## Punkte

```text
score = floor(Sekunden) × 10 + Orbs × 100 + comboBonus + nearMisses × 75
```

Combo: Orbs innerhalb von ~1,35 s, Multiplikator x2–x5. Jeder Orb bei Mult `M` gibt `(M−1)×50` Combo-Bonus.

## Steuerung

| Eingabe | Aktion |
|---------|--------|
| `A` / `←` | Orbit-Radius kleiner |
| `D` / `→` | Orbit-Radius größer |
| Touch links/rechts | dasselbe |
| Pause / Mute | HUD-Buttons |

Am besten Hochformat, etwa 390×844.

## Bestenliste

`GET /api/health` → `{ ok, service, version }` (Produktion zusätzlich `storage: "d1"`)

- `GET /api/scores` → Top 50 `{ rank, name, score, ts, difficulty, mode, dailyDate }`
- `GET /api/scores?difficulty=baba` → `einfach|mittel|schwer|baba` (Daily-Einträge sind hier nicht dabei)
- `GET /api/scores?mode=daily&dailyDate=YYYY-MM-DD`
- `POST /api/scores` `{ name, score, survivalMs, orbs, comboBonus, nearMisses, difficulty?, mode?, dailyDate? }`

Name wird bereinigt (1–16 Zeichen). Score-Maximum **750000**. Formel-Check, IP-Hash, höchstens ein POST alle 2 Sekunden, 30 API-Requests pro Minute, Doppel-Submit innerhalb von 10 s ist idempotent. Die Antwort-Liste ist die passende Top 50 (gleiche Difficulty bzw. das Daily-Datum).

Lokal speichert Express höchstens 500 Zeilen in `data/scores.json` (nicht im Git). Produktion speichert dieselben 500 Zeilen in Cloudflare **D1** und serviert das gebaute Spiel vom selben Host. Fällt die API aus, zeigt der Client die `localStorage`-Liste.

Frontend: `VITE_API_BASE` leer lassen (gleicher Origin). Nur setzen, wenn die API woanders liegt — siehe `.env.example`.

## Layout

```text
index.html
src/                  Spiel, UI, Skins, Achievements, Leaderboard-Client
server/index.js       lokale Express-API
worker/               Produktion: /api auf D1
shared/               gemeinsame Prüfung (Name, Score, Filter)
migrations/           D1-Schema
scripts/              smoke, worker-smoke, playtest, cf-deploy
wrangler.toml
DEPLOY.md
```

## Grenzen

- Lokale JSON-Datei ist nicht für mehrere Prozesse gedacht. Produktion (D1) schon.
- Anti-Cheat ist weich: Formel, Obergrenze, Rate-Limit.
- Öffentliche URL: https://orbit-rush.selimv18.workers.dev (Workers + D1 im Konto des Owners).
