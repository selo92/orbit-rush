#!/usr/bin/env python3
"""Turn original illustrations into static color-by-number pictures.

Build-time only. Needs pillow, numpy, scipy, scikit-image, and potracer
(`import potrace`). Ships JSON, WebP thumbnails, and WebP reveals — no
runtime Python.

  python3 scripts/paint/trace.py
  python3 scripts/paint/trace.py --only hana
"""

from __future__ import annotations

import argparse
import heapq
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from potrace import Bitmap
from scipy import ndimage
from skimage.color import lab2rgb, rgb2lab
from skimage.restoration import denoise_bilateral

ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "scripts" / "paint" / "sources"
PAINT_DIR = ROOT / "public" / "paint"
THUMB_DIR = PAINT_DIR / "thumbs"
REVEAL_DIR = PAINT_DIR / "reveal"
INDEX_PATH = ROOT / "scripts" / "paint" / "traced-index.json"
PREVIEW_DIR = Path("/tmp/paint-preview")
UPLOAD_DIR = Path("/home/ubuntu/.cursor/projects/workspace/uploads")

W, H = 960, 540
VIEWBOX = f"0 0 {W} {H}"
CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.int8)

# k = palette cap, de = Lab distance that still counts as the same paint.
PRESET = {
    "leicht": dict(k=18, de=12.0, area=64, lo=150, hi=260, min_r=4.0, line=2.15),
    "mittel": dict(k=22, de=9.0, area=40, lo=220, hi=420, min_r=3.4, line=2.05),
    "schwer": dict(k=28, de=6.5, area=24, lo=300, hi=450, min_r=3.1, line=1.9),
}

# Gallery order within a category follows this list. Prinzessin lives with the
# other gown pictures, not with the animal Märchen.
PICTURES = [
    ("prinzessin", "Prinzessin", "fee", "mittel", "prinzessin_3d54.jpg"),
    ("meerjungfrau", "Meerjungfrau", "fee", "mittel", "meerjungfrau_53ff.jpg"),
    ("fee", "Fee", "fee", "mittel", "fee_a41c.jpg"),
    ("ballkleid", "Ballkleid", "fee", "schwer", "ballkleid_0672.jpg"),
    ("winterprinzessin", "Winterprinzessin", "fee", "mittel", "winterprinzessin_8da3.jpg"),
    ("teeparty", "Teeparty", "fee", "schwer", "teeparty_475d.jpg"),
    ("blumenmaedchen", "Blumenmädchen", "fee", "leicht", "blumenmaedchen_1434.jpg"),
    ("hana", "Hana", "manga", "mittel", "hana_dbce.jpg"),
    ("ren", "Ren", "manga", "mittel", "ren_5af3.jpg"),
    ("momo", "Momo", "manga", "leicht", "momo_149f.jpg"),
    ("laterne", "Laternenmarkt", "manga", "schwer", "laterne_1487.jpg"),
    ("kirsche", "Kirschfest", "manga", "schwer", "kirsche_58f7.jpg"),
    ("schloss", "Schloss", "maerchen", "mittel", "schloss_0b4b.jpg"),
    ("fuchs", "Fuchs", "maerchen", "leicht", "fuchs_6726.jpg"),
    ("drache", "Drache", "maerchen", "schwer", "drache_aa9f.jpg"),
    ("einhorn", "Einhorn", "maerchen", "mittel", "einhorn_3db0.jpg"),
    ("zauberwald", "Zauberwald", "maerchen", "schwer", "zauberwald_cf09.jpg"),
]


def fnum(v):
    r = round(float(v), 1)
    if r == 0:
        return "0"
    if abs(r - round(r)) < 1e-6:
        return str(int(round(r)))
    return f"{r:.1f}"


def ensure_source(picture_id, upload_name):
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    dest = SOURCE_DIR / f"{picture_id}.jpg"
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    src = UPLOAD_DIR / upload_name
    if not src.exists():
        raise SystemExit(f"missing illustration for {picture_id}: {src}")
    dest.write_bytes(src.read_bytes())
    return dest


def load_work(path):
    im = Image.open(path).convert("RGB")
    im = im.resize((W, H), Image.Resampling.LANCZOS)
    arr = np.asarray(im).astype(np.float32) / 255.0
    smooth = denoise_bilateral(arr, sigma_color=0.07, sigma_spatial=2.0, channel_axis=-1)
    rgb = np.clip(np.round(smooth * 255.0), 0, 255).astype(np.uint8)
    return im, rgb


def pick_palette(rgb, max_colors, min_de, min_colors):
    """Greedy Lab palette from common 5-bit buckets, so small features (eyes) survive."""
    q = rgb.astype(np.int32) >> 3
    key = (q[:, :, 0] << 10) | (q[:, :, 1] << 5) | q[:, :, 2]
    counts = np.bincount(key.ravel(), minlength=32768)
    idx = np.flatnonzero(counts >= 28)
    if idx.size == 0:
        idx = np.flatnonzero(counts > 0)
    r = (((idx >> 10) & 31) * 8 + 4).astype(np.uint8)
    g = (((idx >> 5) & 31) * 8 + 4).astype(np.uint8)
    b = ((idx & 31) * 8 + 4).astype(np.uint8)
    cols = np.stack([r, g, b], axis=1)
    lab = rgb2lab(cols.reshape(-1, 1, 3)).reshape(-1, 3)
    order = np.argsort(-counts[idx])

    def greedy(dist, cap):
        chosen = []
        chosen_lab = []
        for i in order:
            if len(chosen) >= cap:
                break
            if chosen_lab:
                delta = np.linalg.norm(np.stack(chosen_lab) - lab[i], axis=1)
                if float(delta.min()) < dist:
                    continue
            chosen.append(int(i))
            chosen_lab.append(lab[i])
        return chosen

    chosen = greedy(min_de, max_colors)
    if len(chosen) < min_colors:
        chosen = greedy(min_de * 0.62, max_colors)
    if len(chosen) < min_colors:
        chosen = greedy(max(3.2, min_de * 0.4), max_colors)
    if len(chosen) < 8:
        chosen = greedy(3.0, max_colors)
    centers = lab[np.array(chosen[:max_colors], dtype=np.int32)]
    return centers


def assign_colors(rgb, centers):
    lab = rgb2lab(rgb)
    flat = lab.reshape(-1, 3).astype(np.float32)
    cents = centers.astype(np.float32)
    labels = np.empty(flat.shape[0], dtype=np.int16)
    step = 48000
    for start in range(0, flat.shape[0], step):
        block = flat[start : start + step]
        dist = ((block[:, None, :] - cents[None, :, :]) ** 2).sum(axis=2)
        labels[start : start + step] = dist.argmin(axis=1).astype(np.int16)
    labels = labels.reshape(rgb.shape[:2])
    lightness = lab[:, :, 0]
    chroma = np.hypot(lab[:, :, 1], lab[:, :, 2])
    dark = np.where(centers[:, 0] < 20)[0]
    if dark.size:
        ink = int(dark[np.argmin(centers[dark, 0])])
        labels[(lightness < 26) & (chroma < 16)] = np.int16(ink)
    return labels, lab


def majority(labels, passes=1):
    k = int(labels.max()) + 1
    current = labels
    for _ in range(passes):
        acc = np.zeros(current.shape, dtype=np.float32)
        best = current.copy()
        for c in range(k):
            dens = ndimage.uniform_filter((current == c).astype(np.float32), size=3, mode="nearest")
            take = dens > acc + 1e-5
            best[take] = np.int16(c)
            np.maximum(acc, dens, out=acc)
        current = best
    return current


def dissolve_thin_ink(labels, centers, line_r):
    """Give hair and pupils their own dark paint; split hairline outlines into neighbors."""
    if centers.shape[0] == 0:
        return labels
    ink = int(np.argmin(centers[:, 0]))
    if float(centers[ink, 0]) > 22:
        return labels
    black = labels == ink
    if not np.any(black):
        return labels
    dist_in = ndimage.distance_transform_edt(black)
    thin = black & (dist_in <= line_r)
    if not np.any(thin):
        return labels
    _, index = ndimage.distance_transform_edt(thin, return_indices=True)
    nearest = labels[index[0], index[1]]
    out = labels.copy()
    out[thin] = nearest[thin]
    return out


def label_components(labels):
    comp = np.zeros(labels.shape, dtype=np.int32)
    color_of = [0]
    next_id = 1
    k = int(labels.max()) + 1
    for c in range(k):
        mask = labels == c
        if not np.any(mask):
            continue
        marked, n = ndimage.label(mask, structure=CROSS)
        if n <= 0:
            continue
        comp[mask] = marked[mask] + (next_id - 1)
        color_of.extend([c] * n)
        next_id += n
    return comp, np.asarray(color_of, dtype=np.int16)


def adjacency(comp):
    adj = {}

    def add(a, b):
        if a == b or a == 0 or b == 0:
            return
        if a > b:
            a, b = b, a
        bucket = adj.get(a)
        if bucket is None:
            bucket = {}
            adj[a] = bucket
        bucket[b] = bucket.get(b, 0) + 1

    left = comp[:, :-1]
    right = comp[:, 1:]
    mask = left != right
    aa = left[mask].astype(np.int64)
    bb = right[mask].astype(np.int64)
    lo = np.minimum(aa, bb)
    hi = np.maximum(aa, bb)
    if lo.size:
        key = lo * (int(hi.max()) + 1) + hi
        uniq, cnt = np.unique(key, return_counts=True)
        span = int(hi.max()) + 1
        for packed, n in zip(uniq.tolist(), cnt.tolist()):
            a = int(packed // span)
            b = int(packed % span)
            adj.setdefault(a, {})
            adj.setdefault(b, {})
            adj[a][b] = adj[a].get(b, 0) + int(n)
            adj[b][a] = adj[b].get(a, 0) + int(n)
    top = comp[:-1, :]
    bot = comp[1:, :]
    mask = top != bot
    aa = top[mask].astype(np.int64)
    bb = bot[mask].astype(np.int64)
    lo = np.minimum(aa, bb)
    hi = np.maximum(aa, bb)
    if lo.size:
        key = lo * (int(hi.max()) + 1) + hi
        uniq, cnt = np.unique(key, return_counts=True)
        span = int(hi.max()) + 1
        for packed, n in zip(uniq.tolist(), cnt.tolist()):
            a = int(packed // span)
            b = int(packed % span)
            adj.setdefault(a, {})
            adj.setdefault(b, {})
            adj[a][b] = adj[a].get(b, 0) + int(n)
            adj[b][a] = adj[b].get(a, 0) + int(n)
    return adj


def merge_small(comp, color_of, centers, min_area, min_r, feature_de=58):
    """Merge specks, then thin untappable regions.

    Pupils and other thick or high-contrast dots are not area-merged, so a
    face stays readable after the small confetti is gone.
    """
    max_id = int(comp.max())
    area = np.bincount(comp.ravel(), minlength=max_id + 1).astype(np.int32)
    parent = np.arange(max_id + 1, dtype=np.int32)
    alive = set(int(i) for i in range(1, max_id + 1) if area[i] > 0)
    adj = adjacency(comp)
    lab = centers.astype(np.float64)
    radii0, _poles0 = measure(comp)

    def contrast(i):
        borders = adj.get(i)
        if not borders:
            return 0.0
        ci = int(color_of[i])
        best = 0.0
        for j in borders:
            if j <= 0 or j >= color_of.shape[0]:
                continue
            de = float(np.linalg.norm(lab[ci] - lab[int(color_of[j])]))
            if de > best:
                best = de
        return best

    features = set()
    for i in alive:
        r = radii0.get(i, 0.0)
        a = int(area[i])
        # Pupils, eye-whites, and small jewelry: high Lab contrast, not texture.
        if 16 <= a <= 280 and r >= 2.05 and keep_compact(a, r) and contrast(i) >= feature_de:
            features.add(i)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return int(x)

    def protected(i):
        return i in features

    def border_of(src):
        best = None
        best_key = None
        for nxt, border in list(adj.get(src, {}).items()):
            j = find(nxt)
            if j == src or j not in alive:
                continue
            de = float(np.linalg.norm(lab[int(color_of[src])] - lab[int(color_of[j])]))
            key = (border, -de, int(area[j]))
            if best_key is None or key > best_key:
                best_key = key
                best = j
        return best

    def absorb(src, dst):
        alive.discard(src)
        parent[src] = dst
        area[dst] += area[src]
        area[src] = 0
        for nxt, border in list(adj.get(src, {}).items()):
            j = find(nxt)
            if j == dst or j == src or j not in alive:
                continue
            adj.setdefault(dst, {})
            adj.setdefault(j, {})
            adj[dst][j] = adj[dst].get(j, 0) + border
            adj[j][dst] = adj[j].get(dst, 0) + border
            if src in adj.get(j, {}):
                adj[j].pop(src, None)
        adj.pop(src, None)
        if dst in adj:
            adj[dst].pop(src, None)

    # Area pass. Heap stays correct because stale (area, id) pairs are skipped.
    heap = [(int(area[i]), i) for i in alive if area[i] < min_area and not protected(i)]
    heapq.heapify(heap)
    while heap:
        a, i = heapq.heappop(heap)
        i = find(i)
        if i not in alive or int(area[i]) != a or a >= min_area or a == 0 or protected(i):
            continue
        dst = border_of(i)
        if dst is None:
            continue
        absorb(i, dst)
        if area[dst] < min_area and not protected(dst):
            heapq.heappush(heap, (int(area[dst]), dst))

    # Thin-region pass. Recompute inradius on the merged masks.
    for _round in range(3):
        root = parent.copy()
        for i in range(1, len(root)):
            root[i] = find(i)
        merged = root[comp]
        radii, poles = measure(merged)
        victims = []
        for i in list(alive):
            if i in features:
                continue
            r = radii.get(i, 0.0)
            if r >= min_r:
                continue
            if keep_compact(int(area[i]), r):
                continue
            victims.append(i)
        if not victims:
            break
        victims.sort(key=lambda i: (radii.get(i, 0.0), int(area[i])))
        changed = False
        for i in victims:
            i = find(i)
            if i not in alive:
                continue
            r = radii.get(i, 0.0)
            if i in features or r >= min_r or keep_compact(int(area[i]), r):
                continue
            dst = border_of(i)
            if dst is None:
                continue
            absorb(i, dst)
            changed = True
        if not changed:
            break

    root = parent.copy()
    for i in range(1, len(root)):
        root[i] = find(i)
    return root


def keep_compact(area, r):
    """Round eye-sized dots stay even when a finger would rather zoom."""
    if r < 1.75 or area < 10:
        return False
    compactness = area / (math.pi * r * r)
    return compactness <= 3.15


def measure(merged):
    max_id = int(merged.max())
    radii = {}
    poles = {}
    if max_id <= 0:
        return radii, poles
    remap = np.zeros(max_id + 1, dtype=np.int32)
    uniq = np.unique(merged)
    uniq = uniq[uniq > 0]
    remap[uniq] = np.arange(1, uniq.size + 1)
    compact = remap[merged]
    slices = ndimage.find_objects(compact)
    for slot, sl in enumerate(slices, start=1):
        if sl is None:
            continue
        src = int(uniq[slot - 1])
        crop = compact[sl] == slot
        if not np.any(crop):
            continue
        dist = ndimage.distance_transform_edt(crop)
        flat = int(dist.argmax())
        py, px = divmod(flat, dist.shape[1])
        radii[src] = float(dist[py, px])
        poles[src] = (float(px + sl[1].start), float(py + sl[0].start), float(dist[py, px]))
    return radii, poles


def curve_to_d(curve, ox, oy):
    start = curve.start_point
    if start is None:
        return ""
    parts = [f"M {fnum(start.x + ox)} {fnum(start.y + oy)}"]
    for seg in curve:
        if seg.is_corner:
            parts.append(f"L {fnum(seg.c.x + ox)} {fnum(seg.c.y + oy)} L {fnum(seg.end_point.x + ox)} {fnum(seg.end_point.y + oy)}")
        else:
            parts.append(
                f"C {fnum(seg.c1.x + ox)} {fnum(seg.c1.y + oy)} {fnum(seg.c2.x + ox)} {fnum(seg.c2.y + oy)} {fnum(seg.end_point.x + ox)} {fnum(seg.end_point.y + oy)}"
            )
    parts.append("Z")
    return " ".join(parts)


def trace_mask(mask, ox, oy, tolerance):
    if not np.any(mask):
        return ""
    # Bitmap inverts its input; pass the complement so True pixels are the region.
    path = Bitmap(~mask).trace(turdsize=0, alphamax=1.0, opticurve=True, opttolerance=tolerance)
    parts = []
    for curve in path.curves:
        d = curve_to_d(curve, ox, oy)
        if d:
            parts.append(d)
    return " ".join(parts)


def name_color(L, a, b, used):
    chroma = math.hypot(a, b)
    hue = math.degrees(math.atan2(b, a)) % 360
    if L < 18 and chroma < 18:
        base = "Tinte"
    elif chroma < 9:
        if L > 90:
            base = "Schnee"
        elif L > 74:
            base = "Creme"
        elif L > 52:
            base = "Nebel"
        elif L > 34:
            base = "Stein"
        else:
            base = "Schiefer"
    elif 22 <= hue <= 78 and 52 <= L <= 90 and 10 <= chroma <= 52:
        base = "Haut" if L >= 64 else "Bronze"
    else:
        table = (
            (16, "Rose"),
            (40, "Koralle"),
            (68, "Orange"),
            (102, "Gold"),
            (145, "Limette"),
            (188, "Blatt"),
            (228, "Türkis"),
            (262, "Himmel"),
            (305, "Blau"),
            (345, "Veilchen"),
            (360, "Rosa"),
        )
        base = "Rosa"
        for edge, name in table:
            if hue <= edge:
                base = name
                break
        if L < 36:
            base = f"Dunkle {base}"
        elif L > 82:
            base = f"Helle {base}"
    name = base
    n = 2
    while name in used:
        name = f"{base} {n}"
        n += 1
    used.add(name)
    return name


def hex_of(lab_row):
    rgb = lab2rgb(np.asarray(lab_row, dtype=np.float64).reshape(1, 1, 3))[0, 0]
    rgb8 = np.clip(np.round(rgb * 255.0), 0, 255).astype(np.uint8)
    return f"#{rgb8[0]:02x}{rgb8[1]:02x}{rgb8[2]:02x}"


def build_regions(comp, root, color_of, centers):
    merged = root[comp]
    radii, poles = measure(merged)
    ids = [i for i, r in radii.items() if r > 0]
    # Big shapes first so a traced edge that overlaps yields the detail on top.
    ids.sort(key=lambda i: (-int(np.count_nonzero(merged == i)), i))
    # Recount with bincount once.
    areas = np.bincount(merged.ravel())
    ids.sort(key=lambda i: (-int(areas[i]) if i < areas.size else 0, i))

    raw = []
    slices = None
    max_id = int(merged.max())
    remap = np.zeros(max_id + 1, dtype=np.int32)
    uniq = np.array([i for i in ids if i <= max_id], dtype=np.int32)
    if uniq.size == 0:
        return []
    remap[uniq] = np.arange(1, uniq.size + 1)
    compact = remap[merged]
    slices = ndimage.find_objects(compact)
    for slot, src in enumerate(uniq.tolist(), start=1):
        sl = slices[slot - 1]
        if sl is None:
            continue
        crop = compact[sl] == slot
        area = int(crop.sum())
        if area < 8:
            continue
        tol = 1.05 if area > 12000 else 0.72 if area > 1500 else 0.48
        d = trace_mask(crop, sl[1].start, sl[0].start, tol)
        if not d.startswith("M"):
            y0, y1 = sl[0].start, sl[0].stop
            x0, x1 = sl[1].start, sl[1].stop
            d = f"M {fnum(x0)} {fnum(y0)} L {fnum(x1)} {fnum(y0)} L {fnum(x1)} {fnum(y1)} L {fnum(x0)} {fnum(y1)} Z"
        pole = poles.get(src)
        if pole is None:
            dist = ndimage.distance_transform_edt(crop)
            flat = int(dist.argmax())
            py, px = divmod(flat, dist.shape[1])
            pole = (px + sl[1].start, py + sl[0].start, float(dist[py, px]))
        raw.append(
            {
                "color": int(color_of[src]),
                "d": d,
                "x": round(pole[0], 1),
                "y": round(pole[1], 1),
                "r": round(max(pole[2], 0.5), 1),
                "area": area,
            }
        )
    return raw


def pack_picture(raw, centers):
    used_idx = sorted({item["color"] for item in raw})
    counts = {c: 0 for c in used_idx}
    for item in raw:
        counts[item["color"]] += item["area"]
    used_idx.sort(key=lambda c: (-counts[c], c))
    remap = {c: i + 1 for i, c in enumerate(used_idx)}
    used_names = set()
    colors = []
    for c in used_idx:
        L, a, b = (float(v) for v in centers[c])
        colors.append({"hex": hex_of(centers[c]), "name": name_color(L, a, b, used_names)})
    regions = []
    for item in raw:
        regions.append(
            {
                "n": remap[item["color"]],
                "d": item["d"],
                "x": item["x"],
                "y": item["y"],
                "r": item["r"],
            }
        )
    return colors, regions


def save_reveal(src_path, dest):
    im = Image.open(src_path).convert("RGB")
    if im.size != (1280, 720):
        im = im.resize((1280, 720), Image.Resampling.LANCZOS)
    chosen = None
    for quality in range(84, 34, -4):
        buf = io.BytesIO()
        im.save(buf, format="WEBP", quality=quality, method=6)
        data = buf.getvalue()
        chosen = (quality, data)
        if len(data) <= 200_000:
            break
    if chosen and len(chosen[1]) < 100_000:
        for quality in range(chosen[0] + 3, 96, 3):
            buf = io.BytesIO()
            im.save(buf, format="WEBP", quality=quality, method=6)
            data = buf.getvalue()
            if len(data) > 200_000:
                break
            chosen = (quality, data)
            if len(data) >= 100_000:
                break
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(chosen[1])
    return len(chosen[1]), chosen[0]


def save_thumb(src_path, dest):
    im = Image.open(src_path).convert("RGB").resize((480, 270), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=76, method=6)
    dest.write_bytes(buf.getvalue())
    return len(buf.getvalue())


def preview_image(rgb_orig, labels, centers, comp_merged, dest):
    flat = np.zeros((*labels.shape, 3), dtype=np.uint8)
    rgb_c = lab2rgb(centers.reshape(-1, 1, 3)).reshape(-1, 3)
    rgb8 = np.clip(np.round(rgb_c * 255.0), 0, 255).astype(np.uint8)
    for c in range(rgb8.shape[0]):
        flat[labels == c] = rgb8[c]
    edge = np.zeros(comp_merged.shape, dtype=bool)
    edge[:, 1:] |= comp_merged[:, 1:] != comp_merged[:, :-1]
    edge[1:, :] |= comp_merged[1:, :] != comp_merged[:-1, :]
    flat[edge] = (flat[edge].astype(np.uint16) * 35 // 100).astype(np.uint8)
    side = np.concatenate([rgb_orig, flat], axis=1)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(side).save(dest, quality=85)
    Image.fromarray(flat).save(dest.with_name(dest.stem + "-flat.jpg"), quality=85)


def region_count_for(comp, color_of, centers, min_area, min_r, feature_de=58):
    root = merge_small(comp, color_of, centers, min_area, min_r, feature_de)
    merged = root[comp]
    return int(np.unique(merged).size - (1 if merged.min() == 0 else 0)), root


def fit_count(comp, color_of, centers, preset):
    lo, hi = preset["lo"], preset["hi"]
    min_r = preset["min_r"]
    area = float(preset["area"])
    feature_de = 58.0
    best = None
    for _ in range(12):
        count, root = region_count_for(comp, color_of, centers, area, min_r, feature_de)
        print(f"    area {area:.0f} min_r {min_r:.2f} de {feature_de:.0f} -> {count} regions")
        if best is None or abs(count - (lo + hi) / 2) < abs(best[0] - (lo + hi) / 2):
            if count <= 450:
                best = (count, root, area, min_r)
        if lo <= count <= hi and count <= 450:
            return root, area, min_r, count
        if count > hi or count > 450:
            if area < 700:
                area = min(700.0, area * 1.38)
            else:
                feature_de = min(84.0, feature_de + 8)
        else:
            area = max(16.0, area * 0.66)
            if area <= 16 and min_r > 2.8:
                min_r = max(2.8, min_r - 0.3)
            elif area <= 16:
                break
    if best is None:
        count, root = region_count_for(comp, color_of, centers, area, min_r, feature_de)
        return root, area, min_r, count
    return best[1], best[2], best[3], best[0]


def process(meta, preview):
    picture_id, title, category, difficulty, upload_name = meta
    preset = PRESET[difficulty]
    src = ensure_source(picture_id, upload_name)
    print(f"{picture_id}: quantize")
    _im, rgb = load_work(src)
    centers = pick_palette(rgb, preset["k"], preset["de"], min_colors=16 if difficulty != "leicht" else 14)
    labels, _lab = assign_colors(rgb, centers)
    labels = majority(labels, passes=1)
    labels = dissolve_thin_ink(labels, centers, preset["line"])
    labels = majority(labels, passes=1)
    comp, color_of = label_components(labels)
    initial = int(comp.max())
    print(f"  {centers.shape[0]} colors, {initial} components before merge")
    root, area, min_r, count = fit_count(comp, color_of, centers, preset)
    print(f"  using area {area:.0f} min_r {min_r:.2f} ({count} regions)")
    raw = build_regions(comp, root, color_of, centers)
    colors, regions = pack_picture(raw, centers)
    if not (150 <= len(regions) <= 450):
        print(f"  WARNING {picture_id} region count {len(regions)} outside 150–450", file=sys.stderr)
    if len(regions) < 80:
        raise SystemExit(f"{picture_id} only produced {len(regions)} regions")
    rs = np.array([region["r"] for region in regions], dtype=np.float64)
    payload = {"id": picture_id, "viewBox": VIEWBOX, "ink": True, "reveal": f"/paint/reveal/{picture_id}.webp", "colors": colors, "regions": regions}
    PAINT_DIR.mkdir(parents=True, exist_ok=True)
    out = PAINT_DIR / f"{picture_id}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    reveal_size, reveal_q = save_reveal(src, REVEAL_DIR / f"{picture_id}.webp")
    thumb_size = save_thumb(src, THUMB_DIR / f"{picture_id}.webp")
    stale_svg = THUMB_DIR / f"{picture_id}.svg"
    if stale_svg.exists():
        stale_svg.unlink()
    if preview:
        merged = root[comp]
        # Recolor preview with post-merge colors so it matches the SVG fills.
        shown = labels.copy()
        for src_id in np.unique(merged):
            if src_id == 0:
                continue
            shown[merged == src_id] = np.int16(color_of[int(src_id)])
        preview_image(rgb, shown, centers, merged, PREVIEW_DIR / f"{picture_id}.jpg")
    entry = {
        "id": picture_id,
        "title": title,
        "category": category,
        "difficulty": difficulty,
        "regionCount": len(regions),
        "colorCount": len(colors),
        "viewBox": VIEWBOX,
        "thumb": f"/paint/thumbs/{picture_id}.webp",
        "reveal": f"/paint/reveal/{picture_id}.webp",
        "ink": True,
    }
    print(
        f"  wrote {len(regions)} regions, {len(colors)} colors, "
        f"r p10 {np.percentile(rs, 10):.1f} med {np.median(rs):.1f} min {rs.min():.1f}, "
        f"json {out.stat().st_size // 1024}KB, reveal {reveal_size // 1024}KB q{reveal_q}, thumb {thumb_size // 1024}KB"
    )
    return entry


def write_index(entries):
    INDEX_PATH.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated picture ids")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    wanted = {part for part in args.only.split(",") if part}
    previous = []
    if INDEX_PATH.exists() and wanted:
        previous = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    by_id = {entry["id"]: entry for entry in previous}
    for meta in PICTURES:
        if wanted and meta[0] not in wanted:
            continue
        by_id[meta[0]] = process(meta, preview=args.preview or bool(wanted))
    ordered = [by_id[meta[0]] for meta in PICTURES if meta[0] in by_id]
    write_index(ordered)
    print(f"index {len(ordered)} pictures")


if __name__ == "__main__":
    main()
