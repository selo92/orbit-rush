/**
 * Orbit Paint UI. Gallery, numbered regions, tap/drag fill, pinch and wheel zoom.
 * Full pictures load on demand. Progress stays in localStorage.
 */
import { utcDateString } from './rng.js';
import {
  CATEGORIES,
  LEGACY_KEY,
  PICTURES,
  STORAGE_KEY,
  colorDone,
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
  legacyHasProgress,
  paintRegion,
  parseStore,
  pictureById,
  readPictureState,
  regionCountOf,
  writePictureState,
} from './paint.js';

const HELP_KEY = 'orbit-paint-help-v2';
const LEGACY_NOTE_KEY = 'orbit-paint-v2-seen';
const PAPER = '#f4efe6';
const SVG_NS = 'http://www.w3.org/2000/svg';

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
  const svg = /** @type {SVGSVGElement} */ ($('paint-svg'));
  const paletteEl = $('paint-palette');
  const help = $('paint-help');
  const toast = $('paint-toast');

  /** @type {any} */
  let picture = null;
  /** @type {SVGPathElement[]} */
  let paths = [];
  /** @type {SVGTextElement[]} */
  let labels = [];
  /** @type {SVGGElement | null} */
  let world = null;
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
  /** @type {{ from: {s:number,ox:number,oy:number}, to: {s:number,ox:number,oy:number}, t: number, dur: number } | null} */
  let anim = null;
  /** @type {Map<number, {x:number,y:number,cx:number,cy:number}>} */
  const pointers = new Map();
  /** @type {{ dist: number, cx: number, cy: number } | null} */
  let pinch = null;
  let gesture = blankGesture();
  let openToken = 0;
  const view = { s: 1, ox: 0, oy: 0, user: false };
  /** @type {Map<string, any>} */
  const artCache = new Map();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

  function blankGesture() {
    return {
      painting: false,
      panning: false,
      color: 1,
      /** @type {{cx:number,cy:number} | null} */
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

  function fitTransform() {
    const sw = stage.clientWidth || 1;
    const sh = stage.clientHeight || 1;
    const s = Math.min(sw / picture.w, sh / picture.h) * 0.94;
    return {
      s,
      ox: (sw - picture.w * s) / 2,
      oy: (sh - picture.h * s) / 2,
    };
  }

  function clampTransform(next) {
    const sw = stage.clientWidth || 1;
    const sh = stage.clientHeight || 1;
    const fit = fitTransform();
    const s = Math.max(fit.s * 0.7, Math.min(fit.s * 12, next.s));
    const w = picture.w * s;
    const h = picture.h * s;
    const margin = 48;
    return {
      s,
      ox: Math.max(margin - w, Math.min(sw - margin, next.ox)),
      oy: Math.max(margin - h, Math.min(sh - margin, next.oy)),
    };
  }

  function applyView(next, user) {
    const clamped = clampTransform(next);
    view.s = clamped.s;
    view.ox = clamped.ox;
    view.oy = clamped.oy;
    if (user) view.user = true;
    if (world) {
      world.setAttribute('transform', `translate(${view.ox} ${view.oy}) scale(${view.s})`);
    }
    syncLabels();
  }

  function fit() {
    if (!picture) return;
    view.user = false;
    applyView(fitTransform(), false);
  }

  function zoomAt(sx, sy, factor) {
    if (!picture) return;
    const fitScale = fitTransform().s;
    const nextScale = Math.max(fitScale * 0.7, Math.min(fitScale * 12, view.s * factor));
    const k = view.s > 0 ? nextScale / view.s : 1;
    view.user = true;
    applyView(
      {
        s: nextScale,
        ox: sx - (sx - view.ox) * k,
        oy: sy - (sy - view.oy) * k,
      },
      true
    );
  }

  function syncLabels() {
    if (!labels.length || !picture) return;
    const scale = view.s || 1;
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const region = picture.regions[i];
      const visible = !doneFlag && !filled[i] && region.r * scale >= 9;
      if (!visible) {
        label.setAttribute('display', 'none');
        continue;
      }
      label.removeAttribute('display');
      const size = Math.min(region.r * 0.82, 16 / scale);
      label.setAttribute('font-size', size.toFixed(2));
    }
  }

  function styleRegion(index) {
    const path = paths[index];
    const region = picture.regions[index];
    if (!path || !region) return;
    const hex = picture.colors[region.n - 1].hex;
    path.classList.remove('is-hot', 'is-wrong', 'is-hint');
    if (filled[index] || doneFlag) path.setAttribute('fill', hex);
    else if (region.n === selected) {
      path.setAttribute('fill', lighten(hex, 0.62));
      path.classList.add('is-hot');
    } else path.setAttribute('fill', PAPER);
  }

  function styleAll() {
    for (let i = 0; i < paths.length; i++) styleRegion(i);
    svg.classList.toggle('is-done', doneFlag);
    syncLabels();
  }

  function localPoint(event) {
    const rect = stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function regionAt(clientX, clientY) {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
      const raw = el.getAttribute?.('data-i');
      if (raw != null && raw !== '') return Number(raw);
    }
    return -1;
  }

  function paintIndex(index) {
    if (!picture || doneFlag || index < 0) return;
    const result = paintRegion(picture, filled, index, gesture.color);
    if (result === 'painted') {
      styleRegion(index);
      syncLabels();
      blip();
      scheduleSave();
      updateChrome();
      renderPalette();
      if (isComplete(picture, filled)) celebrate();
      else if (colorDone(picture, filled, gesture.color) && !gesture.advanced) {
        gesture.advanced = true;
        selectNext();
      }
      return;
    }
    if (result === 'wrong' && !gesture.wrongNoted) {
      gesture.wrongNoted = true;
      paths[index]?.classList.add('is-wrong');
      window.setTimeout(() => paths[index]?.classList.remove('is-wrong'), 220);
      audio?.warn?.();
      showToast('Andere Zahl');
    }
  }

  function paintFromPointer(clientX, clientY) {
    const prev = gesture.last;
    gesture.last = { cx: clientX, cy: clientY };
    if (!prev) {
      paintIndex(regionAt(clientX, clientY));
      return;
    }
    const dist = Math.hypot(clientX - prev.cx, clientY - prev.cy);
    const steps = Math.max(1, Math.ceil(dist / 7));
    let last = -2;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = prev.cx + (clientX - prev.cx) * t;
      const y = prev.cy + (clientY - prev.cy) * t;
      const index = regionAt(x, y);
      if (index === last) continue;
      last = index;
      paintIndex(index);
      if (doneFlag) return;
    }
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
    styleAll();
    const btn = paletteEl.querySelector(`[data-color="${n}"]`);
    btn?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
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
    const existing = paletteEl.querySelectorAll('.paint-swatch');
    if (existing.length === progress.length) {
      progress.forEach((entry, index) => {
        const btn = existing[index];
        btn.classList.toggle('is-on', entry.n === selected);
        btn.classList.toggle('done', entry.complete);
        btn.setAttribute('aria-selected', entry.n === selected ? 'true' : 'false');
        const num = btn.querySelector('strong');
        const count = btn.querySelector('.paint-count');
        const span = btn.querySelector('.paint-bar span');
        if (num) num.textContent = entry.complete ? '✓' : String(entry.n);
        if (count) count.textContent = entry.complete ? entry.name : `${entry.done}/${entry.total}`;
        if (span) span.style.width = `${entry.total ? (entry.done / entry.total) * 100 : 0}%`;
      });
      return;
    }
    paletteEl.replaceChildren();
    for (const entry of progress) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'paint-swatch';
      btn.dataset.color = String(entry.n);
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', entry.n === selected ? 'true' : 'false');
      if (entry.n === selected) btn.classList.add('is-on');
      if (entry.complete) btn.classList.add('done');
      const num = document.createElement('strong');
      num.textContent = entry.complete ? '✓' : String(entry.n);
      const chip = document.createElement('span');
      chip.className = 'paint-chip';
      chip.style.background = entry.hex;
      const count = document.createElement('span');
      count.className = 'paint-count';
      count.textContent = entry.complete ? entry.name : `${entry.done}/${entry.total}`;
      const bar = document.createElement('span');
      bar.className = 'paint-bar';
      const span = document.createElement('span');
      span.style.width = `${entry.total ? (entry.done / entry.total) * 100 : 0}%`;
      bar.append(span);
      btn.append(num, chip, count, bar);
      btn.addEventListener('click', () => selectColor(entry.n, true));
      paletteEl.append(btn);
    }
  }

  function updateChrome() {
    const name = $('paint-name');
    const meta = $('paint-meta');
    const time = $('paint-time');
    if (name && picture) name.textContent = picture.title;
    if (time) time.textContent = formatDuration(displayMs());
    if (!meta || !picture) return;
    const total = regionCountOf(picture);
    const pct = total ? Math.round((filledCount(picture, filled) / total) * 100) : 0;
    if (doneFlag) {
      meta.textContent = 'Fertig';
      return;
    }
    const open = colorProgress(picture, filled).find((entry) => entry.n === selected);
    const left = open ? open.total - open.done : 0;
    meta.textContent = open?.complete
      ? `${pct}% · Farbe ${selected} fertig`
      : `${pct}% · Farbe ${selected} noch ${left}`;
  }

  function syncPan() {
    const btn = $('paint-pan');
    btn?.classList.toggle('is-on', panMode);
    btn?.setAttribute('aria-pressed', panMode ? 'true' : 'false');
    stage.classList.toggle('is-pan', panMode);
  }

  function showHelpIfNeeded() {
    let seen = false;
    try {
      seen = localStorage.getItem(HELP_KEY) === '1';
    } catch {
      seen = true;
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

  function mountBoard() {
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${stage.clientWidth || 1} ${stage.clientHeight || 1}`);
    svg.classList.toggle('is-done', doneFlag);
    world = document.createElementNS(SVG_NS, 'g');
    paths = [];
    labels = [];
    for (let i = 0; i < picture.regions.length; i++) {
      const region = picture.regions[i];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', region.d);
      path.setAttribute('data-i', String(i));
      path.setAttribute('class', 'paint-region');
      world.append(path);
      paths.push(path);
    }
    for (let i = 0; i < picture.regions.length; i++) {
      const region = picture.regions[i];
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('class', 'paint-num');
      text.setAttribute('x', String(region.x));
      text.setAttribute('y', String(region.y));
      text.textContent = String(region.n);
      world.append(text);
      labels.push(text);
    }
    svg.append(world);
    styleAll();
  }

  function resizeBoard() {
    if (!picture || play.classList.contains('hidden')) return;
    if (stage.clientWidth < 2 || stage.clientHeight < 2) return;
    svg.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
    if (anim) return;
    if (!view.user) fit();
    else applyView(view, true);
  }

  function burst() {
    if (reduceMotion) return;
    const layer = document.createElement('div');
    layer.className = 'paint-fx';
    const colors = picture.colors.map((color) => color.hex);
    for (let i = 0; i < 18; i++) {
      const bit = document.createElement('i');
      bit.style.left = `${40 + Math.random() * 20}%`;
      bit.style.top = `${30 + Math.random() * 20}%`;
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty('--dx', `${(Math.random() - 0.5) * 180}px`);
      bit.style.setProperty('--dy', `${-40 - Math.random() * 120}px`);
      layer.append(bit);
    }
    stage.append(layer);
    window.setTimeout(() => layer.remove(), 900);
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
    styleAll();
    const fitTo = fitTransform();
    if (reduceMotion) applyView(fitTo, false);
    else {
      anim = { from: { s: view.s, ox: view.ox, oy: view.oy }, to: fitTo, t: 0, dur: 0.45 };
      view.user = false;
      requestFrame();
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
      best.textContent = result.isBest ? 'Neue Bestzeit' : `Bestzeit ${formatDuration(result.bestMs)}`;
    }
    const again = $('paint-done-again');
    if (again) again.textContent = 'NOCHMAL';
    resetArmed = false;
    renderPalette();
    updateChrome();
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
    paths.forEach((path) => path.classList.remove('is-hint'));
    paths[target.index]?.classList.add('is-hint');
    const region = picture.regions[target.index];
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const want = Math.max(view.s, Math.min(fitTransform().s * 12, 26 / Math.max(8, region.r)));
    const to = clampTransform({
      s: want,
      ox: sw / 2 - region.x * want,
      oy: sh / 2 - region.y * want,
    });
    if (reduceMotion) applyView(to, true);
    else {
      anim = { from: { s: view.s, ox: view.ox, oy: view.oy }, to, t: 0, dur: 0.4 };
      view.user = true;
      requestFrame();
    }
    showToast(`Farbe ${color}`);
  }

  function frame(now) {
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    if (anim) {
      anim.t += dt;
      const k = Math.min(1, anim.t / anim.dur);
      const e = 1 - (1 - k) ** 3;
      applyView(
        {
          s: anim.from.s + (anim.to.s - anim.from.s) * e,
          ox: anim.from.ox + (anim.to.ox - anim.from.ox) * e,
          oy: anim.from.oy + (anim.to.oy - anim.from.oy) * e,
        },
        false
      );
      if (k >= 1) anim = null;
    }
    if (anim) rafId = requestAnimationFrame(frame);
    else {
      rafId = 0;
      lastFrame = 0;
    }
  }

  function requestFrame() {
    if (rafId) return;
    lastFrame = 0;
    rafId = requestAnimationFrame(frame);
  }

  function cancelLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    anim = null;
    lastFrame = 0;
  }

  async function fetchArt(id) {
    if (artCache.has(id)) return artCache.get(id);
    const res = await fetch(`/paint/${id}.json`);
    if (!res.ok) throw new Error(`paint ${id} ${res.status}`);
    const json = await res.json();
    artCache.set(id, json);
    return json;
  }

  function hydrate(meta, json) {
    const box = String(json.viewBox || meta.viewBox).split(/[\s,]+/).map(Number);
    if (!json.regions || json.regions.length !== meta.regionCount) {
      throw new Error(`${meta.id} region mismatch`);
    }
    return {
      ...meta,
      colors: json.colors,
      regions: json.regions,
      w: box[2],
      h: box[3],
    };
  }

  async function openPicture(id) {
    const meta = pictureById(id);
    if (!meta || !screen) return;
    if (picture && picture.id !== id) {
      stopClock();
      saveNow();
    }
    const token = ++openToken;
    picture = null;
    paths = [];
    labels = [];
    world = null;
    svg.replaceChildren();
    doneFlag = false;
    gallery.classList.add('hidden');
    play.classList.remove('hidden');
    $('paint-done')?.classList.add('hidden');
    const name = $('paint-name');
    const metaEl = $('paint-meta');
    if (name) name.textContent = meta.title;
    if (metaEl) metaEl.textContent = 'Lädt…';
    let json;
    try {
      json = await fetchArt(id);
    } catch {
      if (token !== openToken) return;
      showToast('Bild fehlt');
      showGallery();
      return;
    }
    if (token !== openToken) return;
    picture = hydrate(meta, json);
    store = loadStore();
    const state = readPictureState(store, picture);
    filled = state.mask;
    elapsedMs = state.elapsedMs;
    bestMs = state.bestMs;
    bestScore = state.bestScore;
    doneFlag = state.done;
    selected = firstOpenColor(picture, filled);
    hintAfter = -1;
    panMode = false;
    view.user = false;
    resetArmed = false;
    gesture = blankGesture();
    pointers.clear();
    pinch = null;
    $('paint-done')?.classList.toggle('hidden', !doneFlag);
    const again = $('paint-done-again');
    if (again) again.textContent = 'NOCHMAL';
    if (doneFlag) {
      const result = finishState({ elapsedMs, bestMs: elapsedMs, bestScore }, picture);
      const title = $('paint-done-title');
      const time = $('paint-done-time');
      const score = $('paint-done-score');
      const best = $('paint-done-best');
      if (title) title.textContent = picture.title;
      if (time) time.textContent = `Zeit ${formatDuration(elapsedMs)}`;
      if (score) score.textContent = `${bestScore || result.score} Punkte`;
      if (best && bestMs != null) best.textContent = `Bestzeit ${formatDuration(bestMs)}`;
      stopClock();
    } else startClock();
    syncPan();
    showHelpIfNeeded();
    mountBoard();
    renderPalette();
    updateChrome();
    requestAnimationFrame(() => {
      resizeBoard();
      if (doneFlag) applyView(fitTransform(), false);
    });
  }

  function showGallery() {
    stopClock();
    saveNow();
    openToken += 1;
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
    filled = new Uint8Array(picture.regions.length);
    elapsedMs = 0;
    doneFlag = false;
    selected = 1;
    hintAfter = -1;
    $('paint-done')?.classList.add('hidden');
    if (again) again.textContent = 'NOCHMAL';
    saveNow();
    startClock();
    styleAll();
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
    filled = new Uint8Array(picture.regions.length);
    elapsedMs = 0;
    doneFlag = false;
    selected = 1;
    resetArmed = false;
    if (btn) btn.textContent = 'Neu';
    startClock();
    saveNow();
    styleAll();
    renderPalette();
    updateChrome();
    fit();
  }

  function progressLabel(entry, state) {
    if (state.done) return state.bestMs != null ? `Fertig · ${formatDuration(state.bestMs)}` : 'Fertig';
    const pct = Math.round((filledCount(entry, state.mask) / entry.regionCount) * 100);
    return pct > 0 ? `${pct}%` : 'Neu';
  }

  function renderLegacy() {
    const note = $('paint-legacy');
    if (!note) return;
    let show = false;
    try {
      show = legacyHasProgress(localStorage.getItem(LEGACY_KEY)) && localStorage.getItem(LEGACY_NOTE_KEY) !== '1';
    } catch {
      show = false;
    }
    note.classList.toggle('hidden', !show);
  }

  function dismissLegacy() {
    try {
      localStorage.setItem(LEGACY_NOTE_KEY, '1');
    } catch {
      /* ignore */
    }
    $('paint-legacy')?.classList.add('hidden');
  }

  function renderGallery() {
    store = loadStore();
    renderLegacy();
    const today = utcDateString();
    const daily = dailyPicture(today);
    const dailyState = readPictureState(store, daily);
    dailyBtn.replaceChildren();
    const thumb = document.createElement('img');
    thumb.className = 'paint-thumb';
    thumb.alt = '';
    thumb.src = `/paint/thumbs/${daily.id}.svg`;
    dailyBtn.append(
      thumb,
      Object.assign(document.createElement('span'), { className: 'paint-kicker', textContent: 'BILD DES TAGES' }),
      Object.assign(document.createElement('strong'), {
        textContent: `${formatDailyLabel(today)} · ${daily.title}`,
      }),
      Object.assign(document.createElement('span'), { textContent: progressLabel(daily, dailyState) })
    );
    grid.replaceChildren();
    for (const cat of CATEGORIES) {
      const heading = document.createElement('h2');
      heading.className = 'paint-cat';
      heading.textContent = cat.title;
      grid.append(heading);
      for (const entry of PICTURES) {
        if (entry.category !== cat.id) continue;
        const state = readPictureState(store, entry);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'paint-card';
        card.id = `paint-card-${entry.id}`;
        if (entry.id === daily.id) card.classList.add('is-daily');
        const img = document.createElement('img');
        img.className = 'paint-thumb';
        img.alt = '';
        img.loading = 'lazy';
        img.src = `/paint/thumbs/${entry.id}.svg`;
        const name = document.createElement('strong');
        name.textContent = entry.title;
        const meta = document.createElement('span');
        meta.textContent = `${difficultyLabel(entry.difficulty)} · ${entry.regionCount} Flächen`;
        const prog = document.createElement('span');
        prog.className = 'paint-card-progress';
        prog.textContent = progressLabel(entry, state);
        if (entry.id === daily.id) {
          const badge = document.createElement('em');
          badge.textContent = 'Heute';
          card.append(badge);
        }
        card.append(img, name, meta, prog);
        card.addEventListener('click', () => {
          audio?.click?.();
          openPicture(entry.id);
        });
        grid.append(card);
      }
    }
  }

  function onPointerDown(event) {
    if (!picture || play.classList.contains('hidden')) return;
    if (event.target instanceof Element && event.target.closest('#paint-done, #paint-toast, button')) return;
    audio?.resume?.();
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events */
    }
    const point = localPoint(event);
    pointers.set(event.pointerId, { x: point.x, y: point.y, cx: event.clientX, cy: event.clientY });
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
    gesture.advanced = false;
    resetArmed = false;
    const neu = $('paint-reset');
    if (neu) neu.textContent = 'Neu';
    paintFromPointer(event.clientX, event.clientY);
  }

  function onPointerMove(event) {
    const prev = pointers.get(event.pointerId);
    if (!prev || !picture) return;
    const point = localPoint(event);
    const dx = point.x - prev.x;
    const dy = point.y - prev.y;
    pointers.set(event.pointerId, { x: point.x, y: point.y, cx: event.clientX, cy: event.clientY });
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
      applyView(view, true);
      return;
    }
    if (gesture.painting) paintFromPointer(event.clientX, event.clientY);
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
    applyView(view, true);
  }

  function onContext(event) {
    if (stage.contains(event.target)) event.preventDefault();
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
    resizeBoard();
  });
  resizeObs.observe(stage);

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('contextmenu', onContext);
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
  $('paint-legacy-ok')?.addEventListener('click', () => {
    audio?.click?.();
    dismissLegacy();
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
      category: picture?.category || null,
      selected,
      done: doneFlag,
      filled: picture ? filledCount(picture, filled) : 0,
      total: picture ? regionCountOf(picture) : 0,
      panMode,
      gallery: gallery ? !gallery.classList.contains('hidden') : true,
      scale: view.s,
      ox: view.ox,
      oy: view.oy,
      doneText: $('paint-done-score')?.textContent || '',
      meta: $('paint-meta')?.textContent || '',
    };
  }

  return { open, pause, openPicture, getState, destroyClock: () => window.clearInterval(clockTimer) };
}

function lighten(hex, whiteMix) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (channel) => Math.round(channel * (1 - whiteMix) + 255 * whiteMix);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
