/**
 * Original mahjong faces. Drawn as SVG paths, not a tile font and not a traced set.
 * The ivory slab, thickness, and shadow live in CSS; this is only the painted symbol.
 */

const WIND = {
  1: { letter: 'O', tint: '#e2a12b', ink: '#8a5a08' },
  2: { letter: 'S', tint: '#e04b55', ink: '#8d1d2c' },
  3: { letter: 'W', tint: '#4d6ad4', ink: '#24357a' },
  4: { letter: 'N', tint: '#1f9a68', ink: '#0d5b3c' },
};

function dot(cx, cy, r, fill, ring) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>
    <circle cx="${cx - r * 0.28}" cy="${cy - r * 0.32}" r="${r * 0.38}" fill="#fff" opacity="0.55"/>
    ${ring ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="none" stroke="${ring}" stroke-width="1.4"/>` : ''}`;
}

function dotColor(rank, index, total) {
  if (rank === 1) return '#148a74';
  if (rank === 5 && index === Math.floor(total / 2)) return '#e2a12b';
  if (rank >= 6) return '#d23a4a';
  if (rank >= 4) return '#1a7cae';
  return '#128a9a';
}

const DOTS = {
  1: [[40, 52]],
  2: [
    [40, 30],
    [40, 76],
  ],
  3: [
    [40, 24],
    [40, 52],
    [40, 82],
  ],
  4: [
    [26, 32],
    [54, 32],
    [26, 74],
    [54, 74],
  ],
  5: [
    [26, 28],
    [54, 28],
    [40, 52],
    [26, 78],
    [54, 78],
  ],
  6: [
    [26, 26],
    [54, 26],
    [26, 52],
    [54, 52],
    [26, 78],
    [54, 78],
  ],
  7: [
    [26, 22],
    [54, 22],
    [40, 40],
    [26, 58],
    [54, 58],
    [26, 82],
    [54, 82],
  ],
  8: [
    [26, 20],
    [54, 20],
    [26, 42],
    [54, 42],
    [26, 64],
    [54, 64],
    [26, 86],
    [54, 86],
  ],
  9: [
    [24, 24],
    [40, 24],
    [56, 24],
    [24, 52],
    [40, 52],
    [56, 52],
    [24, 80],
    [40, 80],
    [56, 80],
  ],
};

function dots(rank) {
  const spots = DOTS[rank] || DOTS[1];
  const r = rank === 1 ? 14 : rank > 6 ? 7.2 : 8.4;
  return spots
    .map((spot, index) => dot(spot[0], spot[1], r, dotColor(rank, index, spots.length), rank === 1 ? '#b8f6e4' : ''))
    .join('');
}

function stick(x, y, h) {
  return `<g transform="translate(${x} ${y})">
    <rect x="-4.2" y="${-h / 2}" width="8.4" height="${h}" rx="3.2" fill="#178247"/>
    <rect x="-4.2" y="${-h / 2}" width="3.1" height="${h}" rx="3" fill="#8ee8b0" opacity="0.55"/>
    <rect x="-4.2" y="-1.7" width="8.4" height="3.4" rx="1.2" fill="#f4fff6"/>
    <rect x="-4.2" y="${-h / 2 + 3}" width="8.4" height="2.2" fill="#0e5a30" opacity="0.35"/>
  </g>`;
}

function bird() {
  return `<g>
    <path d="M18 70c8 10 20 8 26 2" fill="none" stroke="#1c7a42" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="38" cy="62" rx="16" ry="11" fill="#2ea15c"/>
    <ellipse cx="34" cy="66" rx="8" ry="5" fill="#b7f0cb" opacity="0.8"/>
    <circle cx="52" cy="52" r="8.5" fill="#3cb56c"/>
    <circle cx="55" cy="50" r="1.5" fill="#10281a"/>
    <path d="M59 52l9 1.5-9 3.2z" fill="#f0b429"/>
    <path d="M30 58c-8-10-2-18 6-16" fill="#176b3c"/>
    ${stick(22, 34, 22)}
  </g>`;
}

function bamboo(rank) {
  if (rank === 1) return bird();
  if (rank === 2) return stick(30, 52, 46) + stick(50, 52, 46);
  if (rank === 3) return stick(28, 40, 36) + stick(52, 40, 36) + stick(40, 74, 28);
  if (rank === 4) return stick(28, 36, 30) + stick(52, 36, 30) + stick(28, 72, 30) + stick(52, 72, 30);
  if (rank === 5) {
    return stick(26, 32, 26) + stick(54, 32, 26) + stick(40, 54, 30) + stick(26, 78, 26) + stick(54, 78, 26);
  }
  if (rank === 6) {
    return [24, 48, 72].map((y) => stick(30, y, 20) + stick(50, y, 20)).join('');
  }
  if (rank === 7) {
    return [26, 48, 70].map((y) => stick(28, y, 18) + stick(52, y, 18)).join('') + stick(40, 88, 16);
  }
  if (rank === 8) {
    return [20, 40, 60, 80].map((y) => stick(30, y, 16) + stick(50, y, 16)).join('');
  }
  return [22, 52, 82].map((y) => stick(22, y, 18) + stick(40, y, 18) + stick(58, y, 18)).join('');
}

const NUMERAL = {
  1: 'M0 -20 V20',
  2: 'M-16 -14 H14 C14 -4 2 -4 -2 2 C-10 12 -16 12 -16 20 H16',
  3: 'M-14 -16 H12 C16 -8 4 -6 4 -2 C16 2 16 14 -2 18 H-14',
  4: 'M-14 -18 V2 H16 M6 -18 V20',
  5: 'M14 -16 H-12 V0 H10 C16 0 16 18 0 18 H-14',
  6: 'M12 -14 H-8 C-16 -4 -16 18 2 18 C16 18 16 4 2 4 H-8',
  7: 'M-14 -16 H16 L-2 20',
  8: 'M0 -18 C-16 -18 -16 -2 0 -2 C16 -2 16 -18 0 -18 M0 2 C-16 2 -16 20 0 20 C16 20 16 2 0 2',
  9: 'M-4 8 C-16 8 -16 -16 2 -16 C16 -16 16 -2 2 -2 H-6 L-10 20',
};

function characters(rank) {
  const path = NUMERAL[rank] || NUMERAL[1];
  return `<path d="M24 12h32M30 17h20" stroke="#9d2434" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    <path d="M34 6h12l-2.2 5H36.2z" fill="#d23b45"/>
    <path d="${path}" transform="translate(40 64)" fill="none" stroke="#c4313c" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function windIcon(rank) {
  if (rank === 1) {
    return `<circle cx="40" cy="78" r="7" fill="#f0b429"/>
      <path d="M40 66v4M40 86v4M28 78h4M48 78h4" stroke="#e2a12b" stroke-width="1.6" stroke-linecap="round"/>`;
  }
  if (rank === 2) {
    return `<path d="M40 70c6 4 8 10 0 16c-8-6-6-12 0-16z" fill="#e04b55"/>`;
  }
  if (rank === 3) {
    return `<path d="M34 72a8 8 0 1 0 10 8 6 6 0 1 1 -10-8z" fill="#4d6ad4"/>`;
  }
  return `<path d="M40 68v16M32 76h16M34 70l12 12M46 70L34 82" stroke="#1f9a68" stroke-width="1.5" stroke-linecap="round"/>`;
}

function wind(rank) {
  const spec = WIND[rank] || WIND[1];
  return `<circle cx="40" cy="46" r="22" fill="${spec.tint}"/>
    <circle cx="40" cy="46" r="17" fill="none" stroke="${spec.ink}" stroke-width="1.6"/>
    <text x="40" y="54" text-anchor="middle" font-family="Georgia, serif" font-size="26" font-weight="700" fill="#fffaf2">${spec.letter}</text>
    ${windIcon(rank)}`;
}

function dragon(rank) {
  if (rank === 1) {
    return `<circle cx="40" cy="52" r="24" fill="#d32638"/>
      <rect x="18" y="46" width="44" height="12" rx="3" fill="#fff7ea"/>
      <circle cx="40" cy="52" r="24" fill="none" stroke="#8d1524" stroke-width="1.4"/>`;
  }
  if (rank === 2) {
    return `<path d="M40 22l16 30-16 30-16-30z" fill="#178f55"/>
      <path d="M40 34v28M30 48h20" stroke="#e9fff2" stroke-width="3" stroke-linecap="round"/>
      <path d="M40 22l16 30-16 30-16-30z" fill="none" stroke="#0d5a34" stroke-width="1.4"/>`;
  }
  return `<rect x="18" y="26" width="44" height="54" rx="4" fill="none" stroke="#2a5fbf" stroke-width="3.4"/>
    <rect x="24" y="32" width="32" height="42" rx="2" fill="none" stroke="#9ec4ff" stroke-width="1.4"/>`;
}

function flower(rank) {
  if (rank === 1) {
    return [0, 72, 144, 216, 288]
      .map(
        (deg) =>
          `<ellipse cx="40" cy="36" rx="7" ry="12" fill="#f2a3c0" transform="rotate(${deg} 40 52)"/>`
      )
      .join('') + '<circle cx="40" cy="52" r="5" fill="#f0d36a"/>';
  }
  if (rank === 2) {
    return `<path d="M40 86C28 60 22 40 40 22c18 18 12 38 0 64z" fill="#d96ad4"/>
      <path d="M40 80C26 62 18 48 30 34" fill="none" stroke="#f7c2ef" stroke-width="2"/>
      <path d="M40 80C54 62 62 48 50 34" fill="none" stroke="#f7c2ef" stroke-width="2"/>
      <circle cx="40" cy="40" r="3.2" fill="#f0d36a"/>`;
  }
  if (rank === 3) {
    const petals = [];
    for (let i = 0; i < 12; i++) {
      petals.push(
        `<ellipse cx="40" cy="34" rx="3.2" ry="14" fill="${i % 2 ? '#f2c14d' : '#e09a2e'}" transform="rotate(${i * 30} 40 52)"/>`
      );
    }
    return petals.join('') + '<circle cx="40" cy="52" r="5" fill="#8a4b12"/>';
  }
  return `<path d="M40 28c10 8 16 16 16 24 0 12-8 20-16 22-8-2-16-10-16-22 0-8 6-16 16-24z" fill="#f4b7d4"/>
    <path d="M40 36c6 6 10 12 10 16 0 8-5 12-10 14-5-2-10-6-10-14 0-4 4-10 10-16z" fill="#fff4f8"/>
    <path d="M40 78v12" stroke="#2f8a4e" stroke-width="2" stroke-linecap="round"/>`;
}

function season(rank) {
  if (rank === 1) {
    return `<path d="M22 86c18-8 22-24 18-40" fill="none" stroke="#6b4a2a" stroke-width="3" stroke-linecap="round"/>
      <circle cx="36" cy="40" r="7" fill="#f7b7cb"/>
      <circle cx="48" cy="32" r="5" fill="#f48aaa"/>
      <circle cx="30" cy="28" r="4" fill="#ffe1ec"/>`;
  }
  if (rank === 2) {
    return `<circle cx="40" cy="52" r="12" fill="#f0c14a"/>
      ${[0, 45, 90, 135].map((deg) => `<path d="M40 30v-10M40 74v10" stroke="#e2a12b" stroke-width="3" stroke-linecap="round" transform="rotate(${deg} 40 52)"/>`).join('')}`;
  }
  if (rank === 3) {
    return `<path d="M40 24l8 16 18 2-14 12 4 18-16-10-16 10 4-18-14-12 18-2z" fill="#e2582c"/>
      <path d="M40 40v28" stroke="#f7c9a2" stroke-width="1.6"/>`;
  }
  return `<path d="M40 28v48M16 52h48M22 34l36 36M58 34L22 70" stroke="#7eb6e8" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="40" cy="52" r="4" fill="#d7ecff"/>`;
}

function inner(suit, rank) {
  if (suit === 'dot') return dots(rank);
  if (suit === 'bamboo') return bamboo(rank);
  if (suit === 'char') return characters(rank);
  if (suit === 'wind') return wind(rank);
  if (suit === 'dragon') return dragon(rank);
  if (suit === 'flower') return flower(rank);
  return season(rank);
}

/** @param {string} suit @param {number} rank */
export function tileSvg(suit, rank) {
  return `<svg class="mj-svg" viewBox="0 0 80 104" aria-hidden="true" focusable="false">${inner(suit, rank)}</svg>`;
}

const LABELS = {
  dot: 'Punkte',
  bamboo: 'Bambus',
  char: 'Zeichen',
  wind: ['', 'Ost', 'Süd', 'West', 'Nord'],
  dragon: ['', 'Roter Drache', 'Grüner Drache', 'Weißer Drache'],
};

/** @param {{ suit: string, rank: number }} tile */
export function faceLabel(tile) {
  if (tile.suit === 'wind') return LABELS.wind[tile.rank] || 'Wind';
  if (tile.suit === 'dragon') return LABELS.dragon[tile.rank] || 'Drache';
  if (tile.suit === 'flower') return 'Blume';
  if (tile.suit === 'season') return 'Jahreszeit';
  const name = LABELS[tile.suit] || 'Stein';
  return `${name} ${tile.rank}`;
}
