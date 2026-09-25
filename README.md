# Orbit Rush

Neon-Skill-Spiele für kurze Runs und zwei globale Top-50-Bestenlisten. **v1.4**

Die Seite bleibt **Orbit Rush** (gleiche URL, gleicher Pilot). Der erste Screen ist die **Orbit Arcade**: zwei große Kacheln, **Orbit Rush** und **Orbit Mirror**. Name (`orbit-rush-name`) und `orbit-rush-client-id` gelten für beide Spiele. „Welcome back“ steht auf der Arcade.

| Spiel | Pitch |
|-------|--------|
| **Orbit Rush** | Steuere den Orbit. Sammle Orbs. Überlebe. |
| **Orbit Mirror** | Dein Reflex lügt. Das Schiff fliegt gespiegelt. |

Von jedem Spielmenü führt **ARCADE** zurück zur Auswahl. Orbit Rush selbst ist unverändert: **Einfach · Mittel · Schwer · Baba**, Daily, Achievements, Skins, Auto-Submit.

## Orbit Mirror

**Regel:** Links / `A` / `←` / Wisch nach links schiebt das Schiff **nach außen**. Rechts schiebt es **nach innen**. Der magenta Schatten ist der Reflex (so würde Orbit Rush reagieren). Hindernisse und Orbs liegen im Orbit des Schiffs.

Ein Screen erklärt das auf Deutsch und Englisch (`Links → außen`). In den ersten Sekunden steht dieselbe Zeile im Canvas, und ein cyaner Strich zeigt die sichere Bahn. Die Magenta-Wand deckt den aktuellen Radius plus eine Seite ab. Wer den Rush-Reflex drückt, fliegt in die Wand.

Eine Schwierigkeitsrampe, kein Extra-Picker. Pause, Mute, Game Over und YOU-Badge wie bei Rush.

```text
score = floor(Sekunden) × 10 + Orbs × 100 + comboBonus + nearMisses × 75
```

Dieselbe Formel wie Rush, damit der Server sie prüfen kann. Die Rangliste ist nur `game=mirror`. Die **Clean streak** (Splitter in Folge, lokal `orbit-mirror-streak`) steht im HUD und auf dem Game-Over-Screen und ist keine zweite Bestenliste.

## English

**Orbit Rush** is a mobile-first Canvas 2D reflex game. You auto-orbit a planet and steer the radius with A/D, arrow keys, or a horizontal drag. Collect orbs, dodge debris, chain combos and near-misses. A finished run saves to the top 50 under your pilot name. The first game over asks for that name once; later visits show “Welcome back” and submit on their own.

v1.4 opens on an **Orbit Arcade** hub and adds **Orbit Mirror**: left input moves the ship outward, a ghost shows the unmirrored reflex, and scores post to a separate top 50. Rush keeps daily, difficulty, achievements, skins, and auto-submit. `VITE_API_BASE` empty means the page calls `/api` on the same host. Local play uses `data/scores.json`. Production uses Cloudflare D1 on the same host: https://orbit-rush.selimv18.workers.dev

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

- `GET /api/scores` → Rush Top 50 `{ rank, name, score, ts, difficulty, mode, dailyDate, clientId, game }`
- `GET /api/scores?game=rush` und `?game=mirror` — getrennte Top 50. Ohne `game` gilt `rush`.
- `GET /api/scores?difficulty=baba` → `einfach|mittel|schwer|baba` auf der Rush-Liste (Daily-Einträge sind hier nicht dabei)
- `GET /api/scores?mode=daily&dailyDate=YYYY-MM-DD` — Daily bleibt Rush
- `POST /api/scores` `{ name, score, survivalMs, orbs, comboBonus, nearMisses, difficulty?, mode?, dailyDate?, clientId?, game? }`
- `game` ist `rush` oder `mirror`. Fehlt es, wird `rush` gespeichert. Mirror nutzt dieselbe Punkteformel; `difficulty` ist dabei `mittel` (eine Rampe).

`clientId` ist optional (UUID v4). Ältere Clients lassen es weg; die Spalte bleibt dann `null`. Der Browser speichert Name (`orbit-rush-name`) und Id (`orbit-rush-client-id`). Eigene Zeilen mit derselben Id — oder ältere Zeilen nur mit demselben Namen — bekommen ein **YOU**. Nach dem ersten Namen speichert jeder beendete Run automatisch; ein erneutes Senden ist nur noch „Change name“.

Name wird bereinigt (1–16 Zeichen). Score-Maximum **750000**. Formel-Check, IP-Hash, höchstens ein POST alle 2 Sekunden, 30 API-Requests pro Minute, Doppel-Submit innerhalb von 10 s ist idempotent (pro Spiel).

Schema-Nachzug: `migrations/0002_client_id.sql` (nullable `client_id`) und `migrations/0003_game.sql` (`game`, Default `rush` für bestehende Zeilen). `npm run deploy` wendet die Migrationen an. Der Worker legt fehlende Spalten beim Start ebenfalls an.

Die Antwort-Liste eines POST ist die Top 50 **derselben** Rangliste (`game` plus Difficulty bzw. Daily-Datum). Das 500er-Limit gilt für die gemeinsame Tabelle; die beiden Top 50 bleiben getrennt.

Lokal speichert Express höchstens 500 Zeilen in `data/scores.json` (nicht im Git). Produktion speichert dieselben 500 Zeilen in Cloudflare **D1** und serviert das gebaute Spiel vom selben Host. Fällt die API aus, zeigt der Client die `localStorage`-Liste.

Frontend: `VITE_API_BASE` leer lassen (gleicher Origin). Nur setzen, wenn die API woanders liegt — siehe `.env.example`.

## Layout

```text
index.html
src/                  Spiel, UI, Skins, Achievements, Leaderboard-Client
src/mirror.js         Orbit Mirror (eigener Loop, gespiegelter Radius)
server/index.js       lokale Express-API
worker/               Produktion: /api auf D1
shared/               gemeinsame Prüfung (Name, Score, Filter, game)
migrations/           D1-Schema (`0003_game.sql` setzt bestehende Zeilen auf rush)
scripts/              smoke, worker-smoke, playtest, cf-deploy
wrangler.toml
DEPLOY.md
```

## Grenzen

- Lokale JSON-Datei ist nicht für mehrere Prozesse gedacht. Produktion (D1) schon.
- Anti-Cheat ist weich: Formel, Obergrenze, Rate-Limit.
- Öffentliche URL: https://orbit-rush.selimv18.workers.dev (Workers + D1 im Konto des Owners).
