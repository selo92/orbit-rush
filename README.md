# Orbit Rush

Neon-Skill-Spiele plus ein Online-Brett. **v1.4** bleibt die Rush/Mirror-Bestenliste. Dazu kommen **Orbit Ärger**, **Orbit Drift** und **Orbit Pulse**.

Die Seite bleibt **Orbit Rush** (gleiche URL, gleicher Pilot). Der erste Screen ist die **Orbit Arcade**: fünf Kacheln, **Orbit Rush**, **Orbit Mirror**, **Orbit Ärger**, **Orbit Drift** und **Orbit Pulse**. Name (`orbit-rush-name`) und `orbit-rush-client-id` gelten für die Skill-Spiele. „Welcome back“ steht auf der Arcade. Ärger nutzt denselben Namen, schreibt aber **nicht** in die Top-50.

| Spiel | Pitch |
|-------|--------|
| **Orbit Rush** | Steuere den Orbit. Sammle Orbs. Überlebe. |
| **Orbit Mirror** | Dein Reflex lügt. Das Schiff fliegt gespiegelt. |
| **Orbit Ärger** | Würfeln. Schmeißen. Zu viert online. |
| **Orbit Drift** | Halt die Bahn. Der Tunnel driftet. |
| **Orbit Pulse** | Tippe den Beat. Halt den Flow. |

Von jedem Spielmenü führt **ARCADE** zurück zur Auswahl. Orbit Rush selbst ist unverändert: **Einfach · Mittel · Schwer · Baba**, Daily, Achievements, Skins, Auto-Submit.

## Orbit Mirror

**Regel:** Links / `A` / `←` / Wisch nach links schiebt das Schiff **nach außen**. Rechts schiebt es **nach innen**. Der magenta Schatten ist der Reflex (so würde Orbit Rush reagieren). Hindernisse und Orbs liegen im Orbit des Schiffs.

Ein Screen erklärt das auf Deutsch und Englisch (`Links → außen`). In den ersten Sekunden steht dieselbe Zeile im Canvas, und ein cyaner Strich zeigt die sichere Bahn. Die Magenta-Wand deckt den aktuellen Radius plus eine Seite ab. Wer den Rush-Reflex drückt, fliegt in die Wand.

Eine Schwierigkeitsrampe, kein Extra-Picker. Pause, Mute, Game Over und YOU-Badge wie bei Rush.

```text
score = floor(Sekunden) × 10 + Orbs × 100 + comboBonus + nearMisses × 75
```

Dieselbe Formel wie Rush, damit der Server sie prüfen kann. Die Rangliste ist nur `game=mirror`. Die **Clean streak** (Splitter in Folge, lokal `orbit-mirror-streak`) steht im HUD und auf dem Game-Over-Screen und ist keine zweite Bestenliste.

## Orbit Drift

Solo-Tunnel. Das Schiff bleibt unten in der Mitte, die Bahn biegt und wird enger. **A / D**, **← / →** oder **Wischen** lenken. Wer die leuchtende Spur verlässt, verliert eine von drei Hüllen. Trümmer, Barrieren und Wand-Spikes im Tunnel kosten dieselbe Hülle. Der dritte Treffer beendet den Run.

Vor dem Start wählst du **Einfach · Mittel · Schwer · Baba** (deutsch, eigener Screen). **Mittel** ist schneller und enger als die alte einzelne Rampe und hat Hindernisse. **Einfach** bleibt weit, langsam und mit wenigen Trümmern. Höher heißt mehr Tempo, schärfere Kurven, schmalere Bahn, dichtere Hindernisse. Der Grad liegt lokal unter `orbit-drift-difficulty` und ändert den Rush-Grad nicht.

Ringe in der Bahn sind die Orbs der gemeinsamen Formel. Wer ein Tor knapp an der Wand passiert und danach noch lebt, bekommt einen Near-Miss. Ketten funktionieren wie bei Rush. Angezeigt wird die Strecke in km; die Punkte bleiben an der Zeit hängen, damit der Server sie prüfen kann.

```text
score = floor(Sekunden) × 10 + Ringe × 100 + comboBonus + nearMisses × 75
```

Die Rangliste ist nur `game=drift` (Top 50), gefiltert wie Rush nach `difficulty` (`einfach|mittel|schwer|baba`, plus Alle). Alte Drift-Läufe ohne eigenen Grad stehen auf Mittel. Lokale Rekorde: `orbit-drift-best-<grad>` (der alte Schlüssel `orbit-drift-best` zählt als Mittel). Pause, Mute, Auto-Submit und YOU-Badge wie bei Rush und Mirror. Kein zweites Konto.

## Orbit Pulse

Rhythmus im Hochformat. Leuchtende Kreise laufen auf 3–4 Bahnen auf den Trefferring zu. **Tippen** (Bahn, `A` `S` `D` `F`, oder Leertaste auf der leuchtenden Bahn), wenn der Kreis den Ring trifft. **Holds** hältst du bis zur weißen Endmarke. Perfekt baut die Combo (x2…x5), Gut zählt als Near-Miss, Daneben bricht die Combo. Ein Sync-Balken und eine kurze Fehlerserie beenden den Lauf — Einfach verzeiht, Baba kaum. Der Track selbst kann auch einfach zu Ende gehen.

Vor dem Start wählst du **Einfach · Mittel · Schwer · Baba**. Der Grad liegt unter `orbit-pulse-difficulty` und ändert Rush und Drift nicht. Ein Lauf spielt die Tracks dieses Grads der Reihe nach, der luftigste Beat zuerst. **Level geschafft** (Track zu Ende, Sync noch da) zeigt kurz „Level geschafft“, dann startet der nächste Track etwas härter: engere Fenster, schnellerer Lauf, strengere Sync-Abzüge, dichtere Noten aus derselben Beatmap. Der Sprung bleibt unter dem nächsten genannten Grad. Das letzte Level endet mit „Run geschafft“. Ein Fail beendet den Lauf; die Anzeige zeigt Level und Track. Die Punkte laufen über alle Level und gehen einmal an `game=pulse`, wenn der Lauf endet. **Daily Beat** bleibt ein einzelner Track, immer Schwer, aus `dailyPool`. HUD und Game Over zeigen `Daily · Datum`. Submit: `game:"pulse"`, `mode:"daily"`, `dailyDate`.

Die Musik steht in `public/pulse-music/` (`manifest.json` plus die mp3s). `byDifficulty` ist der Pool eines Grads, sortiert leichter → härter (weniger Schläge pro Sekunde, bei Gleichstand leiseres LUFS). Es werden keine Tracks aus einem härteren Grad in Einfach gezogen. Ein Playback-Rate-Nudge von 0–3 % darf drauf, ersetzt den Dateiwechsel aber nicht. Daily Beat wählt mit dem UTC-Datum stabil aus `dailyPool` und nutzt die Beatmap **dieses** Tracks. Mute nutzt denselben Knopf; Pause und Arcade stoppen die Wiedergabe. Die Noten sitzen auf den `beatTimes` aus `public/pulse-music/beatmaps/` (librosa, Sekunden ab t=0). Die Wertung liest `audio.currentTime`, nicht eine eigene Stoppuhr. Einfach lässt jeden zweiten Schlag aus, Baba fast alle; Offbeat-Onsets nur bei Schwer und Baba. Holds enden auf einem späteren Schlag derselben Beatmap. Spätere Level desselben Grads behalten dieses Raster und setzen zusätzliche Schläge aus derselben Beatmap. Zwei Finger reichen immer, auch auf 3–4 Bahnen und im Daily Beat: ein Hold plus ein Tap ist erlaubt, ein zweiter Hold nur, wenn in dem Überlappungsfenster keine weitere Note startet. Sonst wird der zweite Hold zum Tap, damit nicht beide Daumen feststecken, wenn die nächste Note kommt.

Dieselbe Formel wie Rush, damit der Server sie prüft:

```text
score = floor(Sekunden) × 10 + Treffer × 100 + comboBonus + Gut × 75
```

Treffer sind Perfekt und Gut. `nearMisses` sind die Guts. Die Rangliste ist nur `game=pulse` (Top 50), mit Filtern Alle / Einfach / Mittel / Schwer / Baba / Daily. `GET /api/scores?game=pulse&mode=daily&dailyDate=YYYY-MM-DD` ist die Daily-Liste dieses Tages. Lokale Rekorde: `orbit-pulse-best-<grad>` und `orbit-pulse-daily-best-<datum>`.

## Orbit Ärger

Mensch ärgere dich nicht für bis zu 4 Spieler im selben Neon-Look. Hochformat. Deutsch ist die Hauptsprache, kurze englische Zeilen stehen daneben.

**Ablauf:** Raum erstellen → 6-stelliger Code → die anderen treten mit Code und Namen bei → Lobby (Farben Rot, Blau, Gelb, Grün der Reihe nach) → Host startet bei 2–4 Spielern → Züge → Gewinnscreen → Arcade oder **Nochmal** (Host). Der gespeicherte Pilot-Name wird vorausgefüllt.

**Regeln (klassisch, mit zwei festgehaltenen Ausnahmen):**

- Jede Farbe hat 4 Figuren. Vom Hof kommt man nur mit einer **6** aufs eigene Startfeld. Welche Figur zieht, sucht der Spieler aus (Rauskommen ist nicht erzwungen).
- Eine **6** gibt einen Extra-Wurf. **Nach der dritten 6 in Folge ist die Runde vorbei** (der Zug zählt noch, es gibt keinen vierten Wurf). Das verhindert, dass eine Serie den Raum blockiert.
- Eine 6 ohne legalen Zug gibt **keinen** Extra-Wurf. Der Zug geht weiter.
- Gegner darf man überholen. Wer genau auf einem Gegner landet, schickt ihn in den Hof. **Ausnahme:** eine Figur auf ihrem eigenen Startfeld ist sicher.
- Eigene Figuren darf man weder überspringen noch mit ihnen das Feld teilen.
- Ins Haus (4 Felder) und aufs letzte Hausfeld nur mit exakter Augenzahl. Zu viel ist kein Zug.
- Schmeißen gibt keinen Extra-Wurf, nur die 6.
- Kein legaler Zug: automatisch weiter. Ein Zug, der 45 Sekunden nichts tut, wird übersprungen. Wer 90 Sekunden keinen Heartbeat schickt, ist `abandoned` — der Sitz bleibt, Züge werden übersprungen, Figuren bleiben auf dem Brett (kein KI-Ersatz). Der Host kann leere oder abgemeldete Sitze in der Lobby rauswerfen; im Spiel nur Sitze, die schon weg sind oder seit 30 Sekunden still.

### Polling auf dem Workers-Free-Tarif

Kein Durable Object, kein WebSocket, keine Queue. Ein Raum ist **eine D1-Zeile** (`aerger_rooms`): JSON `state`, `version`, `updated_at`. `migrations/0004_aerger_rooms.sql` legt nur diese Tabelle an. `scores.game` ist `rush`, `mirror`, `drift` oder `pulse`. Drift und Pulse brauchen keine neue Migration: die Spalte aus `0003_game.sql` ist freier Text.

| Aufruf | Wirkung |
|--------|---------|
| `POST /api/aerger/create` | Raum + Secret für den Host |
| `POST /api/aerger/join` | Sitz, braucht `version` |
| `POST /api/aerger/start` `roll` `move` `leave` `kick` `rematch` | Server prüft Sitz und Zug. Alte `version` → **409** |
| `POST /api/aerger/heartbeat` | höchstens alle 15 s eine Schreibaktion pro Sitz |
| `GET /api/aerger/room/:code` | Stand lesen |

Der Client pollt etwa alle **1,8 s**, solange Lobby oder Partie offen sind, und **pausiert**, wenn der Tab versteckt ist (`document.hidden`). **Wer auf den Wurf eines anderen wartet** (`playing` + `phase: roll` + nicht selbst dran), pollt alle **1 s**, damit die Augenzahl früher da ist. Der eigene Wurf wartet nicht auf den nächsten Poll: `POST /api/aerger/roll` liefert `state.dice` in der Antwort. Vorher blieb der Würfel bis zu dieser Antwort leer — und für die anderen bis zum nächsten Poll. Das wirkte wie eine Pause von bis zu zwei Sekunden. Jetzt startet die Animation beim Tippen und läuft, bis die Server-Zahl landet. Dieselbe Landung spielt, wenn sich `rollSeq` bei jemand anderem erhöht.

Unverändert:

- `If-None-Match: W/"<version>"` → **304** ohne Body
- `?since=<version>` → **200** mit `{ unchanged: true, version, code, pollMs }` (klein, für `fetch`, das eine 304 manchmal schluckt)

Beides liest die Zeile trotzdem einmal. D1 kann den Read nicht überspringen. Der 304/Tiny-Pfad spart vor allem Transfer und JSON auf dem Client, und er vermeidet Folge-Writes. Schreibzugriffe gibt es nur bei Zügen, Heartbeats, Zug-Timeouts und gelegentlichem Aufräumen.

**Budget (Annahme Free: 5 Mio. Reads/Tag, 100k Writes/Tag):**

- 4 Spieler × Poll alle 1,8 s × 20 Minuten ≈ 4 × 33 × 20 ≈ **2.700 Reads** pro Partie. Drei Wartende, die während fremder Würfe auf 1 s gehen, legen nur in dieser Phase zu (3 × 60 statt 3 × 33). Selbst eine ganze Partie auf dem schnelleren Takt bliebe bei etwa 4 × 60 × 20 ≈ 4.800 Reads — weit unter 5 Mio./Tag. Versteckte Tabs zählen nicht.
- Polls: höchstens **360/Minute pro IP** im Isolate (früher 200), und sie schreiben **nicht** nach D1. Drei Wartende à 60/min plus der Werfer à ~33/min ≈ 213, plus Luft fürs Tab-Aufwecken. Züge sind enger gedeckelt. Heartbeats schreiben höchstens alle 15 s pro Sitz. Das Limit gilt pro Isolate, nicht global.
- Räume ohne Update seit **3 Stunden** gelten als abgelaufen. Beim Zugriff löscht der Worker gelegentlich bis zu 4 solche Zeilen (`DELETE … LIMIT` über eine Subquery).

Die Skill-Bestenliste bleibt bei 30 Requests/Minute und einem POST alle 2 Sekunden. Ärger hängt nicht an diesem Zähler.

## English

**Orbit Rush** is a mobile-first Canvas 2D reflex game. You auto-orbit a planet and steer the radius with A/D, arrow keys, or a horizontal drag. Collect orbs, dodge debris, chain combos and near-misses. A finished run saves to the top 50 under your pilot name. The first game over asks for that name once; later visits show “Welcome back” and submit on their own.

v1.4 opens on an **Orbit Arcade** hub with five games. **Orbit Mirror**, **Orbit Drift**, and **Orbit Pulse** each post to their own top 50 (`game=mirror`, `game=drift`, `game=pulse`). Pulse is a neon rhythm game: tap or hold circles on the beat, and no chart — stage chain or Daily Beat — asks for more than two fingers at once. A tap beside one hold is fine; a second hold is kept only when nothing else starts during the overlap. A difficulty is a chain of its own tracks, easiest first; clearing a stage starts the next song a little harder, and the run score is submitted once when the run ends. Daily Beat stays a single track. Note times come from each file's beatmap and are judged against `audio.currentTime`. Drift is a solo neon tunnel: steer with A/D, arrows, or a drag, stay in the lane, and lose one of three hull points on a wall or on debris, barriers, and side spikes. Before each run you pick Einfach, Mittel, Schwer, or Baba; Mittel is faster and tighter than the original single ramp. **Orbit Ärger** is a 2–4 player Mensch-ärgere-dich-nicht room on the same host: one D1 row per room, HTTP polling every ~1.8s (1s while waiting for someone else to roll), no Durable Objects or WebSockets. Your own roll is in the POST response; the die tumbles from the click until that face lands. Ärger wins are not leaderboard rows. `VITE_API_BASE` empty means the page calls `/api` on the same host. Local play uses `data/scores.json` plus `data/aerger-rooms.json`. Production uses Cloudflare D1 on the same host: https://orbit-rush.selimv18.workers.dev

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
- `GET /api/scores?game=rush`, `?game=mirror`, `?game=drift` und `?game=pulse` — getrennte Top 50. Ohne `game` gilt `rush`.
- `GET /api/scores?difficulty=baba` → `einfach|mittel|schwer|baba` auf der Rush-Liste (Daily-Einträge sind hier nicht dabei)
- `GET /api/scores?game=drift&difficulty=schwer` → dieselbe Difficulty-Spalte, nur die Drift-Liste. Ohne `difficulty` zeigt Drift alle Grade.
- `GET /api/scores?game=pulse&difficulty=baba` und `GET /api/scores?game=pulse&mode=daily&dailyDate=YYYY-MM-DD` — Pulse-Grad bzw. Pulse-Daily, getrennt von Rush-Daily.
- `GET /api/scores?mode=daily&dailyDate=YYYY-MM-DD` — ohne `game` bleibt Daily Rush
- `POST /api/scores` `{ name, score, survivalMs, orbs, comboBonus, nearMisses, difficulty?, mode?, dailyDate?, clientId?, game? }`
- `game` ist `rush`, `mirror`, `drift` oder `pulse`. Fehlt es, wird `rush` gespeichert. Mirror, Drift und Pulse nutzen dieselbe Punkteformel. Mirror bleibt eine Rampe (`difficulty` mittel). Drift und Pulse speichern `einfach|mittel|schwer|baba` wie Rush; fehlt der Wert, bleibt der Default `mittel`. Daily erzwingt weiter `schwer`. Keine neue Spalte.

`clientId` ist optional (UUID v4). Ältere Clients lassen es weg; die Spalte bleibt dann `null`. Der Browser speichert Name (`orbit-rush-name`) und Id (`orbit-rush-client-id`). Eigene Zeilen mit derselben Id — oder ältere Zeilen nur mit demselben Namen — bekommen ein **YOU**. Nach dem ersten Namen speichert jeder beendete Run automatisch; ein erneutes Senden ist nur noch „Change name“.

Name wird bereinigt (1–16 Zeichen). Score-Maximum **750000**. Formel-Check, IP-Hash, höchstens ein POST alle 2 Sekunden, 30 API-Requests pro Minute, Doppel-Submit innerhalb von 10 s ist idempotent (pro Spiel).

Schema-Nachzug: `migrations/0002_client_id.sql` (nullable `client_id`) und `migrations/0003_game.sql` (`game`, Default `rush` für bestehende Zeilen). `npm run deploy` wendet die Migrationen an. Der Worker legt fehlende Spalten beim Start ebenfalls an.

Die Antwort-Liste eines POST ist die Top 50 **derselben** Rangliste (`game` plus Difficulty bzw. Daily-Datum). Das 500er-Limit gilt für die gemeinsame Tabelle; Rush, Mirror, Drift und Pulse bleiben getrennte Top 50.

Lokal speichert Express höchstens 500 Zeilen in `data/scores.json` (nicht im Git). Produktion speichert dieselben 500 Zeilen in Cloudflare **D1** und serviert das gebaute Spiel vom selben Host. Fällt die API aus, zeigt der Client die `localStorage`-Liste.

Frontend: `VITE_API_BASE` leer lassen (gleicher Origin). Nur setzen, wenn die API woanders liegt — siehe `.env.example`.

## Layout

```text
index.html
src/                  Spiel, UI, Skins, Achievements, Leaderboard-Client
src/mirror.js         Orbit Mirror (eigener Loop, gespiegelter Radius)
src/drift.js          Orbit Drift (Tunnel, Bahn halten, game=drift)
src/pulse.js          Orbit Pulse (Takt, Holds, game=pulse)
public/pulse-music/   Tracks + manifest.json (eine Datei-Gruppe pro Grad)
src/aerger-ui.js      Orbit Ärger Brett, Lobby, Polling
server/index.js       lokale Express-API (Scores + Ärger-Datei)
worker/               Produktion: /api auf D1, Ärger ohne Durable Objects
shared/aerger.js      MADN-Regeln (rein, testbar)
shared/               gemeinsame Prüfung (Name, Score, Filter, game)
migrations/           D1-Schema (`0003_game.sql` setzt bestehende Zeilen auf rush, `0004_aerger_rooms.sql` ist nur die Raum-Tabelle)
scripts/              smoke, worker-smoke, playtest, cf-deploy
wrangler.toml
DEPLOY.md
```

## Grenzen

- Lokale JSON-Datei ist nicht für mehrere Prozesse gedacht. Produktion (D1) schon.
- Anti-Cheat ist weich: Formel, Obergrenze, Rate-Limit.
- Öffentliche URL: https://orbit-rush.selimv18.workers.dev (Workers + D1 im Konto des Owners).
