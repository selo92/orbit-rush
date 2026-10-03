/**
 * Orbit Paint UI. Gallery, numbered palette, tap/drag fill, pinch and wheel zoom.
 * Progress stays in localStorage. No network.
 */
import { hashSeed, mulberry32, utcDateString } from './rng.js';
import {
  PICTURES,
  STORAGE_KEY,
  applyStroke,
  colorProgress,
  dailyPicture,
  difficultyLabel,
  filledCount,
  finishState,
  firstOpenColor,
  formatDailyLabel,
  formatDuration,
  hintTarget,
  isComplete,
  parseStore,
  pictureById,
  readPictureState,
  writePictureState,
} from './paint.js';

const HELP_KEY = 'orbit-paint-help-v1';
const PAPER = '#f4f1fa';

const $ = (id) => document.getElementById(id);

/**
 * @param {{ onHub: () => void, audio?: { resume?: () => void, tone?: Function, collect?: Function, combo?: Function, warn?: Function, click?: Function } }} opts
 */
export function mountPaint({ onHub, audio }) {
  const screen = $('screen-paint');
  const gallery = $('paint-gallery');
  const play = $('paint-play');
  const grid = $('paint-grid');
  const dailyBtn = $('paint-daily');
  const stage = $('paint-stage');
  const canvas = /** @type {HTMLCanvasElement} */ ($('paint-canvas'));
  const ctx = canvas.getContext('2d');
  const paletteEl = $('paint-palette');
  const help = $('paint-help');
  const toast = $('paint-toast');

  /** @type {import('./paint.js').PaintPicture | null} */
  let picture = null;
  /** @type {Uint8Array} */
  let filled = new Uint8Array(0);
  let selected = 1;
  let elapsedMs = 0;
  /** @type {number | null} */
  let bestMs = null;
  /** @type {number | null} */
  let bestScore = null;
  let doneFlag = false;
  let clockOn = false;
  let tickAt = 0;
  let store = loadStore();
  let hintAfter = -1;
  let panMode = false;
  let toastTimer = 0;
  let saveTimer = 0;
  let resetArmed = false;
  let rafId = 0;
  let lastFrame = 0;
  /** @type {{ from: {cell:number,ox:number,oy:number}, to: {cell:number,ox:number,oy:number}, t: number, dur: number } | null} */
  let anim = null;
  /** @type {{x:number,y:number,vx:number,vy:number,g:number,life:number,age:number,color:string,s:number}[]} */
  let particles = [];
  /** @type {Map<number, number>} */
  const flashes = new Map();
  /** @type {Map<number, {x:number,y:number}>} */
  const pointers = new Map();
  /** @type {{ dist: number, cx: number, cy: number } | null} */
  let pinch = null;
  let gesture = blankGesture();
  let hintPulse = 0;
  /** @type {{x:number,y:number} | null} */
  let hintCell = null;
  const view = { cell: 16, ox: 0, oy: 0, user: false };
  /** @type {{x:number,y:number,r:number,a:number}[]} */
  let stars = [];
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

  function blankGesture() {
    return {
      painting: false,
      panning: false,
      color: 1,
      /** @type {{x:number,y:number} | null} */
      last: null,
      wrongNoted: false,
      advanced: false,
    };
  }

  function loadStore() {
    try {
      return parseStore(localStorage.getItem(STORAGE_KEY));
    } catch {
      return parseStore(null);
    }
  }

  function displayMs() {
    if (!clockOn) return elapsedMs;
    return elapsedMs + (performance.now() - tickAt);
  }

  function flushTime() {
    if (!clockOn) return;
    const now = performance.now();
    elapsedMs += now - tickAt;
    tickAt = now;
  }

  function startClock() {
    if (doneFlag || !picture) return;
    if (!clockOn) {
      tickAt = performance.now();
      clockOn = true;
    }
  }

  function stopClock() {
    flushTime();
    clockOn = false;
  }

  function saveNow() {
    if (!picture) return;
    flushTime();
    store = writePictureState(store, picture, {
      mask: filled,
      elapsedMs,
      bestMs,
      bestScore,
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* private mode or quota */
    }
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 200);
  }

  function tone(freq, dur, type, gain) {
    audio?.resume?.();
    audio?.tone?.(freq, dur, type, gain);
  }

  let lastBlip = 0;
  function blip() {
    const now = performance.now();
    if (now - lastBlip < 55) return;
    lastBlip = now;
    tone(680, 0.035, 'triangle', 0.16);
  }

  function showToast(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.classList.remove('hidden');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 700);
  }

  function reduced() {
    return reduceMotion;
  }

  function fitTransform() {
    const sw = stage.clientWidth || 1;
    const sh = stage.clientHeight || 1;
    const pad = 16;
    const cell = Math.max(
      4,
      Math.min((sw - pad * 2) / picture.cols, (sh - pad * 2) / picture.rows)
    );
    return clampTransform({
      cell,
      ox: (sw - picture.cols * cell) / 2,
      oy: (sh - picture.rows * cell) / 2,
    });
  }

  function clampTransform(next) {
    const sw = stage.clientWidth || 1;
    const sh = stage.clientHeight || 1;
    const w = picture.cols * next.cell;
    const h = picture.rows * next.cell;
    const m = 16;
    let ox = next.ox;
    let oy = next.oy;
    if (w + m * 2 <= sw) ox = (sw - w) / 2;
    else ox = Math.min(m, Math.max(sw - w - m, ox));
    if (h + m * 2 <= sh) oy = (sh - h) / 2;
    else oy = Math.min(m, Math.max(sh - h - m, oy));
    return { cell: next.cell, ox, oy };
  }

  function applyView(next, user) {
    view.cell = next.cell;
    view.ox = next.ox;
    view.oy = next.oy;
    view.user = user;
  }

  function fit() {
    if (!picture) return;
    anim = null;
    applyView(fitTransform(), false);
    requestDraw();
  }

  function zoomAt(sx, sy, factor) {
    if (!picture) return;
    const min = fitTransform().cell;
    const max = 72;
    const prev = view.cell;
    const nextCell = Math.min(max, Math.max(min, prev * (Number.isFinite(factor) ? factor : 1)));
    if (Math.abs(nextCell - prev) < 0.02) {
      applyView(clampTransform(view), view.user);
      requestDraw();
      return;
    }
    const wx = (sx - view.ox) / prev;
    const wy = (sy - view.oy) / prev;
    const clamped = clampTransform({
      cell: nextCell,
      ox: sx - wx * nextCell,
      oy: sy - wy * nextCell,
    });
    applyView(clamped, nextCell > min + 0.4);
    requestDraw();
  }

  function screenToCell(sx, sy) {
    return {
      x: Math.floor((sx - view.ox) / view.cell),
      y: Math.floor((sy - view.oy) / view.cell),
    };
  }

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function paintFromPointer(sx, sy) {
    if (!picture || doneFlag) return;
    const cell = screenToCell(sx, sy);
    if (cell.x < 0 || cell.y < 0 || cell.x >= picture.cols || cell.y >= picture.rows) return;
    const from = gesture.last || cell;
    const result = applyStroke(picture, filled, from.x, from.y, cell.x, cell.y, gesture.color);
    gesture.last = cell;
    if (result.painted > 0) {
      blip();
      scheduleSave();
      updateChrome();
    }
    if (result.wrong > 0) {
      const now = performance.now();
      for (const wrong of result.wrongCells) {
        flashes.set(wrong.y * picture.cols + wrong.x, now + 180);
      }
      if (!gesture.wrongNoted) {
        gesture.wrongNoted = true;
        audio?.warn?.();
        showToast('Andere Zahl');
      }
      requestDraw();
    }
    if (result.pictureDone) celebrate();
    else if (result.colorDone && result.painted > 0 && !gesture.advanced) {
      gesture.advanced = true;
      selectNext();
    } else if (result.painted > 0 || result.wrong > 0) requestDraw();
  }

  function selectColor(n, userPick) {
    if (!picture) return;
    selected = n;
    hintAfter = -1;
    if (userPick) {
      audio?.click?.();
      panMode = false;
      syncPan();
    }
    renderPalette();
    updateChrome();
    const btn = paletteEl.querySelector(`[data-color="${n}"]`);
    btn?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    requestDraw();
  }

  function selectNext() {
    if (!picture) return;
    const next = firstOpenColor(picture, filled, 0);
    if (next !== selected) {
      audio?.collect?.(1);
      showToast(`Farbe ${selected} fertig`);
    }
    selectColor(next, false);
  }

  function renderPalette() {
    if (!picture) return;
    const progress = colorProgress(picture, filled);
    paletteEl.replaceChildren();
    for (const entry of progress) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'paint-swatch';
      btn.dataset.color = String(entry.n);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', entry.n === selected ? 'true' : 'false');
      btn.setAttribute(
        'aria-label',
        `Farbe ${entry.n}, ${entry.name}, ${entry.done} von ${entry.total}`
      );
      if (entry.n === selected) btn.classList.add('is-on');
      if (entry.complete) btn.classList.add('done');
      const num = document.createElement('strong');
      num.textContent = String(entry.n);
      const chip = document.createElement('span');
      chip.className = 'paint-chip';
      chip.style.background = entry.hex;
      const count = document.createElement('span');
      count.className = 'paint-count';
      count.textContent = entry.complete ? '✓' : `${entry.done}/${entry.total}`;
      const bar = document.createElement('span');
      bar.className = 'paint-bar';
      const fill = document.createElement('span');
      fill.style.width = `${entry.total ? Math.round((entry.done / entry.total) * 100) : 0}%`;
      bar.append(fill);
      btn.append(num, chip, count, bar);
      btn.addEventListener('click', () => selectColor(entry.n, true));
      paletteEl.append(btn);
    }
  }

  function updateChrome() {
    if (!picture) return;
    const total = picture.cells.length;
    const done = filledCount(picture, filled);
    const pct = Math.round((done / total) * 100);
    const name = $('paint-name');
    const meta = $('paint-meta');
    const time = $('paint-time');
    if (name) name.textContent = picture.title;
    const open = colorProgress(picture, filled).find((entry) => entry.n === selected);
    const left = open ? open.total - open.done : 0;
    if (meta) {
      meta.textContent = doneFlag
        ? 'Fertig'
        : left === 0
          ? `${pct}% · Farbe ${selected} fertig`
          : `${pct}% · Farbe ${selected} noch ${left}`;
    }
    if (time) time.textContent = formatDuration(displayMs());
    canvas.setAttribute('aria-label', `${picture.title}, Malen nach Zahlen`);
  }

  function syncPan() {
    const btn = $('paint-pan');
    btn?.setAttribute('aria-pressed', panMode ? 'true' : 'false');
    btn?.classList.toggle('is-on', panMode);
    stage.classList.toggle('is-pan', panMode);
  }

  function showHelpIfNeeded() {
    let seen = false;
    try {
      seen = localStorage.getItem(HELP_KEY) === '1';
    } catch {
      seen = false;
    }
    help?.classList.toggle('hidden', seen);
  }

  function dismissHelp() {
    help?.classList.add('hidden');
    try {
      localStorage.setItem(HELP_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    if (stage.clientWidth < 2 || stage.clientHeight < 2) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    if (!picture) return;
    if (anim) {
      draw();
      return;
    }
    if (!view.user) applyView(fitTransform(), false);
    else applyView(clampTransform(view), true);
    draw();
  }

  function drawBackdrop(w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#12081c');
    g.addColorStop(1, '#070714');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (const star of stars) {
      ctx.globalAlpha = star.a;
      ctx.fillStyle = '#dff6ff';
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawBackdrop(w, h);
    if (!picture) return;
    const cell = view.cell;
    const ox = view.ox;
    const oy = view.oy;
    const clean = doneFlag;
    const boardW = picture.cols * cell;
    const boardH = picture.rows * cell;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 240, 255, 0.2)';
    ctx.shadowBlur = clean ? 28 : 16;
    ctx.fillStyle = clean ? '#0b0b16' : PAPER;
    ctx.fillRect(ox, oy, boardW, boardH);
    ctx.restore();

    const now = performance.now();
    const showGrid = !clean && cell >= 6;
    const showNumbers = !clean && cell >= 18;
    for (let y = 0; y < picture.rows; y++) {
      for (let x = 0; x < picture.cols; x++) {
        const i = y * picture.cols + x;
        const n = picture.cells[i];
        const hex = picture.colors[n - 1].hex;
        const on = clean || filled[i] === 1;
        if (on) ctx.fillStyle = hex;
        else if (n === selected) ctx.fillStyle = lighten(hex, 0.62);
        else ctx.fillStyle = PAPER;
        ctx.fillRect(ox + x * cell, oy + y * cell, cell + 0.4, cell + 0.4);
        const flash = flashes.get(i);
        if (!on && flash && flash > now) {
          ctx.fillStyle = 'rgba(255, 77, 109, 0.55)';
          ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
        } else if (flash && flash <= now) flashes.delete(i);
      }
    }

    if (showGrid) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(20, 16, 40, 0.2)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= picture.cols; x++) {
        const px = ox + x * cell;
        ctx.moveTo(px, oy);
        ctx.lineTo(px, oy + boardH);
      }
      for (let y = 0; y <= picture.rows; y++) {
        const py = oy + y * cell;
        ctx.moveTo(ox, py);
        ctx.lineTo(ox + boardW, py);
      }
      ctx.stroke();
    }

    if (!clean) {
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = '#ffe566';
      for (let y = 0; y < picture.rows; y++) {
        for (let x = 0; x < picture.cols; x++) {
          const i = y * picture.cols + x;
          if (filled[i] || picture.cells[i] !== selected) continue;
          ctx.strokeRect(ox + x * cell + 1.5, oy + y * cell + 1.5, cell - 3, cell - 3);
        }
      }
    }

    if (showNumbers) {
      const size = Math.max(8, Math.floor(cell * 0.46));
      ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, size * 0.16);
      for (let y = 0; y < picture.rows; y++) {
        for (let x = 0; x < picture.cols; x++) {
          const i = y * picture.cols + x;
          if (filled[i]) continue;
          const label = String(picture.cells[i]);
          const cx = ox + (x + 0.5) * cell;
          const cy = oy + (y + 0.5) * cell + 0.5;
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.strokeText(label, cx, cy);
          ctx.fillStyle = '#1a1028';
          ctx.fillText(label, cx, cy);
        }
      }
    }

    if (hintCell && now - hintPulse < 1400) {
      const alpha = 0.35 + 0.65 * Math.abs(Math.sin((now - hintPulse) / 140));
      ctx.strokeStyle = `rgba(255, 229, 102, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(
        ox + hintCell.x * cell + 0.5,
        oy + hintCell.y * cell + 0.5,
        cell - 1,
        cell - 1
      );
    }

    for (const particle of particles) {
      const t = 1 - particle.age / particle.life;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.s, particle.s);
    }
    ctx.globalAlpha = 1;
  }

  function animating() {
    const now = performance.now();
    if (particles.length || anim) return true;
    if (hintCell && now - hintPulse < 1400) return true;
    for (const until of flashes.values()) if (until > now) return true;
    return false;
  }

  function frame(now) {
    rafId = 0;
    const dt = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0.016);
    lastFrame = now;
    if (anim && picture) {
      anim.t += dt / anim.dur;
      const k = Math.min(1, anim.t);
      const e = reduced() ? 1 : 1 - (1 - k) ** 3;
      const next = clampTransform({
        cell: anim.from.cell + (anim.to.cell - anim.from.cell) * e,
        ox: anim.from.ox + (anim.to.ox - anim.from.ox) * e,
        oy: anim.from.oy + (anim.to.oy - anim.from.oy) * e,
      });
      view.cell = next.cell;
      view.ox = next.ox;
      view.oy = next.oy;
      if (k >= 1) anim = null;
    }
    for (const particle of particles) {
      particle.age += dt;
      particle.vy += particle.g * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
    particles = particles.filter((particle) => particle.age < particle.life);
    draw();
    if (animating()) requestDraw();
  }

  function requestDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(frame);
  }

  function cancelLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function burst() {
    if (reduced() || !picture) return;
    particles = [];
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    for (let i = 0; i < 56; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 240;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 50,
        g: 320,
        life: 0.7 + Math.random() * 0.6,
        age: 0,
        color: picture.colors[i % picture.colors.length].hex,
        s: 3 + Math.random() * 4,
      });
    }
    requestDraw();
  }

  function celebrate() {
    if (doneFlag || !picture) return;
    stopClock();
    doneFlag = true;
    const result = finishState({ elapsedMs, bestMs, bestScore }, picture);
    elapsedMs = result.elapsedMs;
    bestMs = result.bestMs;
    bestScore = result.bestScore;
    saveNow();
    gesture = blankGesture();
    pointers.clear();
    pinch = null;
    tone(523, 0.12, 'triangle', 0.22);
    tone(659, 0.14, 'sine', 0.18);
    tone(784, 0.16, 'triangle', 0.16);
    audio?.combo?.(3);
    const fitTo = fitTransform();
    if (reduced()) applyView(fitTo, false);
    else {
      anim = { from: { cell: view.cell, ox: view.ox, oy: view.oy }, to: fitTo, t: 0, dur: 0.45 };
      view.user = false;
    }
    burst();
    const sheet = $('paint-done');
    sheet?.classList.remove('hidden');
    const title = $('paint-done-title');
    const time = $('paint-done-time');
    const score = $('paint-done-score');
    const best = $('paint-done-best');
    if (title) title.textContent = picture.title;
    if (time) time.textContent = `Zeit ${formatDuration(result.elapsedMs)}`;
    if (score) score.textContent = `${result.score} Punkte`;
    if (best) {
      best.textContent = result.isBest
        ? 'Neue Bestzeit'
        : `Bestzeit ${formatDuration(result.bestMs)}`;
    }
    const again = $('paint-done-again');
    if (again) again.textContent = 'NOCHMAL';
    resetArmed = false;
    renderPalette();
    updateChrome();
    requestDraw();
  }

  function hint() {
    if (!picture || doneFlag) return;
    audio?.click?.();
    let color = selected;
    if (colorProgress(picture, filled).find((entry) => entry.n === color)?.complete) {
      color = firstOpenColor(picture, filled, 0);
      selectColor(color, false);
    }
    const target = hintTarget(picture, filled, color, hintAfter);
    if (!target) {
      showToast('Diese Farbe ist fertig');
      return;
    }
    hintAfter = target.index;
    hintCell = { x: target.x, y: target.y };
    hintPulse = performance.now();
    const readable = Math.max(view.cell, Math.min(48, Math.max(28, fitTransform().cell * 1.8)));
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const to = clampTransform({
      cell: readable,
      ox: sw / 2 - (target.x + 0.5) * readable,
      oy: sh / 2 - (target.y + 0.5) * readable,
    });
    if (reduced()) applyView(to, true);
    else anim = { from: { cell: view.cell, ox: view.ox, oy: view.oy }, to, t: 0, dur: 0.4 };
    view.user = true;
    showToast(`Farbe ${color}`);
    requestDraw();
  }

  function openPicture(id) {
    const next = pictureById(id);
    if (!next || !screen) return;
    picture = next;
    store = loadStore();
    const state = readPictureState(store, picture);
    filled = state.mask;
    elapsedMs = state.elapsedMs;
    bestMs = state.bestMs;
    bestScore = state.bestScore;
    doneFlag = state.done;
    selected = firstOpenColor(picture, filled);
    hintAfter = -1;
    hintCell = null;
    panMode = false;
    view.user = false;
    resetArmed = false;
    particles = [];
    flashes.clear();
    gesture = blankGesture();
    pointers.clear();
    pinch = null;
    stars = makeStars(picture.id);
    gallery.classList.add('hidden');
    play.classList.remove('hidden');
    $('paint-done')?.classList.toggle('hidden', !doneFlag);
    const again = $('paint-done-again');
    if (again) again.textContent = 'NOCHMAL';
    if (doneFlag) {
      const result = finishState(
        { elapsedMs, bestMs: elapsedMs, bestScore },
        picture
      );
      const title = $('paint-done-title');
      const time = $('paint-done-time');
      const score = $('paint-done-score');
      const best = $('paint-done-best');
      if (title) title.textContent = picture.title;
      if (time) time.textContent = `Zeit ${formatDuration(elapsedMs)}`;
      if (score) score.textContent = `${bestScore || result.score} Punkte`;
      if (best && bestMs != null) best.textContent = `Bestzeit ${formatDuration(bestMs)}`;
      stopClock();
    } else {
      startClock();
    }
    syncPan();
    showHelpIfNeeded();
    renderPalette();
    updateChrome();
    requestAnimationFrame(() => {
      resizeCanvas();
      if (doneFlag) applyView(fitTransform(), false);
    });
  }

  function showGallery() {
    stopClock();
    saveNow();
    play.classList.add('hidden');
    gallery.classList.remove('hidden');
    picture = null;
    cancelLoop();
    renderGallery();
  }

  function replay() {
    if (!picture) return;
    const again = $('paint-done-again');
    if (!resetArmed) {
      resetArmed = true;
      if (again) again.textContent = 'WIRKLICH NEU?';
      return;
    }
    resetArmed = false;
    stopClock();
    filled = new Uint8Array(picture.cells.length);
    elapsedMs = 0;
    doneFlag = false;
    selected = 1;
    hintAfter = -1;
    hintCell = null;
    particles = [];
    $('paint-done')?.classList.add('hidden');
    if (again) again.textContent = 'NOCHMAL';
    saveNow();
    startClock();
    renderPalette();
    updateChrome();
    fit();
  }

  function resetCurrent() {
    if (!picture || doneFlag) return;
    const btn = $('paint-reset');
    if (!resetArmed) {
      resetArmed = true;
      if (btn) btn.textContent = 'Sicher?';
      return;
    }
    stopClock();
    filled = new Uint8Array(picture.cells.length);
    elapsedMs = 0;
    doneFlag = false;
    selected = 1;
    resetArmed = false;
    if (btn) btn.textContent = 'Neu';
    startClock();
    saveNow();
    renderPalette();
    updateChrome();
    fit();
  }

  function renderGallery() {
    store = loadStore();
    const today = utcDateString();
    const daily = dailyPicture(today);
    const dailyState = readPictureState(store, daily);
    dailyBtn.replaceChildren();
    dailyBtn.append(
      Object.assign(document.createElement('span'), { className: 'paint-kicker', textContent: 'BILD DES TAGES' }),
      Object.assign(document.createElement('strong'), {
        textContent: `${formatDailyLabel(today)} · ${daily.title}`,
      }),
      Object.assign(document.createElement('span'), {
        textContent: progressLabel(daily, dailyState),
      })
    );
    const thumb = document.createElement('canvas');
    thumb.className = 'paint-thumb daily';
    thumb.setAttribute('aria-hidden', 'true');
    dailyBtn.prepend(thumb);
    paintThumb(thumb, daily, dailyState.mask, 84);

    grid.replaceChildren();
    for (const entry of PICTURES) {
      const state = readPictureState(store, entry);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'paint-card';
      card.id = `paint-card-${entry.id}`;
      if (entry.id === daily.id) card.classList.add('is-daily');
      const canvasThumb = document.createElement('canvas');
      canvasThumb.className = 'paint-thumb';
      canvasThumb.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong');
      name.textContent = entry.title;
      const meta = document.createElement('span');
      meta.textContent = `${difficultyLabel(entry.difficulty)} · ${entry.cols}×${entry.rows}`;
      const prog = document.createElement('span');
      prog.className = 'paint-card-progress';
      prog.textContent = progressLabel(entry, state);
      if (entry.id === daily.id) {
        const badge = document.createElement('em');
        badge.textContent = 'Heute';
        card.append(badge);
      }
      card.append(canvasThumb, name, meta, prog);
      card.addEventListener('click', () => {
        audio?.click?.();
        openPicture(entry.id);
      });
      grid.append(card);
      paintThumb(canvasThumb, entry, state.mask, 96);
    }
  }

  function onPointerDown(event) {
    if (!picture || play.classList.contains('hidden')) return;
    if (event.target !== canvas) return;
    audio?.resume?.();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events */
    }
    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    if (pointers.size >= 2) {
      gesture.painting = false;
      gesture.panning = false;
      pinch = pairMetrics();
      return;
    }
    if (event.button === 1 || event.button === 2 || panMode) {
      gesture.panning = true;
      gesture.painting = false;
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || doneFlag) return;
    gesture.painting = true;
    gesture.panning = false;
    gesture.color = selected;
    gesture.last = null;
    gesture.wrongNoted = false;
    resetArmed = false;
    const neu = $('paint-reset');
    if (neu) neu.textContent = 'Neu';
    paintFromPointer(point.x, point.y);
  }

  function onPointerMove(event) {
    const prev = pointers.get(event.pointerId);
    if (!prev || !picture) return;
    const point = localPoint(event);
    const dx = point.x - prev.x;
    const dy = point.y - prev.y;
    pointers.set(event.pointerId, point);
    if (pointers.size >= 2) {
      gesture.painting = false;
      const metrics = pairMetrics();
      if (!pinch || !metrics) {
        pinch = metrics;
        return;
      }
      const factor = pinch.dist > 8 ? metrics.dist / pinch.dist : 1;
      view.ox += metrics.cx - pinch.cx;
      view.oy += metrics.cy - pinch.cy;
      view.user = true;
      pinch = metrics;
      zoomAt(metrics.cx, metrics.cy, factor);
      return;
    }
    if (gesture.panning) {
      view.ox += dx;
      view.oy += dy;
      view.user = true;
      applyView(clampTransform(view), true);
      requestDraw();
      return;
    }
    if (gesture.painting) paintFromPointer(point.x, point.y);
  }

  function onPointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size > 0) return;
    const color = gesture.color;
    const wasPainting = gesture.painting;
    const advanced = gesture.advanced;
    gesture = blankGesture();
    if (!picture || doneFlag) return;
    if (wasPainting && isComplete(picture, filled)) celebrate();
    else if (
      wasPainting &&
      !advanced &&
      colorProgress(picture, filled).find((entry) => entry.n === color)?.complete
    ) {
      selectNext();
    }
    saveNow();
  }

  function pairMetrics() {
    const pts = [...pointers.values()];
    if (pts.length < 2) return null;
    return {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    };
  }

  function onWheel(event) {
    if (!picture || play.classList.contains('hidden')) return;
    event.preventDefault();
    const point = localPoint(event);
    let dy = event.deltaY;
    if (event.deltaMode === 1) dy *= 16;
    else if (event.deltaMode === 2) dy *= stage.clientHeight || 400;
    const factor = Math.exp(-dy * 0.0012);
    zoomAt(point.x, point.y, factor);
  }

  function onKey(event) {
    if (!screen || screen.classList.contains('hidden')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.key === ' ' && tag === 'BUTTON') return;
    if (play.classList.contains('hidden')) {
      if (event.key === 'Escape') onHub();
      return;
    }
    if (event.key === 'Escape') {
      showGallery();
      return;
    }
    if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      hint();
      return;
    }
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      panMode = !panMode;
      syncPan();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.15);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.15);
      return;
    }
    const digit = Number(event.key);
    if (digit >= 1 && digit <= 9 && picture && digit <= picture.colors.length) {
      selectColor(digit, true);
      return;
    }
    const step = 36;
    if (event.key === 'ArrowLeft') view.ox += step;
    else if (event.key === 'ArrowRight') view.ox -= step;
    else if (event.key === 'ArrowUp') view.oy += step;
    else if (event.key === 'ArrowDown') view.oy -= step;
    else return;
    event.preventDefault();
    view.user = true;
    applyView(clampTransform(view), true);
    requestDraw();
  }

  function onContext(event) {
    if (event.target === canvas) event.preventDefault();
  }

  function onVis() {
    if (document.hidden) stopClock();
    else if (picture && !play.classList.contains('hidden') && !doneFlag) startClock();
  }

  const clockTimer = window.setInterval(() => {
    if (!picture || play.classList.contains('hidden') || doneFlag) return;
    const time = $('paint-time');
    if (time) time.textContent = formatDuration(displayMs());
  }, 250);

  const resizeObs = new ResizeObserver(() => {
    if (!picture || play.classList.contains('hidden')) return;
    resizeCanvas();
  });
  resizeObs.observe(stage);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', () => saveNow());

  $('btn-paint-hub')?.addEventListener('click', () => {
    audio?.click?.();
    onHub();
  });
  dailyBtn?.addEventListener('click', () => {
    audio?.click?.();
    openPicture(dailyPicture(utcDateString()).id);
  });
  $('paint-back')?.addEventListener('click', () => {
    audio?.click?.();
    showGallery();
  });
  $('paint-hint')?.addEventListener('click', hint);
  $('paint-pan')?.addEventListener('click', () => {
    audio?.click?.();
    panMode = !panMode;
    syncPan();
  });
  $('paint-reset')?.addEventListener('click', () => {
    audio?.click?.();
    resetCurrent();
  });
  $('paint-help-ok')?.addEventListener('click', () => {
    audio?.click?.();
    dismissHelp();
  });
  $('paint-done-gallery')?.addEventListener('click', () => {
    audio?.click?.();
    showGallery();
  });
  $('paint-done-again')?.addEventListener('click', () => {
    audio?.click?.();
    replay();
  });

  function open() {
    store = loadStore();
    showGallery();
  }

  function pause() {
    stopClock();
    if (picture && !play.classList.contains('hidden')) saveNow();
    pointers.clear();
    pinch = null;
    gesture = blankGesture();
    cancelLoop();
  }

  function getState() {
    return {
      pictureId: picture?.id || null,
      selected,
      done: doneFlag,
      filled: picture ? filledCount(picture, filled) : 0,
      total: picture?.cells.length || 0,
      cols: picture?.cols || 0,
      rows: picture?.rows || 0,
      panMode,
      gallery: gallery ? !gallery.classList.contains('hidden') : true,
      cell: view.cell,
      ox: view.ox,
      oy: view.oy,
      doneText: $('paint-done-score')?.textContent || '',
      meta: $('paint-meta')?.textContent || '',
    };
  }

  return { open, pause, openPicture, getState, destroyClock: () => window.clearInterval(clockTimer) };
}

function progressLabel(picture, state) {
  if (state.done) {
    return state.bestMs != null ? `Fertig · ${formatDuration(state.bestMs)}` : 'Fertig';
  }
  const pct = Math.round((filledCount(picture, state.mask) / picture.cells.length) * 100);
  return pct > 0 ? `${pct}%` : 'Neu';
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {import('./paint.js').PaintPicture} picture
 * @param {Uint8Array} filled
 * @param {number} css
 */
function paintThumb(canvas, picture, filled, css) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(css * dpr);
  canvas.height = Math.floor(css * dpr);
  canvas.style.width = `${css}px`;
  canvas.style.height = `${css}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);
  const cell = Math.min(css / picture.cols, css / picture.rows);
  const ox = (css - picture.cols * cell) / 2;
  const oy = (css - picture.rows * cell) / 2;
  ctx.fillStyle = '#12101c';
  ctx.fillRect(0, 0, css, css);
  ctx.globalAlpha = 0.38;
  for (let y = 0; y < picture.rows; y++) {
    for (let x = 0; x < picture.cols; x++) {
      const n = picture.cells[y * picture.cols + x];
      ctx.fillStyle = picture.colors[n - 1].hex;
      ctx.fillRect(ox + x * cell, oy + y * cell, cell + 0.4, cell + 0.4);
    }
  }
  ctx.globalAlpha = 1;
  for (let y = 0; y < picture.rows; y++) {
    for (let x = 0; x < picture.cols; x++) {
      const i = y * picture.cols + x;
      if (!filled[i]) continue;
      ctx.fillStyle = picture.colors[picture.cells[i] - 1].hex;
      ctx.fillRect(ox + x * cell, oy + y * cell, cell + 0.4, cell + 0.4);
    }
  }
}

function makeStars(id) {
  const rng = mulberry32(hashSeed(`orbit-paint-stars:${id}`));
  const stars = [];
  for (let i = 0; i < 32; i++) {
    stars.push({
      x: rng(),
      y: rng(),
      r: 0.6 + rng() * 1.5,
      a: 0.25 + rng() * 0.55,
    });
  }
  return stars;
}

function lighten(hex, whiteMix) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (channel) => Math.round(channel * (1 - whiteMix) + 255 * whiteMix);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
