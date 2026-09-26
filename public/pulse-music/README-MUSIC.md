# Orbit Pulse music pack (user-owned)

All clips start at t=0 (slow intros kept on purpose).
Assigned by integrated LUFS and beat density: quieter and sparser → Einfach, louder and busier → Baba. Newer alts are clipped to about 55–70s from t=0.
Place files under `public/pulse-music/` and load via `manifest.json`.

Per difficulty the pool stays inside that grade (quieter LUFS → Einfach, louder → Baba). A run shuffles the pool, and on a clear continues with the next file in that shuffle. Daily Beat stays a single track: pick from `dailyPool` using UTC date hash (same idea as Rush Daily seed).
Each clip has `beatmaps/<name>.json` (`beatTimes` from t=0). Charts follow those stamps, not a BPM grid.
