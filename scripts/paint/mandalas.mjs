import { Art, polar, ringPath } from './geometry.mjs';

function alt(a, b) {
  return (C, i) => (i % 2 === 0 ? C[a] : C[b]);
}

function tri(a, b, c) {
  return (C, i) => C[[a, b, c][i % 3]];
}

function pick(C, color, i) {
  if (typeof color === 'function') return color(C, i);
  return C[color];
}

/**
 * Concentric stained-glass mandala. Petals and gems sit inside a halo
 * sector so every region keeps a visible, numbered patch.
 */
function buildMandala(spec) {
  const art = new Art(spec);
  const C = {};
  for (const [key, hex, name] of spec.palette) C[key] = art.col(hex, name);
  const cx = art.w / 2;
  const cy = art.h / 2;
  const outer = spec.outer;
  art.corners(C.margin, cx, cy, outer);

  let r = spec.disk;
  const ringThick = Math.max(16, r * 0.36);
  const hole = r - ringThick;
  art.add(
    C[spec.coreColor],
    ringPath(cx, cy, hole, r),
    cx,
    cy - (hole + r) / 2,
    ringThick * 0.42
  );
  art.circle(C[spec.diskColor], cx, cy, hole * 0.86);

  const folds = spec.folds;
  for (const layer of spec.layers) {
    const count = layer.n || folds;
    const step = 360 / count;
    const shift = (layer.half ? step / 2 : 0) + (layer.rot || 0);
    if (layer.type === 'ring') {
      const r0 = r;
      const r1 = r + layer.t;
      for (let i = 0; i < count; i++) {
        const a0 = shift + i * step;
        art.sector(pick(C, layer.color, i), cx, cy, r0, r1, a0, a0 + step, layer.bias || 0.5);
      }
      r = r1;
    } else if (layer.type === 'petals') {
      const halo = layer.halo ?? Math.max(26, layer.t * 0.4);
      const rPetal = r + layer.t;
      const r1 = rPetal + halo;
      const spread = step * (layer.spread || 0.33);
      for (let i = 0; i < count; i++) {
        const deg = shift + i * step;
        art.sector(pick(C, layer.cup, i), cx, cy, r, r1, deg - step / 2, deg + step / 2, 0.78);
      }
      for (let i = 0; i < count; i++) {
        const deg = shift + i * step;
        art.petal(pick(C, layer.color, i), cx, cy, r + (layer.gap || 2), rPetal, deg, spread);
      }
      r = r1;
    } else if (layer.type === 'beads') {
      const r0 = r;
      const r1 = r + layer.t;
      const mid = r0 + (r1 - r0) * 0.4;
      const beadR = layer.bead;
      for (let i = 0; i < count; i++) {
        const deg = shift + i * step;
        art.sector(pick(C, layer.cup, i), cx, cy, r0, r1, deg - step / 2, deg + step / 2, 0.8);
        const [bx, by] = polar(cx, cy, mid, deg);
        art.circle(pick(C, layer.color, i), bx, by, beadR);
      }
      r = r1;
    } else if (layer.type === 'gems') {
      const r0 = r;
      const r1 = r + layer.t;
      const mid = r0 + (r1 - r0) * 0.42;
      for (let i = 0; i < count; i++) {
        const deg = shift + i * step;
        art.sector(pick(C, layer.cup, i), cx, cy, r0, r1, deg - step / 2, deg + step / 2, 0.8);
        art.diamond(pick(C, layer.color, i), cx, cy, mid, deg, layer.rad, layer.tan || step * 0.28);
      }
      r = r1;
    } else {
      throw new Error(`unknown layer ${layer.type}`);
    }
    if (r > outer + 0.5) {
      throw new Error(`${spec.id} layer overflow ${r.toFixed(1)} > ${outer}`);
    }
  }
  return art;
}

const NIGHT = ['margin', '#241428', 'Nacht'];

export function mandalas() {
  return [
    buildMandala({
      id: 'lotus',
      title: 'Lotusmandala',
      category: 'mandala',
      difficulty: 'leicht',
      w: 1000,
      h: 1000,
      outer: 476,
      disk: 42,
      diskColor: 'gold',
      coreColor: 'cream',
      folds: 8,
      palette: [
        NIGHT,
        ['plum', '#6d3158', 'Pflaume'],
        ['rose', '#e25b86', 'Rose'],
        ['blush', '#ffc0d0', 'Blüte'],
        ['cream', '#fff3e4', 'Creme'],
        ['gold', '#e8b84a', 'Gold'],
        ['sage', '#8fbf96', 'Salbei'],
        ['leaf', '#2f6d4c', 'Blatt'],
      ],
      layers: [
        { type: 'petals', t: 58, halo: 24, color: 'rose', cup: 'plum', spread: 0.34 },
        { type: 'beads', t: 58, bead: 13, color: 'gold', cup: 'blush' },
        { type: 'ring', t: 34, n: 16, color: alt('sage', 'leaf') },
        { type: 'petals', t: 78, halo: 28, half: true, color: 'blush', cup: 'rose', spread: 0.32 },
        { type: 'gems', t: 46, rad: 14, tan: 9, color: 'gold', cup: 'cream' },
        { type: 'petals', t: 62, halo: 24, color: 'sage', cup: 'leaf', spread: 0.3 },
        { type: 'ring', t: 22, n: 16, half: true, color: alt('gold', 'plum') },
      ],
    }),
    buildMandala({
      id: 'sonne',
      title: 'Sonnenrad',
      category: 'mandala',
      difficulty: 'mittel',
      w: 1000,
      h: 1000,
      outer: 478,
      disk: 34,
      diskColor: 'cream',
      coreColor: 'gold',
      folds: 12,
      palette: [
        ['margin', '#3a1c10', 'Abend'],
        ['rust', '#c24e28', 'Rost'],
        ['tangerine', '#ff8b3d', 'Mandarine'],
        ['gold', '#ffc857', 'Gold'],
        ['cream', '#fff1cc', 'Creme'],
        ['amber', '#e39b16', 'Bernstein'],
        ['coral', '#ff6d6d', 'Koralle'],
        ['clay', '#8a3d2c', 'Ton'],
      ],
      layers: [
        { type: 'ring', t: 28, color: alt('tangerine', 'coral') },
        { type: 'petals', t: 52, halo: 22, color: 'gold', cup: 'rust', spread: 0.34 },
        { type: 'beads', t: 50, bead: 11, half: true, color: 'cream', cup: 'amber' },
        { type: 'petals', t: 64, halo: 24, color: 'tangerine', cup: 'clay', spread: 0.31 },
        { type: 'ring', t: 26, n: 24, color: alt('gold', 'rust') },
        { type: 'gems', t: 42, rad: 13, tan: 7, half: true, color: 'cream', cup: 'coral' },
        { type: 'petals', t: 60, halo: 24, color: 'gold', cup: 'amber', spread: 0.3 },
        { type: 'beads', t: 34, bead: 9, n: 24, color: 'tangerine', cup: 'clay' },
        { type: 'ring', t: 18, n: 24, half: true, color: tri('coral', 'gold', 'rust') },
      ],
    }),
    buildMandala({
      id: 'nachtstern',
      title: 'Nachtstern',
      category: 'mandala',
      difficulty: 'schwer',
      w: 1000,
      h: 1000,
      outer: 472,
      disk: 28,
      diskColor: 'ice',
      coreColor: 'silver',
      folds: 16,
      palette: [
        ['margin', '#100818', 'All'],
        ['indigo', '#2a1b6e', 'Indigo'],
        ['violet', '#7a5cff', 'Violett'],
        ['lilac', '#d2c4ff', 'Flieder'],
        ['ice', '#e7f3ff', 'Eis'],
        ['silver', '#b7c3d4', 'Silber'],
        ['magenta', '#d946ef', 'Magenta'],
        ['navy', '#1a2748', 'Nachtblau'],
      ],
      layers: [
        { type: 'petals', t: 40, halo: 20, color: 'violet', cup: 'indigo', spread: 0.44 },
        { type: 'beads', t: 40, bead: 9, color: 'ice', cup: 'navy' },
        { type: 'ring', t: 22, n: 32, color: alt('magenta', 'indigo') },
        { type: 'gems', t: 44, rad: 12, tan: 6, half: true, color: 'silver', cup: 'violet' },
        { type: 'petals', t: 48, halo: 20, color: 'lilac', cup: 'navy', spread: 0.3 },
        { type: 'beads', t: 38, bead: 11, n: 32, half: true, color: 'ice', cup: 'magenta' },
        { type: 'ring', t: 20, n: 32, color: tri('silver', 'violet', 'indigo') },
        { type: 'petals', t: 52, halo: 20, half: true, color: 'violet', cup: 'indigo', spread: 0.28 },
        { type: 'gems', t: 42, rad: 11, tan: 5.5, n: 32, color: 'ice', cup: 'navy' },
        { type: 'ring', t: 22, n: 32, half: true, color: alt('magenta', 'lilac') },
      ],
    }),
    buildMandala({
      id: 'kristall',
      title: 'Kristallrose',
      category: 'mandala',
      difficulty: 'mittel',
      w: 1000,
      h: 1000,
      outer: 476,
      disk: 32,
      diskColor: 'gold',
      coreColor: 'ivory',
      folds: 10,
      palette: [
        ['margin', '#102e2a', 'Tanne'],
        ['emerald', '#1c8f72', 'Smaragd'],
        ['mint', '#b6f0d4', 'Minze'],
        ['gold', '#e4c16a', 'Gold'],
        ['ivory', '#f8f3e6', 'Elfenbein'],
        ['rose', '#f0a8b8', 'Rose'],
        ['jade', '#0e5c4c', 'Jade'],
        ['aqua', '#63d4c4', 'Aqua'],
      ],
      layers: [
        { type: 'petals', t: 48, halo: 20, color: 'rose', cup: 'jade', spread: 0.34 },
        { type: 'ring', t: 26, n: 20, color: alt('mint', 'emerald') },
        { type: 'gems', t: 50, rad: 14, tan: 8, half: true, color: 'gold', cup: 'ivory' },
        { type: 'petals', t: 62, halo: 24, color: 'aqua', cup: 'emerald', spread: 0.32 },
        { type: 'beads', t: 48, bead: 11, color: 'ivory', cup: 'rose' },
        { type: 'petals', t: 68, halo: 24, half: true, color: 'mint', cup: 'jade', spread: 0.3 },
        { type: 'ring', t: 24, n: 20, color: alt('gold', 'emerald') },
        { type: 'gems', t: 40, rad: 11, tan: 7, n: 20, half: true, color: 'rose', cup: 'aqua' },
      ],
    }),
    buildMandala({
      id: 'orbitrose',
      title: 'Orbitrose',
      category: 'mandala',
      difficulty: 'schwer',
      w: 1000,
      h: 1000,
      outer: 476,
      disk: 28,
      diskColor: 'gold',
      coreColor: 'white',
      folds: 12,
      palette: [
        ['margin', '#160818', 'Leere'],
        ['cyan', '#3ecbff', 'Cyan'],
        ['magenta', '#ff2bd6', 'Magenta'],
        ['gold', '#ffe566', 'Gold'],
        ['white', '#f4f7ff', 'Weiss'],
        ['navy', '#2a1458', 'Nacht'],
        ['orchid', '#c9a6ff', 'Orchidee'],
        ['teal', '#149eae', 'Türkis'],
      ],
      layers: [
        { type: 'ring', t: 24, color: alt('cyan', 'magenta') },
        { type: 'petals', t: 46, halo: 18, color: 'white', cup: 'navy', spread: 0.33 },
        { type: 'beads', t: 42, bead: 10, half: true, color: 'gold', cup: 'teal' },
        { type: 'petals', t: 54, halo: 20, color: 'cyan', cup: 'magenta', spread: 0.31 },
        { type: 'gems', t: 44, rad: 12, tan: 7, n: 24, color: 'orchid', cup: 'navy' },
        { type: 'ring', t: 22, n: 24, half: true, color: tri('gold', 'cyan', 'magenta') },
        { type: 'petals', t: 48, halo: 20, half: true, color: 'magenta', cup: 'navy', spread: 0.29 },
        { type: 'beads', t: 36, bead: 9, n: 24, color: 'white', cup: 'teal' },
        { type: 'petals', t: 42, halo: 18, color: 'gold', cup: 'orchid', spread: 0.28 },
        { type: 'ring', t: 14, n: 24, color: alt('cyan', 'navy') },
      ],
    }),
  ];
}
