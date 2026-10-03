# Orbit Rush

Neon-Skill-Spiele plus zwei Online-Räume. **v1.5** bleibt die Rush/Mirror-Bestenliste. Dazu kommen **Orbit Ärger**, **Orbit Duel**, **Orbit Drift**, **Orbit Pulse**, **Orbit Jet**, **Orbit Dash** und **Orbit Paint**.

Die Seite bleibt **Orbit Rush** (gleiche URL, gleicher Pilot). Der erste Screen ist die **Orbit Arcade**: neun Kacheln, **Orbit Rush**, **Orbit Mirror**, **Orbit Ärger**, **Orbit Duel**, **Orbit Drift**, **Orbit Pulse**, **Orbit Jet**, **Orbit Dash** und **Orbit Paint**. Name (`orbit-rush-name`) und `orbit-rush-client-id` gelten für die Skill-Spiele. „Welcome back“ steht auf der Arcade. Ärger, Duel und Paint schreiben **nicht** in die Top-50.

| Spiel | Pitch |
|-------|--------|
| **Orbit Rush** | Steuere den Orbit. Sammle Orbs. Überlebe. |
| **Orbit Mirror** | Dein Reflex lügt. Das Schiff fliegt gespiegelt. |
| **Orbit Ärger** | Würfeln. Schmeißen. Zu viert online. |
| **Orbit Duel** | Zwei Paddles. Ein Ball. Weit weg, ein Code. |
| **Orbit Drift** | Halt die Bahn. Der Tunnel driftet. |
| **Orbit Pulse** | Tippe den Beat. Halt den Flow. |
| **Orbit Jet** | Flieg den Jet. Auto-Feuer. Besiege den Boss. |
| **Orbit Dash** | Bahnen wechseln. Hochwischen springt. |
| **Orbit Paint** | Malen nach Zahlen. Tippen und ziehen. |

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

Im Lauf steigt das Tempo weiter. Die kurze Streckenrampe bleibt (dann flach). Darüber legt eine geglättete Zeitrampen nach, in den ersten Sekunden fast nicht, und erreicht ihre Kappe erst spät: Einfach 19 → 45 in 100 s, Mittel 33 → 77 in 75 s, Schwer 44 → 94 in 75 s, Baba 54 → 112 in 75 s. Kurven, Bahnbreite und Hindernisse ziehen nur über die Strecke an und werden danach nicht enger. Die Formel und die Rangliste bleiben dieselben; ein längerer Lauf sammelt Ringe nur etwas schneller, weil die Bahn zügiger vorbeizieht.

Ringe in der Bahn sind die Orbs der gemeinsamen Formel. Wer ein Tor knapp an der Wand passiert und danach noch lebt, bekommt einen Near-Miss. Ketten funktionieren wie bei Rush. Angezeigt wird die Strecke in km; die Punkte bleiben an der Zeit hängen, damit der Server sie prüfen kann.

```text
score = floor(Sekunden) × 10 + Ringe × 100 + comboBonus + nearMisses × 75
```

Die Rangliste ist nur `game=drift` (Top 50), gefiltert wie Rush nach `difficulty` (`einfach|mittel|schwer|baba`, plus Alle). Alte Drift-Läufe ohne eigenen Grad stehen auf Mittel. Lokale Rekorde: `orbit-drift-best-<grad>` (der alte Schlüssel `orbit-drift-best` zählt als Mittel). Pause, Mute, Auto-Submit und YOU-Badge wie bei Rush und Mirror. Kein zweites Konto.

## Orbit Dash

Endloslauf auf Bahnen, kein Tunnel. Die Figur läuft von selbst. **Ein Wisch nach links oder rechts** (auch Pfeil links/rechts oder **A** / **D**) schiebt genau eine Bahn. **Hochwischen** (auch Pfeil hoch, **W** oder Leertaste) springt. Runterwischen macht nichts. Die Kamera sitzt hinter der Figur und schaut die Straße hinunter.

**Einfach** und **Mittel** haben drei Bahnen, eine oder zwei davon zu. **Schwer** und **Baba** haben vier Bahnen, eine bis drei davon zu. Nie sind alle Bahnen zu. Die freie Bahn liegt höchstens einen Schritt neben der freien Bahn der Reihe davor. Eine niedrige Wand geht mit dem Sprung aus dem Weg. Hohe Barrieren und Kisten treffen auch in der Luft. Goldenes ↑ auf kurzer Wand heißt springen oder ausweichen. Magenta auf hoher Wand oder Kiste heißt Bahn wechseln. Ringe liegen in der freien Bahn, manchmal über einer niedrigen Wand. Wer knapp an einer Wand vorbeikommt, bekommt einen Fast-vorbei.

Die Strecke wechselt die Umgebung ohne Menü: **Neonstadt**, dann **Leerentunnel**, dann **Cyber-Gasse**, und von vorn. Beim Wechsel blitzt der Stufenname kurz auf und bleibt im HUD. Im Tunnel liegen mehr niedrige Wände, in der Gasse mehr Kisten.

Vor dem Start: **Einfach · Mittel · Schwer · Baba**. Der Grad liegt unter `orbit-dash-difficulty` und ändert die anderen Spiele nicht. Tempo und Dichte steigen mit Strecke und Zeit und stoppen an einer Kappe, damit die Bahn auf dem Handy lesbar bleibt.

| Grad | Bahnen | Start | Kappe | Stufe alle |
|------|--------|-------|-------|------------|
| Einfach | 3 | 12 m/s (43 km/h) | 20 m/s (72 km/h) | 680 m |
| Mittel | 3 | 18 m/s (65 km/h) | 31 m/s (112 km/h) | 860 m |
| Schwer | 4 | 22 m/s (79 km/h) | 38 m/s (137 km/h) | 1040 m |
| Baba | 4 | 26 m/s (94 km/h) | 46 m/s (166 km/h) | 1200 m |

Das HUD zeigt **Tempo** in km/h, dazu Punkte, Ringe, Meter, Grad und Stufenname. Die Punkte hängen an der Zeit, nicht an den Metern, damit der Server dieselbe Formel wie Rush prüfen kann. Schnellere Grade sammeln Ringe trotzdem zügiger, weil die Ringe in Metern liegen. Ein Sprung ändert die Formel nicht.

```text
score = floor(Sekunden) × 10 + Ringe × 100 + comboBonus + nearMisses × 75
```

Die Rangliste ist nur `game=dash` (Top 50), gefiltert nach `difficulty`. Keine neue Migration: `scores.game` bleibt die Textspalte aus `0003_game.sql`. Lokale Rekorde: `orbit-dash-best-<grad>`. Pause, Mute, Auto-Submit und YOU-Badge wie bei Drift und Jet.

## Orbit Paint

Malen nach Zahlen, nur auf dem Gerät. Kein D1, keine Rangliste, kein extra Request. Zwölf eigene Pixelbilder (Herz, Mond, Pilz, Sonne, Rakete, Fisch, Komet, Orbit, Blume, Alien, Katze, Station) stecken als Zahlenraster in `src/paint.js`.

**Ablauf:** Farbe in der Leiste wählen. Die passenden, noch leeren Felder leuchten. Tippen füllt ein Feld, Ziehen füllt alle Felder dieser Zahl unter dem Finger. Eine andere Zahl bleibt leer und blitzt kurz rot. Ist eine Farbe voll, setzt ein Haken sie ab und die nächste offene Farbe wird gewählt. **Tipp** springt zum nächsten offenen Feld und zoomt heran. Zahlen stehen im Feld, sobald es groß genug ist.

**Zoom:** Zwei Finger ziehen auf und schieben. Am Desktop zoomt das Mausrad, die rechte oder mittlere Taste schiebt, die **Hand** macht aus dem nächsten Zug ein Schieben. **1–9** wählen Farben, **H** ist der Tipp, **Esc** geht zur Galerie.

**Fertig:** Das Bild zoomt auf die ganze Fläche, ohne Gitter und ohne Zahlen, mit einem kurzen Konfetti. Zeit und Punkte bleiben lokal (`orbit-paint-v1`). Punkte = `par / Zeit × 1000`, Par sind 0,8 s pro Feld, mindestens 50 und höchstens 9999. Schneller als die Par liegt über 1000. Die Galerie zeigt den Fortschritt; **Bild des Tages** ist ein stabiles Bild zum UTC-Datum aus derselben Galerie.

## Orbit Pulse

Rhythmus im Hochformat. Leuchtende Kreise laufen auf 3–4 Bahnen auf den Trefferring zu. **Tippen** (Bahn, `A` `S` `D` `F`, oder Leertaste auf der leuchtenden Bahn), wenn der Kreis den Ring trifft. **Holds** hältst du bis zur weißen Endmarke. Perfekt baut die Combo (x2…x5), Gut zählt als Near-Miss, Daneben bricht die Combo. Ein Sync-Balken und eine kurze Fehlerserie beenden den Lauf — Einfach verzeiht, Baba kaum. Der Track selbst kann auch einfach zu Ende gehen.

Vor dem Start wählst du **Einfach · Mittel · Schwer · Baba**. Der Grad liegt unter `orbit-pulse-difficulty` und ändert Rush und Drift nicht. Ein Lauf mischt die Tracks dieses Grads neu, ohne denselben Song zweimal hintereinander, solange der Pool noch andere Titel hat. **Level geschafft** (Track zu Ende, Sync noch da) zeigt kurz „Level geschafft“, dann startet der nächste Song aus dieser Mischung etwas härter: engere Fenster, schnellerer Lauf, strengere Sync-Abzüge, dichtere Noten aus **dieser** Beatmap. Der Sprung bleibt unter dem nächsten genannten Grad. Das letzte Level endet mit „Run geschafft“. Ein Fail beendet den Lauf; die Anzeige zeigt Level und Track. Die Punkte laufen über alle Level und gehen einmal an `game=pulse`, wenn der Lauf endet. **Daily Beat** bleibt ein einzelner Track, immer Schwer, aus `dailyPool`, und wechselt mit dem UTC-Datum. HUD und Game Over zeigen `Daily · Datum`. Submit: `game:"pulse"`, `mode:"daily"`, `dailyDate`.

Die Musik steht in `public/pulse-music/` (`manifest.json` plus die mp3s). `byDifficulty` ist der Pool eines Grads. Ein Lauf spielt eine Mischung daraus, nicht die feste Reihenfolge leichter → härter. Es werden keine Tracks aus einem härteren Grad in Einfach gezogen. Ein Playback-Rate-Nudge von 0–3 % darf drauf, ersetzt den Dateiwechsel aber nicht. Daily Beat wählt mit dem UTC-Datum stabil aus `dailyPool` und nutzt die Beatmap **dieses** Tracks. Mute nutzt denselben Knopf; Pause und Arcade stoppen die Wiedergabe. Die Noten sitzen auf den `beatTimes` aus `public/pulse-music/beatmaps/` (librosa, Sekunden ab t=0). Die Wertung liest `audio.currentTime`, nicht eine eigene Stoppuhr. Einfach lässt jeden zweiten Schlag aus, Baba fast alle; Offbeat-Onsets nur bei Schwer und Baba. Holds enden auf einem späteren Schlag derselben Beatmap. Spätere Level desselben Grads behalten dieses Raster und setzen zusätzliche Schläge aus derselben Beatmap. Zwei Finger reichen immer, auch auf 3–4 Bahnen und im Daily Beat: ein Hold plus ein Tap ist erlaubt, ein zweiter Hold nur, wenn in dem Überlappungsfenster keine weitere Note startet. Sonst wird der zweite Hold zum Tap, damit nicht beide Daumen feststecken, wenn die nächste Note kommt.

Dieselbe Formel wie Rush, damit der Server sie prüft:

```text
score = floor(Sekunden) × 10 + Treffer × 100 + comboBonus + Gut × 75
```

Treffer sind Perfekt und Gut. `nearMisses` sind die Guts. Die Rangliste ist nur `game=pulse` (Top 50), mit Filtern Alle / Einfach / Mittel / Schwer / Baba / Daily. `GET /api/scores?game=pulse&mode=daily&dailyDate=YYYY-MM-DD` ist die Daily-Liste dieses Tages. Lokale Rekorde: `orbit-pulse-best-<grad>` und `orbit-pulse-daily-best-<datum>`.

## Orbit Jet

Vertikaler Kampfjet. Die Welt scrollt auf dich zu. Der Jet schießt immer. **Ziehen** (Finger oder Maus) folgt in der Bahn, mit kurzer Leine nach oben und unten. **Pfeile** oder **WASD** lenken ebenfalls. **Leertaste** oder der Bomben-Knopf zündet eine Räumbombe, wenn du eine hast.

Vor dem Start wählst du **Einfach · Mittel · Schwer · Baba**. Der Grad liegt unter `orbit-jet-difficulty` und ändert Rush, Drift und Pulse nicht. Einfach hat vier Leben und langsameres Feuer, Baba zwei Leben und dichtere Wellen. Ein Lauf geht durch vier Stufen und fängt danach härter wieder von vorn an, bis die Leben leer sind.

| Stufe | Boss |
|-------|------|
| **Neon City** | Träger: Drohnen und ein breiter Laser-Sweep |
| **Desert Dusk** | Sandwyrm: gräbt sich seitlich neu und wirbelt kurz einen Sandsturm auf |
| **Ice Orbit** | Frostkern: friert eine Bahn ein (Slow-Zone) und schießt einen Splitterring |
| **Storm Nebula** | Sturmtitan: Blitzsäulen mit Vorwarnung und zielsuchende Orbs |

Waffen-Pickups (`WAFFE`) steigen: Einzel → Doppel → Dreifach → Fächer → Laser. Ein Treffer ohne Schild kostet ein Leben und genau eine Waffenstufe. Dazu gibt es Schild (zwei Treffer), Zeitlupe (Gegner und Schüsse etwa 40 % langsamer), Bombe, Magnet, Boost und eine kurze Drohne.

Dieselbe Formel wie Rush, damit der Server sie prüft. Abschüsse, Pickups und der Boss-Bonus sind die Ziele, Fast-vorbei die Near-Misses:

```text
score = floor(Sekunden) × 10 + Ziele × 100 + comboBonus + nearMisses × 75
```

Die Rangliste ist nur `game=jet` (Top 50), gefiltert nach `difficulty`. Keine neue Migration: `scores.game` bleibt die Textspalte aus `0003_game.sql`. Lokale Rekorde: `orbit-jet-best-<grad>`. Pause, Mute, Auto-Submit und YOU-Badge wie bei Drift und Pulse.

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

Kein Durable Object, kein WebSocket, keine Queue. Ein Raum ist **eine D1-Zeile** (`aerger_rooms`): JSON `state`, `version`, `updated_at`. `migrations/0004_aerger_rooms.sql` legt nur diese Tabelle an. `scores.game` ist `rush`, `mirror`, `drift`, `pulse`, `jet` oder `dash`. Drift, Pulse, Jet und Dash brauchen keine neue Migration: die Spalte aus `0003_game.sql` ist freier Text.

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

## Orbit Duel

Pong / Air-Hockey für genau zwei Spieler, gleicher Neon-Look, Hoch- und Querformat. Deutsch ist die Hauptsprache.

**Ablauf:** Raum erstellen → 6-stelliger Code → Gast tritt mit Code und Namen bei → beide tippen **Bereit** → drei Sekunden Countdown → Ball. Der gespeicherte Pilot-Name wird vorausgefüllt. **Nochmal** schickt beide zurück in die Lobby, wieder mit Bereit.

**Regeln:** Jeder hat ein Paddle. Auf deinem Bildschirm bist du immer unten (der Gast sieht das Feld gespiegelt, links bleibt links). Ziehen oder **A / D** und die Pfeile bewegen nur dein Paddle. Wer den Ball vorbeilässt, kassiert einen Punkt. **Zuerst 7** gewinnt. Danach Aufschlag für den, der den Punkt abgegeben hat.

Der Ball gehört dem Server. Clients zeichnen ihn zwischen den Polls aus dem letzten Snapshot weiter, Punkte zählt nur der Worker. Ein Tab, der etwa 70 Sekunden still ist, gibt auf.

Siege auf diesem Gerät stehen unter `orbit-duel-wins`. Es gibt **keine** Zeile in `scores`: die Skill-Formel passt nicht auf einen Sieg, und `game=duel` bleibt ungültig.

### Polling auf dem Workers-Free-Tarif

Kein neues Produkt, kein zweiter Worker, kein Durable Object, kein WebSocket. Ein Raum ist **eine D1-Zeile** (`duel_rooms`), analog zu `aerger_rooms`. `migrations/0005_duel_rooms.sql` legt nur diese Tabelle an. Der Worker erzeugt sie beim Start ebenfalls.

| Aufruf | Wirkung |
|--------|---------|
| `POST /api/duel/create` | Raum + Secret für den Host |
| `POST /api/duel/join` | Gast-Sitz, braucht `version` |
| `POST /api/duel/ready` `leave` `rematch` | Server prüft den Sitz. Alte `version` → **409** |
| `POST /api/duel/paddle` | Paddle 0–1. Beide dürfen gleichzeitig schreiben; der Worker wiederholt die Zeile selbst |
| `POST /api/duel/heartbeat` | höchstens alle 12 s eine Schreibaktion pro Sitz |
| `GET /api/duel/room/:code` | Stand lesen. In der Rallye steht der Ball immer im Body. `?p=` trägt das eigene Paddle mit, schreibt aber nur wenn das Intervall es erlaubt |

Lobby und Abpfiff: Poll etwa alle **1,6 s** (danach **1 s**), Pause bei `document.hidden`, `If-None-Match` → **304**, `?since=` → kleines JSON. Während Countdown und Rallye pollt der Client alle **120 ms**. Das Paddle schreibt höchstens alle **240 ms**, und alle **100 ms** solange der Ball auf dieses Paddle zufliegt — und nur wenn es sich bewegt hat. Der Treffer wird mit dem neuen Paddle gerechnet, bevor der Ball in diesem Request weiterläuft. Unveränderte Polls in der Rallye sind trotzdem **kein** 304: der Ball wird im Speicher vorgerechnet und nur bei Punkt, Aufschlag, Aufgabe oder einem erlaubten Paddle-Schritt nach D1 geschrieben.

**Budget (Annahme Free: 5 Mio. Reads/Tag, 100k Writes/Tag):**

- Zwei Spieler, Poll alle 120 ms, 10 Minuten ≈ 2 × 500 × 10 ≈ **10.000 Reads** nur fürs Pollen. Ein Paddle-POST liest die Zeile zusätzlich. Weit unter 5 Mio./Tag.
- Schlimmster Fall, beide sägen dauernd am Paddle: etwa **8 D1-Writes/s** (4 Hz × 2), plus etwa **6/s** extra für den Spieler, auf den der Ball gerade zufliegt. Das sind grob **2 Stunden** solcher Dauer-Wackler pro Tag, dann ist das Write-Kontingent voll. Steht das Paddle, schreibt der Worker fast nur Punkte, Aufschläge und Heartbeats.
- Räume ohne Update seit **3 Stunden** werden wie bei Ärger gelegentlich gelöscht.

## English

**Orbit Rush** is a mobile-first Canvas 2D reflex game. You auto-orbit a planet and steer the radius with A/D, arrow keys, or a horizontal drag. Collect orbs, dodge debris, chain combos and near-misses. A finished run saves to the top 50 under your pilot name. The first game over asks for that name once; later visits show “Welcome back” and submit on their own.

v1.6 opens on an **Orbit Arcade** hub with nine games. **Orbit Paint** is local paint-by-number (twelve original pixel pictures, no leaderboard and no D1): pick a numbered color, tap or drag the matching cells, pinch or scroll to zoom, and a finished picture drops the numbers. Progress stays in `orbit-paint-v1`. v1.5 opened the same hub with eight games. **Orbit Duel** is a two-player paddle match on the same host: one D1 row (`duel_rooms`), HTTP polling, server-owned ball, first to 7. Wins stay on the device (`orbit-duel-wins`) and are not leaderboard rows. **Orbit Mirror**, **Orbit Drift**, **Orbit Pulse**, **Orbit Jet**, and **Orbit Dash** each post to their own top 50 (`game=mirror`, `game=drift`, `game=pulse`, `game=jet`, `game=dash`). Orbit Dash is an endless lane runner, not a tunnel: one horizontal swipe or A/D steps exactly one lane, swipe up or W/Space jumps low walls while high barriers and crates still kill, Schwer and Baba use four lanes while Einfach and Mittel stay on three, every row leaves a safe lane, the road shifts from Neonstadt to Leerentunnel to Cyber-Gasse, and the score uses the same time-and-rings formula as Drift. Orbit Jet is a vertical auto-fire jet: drag or keys to fly, weapon pickups from single shot through laser, timed specials, and four boss stages (Neon City, Desert Dusk, Ice Orbit, Storm Nebula). Pulse is a neon rhythm game: tap or hold circles on the beat, and no chart — stage chain or Daily Beat — asks for more than two fingers at once. A tap beside one hold is fine; a second hold is kept only when nothing else starts during the overlap. Two fingers on adjacent notes each score, even when both land closer to the same lane. A difficulty shuffles its own tracks for the run; clearing a stage starts the next remaining song a little harder, and the run score is submitted once when the run ends. Daily Beat stays a single date-seeded track. Note times come from the playing file's beatmap and are judged against `audio.currentTime`. Drift is a solo neon tunnel: steer with A/D, arrows, or a drag, stay in the lane, and lose one of three hull points on a wall or on debris, barriers, and side spikes. Before each run you pick Einfach, Mittel, Schwer, or Baba; Mittel is faster and tighter than the original single ramp. **Orbit Ärger** is a 2–4 player Mensch-ärgere-dich-nicht room on the same host: one D1 row per room, HTTP polling every ~1.8s (1s while waiting for someone else to roll), no Durable Objects or WebSockets. Your own roll is in the POST response; the die tumbles from the click until that face lands. Ärger wins are not leaderboard rows. `VITE_API_BASE` empty means the page calls `/api` on the same host. Local play uses `data/scores.json` plus `data/aerger-rooms.json`. Production uses Cloudflare D1 on the same host: https://orbit-rush.selimv18.workers.dev

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
migrations/           D1-Schema (`0003_game.sql` setzt bestehende Zeilen auf rush, `0004_aerger_rooms.sql` und `0005_duel_rooms.sql` sind nur Raum-Tabellen)
scripts/              smoke, worker-smoke, playtest, cf-deploy
wrangler.toml
DEPLOY.md
```

## Grenzen

- Lokale JSON-Datei ist nicht für mehrere Prozesse gedacht. Produktion (D1) schon.
- Anti-Cheat ist weich: Formel, Obergrenze, Rate-Limit.
- Öffentliche URL: https://orbit-rush.selimv18.workers.dev (Workers + D1 im Konto des Owners).
