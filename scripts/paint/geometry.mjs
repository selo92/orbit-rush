/**
 * Smooth region geometry for Orbit Paint.
 * Angles are degrees, 0 = up, clockwise. Paths are closed SVG.
 */

export function n(v) {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

export function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

export function circlePath(cx, cy, r) {
  return `M ${n(cx - r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)} A ${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)} Z`;
}

export function ringPath(cx, cy, r0, r1) {
  return `M ${n(cx - r1)} ${n(cy)} A ${n(r1)} ${n(r1)} 0 1 1 ${n(cx + r1)} ${n(cy)} A ${n(r1)} ${n(r1)} 0 1 1 ${n(cx - r1)} ${n(cy)} Z M ${n(cx - r0)} ${n(cy)} A ${n(r0)} ${n(r0)} 0 1 0 ${n(cx + r0)} ${n(cy)} A ${n(r0)} ${n(r0)} 0 1 0 ${n(cx - r0)} ${n(cy)} Z`;
}

export function sectorPath(cx, cy, r0, r1, deg0, deg1) {
  let a0 = deg0;
  let a1 = deg1;
  while (a1 <= a0) a1 += 360;
  const span = a1 - a0;
  const large = span > 180 ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  if (r0 < 0.8) {
    return `M ${n(cx)} ${n(cy)} L ${n(x0)} ${n(y0)} A ${n(r1)} ${n(r1)} 0 ${large} 1 ${n(x1)} ${n(y1)} Z`;
  }
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M ${n(x0)} ${n(y0)} A ${n(r1)} ${n(r1)} 0 ${large} 1 ${n(x1)} ${n(y1)} L ${n(x2)} ${n(y2)} A ${n(r0)} ${n(r0)} 0 ${large} 0 ${n(x3)} ${n(y3)} Z`;
}

export function sectorLabel(cx, cy, r0, r1, deg0, deg1, bias = 0.5) {
  let a0 = deg0;
  let a1 = deg1;
  while (a1 <= a0) a1 += 360;
  const mid = (a0 + a1) / 2;
  const rm = r0 + (r1 - r0) * bias;
  const [x, y] = polar(cx, cy, rm, mid);
  const span = ((a1 - a0) * Math.PI) / 180;
  const radial = Math.min(rm - r0, r1 - rm) * 0.92;
  const tang = rm * span * 0.42;
  return { x, y, r: Math.min(radial, tang) };
}

export function petalPath(cx, cy, r0, r1, deg, spread) {
  const tip = polar(cx, cy, r1, deg);
  const bl = polar(cx, cy, r0, deg - spread * 0.92);
  const br = polar(cx, cy, r0, deg + spread * 0.92);
  const cl = polar(cx, cy, r0 + (r1 - r0) * 0.42, deg - spread * 1.28);
  const cr = polar(cx, cy, r0 + (r1 - r0) * 0.42, deg + spread * 1.28);
  const tl = polar(cx, cy, r0 + (r1 - r0) * 0.84, deg - spread * 0.42);
  const tr = polar(cx, cy, r0 + (r1 - r0) * 0.84, deg + spread * 0.42);
  return `M ${n(bl[0])} ${n(bl[1])} C ${n(cl[0])} ${n(cl[1])} ${n(tl[0])} ${n(tl[1])} ${n(tip[0])} ${n(tip[1])} C ${n(tr[0])} ${n(tr[1])} ${n(cr[0])} ${n(cr[1])} ${n(br[0])} ${n(br[1])} Z`;
}

export function petalLabel(cx, cy, r0, r1, deg, spread) {
  const rm = r0 + (r1 - r0) * 0.56;
  const [x, y] = polar(cx, cy, rm, deg);
  const halfWidth = rm * Math.sin((spread * Math.PI) / 180);
  const radial = (r1 - r0) * 0.24;
  return { x, y, r: Math.min(halfWidth * 0.78, radial) };
}

export function smoothClosed(pts, tension = 0.22) {
  const count = pts.length;
  let d = `M ${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 0; i < count; i++) {
    const p0 = pts[(i - 1 + count) % count];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % count];
    const p3 = pts[(i + 2) % count];
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C ${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d} Z`;
}

export function polyPath(pts) {
  return `M ${pts.map((p) => `${n(p[0])} ${n(p[1])}`).join(' L ')} Z`;
}

export function ellipsePoints(cx, cy, rx, ry, rotDeg = 0, count = 28) {
  const rot = (rotDeg * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push([
      cx + x * Math.cos(rot) - y * Math.sin(rot),
      cy + x * Math.sin(rot) + y * Math.cos(rot),
    ]);
  }
  return pts;
}

export function centroid(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function inradius(pts, x, y) {
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    min = Math.min(min, distToSeg(x, y, a[0], a[1], b[0], b[1]));
  }
  return min;
}

export function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  return `M ${n(x + rr)} ${n(y)} H ${n(x + w - rr)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(x + w)} ${n(y + rr)} V ${n(y + h - rr)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(x + w - rr)} ${n(y + h)} H ${n(x + rr)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(x)} ${n(y + h - rr)} V ${n(y + rr)} A ${n(rr)} ${n(rr)} 0 0 1 ${n(x + rr)} ${n(y)} Z`;
}

export function archPath(x, y, w, h) {
  const r = w / 2;
  const body = Math.max(h, r + 8);
  return `M ${n(x)} ${n(y + body)} L ${n(x)} ${n(y + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(x + w)} ${n(y + r)} L ${n(x + w)} ${n(y + body)} Z`;
}

export function ribbonPoints(points, w0, w1 = w0) {
  const left = [];
  const right = [];
  const last = points.length - 1;
  for (let i = 0; i <= last; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(last, i + 1)];
    let dx = next[0] - prev[0];
    let dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const w = w0 + (w1 - w0) * (last === 0 ? 0 : i / last);
    left.push([points[i][0] + -dy * w * 0.5, points[i][1] + dx * w * 0.5]);
    right.push([points[i][0] - -dy * w * 0.5, points[i][1] - dx * w * 0.5]);
  }
  return left.concat(right.reverse());
}

export function waveBand(x0, x1, y0, y1, amp, freq, phase, steps = 16) {
  const top = [];
  const bot = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const wave = Math.sin(t * Math.PI * 2 * freq + phase);
    top.push([x, y0 + wave * amp]);
    bot.push([x, y1 + wave * amp * 0.55]);
  }
  return top.concat(bot.reverse());
}

export class Art {
  constructor({ id, title, category, difficulty, w = 1000, h = 1000 }) {
    this.id = id;
    this.title = title;
    this.category = category;
    this.difficulty = difficulty;
    this.w = w;
    this.h = h;
    this.colors = [];
    this.regions = [];
  }

  col(hex, name) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`${this.id} bad hex ${hex}`);
    this.colors.push({ hex, name });
    return this.colors.length;
  }

  add(color, d, x, y, r) {
    if (!Number.isInteger(color) || color < 1 || color > this.colors.length) {
      throw new Error(`${this.id} bad color ${color}`);
    }
    if (!(r >= 5.2)) {
      throw new Error(`${this.id} region r=${Number(r).toFixed(1)} at ${x.toFixed(0)},${y.toFixed(0)}`);
    }
    this.regions.push({
      n: color,
      d,
      x: n(x),
      y: n(y),
      r: n(r),
    });
  }

  circle(color, cx, cy, r) {
    this.add(color, circlePath(cx, cy, r), cx, cy, r * 0.62);
  }

  sector(color, cx, cy, r0, r1, deg0, deg1, bias = 0.5) {
    const lab = sectorLabel(cx, cy, r0, r1, deg0, deg1, bias);
    this.add(color, sectorPath(cx, cy, r0, r1, deg0, deg1), lab.x, lab.y, lab.r);
  }

  petal(color, cx, cy, r0, r1, deg, spread) {
    const lab = petalLabel(cx, cy, r0, r1, deg, spread);
    this.add(color, petalPath(cx, cy, r0, r1, deg, spread), lab.x, lab.y, lab.r);
  }

  smooth(color, pts, labelR) {
    const [x, y] = centroid(pts);
    const r = labelR ?? inradius(pts, x, y) * 0.82;
    this.add(color, smoothClosed(pts), x, y, r);
  }

  poly(color, pts, x, y, r) {
    const c = x == null ? centroid(pts) : [x, y];
    const rr = r ?? inradius(pts, c[0], c[1]) * 0.8;
    this.add(color, polyPath(pts), c[0], c[1], rr);
  }

  ellipse(color, cx, cy, rx, ry, rot = 0, labelR) {
    const pts = ellipsePoints(cx, cy, rx, ry, rot, 32);
    this.add(color, smoothClosed(pts), cx, cy, labelR ?? Math.min(rx, ry) * 0.62);
  }

  roundRect(color, x, y, w, h, radius, lx, ly, lr) {
    this.add(
      color,
      roundRectPath(x, y, w, h, radius),
      lx ?? x + w / 2,
      ly ?? y + h / 2,
      lr ?? Math.min(w, h) * 0.32
    );
  }

  arch(color, x, y, w, h, lr) {
    this.add(color, archPath(x, y, w, h), x + w / 2, y + h * 0.62, lr ?? Math.min(w * 0.32, h * 0.22));
  }

  ribbon(color, points, w0, w1, labelAt = 0.5, labelR) {
    const loop = ribbonPoints(points, w0, w1 ?? w0);
    const i = Math.min(points.length - 1, Math.max(0, Math.round(labelAt * (points.length - 1))));
    const width = w0 + ((w1 ?? w0) - w0) * labelAt;
    this.add(color, smoothClosed(loop, 0.16), points[i][0], points[i][1], labelR ?? width * 0.32);
  }

  diamond(color, cx, cy, rMid, deg, rad, tanDeg) {
    const pts = [
      polar(cx, cy, rMid + rad, deg),
      polar(cx, cy, rMid, deg + tanDeg),
      polar(cx, cy, rMid - rad, deg),
      polar(cx, cy, rMid, deg - tanDeg),
    ];
    const [x, y] = polar(cx, cy, rMid, deg);
    const tang = rMid * Math.sin((tanDeg * Math.PI) / 180);
    this.add(color, polyPath(pts), x, y, Math.min(rad, tang) * 0.55);
  }

  corners(color, cx, cy, R) {
    const w = this.w;
    const h = this.h;
    const paths = [
      `M 0 0 L ${n(cx)} 0 L ${n(cx)} ${n(cy - R)} A ${n(R)} ${n(R)} 0 0 0 ${n(cx - R)} ${n(cy)} L 0 ${n(cy)} Z`,
      `M ${n(w)} 0 L ${n(w)} ${n(cy)} L ${n(cx + R)} ${n(cy)} A ${n(R)} ${n(R)} 0 0 0 ${n(cx)} ${n(cy - R)} L ${n(cx)} 0 Z`,
      `M ${n(w)} ${n(h)} L ${n(cx)} ${n(h)} L ${n(cx)} ${n(cy + R)} A ${n(R)} ${n(R)} 0 0 0 ${n(cx + R)} ${n(cy)} L ${n(w)} ${n(cy)} Z`,
      `M 0 ${n(h)} L 0 ${n(cy)} L ${n(cx - R)} ${n(cy)} A ${n(R)} ${n(R)} 0 0 0 ${n(cx)} ${n(cy + R)} L ${n(cx)} ${n(h)} Z`,
    ];
    const inset = 86;
    const labels = [
      [inset, inset],
      [w - inset, inset],
      [w - inset, h - inset],
      [inset, h - inset],
    ];
    const pocket = Math.hypot(cx - inset, cy - inset) - R;
    const lr = Math.max(18, Math.min(42, pocket * 0.28));
    paths.forEach((d, i) => this.add(color, d, labels[i][0], labels[i][1], lr));
  }
}
