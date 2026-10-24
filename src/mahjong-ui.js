/**
 * Orbit Mahjong screen: menu, board, sounds, and the win card.
 * The rules live in mahjong.js. This file only draws and listens.
 */
import {
  LAYOUTS,
  MahjongGame,
  getMahjongDifficulty,
  layoutMeta,
  normalizeLayout,
  normalizeMahjongDifficulty,
  readBest,
  writeBest,
} from './mahjong.js';
import { faceLabel, tileSvg } from './mahjong-art.js';
import { submitScore, sanitizeName, beginScoreRun } from './leaderboard.js';
import { mulberry32 } from './rng.js';
import { inspectName } from '../shared/scores.js';
import { getOrCreateClientId, loadPlayerName, savePlayerName } from './identity.js';

const LS_LAYOUT = 'orbit-mahjong-layout';
const LS_DIFF = 'orbit-mahjong-difficulty';
const LS_DIM = 'orbit-mahjong-dim';

const UNIT = 26;
const ROW = 35;
const LIFT = 16;
const TILE_W = 56;
const TILE_H = 74;

const $ = (id) => document.getElementById(id);

function clock(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function germanStatus(res) {
  if (!res) return 'Gespeichert.';
  if (res.duplicate) {
    return res.rank ? `Schon auf der Liste. Platz ${res.rank}.` : 'Schon auf der Liste.';
  }
  if (res.rateLimited) return 'Auf diesem Gerät gespeichert. Die Liste bittet um eine Pause.';
  if (res.rejected) return 'Auf diesem Gerät gespeichert. Die Liste hat diesen Lauf nicht angenommen.';
  if (res.fallback || res.source !== 'api') {
    return res.rank ? `Auf diesem Gerät gespeichert. Platz ${res.rank}.` : 'Auf diesem Gerät gespeichert.';
  }
  return res.rank ? `In der Bestenliste. Platz ${res.rank}.` : 'In der Bestenliste gespeichert.';
}

/**
 * @param {{ audio?: object, onHub?: () => void, onLeaderboard?: () => void }} hooks
 */
export function mountMahjong(hooks) {
  const audio = hooks.audio || {};
  const game = new MahjongGame();
  const menu = $('mj-menu');
  const table = $('mj-table');
  const board = $('mj-board');
  const clip = $('mj-clip');
  const notice = $('mj-notice');
  const win = $('mj-win');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let layoutId = normalizeLayout(readStore(LS_LAYOUT) || 'schildkroete');
  let difficultyId = normalizeMahjongDifficulty(readStore(LS_DIFF) || 'mittel');
  let dimmed = readStore(LS_DIM) !== '0';
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let boardPx = { w: 1, h: 1 };
  let raf = 0;
  let lastTs = 0;
  let toastTimer = 0;
  let confettiFrame = 0;
  /** @type {Map<number, { x: number, y: number, sx: number, sy: number }>} */
  const pointers = new Map();
  let gesture = null;

  function readStore(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }

  function syncMenu() {
    document.querySelectorAll('[data-layout]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-layout') === layoutId ? 'true' : 'false');
    });
    document.querySelectorAll('[data-mj-diff]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-mj-diff') === difficultyId ? 'true' : 'false');
    });
    const best = readBest(layoutId, difficultyId);
    const label = `${layoutMeta(layoutId).label} · ${getMahjongDifficulty(difficultyId).label}`;
    const line = $('mj-menu-best');
    if (line) {
      line.innerHTML = `Rekord ${label}: <strong id="mj-menu-best-val">${best > 0 ? best : '—'}</strong>`;
    }
  }

  function applyTransform() {
    board.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }

  function fit(mode = 'board') {
    const rect = clip.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return false;
    const pad = 8;
    const contain = Math.min((rect.width - pad) / boardPx.w, (rect.height - pad) / boardPx.h);
    let next = contain;
    if (mode === 'tap') {
      const tap = 46 / TILE_W;
      if (contain < tap) next = tap;
    }
    scale = Math.max(0.18, Math.min(next, mode === 'tap' ? 1.85 : 2.6));
    panX = (rect.width - boardPx.w * scale) / 2;
    panY = (rect.height - boardPx.h * scale) / 2;
    applyTransform();
    return true;
  }

  function fitPlay() {
    if (!fit('board')) return false;
    if (TILE_W * scale < 40) fit('tap');
    return true;
  }

  function zoomBy(factor) {
    const rect = clip.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const next = Math.max(0.18, Math.min(3.2, scale * factor));
    const k = next / scale;
    panX = cx - (cx - panX) * k;
    panY = cy - (cy - panY) * k;
    scale = next;
    applyTransform();
  }

  function renderBoard() {
    const tiles = game.tiles;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const placed = tiles.map((tile) => {
      const x = tile.x * UNIT - tile.z * LIFT;
      const y = tile.y * ROW - tile.z * LIFT;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + TILE_W);
      maxY = Math.max(maxY, y + TILE_H);
      return { tile, x, y };
    });
    const pad = 18;
    boardPx = { w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    board.style.width = `${boardPx.w}px`;
    board.style.height = `${boardPx.h}px`;
    board.replaceChildren();
    for (const { tile, x, y } of placed) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mj-tile';
      btn.dataset.id = String(tile.id);
      btn.style.left = `${x - minX + pad}px`;
      btn.style.top = `${y - minY + pad}px`;
      btn.style.zIndex = String(tile.z * 1000 + tile.y * 6 + tile.x);
      btn.innerHTML = `<span class="mj-slab"></span><span class="mj-face">${tileSvg(tile.suit, tile.rank)}</span>`;
      btn.setAttribute('aria-label', faceLabel(tile));
      board.appendChild(btn);
    }
    board.classList.toggle('is-dim', dimmed);
  }

  function paint() {
    const snap = game.snapshot();
    const hint = new Set(snap.hintPair || []);
    board.querySelectorAll('.mj-tile').forEach((el) => {
      const id = Number(el.dataset.id);
      const tile = game.tile(id);
      if (!tile) return;
      const flying = el.classList.contains('is-out');
      el.classList.toggle('is-gone', tile.removed && !flying);
      el.classList.toggle('is-free', !tile.removed && game.isFreeId(id));
      el.classList.toggle('is-selected', snap.selectedId === id);
      el.classList.toggle('is-hint', hint.has(id));
      el.disabled = tile.removed;
      el.setAttribute('aria-label', faceLabel(tile));
    });
    $('mj-layout-name').textContent = snap.layoutLabel;
    $('mj-diff-name').textContent = snap.difficultyLabel;
    $('mj-score').textContent = String(snap.score);
    $('mj-pairs').textContent = String(snap.remainingPairs);
    $('mj-time').textContent = clock(snap.elapsedMs);
    const combo = $('mj-combo');
    if (snap.combo >= 2) {
      combo.hidden = false;
      $('mj-combo-val').textContent = `×${snap.combo}`;
    } else {
      combo.hidden = true;
    }
    $('mj-hint').textContent = `Hinweis ${snap.hintsLeft}`;
    $('mj-shuffle').textContent = `Mischen ${snap.shufflesLeft}`;
    $('mj-hint').disabled = snap.won || snap.hintsLeft <= 0;
    $('mj-undo').disabled = !snap.canUndo;
    $('mj-shuffle').disabled = snap.won || !snap.stuck || snap.shufflesLeft <= 0;
    $('mj-dim').setAttribute('aria-pressed', dimmed ? 'true' : 'false');
    if (!toastTimer) {
      if (snap.stuck) {
        notice.classList.remove('hidden');
        notice.textContent =
          snap.shufflesLeft > 0 ? 'Keine Züge mehr' : 'Keine Züge mehr. Nimm einen Zug zurück.';
      } else {
        notice.classList.add('hidden');
      }
    }
    return snap;
  }

  function flash(text) {
    notice.textContent = text;
    notice.classList.remove('hidden');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastTimer = 0;
      paint();
    }, 1100);
  }

  function refreshFaces() {
    for (const el of board.querySelectorAll('.mj-tile')) {
      const tile = game.tile(Number(el.dataset.id));
      if (!tile) continue;
      const face = el.querySelector('.mj-face');
      if (face) face.innerHTML = tileSvg(tile.suit, tile.rank);
      el.classList.remove('is-out', 'is-gone', 'is-selected', 'is-hint');
    }
  }

  function fly(ids) {
    const boardRect = board.getBoundingClientRect();
    const cx = boardRect.left + boardRect.width / 2;
    const cy = boardRect.top + boardRect.height / 2;
    for (const id of ids) {
      const el = board.querySelector(`[data-id="${id}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dx = (cx - (rect.left + rect.width / 2)) / scale;
      const dy = (cy - (rect.top + rect.height / 2)) / scale;
      el.style.setProperty('--dx', `${dx}px`);
      el.style.setProperty('--dy', `${dy}px`);
      el.classList.add('is-out');
      el.classList.remove('is-selected');
      for (let i = 0; i < 6; i++) {
        const spark = document.createElement('i');
        spark.className = 'mj-spark';
        spark.style.setProperty('--sx', `${(Math.random() - 0.5) * 84}px`);
        spark.style.setProperty('--sy', `${-20 - Math.random() * 70}px`);
        el.appendChild(spark);
        spark.addEventListener('animationend', () => spark.remove(), { once: true });
      }
      el.addEventListener(
        'animationend',
        (event) => {
          if (event.target !== el) return;
          el.classList.remove('is-out');
          el.classList.add('is-gone');
        },
        { once: true }
      );
    }
  }

  function burst() {
    const canvas = $('mj-confetti');
    if (!canvas || reduced) return;
    const rect = clip.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.classList.remove('hidden');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ['#00f0ff', '#ff2bd6', '#f0c14a', '#7dffa8', '#fff6e8', '#8b5cff'];
    const bits = Array.from({ length: 84 }, () => ({
      x: rect.width * (0.15 + Math.random() * 0.7),
      y: rect.height * 0.42,
      vx: (Math.random() - 0.5) * 460,
      vy: -160 - Math.random() * 320,
      w: 4 + Math.random() * 5,
      h: 7 + Math.random() * 7,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 9,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1,
    }));
    let prev = performance.now();
    const step = (now) => {
      const dt = Math.min(0.033, (now - prev) / 1000);
      prev = now;
      ctx.clearRect(0, 0, rect.width, rect.height);
      let alive = false;
      for (const bit of bits) {
        bit.vy += 640 * dt;
        bit.x += bit.vx * dt;
        bit.y += bit.vy * dt;
        bit.rot += bit.vr * dt;
        bit.life -= dt * 0.38;
        if (bit.life <= 0) continue;
        alive = true;
        ctx.save();
        ctx.translate(bit.x, bit.y);
        ctx.rotate(bit.rot);
        ctx.globalAlpha = Math.max(0, bit.life);
        ctx.fillStyle = bit.color;
        ctx.fillRect(-bit.w / 2, -bit.h / 2, bit.w, bit.h);
        ctx.restore();
      }
      if (alive) confettiFrame = requestAnimationFrame(step);
      else canvas.classList.add('hidden');
    };
    cancelAnimationFrame(confettiFrame);
    confettiFrame = requestAnimationFrame(step);
  }

  async function submitWin(result) {
    const status = $('mj-win-status');
    const name = sanitizeName(loadPlayerName());
    const form = $('mj-win-form');
    if (!name) {
      form?.classList.remove('hidden');
      if (status) status.textContent = 'Name eintragen, dann geht der Punkt auf die Liste.';
      return;
    }
    form?.classList.add('hidden');
    if (status) status.textContent = 'Speichern…';
    try {
      const res = await submitScore({
        name,
        clientId: getOrCreateClientId(),
        score: result.score,
        survivalMs: result.survivalMs,
        orbs: result.orbs,
        comboBonus: result.comboBonus,
        nearMisses: result.nearMisses,
        difficulty: result.difficulty,
        mode: 'normal',
        game: 'mahjong',
        mahjongLog: result.mahjongLog,
      });
      if (status) status.textContent = germanStatus(res);
    } catch (err) {
      if (status) status.textContent = err?.message || 'Senden fehlgeschlagen.';
    }
  }

  function showWin() {
    const result = game.result();
    const saved = writeBest(result.layout, result.difficulty, result.score);
    const best = readBest(result.layout, result.difficulty);
    $('mj-win-time').textContent = `Zeit ${clock(result.elapsedMs)}`;
    $('mj-win-score').textContent = String(result.score);
    $('mj-win-formula').textContent = result.formula;
    $('mj-win-best').textContent = saved.record
      ? `Neuer Rekord · ${result.layoutLabel} · ${getMahjongDifficulty(result.difficulty).label}`
      : `Rekord ${result.layoutLabel} · ${getMahjongDifficulty(result.difficulty).label}: ${best || result.score}`;
    $('mj-win-tag').textContent = `${result.layoutLabel} · ${getMahjongDifficulty(result.difficulty).label}`;
    win.classList.remove('hidden');
    audio.mahjongWin?.();
    burst();
    void submitWin(result);
  }

  function afterAction(action) {
    if (action?.type === 'blocked') {
      audio.mahjongDeny?.();
      const el = board.querySelector(`[data-id="${action.id}"]`);
      el?.classList.add('is-shake');
      window.setTimeout(() => el?.classList.remove('is-shake'), 220);
    } else if (action?.type === 'select') {
      audio.mahjongTap?.();
    } else if (action?.type === 'mismatch') {
      audio.mahjongDeny?.();
    } else if (action?.type === 'match' || action?.type === 'win') {
      audio.mahjongMatch?.(action.combo || 1);
      fly(action.ids || []);
    }
    const snap = paint();
    if (action?.type === 'win' || snap.won) showWin();
  }

  function onTile(id) {
    if (win && !win.classList.contains('hidden')) return;
    afterAction(game.select(id));
  }

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (!document.hidden && game.running && !game.paused && !game.won) {
      game.advance(dt);
      const time = $('mj-time');
      if (time) time.textContent = clock(game.elapsedMs);
    }
    raf = requestAnimationFrame(loop);
  }

  function startLoop() {
    cancelAnimationFrame(raf);
    lastTs = 0;
    raf = requestAnimationFrame(loop);
  }

  function stopLoop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  async function begin() {
    audio.resume?.();
    audio.mahjongTap?.();
    const run = await beginScoreRun({ game: 'mahjong', difficulty: difficultyId, mode: 'normal' });
    const seed = Number.isInteger(run?.seed) ? run.seed : null;
    game.start({
      layout: layoutId,
      difficulty: difficultyId,
      ...(seed != null ? { rng: mulberry32(seed) } : {}),
    });
    menu.classList.add('hidden');
    table.classList.remove('hidden');
    win.classList.add('hidden');
    $('mj-confetti')?.classList.add('hidden');
    document.body.classList.add('mj-live');
    renderBoard();
    paint();
    startLoop();
    requestAnimationFrame(() => {
      if (!fitPlay()) requestAnimationFrame(() => fitPlay());
    });
  }

  function showMenu() {
    stopLoop();
    game.pause();
    document.body.classList.remove('mj-live');
    table.classList.add('hidden');
    menu.classList.remove('hidden');
    syncMenu();
  }

  function open() {
    showMenu();
  }

  function pause() {
    game.pause();
    stopLoop();
  }

  function resume() {
    if (table.classList.contains('hidden') || game.won) return;
    game.resume();
    if (!raf) startLoop();
  }

  document.querySelectorAll('[data-layout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      layoutId = normalizeLayout(btn.getAttribute('data-layout'));
      writeStore(LS_LAYOUT, layoutId);
      audio.click?.();
      syncMenu();
    });
  });
  document.querySelectorAll('[data-mj-diff]').forEach((btn) => {
    btn.addEventListener('click', () => {
      difficultyId = normalizeMahjongDifficulty(btn.getAttribute('data-mj-diff'));
      writeStore(LS_DIFF, difficultyId);
      audio.click?.();
      syncMenu();
    });
  });

  $('mj-play')?.addEventListener('click', begin);
  $('mj-hub')?.addEventListener('click', () => {
    audio.click?.();
    showMenu();
    hooks.onHub?.();
  });
  $('mj-lb')?.addEventListener('click', () => {
    audio.click?.();
    hooks.onLeaderboard?.();
  });
  $('mj-back')?.addEventListener('click', () => {
    audio.click?.();
    showMenu();
  });
  $('mj-hint')?.addEventListener('click', () => {
    const result = game.hint();
    if (!result.ok && result.reason === 'empty') flash('Keine Hinweise mehr');
    else if (!result.ok) flash('Kein Paar frei');
    else audio.mahjongHint?.();
    paint();
  });
  $('mj-undo')?.addEventListener('click', () => {
    const result = game.undo();
    if (!result.ok) flash('Nichts zum Rückgängigmachen');
    else {
      audio.mahjongUndo?.();
      refreshFaces();
    }
    paint();
  });
  $('mj-shuffle')?.addEventListener('click', () => {
    const result = game.shuffle(false);
    if (!result.ok && result.reason === 'empty') flash('Kein Mischen mehr');
    else if (!result.ok && result.reason === 'geometry') flash('Diese Stellung bleibt zu');
    else if (!result.ok) flash('Noch sind Züge da');
    else {
      audio.mahjongShuffle?.();
      refreshFaces();
    }
    paint();
  });
  $('mj-dim')?.addEventListener('click', () => {
    dimmed = !dimmed;
    writeStore(LS_DIM, dimmed ? '1' : '0');
    board.classList.toggle('is-dim', dimmed);
    audio.click?.();
    paint();
  });
  $('mj-zoom-out')?.addEventListener('click', () => zoomBy(0.88));
  $('mj-zoom-in')?.addEventListener('click', () => zoomBy(1.14));
  $('mj-fit')?.addEventListener('click', () => fit('board'));
  $('mj-mute')?.addEventListener('click', () => {
    const muted = audio.toggleMute?.();
    syncMute();
    if (!muted) audio.mahjongTap?.();
  });
  $('mj-win-again')?.addEventListener('click', begin);
  $('mj-win-lb')?.addEventListener('click', () => hooks.onLeaderboard?.());
  $('mj-win-menu')?.addEventListener('click', showMenu);
  $('mj-win-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('mj-win-name');
    const named = inspectName(input?.value || '');
    const clean = named.ok ? named.name : '';
    if (!clean) {
      $('mj-win-status').textContent = named.error === 'Name not allowed' ? 'Name nicht erlaubt.' : 'Name mit 1–16 Zeichen.';
      return;
    }
    savePlayerName(clean);
    void submitWin(game.result());
  });

  clip.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    try {
      clip.setPointerCapture?.(event.pointerId);
    } catch {
      /* pointer already released */
    }
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      sx: event.clientX,
      sy: event.clientY,
    });
    if (pointers.size === 1) {
      gesture = {
        kind: 'pan',
        x: event.clientX,
        y: event.clientY,
        panX,
        panY,
        moved: false,
        tile: event.target.closest?.('.mj-tile') || null,
      };
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      gesture = {
        kind: 'pinch',
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        scale,
        panX,
        panY,
      };
    }
  });
  clip.addEventListener('pointermove', (event) => {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (gesture?.kind === 'pinch' && pointers.size >= 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const next = Math.max(0.4, Math.min(2.8, gesture.scale * (dist / gesture.dist)));
      const rect = clip.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const k = next / gesture.scale;
      panX = cx - (cx - gesture.panX) * k;
      panY = cy - (cy - gesture.panY) * k;
      scale = next;
      applyTransform();
      return;
    }
    if (gesture?.kind === 'pan') {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 9) gesture.moved = true;
      if (gesture.moved) {
        panX = gesture.panX + (event.clientX - gesture.x);
        panY = gesture.panY + (event.clientY - gesture.y);
        applyTransform();
      }
    }
  });
  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (gesture?.kind === 'pan' && pointers.size === 0 && !gesture.moved && gesture.tile) {
      const id = Number(gesture.tile.dataset.id);
      if (Number.isInteger(id)) onTile(id);
    }
    if (pointers.size < 2 && gesture?.kind === 'pinch') gesture = null;
    if (pointers.size === 0) gesture = null;
  }
  clip.addEventListener('pointerup', endPointer);
  clip.addEventListener('pointercancel', endPointer);
  clip.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      zoomBy(event.deltaY > 0 ? 0.92 : 1.08);
    },
    { passive: false }
  );

  window.addEventListener('keydown', (event) => {
    if (table.classList.contains('hidden')) return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.key === 'h' || event.key === 'H') $('mj-hint')?.click();
    else if (event.key === 'u' || event.key === 'U' || event.key === 'z' || event.key === 'Backspace') {
      event.preventDefault();
      $('mj-undo')?.click();
    } else if (event.key === 'm' || event.key === 'M') $('mj-shuffle')?.click();
    else if (event.key === '+' || event.key === '=') zoomBy(1.12);
    else if (event.key === '-' || event.key === '_') zoomBy(0.9);
    else if (event.key === '0') fit('board');
    else if (event.key === 'Escape') showMenu();
  });

  window.addEventListener('resize', () => {
    if (!table.classList.contains('hidden')) fitPlay();
  });

  function syncMute() {
    const btn = $('mj-mute');
    if (!btn) return;
    const muted = !!audio.muted;
    btn.textContent = muted ? '🔇' : '🔊';
    btn.setAttribute('aria-label', muted ? 'Ton an' : 'Ton aus');
  }

  board.classList.toggle('is-dim', dimmed);
  syncMute();
  syncMenu();

  return {
    open,
    pause,
    resume,
    get layoutId() {
      return layoutId;
    },
    get difficultyId() {
      return difficultyId;
    },
  };
}

export { LAYOUTS };
