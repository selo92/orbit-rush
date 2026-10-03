import { Art, archPath, ellipsePoints, polar, smoothClosed, waveBand } from './geometry.mjs';

function shape(art, color, pts, x, y, r) {
  art.add(color, smoothClosed(pts), x, y, r);
}

function bands(art, x0, x1, rows) {
  for (let i = 0; i < rows.length - 1; i++) {
    const row = rows[i];
    const y0 = row.y;
    const y1 = rows[i + 1].y;
    const pts = waveBand(x0, x1, y0, y1, row.amp ?? 18, row.freq ?? 1.15, row.phase ?? i * 0.8, 14);
    art.poly(row.color, pts, (x0 + x1) / 2, (y0 + y1) / 2, Math.min(36, (y1 - y0) * 0.3));
  }
}

function bloom(art, petal, heart, x, y, petals, inner, outer, rot = 0) {
  const innerR = Math.max(inner, 14);
  const outerR = Math.max(outer, innerR + 30);
  const step = 360 / petals;
  const spread = step * 0.38;
  for (let i = 0; i < petals; i++) {
    art.petal(petal, x, y, innerR, outerR, rot + i * step, spread);
  }
  art.circle(heart, x, y, innerR * 0.78);
}

function cloud(art, color, x, y, s = 1) {
  art.circle(color, x, y, 28 * s);
  art.circle(color, x - 26 * s, y + 8 * s, 20 * s);
  art.circle(color, x + 30 * s, y + 6 * s, 22 * s);
}

function eye(art, white, iris, x, y, tilt = 0) {
  art.ellipse(white, x, y, 28, 20, tilt, 12);
  art.circle(iris, x + 2, y + 1, 12);
}

function brow(art, color, x, y, flip = 1) {
  shape(
    art,
    color,
    [
      [x - 26 * flip, y + 4],
      [x - 8 * flip, y - 8],
      [x + 16 * flip, y - 6],
      [x + 24 * flip, y],
      [x + 6 * flip, y + 8],
      [x - 12 * flip, y + 8],
    ],
    x,
    y,
    8
  );
}

function lock(art, color, x, y, len, bend, w0, w1) {
  const pts = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([x + Math.sin(t * Math.PI) * bend, y + t * len]);
  }
  const width = w0 + (w1 - w0) * 0.55;
  art.ribbon(color, pts, w0, w1, 0.55, Math.max(7, width * 0.42));
}

function gown(art, cloth, lite, dark, x, waist, hem, waistW, hemW, gores) {
  shape(
    art,
    cloth,
    [
      [x - waistW * 0.55, waist - 70],
      [x + waistW * 0.55, waist - 70],
      [x + waistW * 0.7, waist],
      [x + hemW / 2, hem],
      [x + hemW * 0.2, hem + 28],
      [x, hem + 8],
      [x - hemW * 0.2, hem + 28],
      [x - hemW / 2, hem],
      [x - waistW * 0.7, waist],
    ],
    x,
    waist - 28,
    22
  );
  for (let i = 0; i < gores; i++) {
    const t0 = (i + 0.12) / gores;
    const t1 = (i + 0.88) / gores;
    const left = (t) => x - waistW / 2 + waistW * t;
    const right = (t) => x - hemW / 2 + hemW * t;
    const color = i % 2 === 0 ? lite : dark;
    shape(
      art,
      color,
      [
        [left(t0), waist + 8],
        [left(t1), waist + 8],
        [right(t1), hem - 6],
        [right(t0), hem - 6],
      ],
      (right(t0) + right(t1)) / 2,
      waist + (hem - waist) * 0.62,
      Math.max(8, ((right(t1) - right(t0)) * 0.28))
    );
  }
}

export function scenes() {
  return [hana(), ren(), momo(), laterne(), kirsche(), schloss(), prinzessin(), fuchs(), drache(), einhorn(), wald()];
}

function hana() {
  const art = new Art({
    id: 'hana',
    title: 'Hana',
    category: 'manga',
    difficulty: 'mittel',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#f7c5d6', 'Himmel');
  const mist = art.col('#f29ab8', 'Dunst');
  const blushSky = art.col('#ffe4ee', 'Wolke');
  const hill = art.col('#7dba72', 'Hügel');
  const hill2 = art.col('#3f8d55', 'Wiese');
  const ground = art.col('#c4ec9a', 'Gras');
  const trunk = art.col('#8d5a3c', 'Stamm');
  const petal = art.col('#ff7aa8', 'Blüte');
  const heart = art.col('#ffe07a', 'Herz');
  const skin = art.col('#ffd0b4', 'Haut');
  const hair = art.col('#3a2238', 'Haar');
  const hairL = art.col('#8a4d6e', 'Glanz');
  const eyeC = art.col('#5b3480', 'Auge');
  const white = art.col('#fff8fb', 'Weiss');
  const dress = art.col('#ff4f86', 'Kleid');
  const dressL = art.col('#ffd0e2', 'Falte');
  const dressD = art.col('#c43166', 'Schatten');
  const ribbon = art.col('#ffd24a', 'Schleife');
  const shoe = art.col('#3a2a44', 'Schuh');

  bands(art, 0, 900, [
    { y: 0, color: sky, amp: 22, phase: 0.2 },
    { y: 180, color: mist, amp: 26, phase: 1.1 },
    { y: 340, color: blushSky, amp: 20, phase: 0.4 },
    { y: 520, color: hill, amp: 28, phase: 0.8 },
    { y: 760, color: hill2, amp: 18, phase: 1.4 },
    { y: 1200, color: ground },
  ]);
  art.circle(heart, 140, 120, 54);
  cloud(art, white, 680, 150, 1.15);
  cloud(art, white, 250, 230, 0.9);

  art.ribbon(trunk, [[150, 980], [180, 720], [210, 520], [250, 360]], 34, 18, 0.35);
  art.ribbon(trunk, [[230, 460], [320, 400], [430, 360]], 16, 10, 0.5, 8);
  art.ribbon(trunk, [[200, 560], [300, 520], [390, 470]], 14, 9, 0.55, 7);

  const flowers = [
    [120, 300, 0], [250, 280, 12], [360, 330, 20], [180, 420, -8],
    [300, 390, 16], [430, 300, 4], [90, 500, 18], [340, 470, -12],
    [470, 420, 8], [160, 620, 22], [260, 700, -6], [390, 640, 14],
  ];
  for (const [x, y, rot] of flowers) bloom(art, petal, heart, x, y, 5, 14, 40, rot);

  for (let i = 0; i < 8; i++) {
    const x = 80 + i * 48;
    art.ellipse(petal, x, 860 + (i % 3) * 18, 16, 10, -20 + i * 8, 7);
  }

  const x = 640;
  const y = 430;
  shape(art, hair, [
    [x, y - 150], [x + 90, y - 110], [x + 120, y - 20], [x + 100, y + 120],
    [x + 40, y + 40], [x, y + 10], [x - 40, y + 40], [x - 100, y + 130],
    [x - 120, y - 10], [x - 80, y - 120],
  ], x, y - 120, 28);
  lock(art, hairL, x - 90, y - 20, 180, -26, 28, 16);
  lock(art, hairL, x + 90, y - 10, 190, 24, 28, 16);
  lock(art, hair, x - 40, y - 130, 70, -10, 26, 14);
  lock(art, hair, x + 10, y - 140, 64, 6, 24, 14);
  lock(art, hair, x + 48, y - 120, 78, 16, 22, 12);
  art.ellipse(skin, x, y, 78, 90, 0, 36);
  brow(art, hair, x - 32, y - 28, 1);
  brow(art, hair, x + 32, y - 28, -1);
  eye(art, white, eyeC, x - 30, y - 4, -8);
  eye(art, white, eyeC, x + 30, y - 4, 8);
  art.circle(petal, x - 46, y + 28, 14);
  art.circle(petal, x + 46, y + 28, 14);
  art.ribbon(dressD, [[x - 16, y + 58], [x, y + 70], [x + 18, y + 56]], 16, 12, 0.5, 7);
  gown(art, dress, dressL, dressD, x, y + 150, y + 430, 120, 250, 5);
  art.ellipse(skin, x - 110, y + 170, 22, 48, 18, 12);
  art.ellipse(skin, x + 110, y + 170, 22, 48, -18, 12);
  art.circle(skin, x - 130, y + 230, 16);
  art.circle(skin, x + 130, y + 230, 16);
  bloom(art, petal, heart, x + 128, y + 228, 6, 12, 34, 8);
  shape(art, ribbon, [
    [x - 70, y + 130], [x - 110, y + 100], [x - 90, y + 160], [x - 50, y + 140],
  ], x - 84, y + 132, 12);
  shape(art, ribbon, [
    [x + 70, y + 130], [x + 114, y + 102], [x + 92, y + 164], [x + 48, y + 140],
  ], x + 84, y + 132, 12);
  art.circle(ribbon, x, y + 136, 14);
  art.ellipse(shoe, x - 46, y + 455, 28, 14, 0, 10);
  art.ellipse(shoe, x + 46, y + 455, 28, 14, 0, 10);
  return art;
}

function ren() {
  const art = new Art({
    id: 'ren',
    title: 'Ren',
    category: 'manga',
    difficulty: 'mittel',
    w: 900,
    h: 1200,
  });
  const night = art.col('#1b1440', 'Nacht');
  const dusk = art.col('#3a2a78', 'Dämmerung');
  const deep = art.col('#120e28', 'Himmel');
  const moon = art.col('#f4f0ff', 'Mond');
  const win = art.col('#ffd56a', 'Licht');
  const sign = art.col('#ff4fa3', 'Neon');
  const city = art.col('#2a3358', 'Haus');
  const city2 = art.col('#3d4c7a', 'Fassade');
  const road = art.col('#232033', 'Strasse');
  const skin = art.col('#f0c2a4', 'Haut');
  const hair = art.col('#1d1a24', 'Haar');
  const hairL = art.col('#6a5cff', 'Strähne');
  const eyeC = art.col('#2146c8', 'Auge');
  const white = art.col('#f7fbff', 'Weiss');
  const jacket = art.col('#242838', 'Jacke');
  const jacketL = art.col('#3e465c', 'Aufschlag');
  const scarf = art.col('#ff4b4b', 'Schal');
  const scarfD = art.col('#ffd1a8', 'Streifen');
  const pant = art.col('#1a1e2e', 'Hose');
  const shoe = art.col('#111018', 'Schuh');

  bands(art, 0, 900, [
    { y: 0, color: deep, amp: 16 },
    { y: 220, color: night, amp: 24, phase: 0.6 },
    { y: 460, color: dusk, amp: 20, phase: 1.2 },
    { y: 820, color: road, amp: 12 },
    { y: 1200, color: road },
  ]);
  art.circle(moon, 700, 120, 48);
  art.circle(win, 688, 108, 12);
  for (let i = 0; i < 16; i++) {
    const x = 40 + (i * 83) % 640;
    const y = 40 + ((i * 47) % 180);
    art.circle(moon, x, y, 10);
  }

  const blocks = [
    [40, 520, 110, 300, city, 3],
    [160, 460, 130, 360, city2, 4],
    [300, 500, 100, 320, city, 3],
    [410, 430, 150, 390, city2, 4],
    [570, 490, 120, 330, city, 3],
    [700, 540, 160, 280, city2, 3],
  ];
  for (const [x, y, w, h, color, lights] of blocks) {
    art.roundRect(color, x, y, w, h, 10, x + w / 2, y + 36, 16);
    art.roundRect(sign, x + 16, y + 16, w - 32, 22, 8, x + w / 2, y + 27, 8);
    for (let i = 0; i < lights; i++) {
      art.circle(i % 2 ? win : moon, x + 28 + (i % 2) * 36, y + 70 + Math.floor(i / 2) * 48, 12);
    }
  }

  const x = 450;
  const y = 690;
  for (let i = 0; i < 7; i++) {
    const deg = -70 + i * 22;
    const [tx, ty] = polar(x, y - 20, 108, deg);
    shape(art, i % 2 ? hairL : hair, [
      [x + (i - 3) * 16, y - 20],
      [tx - 16, ty + 10],
      [tx, ty - 8],
      [tx + 18, ty + 16],
    ], (x + tx) / 2, (y - 30 + ty) / 2, 10);
  }
  art.ellipse(skin, x, y + 10, 70, 82, 0, 34);
  brow(art, hair, x - 28, y - 16, 1);
  brow(art, hair, x + 28, y - 16, -1);
  eye(art, white, eyeC, x - 26, y + 6, -6);
  eye(art, white, eyeC, x + 26, y + 6, 6);
  art.ribbon(scarfD, [[x - 10, y + 70], [x + 8, y + 84], [x + 18, y + 72]], 18, 12, 0.5, 7);
  art.roundRect(jacket, x - 90, y + 100, 180, 210, 28, x, y + 150, 28);
  art.roundRect(jacketL, x - 28, y + 110, 56, 180, 12, x, y + 200, 14);
  for (let i = 0; i < 4; i++) {
    art.roundRect(i % 2 ? scarf : scarfD, x - 70, y + 118 + i * 28, 50, 22, 8, x - 45, y + 129 + i * 28, 8);
    art.roundRect(i % 2 ? scarfD : scarf, x + 20, y + 118 + i * 28, 50, 22, 8, x + 45, y + 129 + i * 28, 8);
  }
  art.ribbon(scarf, [[x - 20, y + 96], [x - 80, y + 150], [x - 120, y + 240]], 28, 18, 0.6);
  art.ellipse(pant, x - 40, y + 330, 32, 70, 4, 16);
  art.ellipse(pant, x + 40, y + 330, 32, 70, -4, 16);
  art.ellipse(shoe, x - 46, y + 410, 30, 14, 0, 10);
  art.ellipse(shoe, x + 46, y + 410, 30, 14, 0, 10);
  return art;
}

function momo() {
  const art = new Art({
    id: 'momo',
    title: 'Momo',
    category: 'manga',
    difficulty: 'leicht',
    w: 900,
    h: 1200,
  });
  const indigo = art.col('#24315f', 'Indigo');
  const wave = art.col('#3e6fd8', 'Welle');
  const foam = art.col('#d7e6ff', 'Schaum');
  const gold = art.col('#f0c14d', 'Gold');
  const skin = art.col('#ffd2ba', 'Haut');
  const hair = art.col('#2a1c18', 'Haar');
  const hairL = art.col('#c4493a', 'Band');
  const eyeC = art.col('#7a2d3c', 'Auge');
  const white = art.col('#fffaf6', 'Weiss');
  const cloth = art.col('#f6f1e6', 'Kimono');
  const flower = art.col('#ee6d8a', 'Blume');
  const leaf = art.col('#3e9a62', 'Blatt');
  const obi = art.col('#8e2f45', 'Obi');
  const obiL = art.col('#e7b3c0', 'Knoten');

  bands(art, 0, 900, [
    { y: 0, color: indigo, amp: 20 },
    { y: 260, color: wave, amp: 30, phase: 0.4 },
    { y: 520, color: foam, amp: 24, phase: 1 },
    { y: 780, color: wave, amp: 28, phase: 0.2 },
    { y: 1200, color: indigo },
  ]);
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 5; i++) {
      const cx = 90 + i * 180 + (row % 2) * 40;
      const cy = 80 + row * 140;
      art.sector(row % 2 === 0 ? foam : gold, cx, cy, 20, 62, 200, 340, 0.55);
    }
  }

  const x = 450;
  const y = 470;
  art.circle(hair, x - 120, y - 70, 54);
  art.circle(hair, x + 120, y - 70, 54);
  art.circle(hairL, x - 120, y - 78, 18);
  art.circle(hairL, x + 120, y - 78, 18);
  shape(art, hair, [
    [x, y - 150], [x + 110, y - 90], [x + 90, y + 20], [x + 30, y - 10],
    [x, y + 20], [x - 30, y - 10], [x - 90, y + 20], [x - 110, y - 90],
  ], x, y - 110, 26);
  art.ellipse(skin, x, y, 100, 92, 0, 40);
  brow(art, hair, x - 36, y - 16, 1);
  brow(art, hair, x + 36, y - 16, -1);
  eye(art, white, eyeC, x - 34, y + 4, -6);
  eye(art, white, eyeC, x + 34, y + 4, 6);
  art.circle(flower, x - 58, y + 30, 14);
  art.circle(flower, x + 58, y + 30, 14);
  art.ribbon(obi, [[x - 18, y + 62], [x, y + 76], [x + 16, y + 60]], 20, 14, 0.5, 8);
  shape(art, cloth, [
    [x - 70, y + 110], [x + 70, y + 110], [x + 160, y + 250], [x + 180, y + 520],
    [x, y + 560], [x - 180, y + 520], [x - 160, y + 250],
  ], x, y + 180, 30);
  const motifs = [
    [x - 70, y + 280], [x + 70, y + 300], [x, y + 380],
    [x - 90, y + 450], [x + 90, y + 450], [x, y + 500],
  ];
  for (const [mx, my] of motifs) bloom(art, flower, gold, mx, my, 5, 12, 34, my % 17);
  art.roundRect(obi, x - 90, y + 150, 180, 46, 12, x, y + 173, 16);
  art.circle(obiL, x + 70, y + 173, 16);
  art.ellipse(leaf, x - 150, y + 300, 18, 10, -40, 8);
  art.ellipse(leaf, x + 150, y + 330, 18, 10, 40, 8);
  art.ribbon(gold, [[x + 150, y + 200], [x + 190, y + 250], [x + 160, y + 310]], 14, 10, 0.5, 7);
  return art;
}

function laterne() {
  const art = new Art({
    id: 'laterne',
    title: 'Laternenmarkt',
    category: 'manga',
    difficulty: 'schwer',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#24143a', 'Abend');
  const sky2 = art.col('#4a2d68', 'Dunst');
  const glow = art.col('#ffb15a', 'Licht');
  const paper = art.col('#ffe3b0', 'Papier');
  const red = art.col('#e23b4a', 'Rot');
  const teal = art.col('#2aa7a0', 'Türkis');
  const indigo = art.col('#2c3f88', 'Indigo');
  const wood = art.col('#8a5a32', 'Holz');
  const cloth = art.col('#f2efe4', 'Tuch');
  const fruit = art.col('#ff5d7a', 'Frucht');
  const leaf = art.col('#67b85a', 'Blatt');
  const coat = art.col('#1e2436', 'Mantel');
  const coat2 = art.col('#c4476a', 'Umhang');
  const skin = art.col('#f0c2a0', 'Haut');
  const hair = art.col('#2a1c16', 'Haar');
  const ground = art.col('#3a2a28', 'Weg');

  bands(art, 0, 900, [
    { y: 0, color: sky, amp: 18 },
    { y: 280, color: sky2, amp: 26, phase: 0.7 },
    { y: 760, color: ground, amp: 14 },
    { y: 1200, color: ground },
  ]);
  art.circle(paper, 120, 90, 36);
  for (let i = 0; i < 9; i++) art.circle(paper, 40 + (i * 97) % 820, 40 + (i * 37) % 140, 10);

  art.ribbon(wood, [[30, 160], [870, 210]], 8, 8, 0.5, 6);
  const lanterns = [70, 180, 290, 400, 510, 620, 730, 840];
  const colors = [red, glow, teal, indigo, red, glow, teal, indigo];
  lanterns.forEach((x, i) => {
    const y = 200 + (i % 2) * 24;
    art.ribbon(wood, [[x, 180], [x, y]], 6, 6, 0.5, 5.4);
    art.roundRect(colors[i], x - 28, y, 56, 18, 6, x, y + 9, 7);
    art.arch(paper, x - 32, y + 16, 64, 78, 14);
    art.arch(colors[i], x - 18, y + 34, 36, 46, 10);
    art.circle(glow, x, y + 58, 10);
    art.ribbon(colors[i], [[x, y + 96], [x, y + 130]], 8, 4, 0.4, 5.5);
  });

  for (let i = 0; i < 14; i++) {
    const x = 30 + i * 62;
    const color = [red, teal, glow, indigo][i % 4];
    shape(art, color, [
      [x, 430], [x + 28, 430], [x + 14, 490],
    ], x + 14, 452, 10);
  }

  art.roundRect(wood, 80, 620, 740, 28, 8, 450, 634, 12);
  art.roundRect(cloth, 100, 520, 700, 110, 16, 450, 560, 24);
  for (let i = 0; i < 6; i++) {
    art.roundRect(i % 2 ? red : teal, 120 + i * 112, 536, 90, 78, 10, 165 + i * 112, 575, 16);
  }
  for (let i = 0; i < 8; i++) {
    art.circle(i % 2 ? fruit : glow, 140 + i * 80, 680, 16);
    art.ellipse(leaf, 160 + i * 80, 666, 12, 7, 30, 6);
  }

  const people = [
    [250, coat, hair],
    [560, coat2, hair],
  ];
  for (const [px, c, h] of people) {
    art.ellipse(h, px, 760, 28, 32, 0, 14);
    art.circle(skin, px, 800, 16);
    shape(art, c, [
      [px - 50, 830], [px + 50, 830], [px + 70, 1040], [px - 70, 1040],
    ], px, 930, 28);
    art.ellipse(ground, px - 24, 1060, 22, 12, 0, 8);
    art.ellipse(ground, px + 24, 1060, 22, 12, 0, 8);
  }
  return art;
}

function kirsche() {
  const art = new Art({
    id: 'kirsche',
    title: 'Kirschfest',
    category: 'manga',
    difficulty: 'schwer',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#f8d5e4', 'Himmel');
  const sky2 = art.col('#fff0f6', 'Licht');
  const hill = art.col('#8dca86', 'Hügel');
  const grass = art.col('#d9f5b0', 'Wiese');
  const trunk = art.col('#7a4e36', 'Rinde');
  const petal = art.col('#ff8eb4', 'Blüte');
  const petalL = art.col('#ffd0e0', 'Blass');
  const heart = art.col('#ffe28a', 'Herz');
  const skin = art.col('#ffd0b6', 'Haut');
  const hair = art.col('#4a2a3a', 'Haar');
  const eyeC = art.col('#6a3c98', 'Auge');
  const white = art.col('#fffafc', 'Weiss');
  const dress = art.col('#f25d8c', 'Kleid');
  const dressL = art.col('#ffd6e6', 'Falte');
  const dressD = art.col('#c53b6c', 'Schatten');
  const blanket = art.col('#6aa8ff', 'Decke');
  const blanket2 = art.col('#f7f7f2', 'Tuch');

  bands(art, 0, 900, [
    { y: 0, color: sky2, amp: 16 },
    { y: 200, color: sky, amp: 22, phase: 0.5 },
    { y: 640, color: hill, amp: 26, phase: 1 },
    { y: 920, color: grass, amp: 16 },
    { y: 1200, color: grass },
  ]);
  art.ribbon(trunk, [[460, 980], [430, 700], [390, 460], [340, 240]], 46, 22, 0.45);
  art.ribbon(trunk, [[390, 360], [520, 300], [680, 250]], 18, 10, 0.5, 8);
  art.ribbon(trunk, [[400, 470], [250, 400], [140, 330]], 16, 10, 0.5, 8);
  art.ribbon(trunk, [[420, 560], [600, 520], [760, 470]], 16, 9, 0.55, 7);

  const spots = [];
  for (let i = 0; i < 14; i++) {
    const x = 80 + (i % 7) * 110;
    const y = 160 + Math.floor(i / 7) * 150 + (i % 2) * 30;
    spots.push([x, y, i * 9]);
  }
  spots.push([300, 300, 4], [500, 220, 12], [180, 280, -6], [620, 340, 8]);
  for (const [x, y, rot] of spots) {
    bloom(art, iPetal(art, petal, petalL, rot), heart, x, y, 5, 13, 38, rot);
  }

  for (let i = 0; i < 10; i++) {
    art.ellipse(i % 2 ? petal : petalL, 60 + i * 80, 700 + (i % 4) * 24, 14, 9, 20 + i * 7, 6.5);
  }

  art.roundRect(blanket, 80, 980, 320, 70, 16, 240, 1010, 18);
  art.roundRect(blanket2, 110, 994, 260, 42, 12, 240, 1015, 12);

  const x = 690;
  const y = 860;
  shape(art, hair, [
    [x, y - 120], [x + 70, y - 80], [x + 60, y + 10], [x, y - 10], [x - 60, y + 10], [x - 70, y - 80],
  ], x, y - 90, 20);
  lock(art, hair, x - 50, y - 20, 90, -16, 20, 12);
  lock(art, hair, x + 50, y - 16, 96, 16, 20, 12);
  art.ellipse(skin, x, y, 58, 64, 0, 28);
  eye(art, white, eyeC, x - 20, y - 4, -8);
  eye(art, white, eyeC, x + 20, y - 4, 8);
  art.circle(petal, x - 34, y + 16, 10);
  art.circle(petal, x + 34, y + 16, 10);
  gown(art, dress, dressL, dressD, x, y + 90, y + 250, 90, 180, 4);
  return art;

  function iPetal(_art, a, b, rot) {
    return Math.round(rot) % 2 === 0 ? a : b;
  }
}

function schloss() {
  const art = new Art({
    id: 'schloss',
    title: 'Schloss',
    category: 'maerchen',
    difficulty: 'mittel',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#9fd6ff', 'Himmel');
  const sky2 = art.col('#e7f6ff', 'Wolke');
  const sun = art.col('#ffe08a', 'Sonne');
  const hill = art.col('#7ec87a', 'Hügel');
  const hill2 = art.col('#d8f5a8', 'Wiese');
  const stone = art.col('#f4efe4', 'Stein');
  const stoneD = art.col('#e2d3bd', 'Schatten');
  const roof = art.col('#d4544a', 'Dach');
  const roofD = art.col('#8d3038', 'Ziegel');
  const door = art.col('#6b412c', 'Tor');
  const glass = art.col('#8fd0ea', 'Fenster');
  const flag = art.col('#3c8dff', 'Fahne');
  const gold = art.col('#e7c15a', 'Gold');
  const water = art.col('#5eb6e0', 'Wasser');
  const waterD = art.col('#2f86b8', 'Tiefe');
  const trunk = art.col('#8a5a38', 'Stamm');
  const leaf = art.col('#3f9a48', 'Blatt');
  const leafL = art.col('#b6e98a', 'Hell');
  const flower = art.col('#ff7aa2', 'Blume');
  const bridge = art.col('#c9854a', 'Brücke');

  bands(art, 0, 900, [
    { y: 0, color: sky2, amp: 18 },
    { y: 180, color: sky, amp: 24, phase: 0.6 },
    { y: 430, color: hill, amp: 30, phase: 1 },
    { y: 780, color: water, amp: 16 },
    { y: 980, color: hill2, amp: 14 },
    { y: 1200, color: hill2 },
  ]);
  art.circle(sun, 130, 110, 48);
  cloud(art, sky2, 620, 120, 1.2);
  cloud(art, sky2, 360, 80, 0.85);

  art.roundRect(waterD, 40, 800, 820, 50, 20, 450, 825, 16);

  const tower = (x, y, w, h, windows) => {
    art.roundRect(stone, x, y, w, h, 8, x + w / 2, y + 28, 14);
    shape(art, roof, [
      [x - 12, y], [x + w / 2, y - h * 0.42], [x + w + 12, y],
    ], x + w / 2, y - 16, 14);
    art.circle(gold, x + w / 2, y - h * 0.42 - 10, 11);
    for (let i = 0; i < windows; i++) {
      const wy = y + 40 + i * 58;
      art.arch(glass, x + w / 2 - 14, wy, 28, 40, 8);
    }
  };
  tower(70, 470, 90, 280, 3);
  tower(740, 500, 90, 250, 3);
  art.roundRect(stoneD, 180, 430, 540, 360, 12, 450, 470, 22);
  shape(art, roofD, [
    [160, 430], [450, 300], [740, 430],
  ], 450, 390, 22);
  for (let i = 0; i < 5; i++) art.arch(glass, 230 + i * 90, 470, 36, 52, 10);
  for (let i = 0; i < 4; i++) art.arch(glass, 260 + i * 100, 580, 32, 46, 9);
  art.arch(door, 390, 640, 120, 150, 22);
  art.circle(gold, 470, 720, 11);
  art.roundRect(flag, 450, 250, 70, 36, 6, 490, 268, 12);
  art.ribbon(gold, [[450, 300], [450, 250]], 6, 6, 0.5, 5.4);

  art.roundRect(bridge, 250, 790, 400, 28, 10, 450, 804, 10);
  art.arch(waterD, 300, 800, 90, 70, 12);
  art.arch(waterD, 420, 800, 90, 70, 12);
  art.arch(waterD, 540, 800, 90, 70, 12);

  const trees = [[40, 700], [820, 720], [20, 640]];
  for (const [tx, ty] of trees) {
    art.roundRect(trunk, tx + 18, ty, 22, 90, 6, tx + 29, ty + 50, 8);
    art.circle(leaf, tx + 28, ty - 10, 36);
    art.circle(leafL, tx + 4, ty + 6, 22);
    art.circle(leaf, tx + 54, ty + 8, 24);
  }
  const meadow = [[80, 1040], [180, 1100], [300, 1060], [420, 1120], [560, 1050], [680, 1110], [800, 1060], [240, 1000]];
  for (const [fx, fy] of meadow) bloom(art, flower, gold, fx, fy, 5, 12, 32, fx % 20);
  return art;
}

function prinzessin() {
  const art = new Art({
    id: 'prinzessin',
    title: 'Prinzessin',
    category: 'maerchen',
    difficulty: 'mittel',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#b9dcff', 'Himmel');
  const sky2 = art.col('#eef7ff', 'Wolke');
  const hill = art.col('#9ed98a', 'Hügel');
  const grass = art.col('#e5f8c4', 'Wiese');
  const stone = art.col('#f6f1e6', 'Schloss');
  const roof = art.col('#d15a62', 'Dach');
  const skin = art.col('#ffd3b8', 'Haut');
  const hair = art.col('#6b3e22', 'Haar');
  const hairL = art.col('#e0a15a', 'Glanz');
  const eyeC = art.col('#3d6b4f', 'Auge');
  const white = art.col('#fffaf6', 'Weiss');
  const gownC = art.col('#1f8a86', 'Kleid');
  const gownL = art.col('#b7efe4', 'Falte');
  const gownD = art.col('#0f5c62', 'Schatten');
  const gold = art.col('#f0c85a', 'Gold');
  const cape = art.col('#7d3d86', 'Umhang');
  const rose = art.col('#e24b6a', 'Rose');
  const shoe = art.col('#f2d7ea', 'Schuh');

  bands(art, 0, 900, [
    { y: 0, color: sky2, amp: 16 },
    { y: 220, color: sky, amp: 20, phase: 0.5 },
    { y: 520, color: hill, amp: 24 },
    { y: 1200, color: grass },
  ]);
  cloud(art, sky2, 140, 120, 1);
  cloud(art, sky2, 760, 160, 1.1);
  art.roundRect(stone, 40, 300, 70, 180, 6, 75, 340, 12);
  shape(art, roof, [[30, 300], [75, 230], [120, 300]], 75, 270, 12);
  art.roundRect(stone, 790, 320, 70, 160, 6, 825, 360, 12);
  shape(art, roof, [[780, 320], [825, 250], [870, 320]], 825, 290, 12);
  for (let i = 0; i < 6; i++) art.circle(gold, 80 + (i % 3) * 250, 80 + Math.floor(i / 3) * 40, 11);

  const x = 450;
  const y = 390;
  shape(art, cape, [
    [x - 40, y + 80], [x - 180, y + 160], [x - 200, y + 620], [x - 40, y + 580],
    [x + 40, y + 580], [x + 200, y + 620], [x + 180, y + 160], [x + 40, y + 80],
  ], x - 150, y + 360, 24);
  shape(art, hair, [
    [x, y - 160], [x + 80, y - 120], [x + 70, y + 40], [x + 40, y + 220],
    [x, y + 80], [x - 40, y + 220], [x - 70, y + 40], [x - 80, y - 120],
  ], x, y - 130, 24);
  lock(art, hairL, x - 78, y + 10, 280, -20, 26, 14);
  lock(art, hairL, x + 78, y + 6, 300, 22, 26, 14);
  lock(art, hair, x - 30, y - 150, 80, -8, 22, 12);
  lock(art, hair, x + 28, y - 154, 84, 10, 22, 12);
  art.ellipse(skin, x, y, 76, 88, 0, 36);
  brow(art, hair, x - 30, y - 24, 1);
  brow(art, hair, x + 30, y - 24, -1);
  eye(art, white, eyeC, x - 28, y, -6);
  eye(art, white, eyeC, x + 28, y, 6);
  art.circle(rose, x - 44, y + 26, 12);
  art.circle(rose, x + 44, y + 26, 12);
  for (let i = 0; i < 5; i++) {
    const deg = -60 + i * 30;
    const [tx, ty] = polar(x, y - 78, 78, deg);
    shape(art, gold, [
      [x + (i - 2) * 18, y - 78],
      [tx, ty],
      [x + (i - 2) * 18 + 16, y - 70],
    ], (x + tx) / 2, (y - 78 + ty) / 2, 8);
    art.circle(rose, tx, ty - 6, 11);
  }
  gown(art, gownC, gownL, gownD, x, y + 150, y + 560, 130, 300, 6);
  art.roundRect(gold, x - 70, y + 130, 140, 18, 8, x, y + 139, 8);
  bloom(art, rose, gold, x + 78, y + 180, 6, 12, 32, 10);
  art.ellipse(shoe, x - 50, y + 590, 26, 12, 0, 8);
  art.ellipse(shoe, x + 50, y + 590, 26, 12, 0, 8);
  const meadow = [[120, 1080], [220, 1120], [700, 1100], [800, 1060], [160, 1000], [760, 1000]];
  for (const [fx, fy] of meadow) bloom(art, rose, gold, fx, fy, 5, 11, 30, 6);
  return art;
}

function fuchs() {
  const art = new Art({
    id: 'fuchs',
    title: 'Fuchs',
    category: 'maerchen',
    difficulty: 'leicht',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#cfeeff', 'Himmel');
  const sky2 = art.col('#fff6ea', 'Wolke');
  const hill = art.col('#8ed184', 'Hügel');
  const grass = art.col('#e3f7be', 'Wiese');
  const fox = art.col('#ef7a32', 'Fuchs');
  const foxD = art.col('#c45520', 'Schatten');
  const cream = art.col('#fff1dc', 'Bauch');
  const ear = art.col('#f2b6c0', 'Ohr');
  const nose = art.col('#2b241f', 'Nase');
  const eyeC = art.col('#3a2a18', 'Auge');
  const white = art.col('#fffaf4', 'Weiss');
  const flower = art.col('#ff7aae', 'Blume');
  const gold = art.col('#ffe08a', 'Herz');
  const leaf = art.col('#3c9a4e', 'Blatt');
  const wing = art.col('#8ec8ff', 'Flügel');
  const wing2 = art.col('#ffd0ea', 'Falter');

  bands(art, 0, 900, [
    { y: 0, color: sky2, amp: 16 },
    { y: 240, color: sky, amp: 22, phase: 0.4 },
    { y: 640, color: hill, amp: 26 },
    { y: 1200, color: grass },
  ]);
  art.circle(gold, 140, 110, 42);
  cloud(art, sky2, 700, 130, 1.1);

  const x = 450;
  const y = 520;
  art.ellipse(foxD, x + 150, y + 80, 90, 50, -20, 24);
  art.ellipse(cream, x + 210, y + 40, 46, 28, -16, 14);
  art.ellipse(fox, x, y + 80, 150, 110, 0, 48);
  art.ellipse(cream, x, y + 110, 70, 80, 0, 32);
  art.circle(fox, x, y - 40, 120);
  shape(art, fox, [
    [x - 90, y - 80], [x - 130, y - 210], [x - 40, y - 120],
  ], x - 100, y - 150, 16);
  shape(art, fox, [
    [x + 90, y - 80], [x + 130, y - 210], [x + 40, y - 120],
  ], x + 100, y - 150, 16);
  shape(art, ear, [
    [x - 78, y - 100], [x - 112, y - 180], [x - 48, y - 112],
  ], x - 86, y - 136, 12);
  shape(art, ear, [
    [x + 78, y - 100], [x + 112, y - 180], [x + 48, y - 112],
  ], x + 86, y - 136, 12);
  art.ellipse(cream, x, y + 10, 48, 36, 0, 18);
  eye(art, white, eyeC, x - 36, y - 50, -8);
  eye(art, white, eyeC, x + 36, y - 50, 8);
  art.circle(nose, x, y - 8, 10);
  art.ellipse(fox, x - 70, y + 180, 28, 18, 0, 12);
  art.ellipse(fox, x + 70, y + 180, 28, 18, 0, 12);
  art.ellipse(cream, x - 70, y + 188, 14, 8, 0, 6);
  art.ellipse(cream, x + 70, y + 188, 14, 8, 0, 6);

  const flowers = [];
  for (let i = 0; i < 10; i++) flowers.push([70 + (i % 5) * 180, 980 + Math.floor(i / 5) * 90, i * 11]);
  flowers.push([80, 860, 4], [820, 880, 9], [120, 760, 2], [780, 740, 6]);
  for (const [fx, fy, rot] of flowers) bloom(art, flower, gold, fx, fy, 5, 12, 34, rot);
  for (let i = 0; i < 8; i++) art.ellipse(leaf, 100 + i * 90, 930, 16, 8, -30 + i * 10, 6.5);

  const butterflies = [[180, 420], [720, 380], [160, 300], [760, 500]];
  butterflies.forEach(([bx, by], i) => {
    const c = i % 2 ? wing : wing2;
    art.ellipse(c, bx - 18, by, 16, 22, -30, 10);
    art.ellipse(c, bx + 18, by, 16, 22, 30, 10);
    art.ellipse(gold, bx - 16, by + 16, 12, 16, -20, 8);
    art.ellipse(gold, bx + 16, by + 16, 12, 16, 20, 8);
    art.roundRect(nose, bx - 2, by - 8, 4, 28, 2, bx, by + 6, 5.4);
  });
  return art;
}

function drache() {
  const art = new Art({
    id: 'drache',
    title: 'Drache',
    category: 'maerchen',
    difficulty: 'schwer',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#b7e3ff', 'Himmel');
  const sky2 = art.col('#fff4d8', 'Wolke');
  const hill = art.col('#7fbf78', 'Hügel');
  const grass = art.col('#def6b4', 'Wiese');
  const scale = art.col('#3cb38a', 'Schuppe');
  const scaleD = art.col('#1f7a62', 'Rücken');
  const belly = art.col('#f3e2b0', 'Bauch');
  const wing = art.col('#8fe0c8', 'Flügel');
  const wingD = art.col('#2f8f78', 'Spann');
  const horn = art.col('#f0c85a', 'Horn');
  const eyeC = art.col('#f2d35a', 'Auge');
  const dark = art.col('#243028', 'Pupille');
  const fire = art.col('#ff7a3c', 'Feuer');
  const fireL = art.col('#ffe08a', 'Glut');
  const coin = art.col('#e6b23c', 'Münze');
  const coinL = art.col('#fff1c4', 'Glanz');

  bands(art, 0, 900, [
    { y: 0, color: sky2, amp: 18 },
    { y: 260, color: sky, amp: 22, phase: 0.5 },
    { y: 820, color: hill, amp: 20 },
    { y: 1200, color: grass },
  ]);
  cloud(art, sky2, 140, 140, 1);
  cloud(art, sky2, 760, 200, 1.15);
  art.circle(fireL, 80, 80, 28);

  shape(art, wingD, [
    [250, 430], [80, 250], [160, 360], [40, 420], [180, 470], [120, 560], [260, 520],
  ], 140, 420, 28);
  for (let i = 0; i < 3; i++) {
    shape(art, wing, [
      [230, 400 + i * 40],
      [90, 300 + i * 70],
      [150, 390 + i * 50],
      [220, 450 + i * 30],
    ], 160, 390 + i * 48, 16);
  }
  shape(art, wingD, [
    [620, 460], [820, 280], [740, 400], [860, 470], [730, 500], [800, 590], [620, 540],
  ], 760, 450, 26);
  for (let i = 0; i < 3; i++) {
    shape(art, wing, [
      [650, 430 + i * 40],
      [800, 330 + i * 70],
      [740, 420 + i * 50],
      [660, 470 + i * 30],
    ], 730, 420 + i * 46, 16);
  }

  shape(art, scaleD, [
    [180, 620], [280, 500], [430, 430], [600, 480], [760, 620],
    [700, 760], [520, 820], [340, 780], [200, 700],
  ], 300, 640, 30);
  shape(art, belly, [
    [300, 560], [480, 540], [620, 640], [560, 760], [400, 780], [280, 680],
  ], 460, 660, 36);

  const scaleSpots = [];
  for (let row = 0; row < 7; row++) {
    for (let i = 0; i < 6; i++) {
      scaleSpots.push([210 + i * 82 + (row % 2) * 28, 470 + row * 46]);
    }
  }
  scaleSpots.forEach(([sx, sy], i) => {
    art.ellipse(i % 2 ? scale : scaleD, sx, sy, 22, 16, -20, 9);
  });

  art.ellipse(scale, 250, 430, 70, 58, -15, 24);
  art.ellipse(belly, 270, 450, 28, 18, -10, 10);
  shape(art, horn, [[220, 390], [180, 300], [230, 370]], 200, 350, 10);
  shape(art, horn, [[260, 380], [250, 280], [290, 360]], 260, 330, 10);
  art.circle(eyeC, 230, 430, 16);
  for (let i = 0; i < 5; i++) {
    const deg = 250 + i * 16;
    art.petal(i % 2 ? fire : fireL, 160, 470, 12, 48, deg, 18);
  }

  art.ellipse(scale, 300, 800, 26, 18, 20, 10);
  art.ellipse(scale, 430, 840, 26, 18, 0, 10);
  art.ellipse(scale, 560, 820, 26, 18, -16, 10);
  art.ellipse(belly, 300, 812, 12, 8, 0, 6);
  art.ellipse(belly, 430, 852, 12, 8, 0, 6);
  art.ellipse(belly, 560, 832, 12, 8, 0, 6);

  for (let i = 0; i < 8; i++) {
    art.circle(i % 2 ? coin : coinL, 140 + (i % 4) * 50, 1040 + Math.floor(i / 4) * 48, 16);
  }
  return art;
}

function einhorn() {
  const art = new Art({
    id: 'einhorn',
    title: 'Einhorn',
    category: 'maerchen',
    difficulty: 'mittel',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#d9e6ff', 'Himmel');
  const sky2 = art.col('#fff5fb', 'Wolke');
  const hill = art.col('#b7e39a', 'Hügel');
  const grass = art.col('#eaf8c8', 'Wiese');
  const body = art.col('#fffaf8', 'Fell');
  const shade = art.col('#f0d9ea', 'Schatten');
  const mane = art.col('#f08ac4', 'Mähne');
  const mane2 = art.col('#c9a6ff', 'Strähne');
  const mane3 = art.col('#8fd0ff', 'Locke');
  const horn = art.col('#f2d56a', 'Horn');
  const horn2 = art.col('#fff6d4', 'Glanz');
  const eyeC = art.col('#6a4ad4', 'Auge');
  const dark = art.col('#2c2444', 'Pupille');
  const hoof = art.col('#e7c2d8', 'Huf');
  const flower = art.col('#ff8eb0', 'Blume');
  const gold = art.col('#ffe08a', 'Herz');
  const leaf = art.col('#67b86a', 'Blatt');

  bands(art, 0, 900, [
    { y: 0, color: sky2, amp: 16 },
    { y: 300, color: sky, amp: 20, phase: 0.6 },
    { y: 760, color: hill, amp: 22 },
    { y: 1200, color: grass },
  ]);
  const bows = ['#ff8eb0', '#ffd56a', '#8fd0ff', '#c9a6ff', '#f08ac4'];
  const cols = bows.map((hex, i) => art.col(hex, `Bogen ${i + 1}`));
  cols.forEach((color, i) => {
    art.sector(color, -40, 180, 180 + i * 28, 204 + i * 28, 70, 150, 0.5);
  });
  cloud(art, sky2, 760, 150, 1.2);

  const x = 470;
  const y = 640;
  art.ellipse(shade, x + 20, y + 30, 170, 90, -8, 36);
  art.ellipse(body, x, y, 180, 100, -6, 48);
  art.ellipse(body, x + 150, y - 40, 36, 70, 8, 16);
  art.ellipse(body, x - 150, y + 20, 34, 68, -6, 16);
  art.ellipse(body, x + 80, y + 20, 34, 72, 6, 16);
  art.ellipse(body, x - 70, y + 30, 32, 70, -4, 16);
  art.ellipse(hoof, x + 150, y + 40, 16, 10, 0, 7);
  art.ellipse(hoof, x - 150, y + 96, 16, 10, 0, 7);
  art.ellipse(hoof, x + 80, y + 100, 16, 10, 0, 7);
  art.ellipse(hoof, x - 70, y + 108, 16, 10, 0, 7);

  art.ellipse(body, x + 210, y - 150, 48, 70, 16, 22);
  art.ellipse(body, x + 250, y - 130, 36, 24, 10, 12);
  shape(art, body, [
    [x + 230, y - 200], [x + 250, y - 280], [x + 210, y - 190],
  ], x + 236, y - 230, 12);
  for (let i = 0; i < 4; i++) {
    art.roundRect([horn, horn2][i % 2], x + 232, y - 300 - i * 16, 16, 14, 4, x + 240, y - 293 - i * 16, 6);
  }
  art.circle(gold, x + 240, y - 372, 11);
  art.circle(eyeC, x + 230, y - 160, 14);

  const maneCols = [mane, mane2, mane3, mane, mane2, mane3];
  for (let i = 0; i < 6; i++) {
    lock(art, maneCols[i], x + 180 - i * 18, y - 180 + i * 10, 150 + i * 8, -30 - i * 4, 22, 12);
  }
  for (let i = 0; i < 5; i++) {
    lock(art, maneCols[i], x - 160, y - 20 + i * 8, 120, -36, 20, 12);
  }

  for (let i = 0; i < 8; i++) {
    bloom(art, flower, gold, 80 + (i % 4) * 220, 1000 + Math.floor(i / 4) * 80, 5, 12, 32, i * 9);
  }
  for (let i = 0; i < 6; i++) art.ellipse(leaf, 120 + i * 120, 960, 16, 8, 25, 6.5);
  for (let i = 0; i < 8; i++) art.circle(gold, 60 + i * 100, 200 + (i % 3) * 30, 11);
  return art;
}

function wald() {
  const art = new Art({
    id: 'zauberwald',
    title: 'Zauberwald',
    category: 'maerchen',
    difficulty: 'schwer',
    w: 900,
    h: 1200,
  });
  const sky = art.col('#1d2a4a', 'Nacht');
  const sky2 = art.col('#3c4d86', 'Dunst');
  const moon = art.col('#f6f1d0', 'Mond');
  const hill = art.col('#1e4d3a', 'Hügel');
  const moss = art.col('#2f7a48', 'Moos');
  const path = art.col('#d9c08a', 'Pfad');
  const trunk = art.col('#5c3b2e', 'Stamm');
  const leaf = art.col('#1f6a40', 'Blatt');
  const leafL = art.col('#8fd18a', 'Hell');
  const cap = art.col('#e15a6a', 'Hut');
  const capD = art.col('#f2d2b0', 'Tupfen');
  const stem = art.col('#f3e2c4', 'Stiel');
  const glow = art.col('#ffe08a', 'Glühwürmchen');
  const wall = art.col('#f0e2c8', 'Hütte');
  const roof = art.col('#8d4638', 'Dach');
  const door = art.col('#6b3a28', 'Tür');
  const windowC = art.col('#f6d56a', 'Fenster');
  const flower = art.col('#d98cff', 'Blume');

  bands(art, 0, 900, [
    { y: 0, color: sky, amp: 16 },
    { y: 260, color: sky2, amp: 22, phase: 0.5 },
    { y: 560, color: hill, amp: 28 },
    { y: 1200, color: moss },
  ]);
  art.circle(moon, 700, 110, 46);
  art.circle(sky2, 684, 96, 12);
  for (let i = 0; i < 12; i++) art.circle(moon, 40 + (i * 73) % 560, 36 + (i * 29) % 160, 10);

  art.ribbon(path, [[450, 1180], [430, 980], [500, 820], [420, 680]], 70, 28, 0.4);

  const trees = [
    [80, 620, 1], [200, 560, 0.8], [700, 600, 1.05], [820, 540, 0.75], [40, 500, 0.7],
  ];
  for (const [tx, ty, s] of trees) {
    art.roundRect(trunk, tx, ty, 28 * s, 160 * s, 8, tx + 14 * s, ty + 80 * s, 10);
    art.circle(leaf, tx + 14 * s, ty - 10 * s, 48 * s);
    art.circle(leafL, tx - 20 * s, ty + 10 * s, 28 * s);
    art.circle(leaf, tx + 48 * s, ty + 6 * s, 30 * s);
    art.circle(leafL, tx + 10 * s, ty - 40 * s, 22 * s);
  }

  art.roundRect(wall, 330, 700, 200, 150, 10, 430, 760, 22);
  shape(art, roof, [[300, 710], [430, 600], [560, 710]], 430, 670, 20);
  art.arch(door, 400, 760, 60, 90, 14);
  art.arch(windowC, 350, 730, 36, 46, 9);
  art.arch(windowC, 490, 730, 36, 46, 9);
  art.roundRect(trunk, 500, 640, 16, 40, 4, 508, 660, 7);

  for (let i = 0; i < 7; i++) {
    const mx = 80 + i * 120;
    const my = 1000 + (i % 2) * 40;
    art.roundRect(stem, mx, my, 16, 36, 6, mx + 8, my + 20, 7);
    art.ellipse(cap, mx + 8, my - 4, 28, 16, 0, 10);
    art.circle(capD, mx - 14, my - 8, 10);
    art.circle(capD, mx + 28, my - 2, 10);
  }
  for (let i = 0; i < 8; i++) {
    bloom(art, flower, glow, 70 + (i % 4) * 220, 1120 + Math.floor(i / 4) * 10, 5, 11, 30, i);
  }
  for (let i = 0; i < 12; i++) {
    art.circle(glow, 60 + (i * 67) % 800, 300 + (i * 53) % 240, 11);
  }
  return art;
}
