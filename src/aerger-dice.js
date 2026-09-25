/**
 * Orbit Ärger dice. The tile tumbles in the browser; these helpers stay pure
 * so smoke tests can check timing and "was that a new roll?" without a DOM.
 *
 * A roll is identified by `rollSeq` (bumped only in applyRoll). That still
 * fires when the face repeats — a second 6 looks like the first if you only
 * compare `dice`. Rooms from before rollSeq fall back to the phase change.
 */

export const MIN_LOCAL_TUMBLE_MS = 700;
export const REMOTE_LAND_MS = 420;

const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const TONES = ['red', 'blue', 'yellow', 'green'];

/** Held long enough that a screen recorder paints each pose, not only the number. */
const TUMBLE_POSES = [
  'rotate(-18deg) translateY(0)',
  'rotate(22deg) translateY(-16px) scale(1.08)',
  'rotate(-10deg) scaleX(0.2) translateY(-8px)',
  'rotate(16deg) translateY(-12px) scale(1.05)',
  'rotate(8deg) scaleX(0.22) translateY(-4px)',
  'rotate(-14deg) translateY(0) scale(1.06)',
];

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How long to keep a local tumble going after the click, so a fast POST still rolls. */
export function tumbleHoldMs(startedAt, now, reduced = false) {
  if (reduced) return 0;
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return MIN_LOCAL_TUMBLE_MS;
  return Math.max(0, MIN_LOCAL_TUMBLE_MS - Math.max(0, now - startedAt));
}

export function faceValue(value) {
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
}

export function isFreshRoll(prev, next) {
  if (!prev || !next) return false;
  const dice = faceValue(next.dice);
  if (!dice) return false;
  const prevSeq = Number.isInteger(prev.rollSeq) ? prev.rollSeq : null;
  const nextSeq = Number.isInteger(next.rollSeq) ? next.rollSeq : null;
  if (nextSeq != null) return prevSeq == null ? nextSeq > 0 : nextSeq > prevSeq;
  if (prev.phase !== 'roll') return false;
  if (prev.turn === next.turn && (next.phase === 'move' || prev.dice !== dice)) return true;
  return prev.turn !== next.turn && next.notice === 'no-move';
}

function clock() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Mounts the die into `root`. The readout is the sighted number ("…" while a
 * local roll is in flight). `live` announces the real face once, politely.
 */
export function mountDie(root, readout, live) {
  const api = {
    animating: false,
    shown: undefined,
    prefersReduced: false,
    tumble() {
      return clock();
    },
    land() {},
    show() {},
    announce() {},
    setTone() {},
  };
  if (!root || !readout || typeof document === 'undefined') return api;

  root.replaceChildren();
  const glow = document.createElement('div');
  glow.className = 'aerger-die-glow';
  const scene = document.createElement('div');
  scene.className = 'aerger-die-scene';
  const tile = document.createElement('div');
  tile.className = 'aerger-die';
  const pips = [];
  for (let i = 0; i < 9; i += 1) {
    const pip = document.createElement('i');
    pip.className = 'pip off';
    pips.push(pip);
    tile.append(pip);
  }
  const digit = document.createElement('span');
  digit.className = 'die-num';
  tile.append(digit);
  scene.append(tile);
  root.append(glow, scene);

  let spinTimer = 0;
  let landToken = 0;
  let faceN = 0;

  function stopSpin() {
    clearInterval(spinTimer);
    spinTimer = 0;
  }

  function paint(n, { idle = false } = {}) {
    faceN = n || 0;
    const on = n ? new Set(PIPS[n]) : new Set();
    pips.forEach((pip, i) => pip.classList.toggle('off', !on.has(i)));
    digit.textContent = idle || !n ? '–' : String(n);
    tile.classList.toggle('is-idle', idle || !n);
    if (n) tile.dataset.face = String(n);
    else delete tile.dataset.face;
  }

  function stopMotion() {
    landToken += 1;
    stopSpin();
    tile.style.transform = '';
    tile.classList.remove('tumbling', 'landing');
    readout.classList.remove('pop');
    root.classList.remove('rolling');
  }

  api.setTone = (color) => {
    const tone = TONES.includes(color) ? color : '';
    for (const name of TONES) {
      root.classList.toggle(name, name === tone);
      readout.classList.toggle(name, name === tone);
    }
  };

  api.announce = (value) => {
    const face = faceValue(value);
    if (!live || !face) return;
    const text = `Gewürfelt: ${face}`;
    live.textContent = '';
    requestAnimationFrame(() => {
      live.textContent = text;
    });
  };

  api.show = (value, force = false) => {
    const next = faceValue(value);
    if (!force && api.animating) return;
    if (!force && api.shown === next && !tile.classList.contains('tumbling')) return;
    api.animating = false;
    api.shown = next;
    stopMotion();
    paint(next, { idle: !next });
    readout.textContent = next ? String(next) : '–';
  };

  api.tumble = () => {
    stopMotion();
    api.animating = true;
    api.shown = null;
    api.prefersReduced = reducedMotion();
    root.classList.add('rolling');
    readout.textContent = '…';
    if (api.prefersReduced) {
      paint(0, { idle: true });
      digit.textContent = '…';
      return clock();
    }
    let n = 1;
    let pose = 0;
    paint(n);
    tile.classList.add('tumbling');
    tile.style.transform = TUMBLE_POSES[0];
    spinTimer = setInterval(() => {
      n = (n % 6) + 1;
      pose = (pose + 1) % TUMBLE_POSES.length;
      paint(n);
      tile.style.transform = TUMBLE_POSES[pose];
    }, 120);
    return clock();
  };

  api.land = (value) => {
    const face = faceValue(value);
    if (!face) {
      api.show(null, true);
      return;
    }
    const reduced = api.prefersReduced || reducedMotion();
    stopMotion();
    api.animating = false;
    api.prefersReduced = false;
    api.shown = face;
    paint(face);
    readout.textContent = String(face);
    if (!reduced) {
      const token = landToken;
      void tile.offsetWidth;
      tile.classList.add('landing');
      readout.classList.add('pop');
      const stop = () => {
        if (landToken !== token) return;
        tile.classList.remove('landing');
        readout.classList.remove('pop');
      };
      tile.addEventListener('animationend', stop, { once: true });
      setTimeout(stop, REMOTE_LAND_MS + 400);
    }
    api.announce(face);
  };

  api.show(null, true);
  return api;
}
