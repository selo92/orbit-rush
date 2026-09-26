# Orbit Pulse music pack (user-owned)

All clips start at t=0 (slow intros kept on purpose).
Assigned by integrated LUFS: quieter → Einfach, louder → Baba.
Place files under `public/pulse-music/` and load via `manifest.json`.

Per difficulty the pool is ordered easier → harder (fewer beats per second, then quieter LUFS). A run starts at the first track and, on a clear, continues with the next file in that same pool. Daily Beat stays a single track: pick from `dailyPool` using UTC date hash (same idea as Rush Daily seed).
Each clip has `beatmaps/<name>.json` (`beatTimes` from t=0). Charts follow those stamps, not a BPM grid.
