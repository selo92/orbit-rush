/**
 * Orbit Rush – UI wiring & bootstrap (v1.3)
 * Daily Challenge · Achievements · Share · Craft skins
 */
import { Game, formatFormula, computeScore, NEAR_MISS_POINTS, COMBO_STEP } from './game.js';
import { MirrorGame } from './mirror.js';
import { DriftGame, getDriftDifficulty } from './drift.js';
import { mountAerger } from './aerger-ui.js';
import {
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
  getDifficulty,
  difficultyBadge,
} from './difficulty.js';
import { AudioBus } from './audio.js';
import { fetchScores, submitScore, sanitizeName } from './leaderboard.js';
import { getOrCreateClientId, isOwnRow, loadPlayerName, savePlayerName } from './identity.js';
import { utcDateString } from './rng.js';
import {
  ACHIEVEMENTS,
  checkUnlocks,
  unlockMany,
  unlockedSet,
  loadAchievements,
} from './achievements.js';
import {
  SKINS,
  SKIN_IDS,
  DEFAULT_SKIN,
  getSkin,
  loadSavedSkin,
  saveSkin,
  isSkinUnlocked,
  normalizeSkin,
} from './skins.js';

const $ = (id) => document.getElementById(id);

const LS_BEST = 'orbit-rush-best';
const LS_BEST_PREFIX = 'orbit-rush-best-';
const LS_DAILY_PREFIX = 'orbit-rush-daily-best-';
const LS_DIFF = 'orbit-rush-difficulty';
const LS_ONBOARD = 'orbit-rush-onboard-v1';
const LS_MIRROR_BEST = 'orbit-mirror-best';
const LS_MIRROR_STREAK = 'orbit-mirror-streak';
const LS_MIRROR_ONBOARD = 'orbit-mirror-onboard-v1';
const LS_DRIFT_BEST = 'orbit-drift-best';
const LS_DRIFT_BEST_PREFIX = 'orbit-drift-best-';
const LS_DRIFT_DIFF = 'orbit-drift-difficulty';
const LS_DRIFT_ONBOARD = 'orbit-drift-onboard-v1';
const SHARE_NOTE = '(Orbit Rush — play locally / LiveCodes)';

const canvas = /** @type {HTMLCanvasElement} */ ($('game'));
const audio = new AudioBus();

const screens = {
  hub: $('screen-hub'),
  title: $('screen-title'),
  diff: $('screen-diff'),
  pause: $('screen-pause'),
  over: $('screen-over'),
  lb: $('screen-lb'),
  onboard: $('screen-onboard'),
  achievements: $('screen-achievements'),
  skins: $('screen-skins'),
  mirror: $('screen-mirror'),
  mirrorOnboard: $('screen-mirror-onboard'),
  drift: $('screen-drift'),
  driftOnboard: $('screen-drift-onboard'),
  driftDiff: $('screen-drift-diff'),
  aerger: $('screen-aerger'),
};

const hud = $('hud');
const hudScore = $('hud-score');
const hudOrbs = $('hud-orbs');
const hudTime = $('hud-time');
const hudCombo = $('hud-combo');
const hudComboVal = $('hud-combo-val');
const hudMode = $('hud-mode');
const pwrShield = $('pwr-shield');
const pwrSlow = $('pwr-slow');
const pwrMagnet = $('pwr-magnet');
const btnMute = $('btn-mute');
const btnPause = $('btn-pause');
const touchHint = $('touch-hint');
const toastEl = $('toast');

/** @type {object|null} */
let lastResult = null;
let lbBackTo = 'title';
let lbFilter = 'all';
/** @type {'hub'|'rush'|'mirror'|'aerger'|'drift'} */
let activeGame = 'hub';
/** @type {() => void} */
let pauseAerger = () => {};
/** @type {'rush'|'mirror'|'drift'} */
let lbGame = 'rush';
let submitting = false;
let runSeq = 0;
/** runId of the finish that already triggered an automatic submit */
let autoSubmittedRun = 0;
let onboardStep = 0;
let pendingAfterOnboard = null; // 'play' | 'daily' | null
/** @type {'normal'|'daily'} */
let runMode = 'normal';
let dailyDate = utcDateString();
/** @type {import('./difficulty.js').DifficultyId} */
let selectedDifficulty = loadSavedDifficulty();
/** @type {import('./difficulty.js').DifficultyId} */
let driftDifficulty = loadDriftDifficulty();
/** @type {string} */
let selectedSkin = normalizeSkin(loadSavedSkin());

const ONBOARD_STEPS = [
  {
    title: 'Steer your orbit',
    body: 'Drag left/right or use A/D to change radius. Your craft auto-revolves around the planet.',
  },
  {
    title: 'Collect orbs',
    body: 'Grab cyan orbs for points. Chain them quickly for combo multipliers (up to x5).',
  },
  {
    title: 'Survive & juice',
    body: 'Dodge asteroids — near misses score bonus. Rare power-ups: Shield, Slow-mo, Magnet. Try the Daily!',
  },
];

function loadSavedDifficulty() {
  try {
    return normalizeDifficulty(localStorage.getItem(LS_DIFF) || DEFAULT_DIFFICULTY);
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

function saveDifficulty(id) {
  const d = normalizeDifficulty(id);
  selectedDifficulty = d;
  try {
    localStorage.setItem(LS_DIFF, d);
  } catch {
    /* ignore */
  }
}

function loadDriftDifficulty() {
  try {
    return normalizeDifficulty(localStorage.getItem(LS_DRIFT_DIFF) || DEFAULT_DIFFICULTY);
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

function saveDriftDifficulty(id) {
  const d = normalizeDifficulty(id);
  driftDifficulty = d;
  try {
    localStorage.setItem(LS_DRIFT_DIFF, d);
  } catch {
    /* ignore */
  }
}

function bestKey(id) {
  return LS_BEST_PREFIX + normalizeDifficulty(id);
}

function getBest(id = selectedDifficulty) {
  const d = normalizeDifficulty(id);
  try {
    const per = Math.max(0, Math.floor(Number(localStorage.getItem(bestKey(d))) || 0));
    if (per > 0) return per;
    if (d === 'mittel') {
      const legacy = Math.max(0, Math.floor(Number(localStorage.getItem(LS_BEST)) || 0));
      if (legacy > 0) {
        localStorage.setItem(bestKey('mittel'), String(legacy));
        return legacy;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

function setBest(score, id = selectedDifficulty) {
  const d = normalizeDifficulty(id);
  try {
    localStorage.setItem(bestKey(d), String(Math.floor(score)));
    if (d === 'mittel') localStorage.setItem(LS_BEST, String(Math.floor(score)));
  } catch {
    /* ignore */
  }
}

function dailyBestKey(dateStr) {
  return LS_DAILY_PREFIX + dateStr;
}

function getDailyBest(dateStr = dailyDate) {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(dailyBestKey(dateStr))) || 0));
  } catch {
    return 0;
  }
}

function setDailyBest(score, dateStr = dailyDate) {
  try {
    const prev = getDailyBest(dateStr);
    if (score > prev) localStorage.setItem(dailyBestKey(dateStr), String(Math.floor(score)));
  } catch {
    /* ignore */
  }
}

function getMirrorBest() {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(LS_MIRROR_BEST)) || 0));
  } catch {
    return 0;
  }
}

function setMirrorBest(score) {
  try {
    localStorage.setItem(LS_MIRROR_BEST, String(Math.floor(score)));
  } catch {
    /* ignore */
  }
}

function getMirrorStreak() {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(LS_MIRROR_STREAK)) || 0));
  } catch {
    return 0;
  }
}

function setMirrorStreak(n) {
  try {
    localStorage.setItem(LS_MIRROR_STREAK, String(Math.floor(n)));
  } catch {
    /* ignore */
  }
}

function refreshMirrorMenu() {
  const best = getMirrorBest();
  const streak = getMirrorStreak();
  const bestEl = $('mirror-best-val');
  const streakEl = $('mirror-streak-val');
  if (bestEl) bestEl.textContent = best > 0 ? String(best) : '—';
  if (streakEl) streakEl.textContent = streak > 0 ? String(streak) : '—';
}

function refreshHub() {
  const name = loadPlayerName();
  const line = $('hub-identity');
  if (!line) return;
  if (name) {
    $('hub-identity-name').textContent = name;
    line.classList.remove('hidden');
  } else {
    line.classList.add('hidden');
  }
}

function getDriftBest(id = driftDifficulty) {
  const d = normalizeDifficulty(id);
  try {
    const per = Math.max(0, Math.floor(Number(localStorage.getItem(LS_DRIFT_BEST_PREFIX + d)) || 0));
    if (per > 0) return per;
    if (d === 'mittel') {
      const legacy = Math.max(0, Math.floor(Number(localStorage.getItem(LS_DRIFT_BEST)) || 0));
      if (legacy > 0) {
        localStorage.setItem(LS_DRIFT_BEST_PREFIX + 'mittel', String(legacy));
        return legacy;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

function setDriftBest(score, id = driftDifficulty) {
  const d = normalizeDifficulty(id);
  try {
    localStorage.setItem(LS_DRIFT_BEST_PREFIX + d, String(Math.floor(score)));
    if (d === 'mittel') localStorage.setItem(LS_DRIFT_BEST, String(Math.floor(score)));
  } catch {
    /* ignore */
  }
}

function refreshDriftMenu() {
  const best = getDriftBest(driftDifficulty);
  const label = getDriftDifficulty(driftDifficulty).label;
  const bestEl = $('drift-best-val');
  const line = $('drift-best');
  if (line?.childNodes[0]?.nodeType === 3) {
    line.childNodes[0].textContent = `Rekord (${label}): `;
  }
  if (bestEl) bestEl.textContent = best > 0 ? String(best) : '—';
}

function driftOnboardDone() {
  try {
    return localStorage.getItem(LS_DRIFT_ONBOARD) === '1';
  } catch {
    return true;
  }
}

function markDriftOnboard() {
  try {
    localStorage.setItem(LS_DRIFT_ONBOARD, '1');
  } catch {
    /* ignore */
  }
}

function mirrorOnboardDone() {
  try {
    return localStorage.getItem(LS_MIRROR_ONBOARD) === '1';
  } catch {
    return true;
  }
}

function markMirrorOnboard() {
  try {
    localStorage.setItem(LS_MIRROR_ONBOARD, '1');
  } catch {
    /* ignore */
  }
}

function onboardDone() {
  try {
    return localStorage.getItem(LS_ONBOARD) === '1';
  } catch {
    return true;
  }
}

function markOnboardDone() {
  try {
    localStorage.setItem(LS_ONBOARD, '1');
  } catch {
    /* ignore */
  }
}

function resultGame(result) {
  if (result?.game === 'mirror' || result?.game === 'drift') return result.game;
  return 'rush';
}

function setHudChrome(mode) {
  const drift = mode === 'drift';
  const scoreLabel = $('hud-score-label');
  const orbsLabel = $('hud-orbs-label');
  const timeLabel = $('hud-time-label');
  if (scoreLabel) scoreLabel.textContent = drift ? 'PUNKTE' : 'SCORE';
  if (orbsLabel) orbsLabel.textContent = drift ? 'RINGE' : 'ORBS';
  if (timeLabel) timeLabel.textContent = drift ? 'KM' : 'TIME';
  hud.classList.toggle('drift-mode', drift);
  hud.classList.toggle('mirror-mode', mode === 'mirror');
}

function showScreen(name) {
  if (name !== 'aerger') pauseAerger();
  for (const [k, el] of Object.entries(screens)) {
    if (!el) continue;
    el.classList.toggle('hidden', k !== name);
  }
}

function hideAllScreens() {
  for (const el of Object.values(screens)) {
    if (el) el.classList.add('hidden');
  }
}

function syncMuteBtn() {
  btnMute.textContent = audio.muted ? '🔇' : '🔊';
  btnMute.title = audio.muted ? 'Unmute' : 'Mute';
  btnMute.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
}

function refreshTitleBest() {
  const best = getBest(selectedDifficulty);
  const el = $('title-best');
  const val = $('title-best-val');
  const label = getDifficulty(selectedDifficulty).label;
  if (best > 0) {
    el.classList.remove('hidden');
    // text node before <strong>
    if (el.childNodes[0] && el.childNodes[0].nodeType === 3) {
      el.childNodes[0].textContent = `Best (${label}): `;
    }
    val.textContent = String(best);
  } else {
    el.classList.add('hidden');
  }
  dailyDate = utcDateString();
  refreshTitleIdentity();
  $('title-daily-date').textContent = dailyDate;
  const db = getDailyBest(dailyDate);
  const dailyLine = $('title-daily');
  if (db > 0) {
    dailyLine.innerHTML = `Daily · <span id="title-daily-date">${dailyDate}</span> · best <strong>${db}</strong>`;
  } else {
    dailyLine.innerHTML = `Daily · <span id="title-daily-date">${dailyDate}</span>`;
  }
}

function syncDiffChips() {
  document.querySelectorAll('#diff-options .diff-chip').forEach((btn) => {
    const id = btn.getAttribute('data-diff');
    btn.setAttribute('aria-pressed', id === selectedDifficulty ? 'true' : 'false');
  });
  const best = getBest(selectedDifficulty);
  const label = getDifficulty(selectedDifficulty).label;
  const diffBest = $('diff-best');
  if (diffBest.childNodes[0] && diffBest.childNodes[0].nodeType === 3) {
    diffBest.childNodes[0].textContent = `Best on ${label}: `;
  }
  $('diff-best-val').textContent = best > 0 ? String(best) : '—';
  const startBtn = $('btn-diff-start');
  if (selectedDifficulty === 'baba') {
    startBtn.textContent = 'START BABA';
    startBtn.classList.add('baba-start');
  } else {
    startBtn.textContent = 'START RUN';
    startBtn.classList.remove('baba-start');
  }
}

function openDifficultyPicker() {
  runMode = 'normal';
  syncDiffChips();
  showScreen('diff');
}

function syncDriftDiffChips() {
  document.querySelectorAll('#drift-diff-options .diff-chip').forEach((btn) => {
    const id = btn.getAttribute('data-drift-diff');
    btn.setAttribute('aria-pressed', id === driftDifficulty ? 'true' : 'false');
  });
  const best = getDriftBest(driftDifficulty);
  const label = getDriftDifficulty(driftDifficulty).label;
  const line = $('drift-diff-best');
  if (line?.childNodes[0]?.nodeType === 3) {
    line.childNodes[0].textContent = `Rekord auf ${label}: `;
  }
  const val = $('drift-diff-best-val');
  if (val) val.textContent = best > 0 ? String(best) : '—';
  const startBtn = $('btn-drift-diff-start');
  if (startBtn) {
    if (driftDifficulty === 'baba') {
      startBtn.textContent = 'BABA STARTEN';
      startBtn.classList.add('baba-start');
    } else {
      startBtn.textContent = 'START';
      startBtn.classList.remove('baba-start');
    }
  }
  if (!drift.running) {
    drift.setDifficulty(driftDifficulty);
    drift.resetState();
    if (drift.w) drift.ensureTrack();
  }
}

function openDriftDifficulty() {
  activeGame = 'drift';
  syncDriftDiffChips();
  showScreen('driftDiff');
}

function renderOnboardStep() {
  const step = ONBOARD_STEPS[onboardStep] || ONBOARD_STEPS[0];
  $('onboard-title').textContent = step.title;
  $('onboard-body').textContent = step.body;
  $('btn-onboard-next').textContent =
    onboardStep >= ONBOARD_STEPS.length - 1 ? "LET'S GO" : 'NEXT';
  document.querySelectorAll('.onboard-dots .dot').forEach((d, i) => {
    d.classList.toggle('active', i === onboardStep);
  });
}

function finishOnboard() {
  markOnboardDone();
  const pending = pendingAfterOnboard;
  pendingAfterOnboard = null;
  if (pending === 'daily') {
    beginRun({ daily: true });
  } else if (pending === 'play') {
    openDifficultyPicker();
  } else {
    showScreen('title');
  }
}

function refreshTitleIdentity() {
  const name = loadPlayerName();
  const line = $('title-identity');
  if (line) {
    if (name) {
      $('title-identity-name').textContent = name;
      line.classList.remove('hidden');
    } else {
      line.classList.add('hidden');
    }
  }
  refreshHub();
}

function showWelcome(name) {
  refreshTitleIdentity();
  $('over-identity-name').textContent = name;
  $('over-identity').classList.remove('hidden');
  $('score-form').classList.add('hidden');
  $('btn-change-name').classList.remove('hidden');
  $('player-name').value = name;
}

function showNameEditor({ firstTime }) {
  $('score-form').classList.remove('hidden');
  $('name-hint').classList.toggle('hidden', !firstTime);
  $('btn-change-name').classList.add('hidden');
  $('btn-submit').textContent = firstTime ? 'SAVE & SUBMIT' : 'RESUBMIT';
  $('btn-submit').disabled = false;
  if (!firstTime) {
    const name = loadPlayerName();
    $('over-identity').classList.remove('hidden');
    $('over-identity-name').textContent = name;
    $('player-name').value = name;
  }
}

function formatSubmitStatus(res) {
  if (res.duplicate) {
    return res.rank
      ? `Already on the leaderboard. Rank #${res.rank}.`
      : 'Already on the leaderboard.';
  }
  if (res.rateLimited) {
    return 'Saved on this device. The global board asked for a short pause.';
  }
  if (res.fallback || res.source !== 'api') {
    const rankTxt = res.rank ? ` Rank #${res.rank}.` : '';
    return `Saved on this device.${rankTxt} Global board unreachable.`;
  }
  return res.rank ? `Saved to the leaderboard. Rank #${res.rank}.` : 'Saved to the leaderboard.';
}

async function sendScore(name, { auto = false } = {}) {
  if (!lastResult || submitting) return;
  const clean = sanitizeName(name);
  const status = $('submit-status');
  if (!clean) {
    status.textContent = 'Enter a name (max 16).';
    status.classList.add('error');
    status.classList.remove('calm');
    $('over-identity').classList.add('hidden');
    showNameEditor({ firstTime: true });
    $('player-name').value = '';
    return;
  }
  submitting = true;
  $('btn-submit').disabled = true;
  $('btn-change-name').disabled = true;
  status.classList.remove('error', 'calm');
  status.textContent = auto ? 'Saving score…' : 'Submitting…';
  savePlayerName(clean);
  refreshTitleIdentity();
  try {
    const res = await submitScore({
      name: clean,
      clientId: getOrCreateClientId(),
      score: lastResult.score,
      survivalMs: lastResult.survivalMs,
      orbs: lastResult.orbs,
      comboBonus: lastResult.comboBonus ?? 0,
      nearMisses: lastResult.nearMisses ?? 0,
      difficulty: lastResult.difficulty || selectedDifficulty,
      mode: lastResult.daily ? 'daily' : 'normal',
      dailyDate: lastResult.daily ? lastResult.dailyDate || dailyDate : undefined,
      game: resultGame(lastResult),
    });
    status.classList.remove('error');
    status.classList.toggle('calm', !!(res.duplicate || res.rateLimited));
    status.textContent = formatSubmitStatus(res);
    showWelcome(clean);
  } catch (err) {
    status.textContent = err.message || 'Submit failed';
    status.classList.add('error');
    status.classList.remove('calm');
    showNameEditor({ firstTime: !loadPlayerName() });
  } finally {
    submitting = false;
    $('btn-submit').disabled = false;
    $('btn-change-name').disabled = false;
  }
}

function presentGameOverIdentity(result) {
  submitting = false;
  $('btn-submit').disabled = false;
  $('btn-change-name').disabled = false;
  $('submit-status').textContent = '';
  $('submit-status').classList.remove('error', 'calm');
  const name = loadPlayerName();
  if (name) {
    showWelcome(name);
    if (autoSubmittedRun !== result.runId) {
      autoSubmittedRun = result.runId;
      void sendScore(name, { auto: true });
    }
    return;
  }
  $('over-identity').classList.add('hidden');
  showNameEditor({ firstTime: true });
  $('player-name').value = '';
}

function setOverDiffBadge(result) {
  const badge = $('over-diff-badge');
  if (result.game === 'mirror') {
    badge.textContent = 'Mirror';
    badge.className = 'diff-badge mirror';
    return;
  }
  if (result.game === 'drift') {
    const d = normalizeDifficulty(result.difficulty || driftDifficulty);
    badge.textContent = getDriftDifficulty(d).label;
    badge.className = `diff-badge ${d}`;
    return;
  }
  if (result.daily) {
    badge.textContent = `Daily · ${result.dailyDate || dailyDate}`;
    badge.className = 'diff-badge daily';
  } else {
    const d = normalizeDifficulty(result.difficulty || selectedDifficulty);
    badge.textContent = difficultyBadge(d);
    badge.className = `diff-badge ${d}`;
  }
}

function showToast(title, body = '') {
  toastEl.innerHTML = `<strong>${title}</strong>${body ? `<span>${body}</span>` : ''}`;
  toastEl.classList.remove('hidden');
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(() => toastEl.classList.add('hidden'), 280);
  }, 2800);
}

function processAchievements(result) {
  const current = loadAchievements();
  const ids = checkUnlocks(current, {
    orbs: result.orbs || 0,
    comboPeak: result.comboPeak || 1,
    nearMisses: result.nearMisses || 0,
    survivalMs: result.survivalMs || 0,
    difficulty: result.difficulty || selectedDifficulty,
    daily: !!result.daily,
  });
  const unlocked = unlockMany(ids);
  for (const def of unlocked) {
    showToast(`★ ${def.title}`, def.desc);
  }
  return unlocked;
}

function renderAchievements() {
  const list = $('ach-list');
  const unlocked = loadAchievements();
  list.innerHTML = '';
  for (const a of ACHIEVEMENTS) {
    const li = document.createElement('li');
    const on = !!unlocked[a.id];
    li.className = on ? 'ach unlocked' : 'ach locked';
    li.innerHTML = `<span class="ach-icon">${on ? '★' : '☆'}</span>
      <span class="ach-text"><strong>${a.title}</strong><em>${a.desc}</em></span>`;
    list.appendChild(li);
  }
}

function skinIsUnlocked(id) {
  return isSkinUnlocked(id, unlockedSet(), { getBest });
}

function renderSkins() {
  const box = $('skin-options');
  box.innerHTML = '';
  for (const id of SKIN_IDS) {
    const skin = getSkin(id);
    const unlocked = skinIsUnlocked(id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'skin-chip' + (id === selectedSkin ? ' active' : '') + (unlocked ? '' : ' locked');
    btn.setAttribute('data-skin', id);
    btn.setAttribute('aria-pressed', id === selectedSkin ? 'true' : 'false');
    btn.disabled = !unlocked;
    btn.innerHTML = `<span class="skin-swatch" style="--c:${skin.craft};--a:${skin.accent}"></span>
      <span class="skin-meta"><strong>${skin.label}</strong>
      <em>${unlocked ? (id === selectedSkin ? 'Equipped' : 'Unlocked') : 'Locked'}</em></span>`;
    btn.addEventListener('click', () => {
      if (!unlocked) return;
      audio.click();
      selectedSkin = saveSkin(id);
      game.setSkin(selectedSkin);
      renderSkins();
    });
    box.appendChild(btn);
  }
}

function openAchievements() {
  renderAchievements();
  showScreen('achievements');
}

function openSkins() {
  if (!skinIsUnlocked(selectedSkin)) {
    selectedSkin = saveSkin(DEFAULT_SKIN);
  }
  game.setSkin(selectedSkin);
  renderSkins();
  showScreen('skins');
}

function buildShareText(result) {
  const score = result?.score ?? 0;
  if (result?.game === 'mirror') {
    const streak = Math.max(0, Math.floor(result.cleanStreak || 0));
    return `Orbit Mirror — score ${score} — clean streak ${streak} — beat me!`;
  }
  if (result?.game === 'drift') {
    const km = Number(result.distanceKm || 0).toFixed(2);
    const tag = getDriftDifficulty(result.difficulty || driftDifficulty).label;
    return `Orbit Drift [${tag}] — ${score} Punkte — ${km} km — schlag mich!`;
  }
  let tag;
  if (result?.daily) {
    tag = `Daily · ${result.dailyDate || dailyDate}`;
  } else {
    tag = getDifficulty(result?.difficulty || selectedDifficulty).label;
  }
  return `Orbit Rush [${tag}] — score ${score} — beat me! ${SHARE_NOTE}`;
}

async function shareScore() {
  if (!lastResult) return;
  const text = buildShareText(lastResult);
  audio.click();
  try {
    if (navigator.share) {
      const titles = { mirror: 'Orbit Mirror', drift: 'Orbit Drift' };
      await navigator.share({ title: titles[lastResult?.game] || 'Orbit Rush', text });
      $('submit-status').textContent = 'Shared!';
      $('submit-status').classList.remove('error');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    $('submit-status').textContent = 'Copied share text!';
    $('submit-status').classList.remove('error');
  } catch {
    $('submit-status').textContent = text;
    $('submit-status').classList.remove('error');
  }
}

const game = new Game(canvas, {
  audio,
  onHud({ score, orbs, time, combo, shield, slowMo, magnet }) {
    $('hud-combo-label').textContent = 'COMBO';
    hudScore.textContent = String(score);
    hudOrbs.textContent = String(orbs);
    hudTime.textContent = time.toFixed(1);
    if (combo > 1) {
      hudCombo.classList.remove('hidden');
      hudComboVal.textContent = `x${combo}`;
      hudCombo.classList.toggle('hot', combo >= 4);
    } else {
      hudCombo.classList.add('hidden');
      hudCombo.classList.remove('hot');
    }
    pwrShield.classList.toggle('hidden', !shield);
    pwrSlow.classList.toggle('hidden', !slowMo);
    pwrMagnet.classList.toggle('hidden', !magnet);
  },
  onTutorial({ type }) {
    if (type === 'orbit' || type === 'orb') {
      touchHint.classList.add('fade-fast');
      setTimeout(() => touchHint.classList.add('hidden'), 600);
    }
  },
  onGameOver(result) {
    result.game = 'rush';
    showGameOver(result);
  },
});

function showGameOver(result) {
  result.runId = ++runSeq;
  lastResult = result;
  hud.classList.add('hidden');
  touchHint.classList.add('hidden');
  audio.stopMusic();

  const mirrorRun = result.game === 'mirror';
  const driftRun = result.game === 'drift';
  const hint = $('name-hint');
  if (hint) {
    hint.textContent = driftRun
      ? 'Ein Name, einmal. Spätere Runs speichern automatisch.'
      : 'Enter a name once. Later runs save automatically.';
  }
  $('over-title').textContent = driftRun ? 'BAHN VERLASSEN' : mirrorRun ? 'SPIEGEL BRICHT' : 'ORBIT LOST';
  $('over-streak').classList.toggle('hidden', !mirrorRun && !driftRun);
  const streakLine = $('over-streak');
  if (streakLine?.childNodes[0]?.nodeType === 3) {
    streakLine.childNodes[0].textContent = driftRun ? 'Strecke: ' : 'Clean streak: ';
  }

  if (!mirrorRun && !driftRun) processAchievements(result);

  let isNew = false;
  let best = 0;
  if (driftRun) {
    const diff = normalizeDifficulty(result.difficulty || driftDifficulty);
    const prev = getDriftBest(diff);
    isNew = result.score > prev;
    if (isNew) setDriftBest(result.score, diff);
    best = Math.max(prev, result.score);
    const km = Number(result.distanceKm || 0);
    $('over-streak-val').textContent = `${km.toFixed(2)} km`;
    const ob = $('over-best');
    if (ob.childNodes[0] && ob.childNodes[0].nodeType === 3) {
      ob.childNodes[0].textContent = `Rekord (${getDriftDifficulty(diff).label}): `;
    }
  } else if (mirrorRun) {
    const prev = getMirrorBest();
    isNew = result.score > prev;
    if (isNew) setMirrorBest(result.score);
    best = Math.max(prev, result.score);
    const streak = Math.max(0, Math.floor(result.cleanStreak || 0));
    $('over-streak-val').textContent = String(streak);
    const prevStreak = getMirrorStreak();
    if (streak > prevStreak) {
      setMirrorStreak(streak);
      showToast('★ Mirror streak', String(streak));
    }
    const ob = $('over-best');
    if (ob.childNodes[0] && ob.childNodes[0].nodeType === 3) {
      ob.childNodes[0].textContent = 'Best: ';
    }
  } else if (result.daily) {
    const date = result.dailyDate || dailyDate;
    const prev = getDailyBest(date);
    isNew = result.score > prev;
    if (isNew) setDailyBest(result.score, date);
    best = Math.max(prev, result.score);
    const ob = $('over-best');
    if (ob.childNodes[0] && ob.childNodes[0].nodeType === 3) {
      ob.childNodes[0].textContent = `Daily best (${date}): `;
    }
  } else {
    const diff = normalizeDifficulty(result.difficulty || selectedDifficulty);
    const prevBest = getBest(diff);
    isNew = result.score > prevBest;
    if (isNew) setBest(result.score, diff);
    best = Math.max(prevBest, result.score);
    const ob = $('over-best');
    if (ob.childNodes[0] && ob.childNodes[0].nodeType === 3) {
      ob.childNodes[0].textContent = `Best (${getDifficulty(diff).label}): `;
    }
  }

  setOverDiffBadge(result);
  $('over-score').textContent = String(result.score);
  $('over-formula').textContent =
    result.formula ||
    formatFormula(
      result.survivalMs,
      result.orbs,
      result.comboBonus,
      result.nearMisses,
      result.score
    );
  $('over-new-best').textContent = driftRun ? '★ NEUER REKORD ★' : '★ NEW PERSONAL BEST ★';
  $('over-new-best').classList.toggle('hidden', !isNew || result.score <= 0);
  $('over-best').classList.toggle('hidden', best <= 0);
  $('over-best-val').textContent = String(best);

  refreshTitleBest();
  refreshMirrorMenu();
  refreshDriftMenu();
  refreshHub();
  presentGameOverIdentity(result);
  showScreen('over');
}

game.setSkin(selectedSkin);

const mirror = new MirrorGame(canvas, {
  audio,
  onHud({ score, orbs, time, streak }) {
    hudScore.textContent = String(score);
    hudOrbs.textContent = String(orbs);
    hudTime.textContent = time.toFixed(1);
    $('hud-combo-label').textContent = 'STREAK';
    if (streak > 0) {
      hudCombo.classList.remove('hidden');
      hudComboVal.textContent = String(streak);
      hudCombo.classList.toggle('hot', streak >= 4);
    } else {
      hudCombo.classList.add('hidden');
      hudCombo.classList.remove('hot');
    }
    pwrShield.classList.add('hidden');
    pwrSlow.classList.add('hidden');
    pwrMagnet.classList.add('hidden');
  },
  onGameOver(result) {
    showGameOver(result);
  },
});

const drift = new DriftGame(canvas, {
  audio,
  onHud({ score, orbs, time, combo, hull }) {
    hudScore.textContent = String(score);
    hudOrbs.textContent = String(orbs);
    hudTime.textContent = Number(time || 0).toFixed(2);
    $('hud-combo-label').textContent = 'KETTE';
    if (combo > 1) {
      hudCombo.classList.remove('hidden');
      hudComboVal.textContent = `x${combo}`;
      hudCombo.classList.toggle('hot', combo >= 4);
    } else {
      hudCombo.classList.add('hidden');
      hudCombo.classList.remove('hot');
    }
    pwrShield.classList.add('hidden');
    pwrSlow.classList.add('hidden');
    pwrMagnet.classList.add('hidden');
    const hearts = '●'.repeat(Math.max(0, hull)) + '○'.repeat(Math.max(0, 3 - hull));
    const grade = getDriftDifficulty(drift.difficultyId).label.toUpperCase();
    hudMode.textContent = `${grade} · HÜLLE ${hearts}`;
    hudMode.classList.remove('hidden');
  },
  onGameOver(result) {
    showGameOver(result);
  },
});

function liveGame() {
  if (activeGame === 'mirror') return mirror;
  if (activeGame === 'drift') return drift;
  return game;
}

function showHub() {
  activeGame = 'hub';
  if (game.running) game.stop();
  if (mirror.running) mirror.stop();
  if (drift.running) drift.stop();
  audio.stopMusic();
  hud.classList.add('hidden');
  setHudChrome('rush');
  hudMode.classList.add('hidden');
  refreshHub();
  showScreen('hub');
}

function openRushMenu() {
  activeGame = 'rush';
  if (mirror.running) mirror.stop();
  if (drift.running) drift.stop();
  audio.stopMusic();
  hud.classList.add('hidden');
  setHudChrome('rush');
  refreshTitleBest();
  refreshTitleIdentity();
  showScreen('title');
}

function openMirrorMenu() {
  activeGame = 'mirror';
  if (game.running) game.stop();
  if (mirror.running) mirror.stop();
  if (drift.running) drift.stop();
  audio.stopMusic();
  hud.classList.add('hidden');
  setHudChrome('rush');
  refreshMirrorMenu();
  showScreen('mirror');
}

function openDriftMenu() {
  activeGame = 'drift';
  if (game.running) game.stop();
  if (mirror.running) mirror.stop();
  if (drift.running) drift.stop();
  audio.stopMusic();
  hud.classList.add('hidden');
  setHudChrome('rush');
  refreshDriftMenu();
  showScreen('drift');
}

function beginMirror() {
  activeGame = 'mirror';
  if (game.running) game.stop();
  if (drift.running) drift.stop();
  audio.resume();
  audio.startMusic();
  hideAllScreens();
  hud.classList.remove('hidden');
  setHudChrome('mirror');
  $('hud-combo-label').textContent = 'STREAK';
  hudCombo.classList.add('hidden');
  pwrShield.classList.add('hidden');
  pwrSlow.classList.add('hidden');
  pwrMagnet.classList.add('hidden');
  hudMode.textContent = 'MIRROR';
  hudMode.classList.remove('hidden');
  touchHint.textContent = '← außen / out · → innen / in';
  touchHint.classList.add('hidden');
  touchHint.classList.remove('fade-fast');
  void touchHint.offsetWidth;
  touchHint.classList.remove('hidden');
  mirror.start();
}

function startMirror() {
  activeGame = 'mirror';
  audio.resume();
  audio.click();
  if (!mirrorOnboardDone()) {
    showScreen('mirrorOnboard');
    return;
  }
  beginMirror();
}

function beginDrift() {
  activeGame = 'drift';
  if (game.running) game.stop();
  if (mirror.running) mirror.stop();
  audio.resume();
  audio.startMusic();
  hideAllScreens();
  hud.classList.remove('hidden');
  setHudChrome('drift');
  $('hud-combo-label').textContent = 'KETTE';
  hudCombo.classList.add('hidden');
  pwrShield.classList.add('hidden');
  pwrSlow.classList.add('hidden');
  pwrMagnet.classList.add('hidden');
  const grade = getDriftDifficulty(driftDifficulty).label.toUpperCase();
  hudMode.textContent = `${grade} · HÜLLE ●●●`;
  hudMode.classList.remove('hidden');
  touchHint.textContent = 'Wischen zum Lenken';
  touchHint.classList.add('hidden');
  touchHint.classList.remove('fade-fast');
  void touchHint.offsetWidth;
  touchHint.classList.remove('hidden');
  drift.start(driftDifficulty);
}

function startDrift() {
  activeGame = 'drift';
  audio.resume();
  audio.click();
  if (!driftOnboardDone()) {
    showScreen('driftOnboard');
    return;
  }
  openDriftDifficulty();
}

function beginRun(opts = {}) {
  activeGame = 'rush';
  if (mirror.running) mirror.stop();
  if (drift.running) drift.stop();
  setHudChrome('rush');
  $('hud-combo-label').textContent = 'COMBO';
  touchHint.textContent = 'Drag left / right to change orbit';
  audio.resume();
  audio.click();
  audio.startMusic();
  hideAllScreens();
  hud.classList.remove('hidden');
  touchHint.classList.add('hidden');
  touchHint.classList.remove('fade-fast');
  void touchHint.offsetWidth;
  touchHint.classList.remove('hidden');

  const daily = !!opts.daily;
  dailyDate = utcDateString();
  if (daily) {
    runMode = 'daily';
    hudMode.textContent = `Daily · ${dailyDate}`;
    hudMode.classList.remove('hidden');
    game.start({
      daily: true,
      dailyDate,
      skinId: selectedSkin,
      difficulty: 'schwer',
    });
  } else {
    runMode = 'normal';
    hudMode.classList.add('hidden');
    game.start({
      difficulty: selectedDifficulty,
      skinId: selectedSkin,
    });
  }
}

function startRun() {
  runMode = 'normal';
  if (!onboardDone()) {
    pendingAfterOnboard = 'play';
    onboardStep = 0;
    renderOnboardStep();
    showScreen('onboard');
    audio.resume();
    audio.click();
    return;
  }
  audio.click();
  openDifficultyPicker();
}

function startDaily() {
  runMode = 'daily';
  dailyDate = utcDateString();
  if (!onboardDone()) {
    pendingAfterOnboard = 'daily';
    onboardStep = 0;
    renderOnboardStep();
    showScreen('onboard');
    audio.resume();
    audio.click();
    return;
  }
  audio.click();
  beginRun({ daily: true });
}

function openLeaderboard(from, gameId = 'rush') {
  lbBackTo = from;
  lbGame = gameId === 'mirror' || gameId === 'drift' ? gameId : 'rush';
  if (lbGame === 'rush') {
    lbFilter = runMode === 'daily' ? 'daily' : selectedDifficulty || 'all';
  } else if (lbGame === 'drift') {
    lbFilter = driftDifficulty || 'all';
  }
  syncLbFilters();
  showScreen('lb');
  renderLeaderboard();
}

function syncLbFilters() {
  document.querySelectorAll('.lb-filter').forEach((btn) => {
    const filter = btn.getAttribute('data-filter');
    btn.classList.toggle('hidden', filter === 'daily' && lbGame !== 'rush');
    btn.classList.toggle('active', filter === lbFilter);
    if (filter === 'all') btn.textContent = lbGame === 'drift' ? 'Alle' : 'All';
  });
}

async function renderLeaderboard() {
  const list = $('lb-list');
  const empty = $('lb-empty');
  list.innerHTML = '<li class="muted">Loading…</li>';
  empty.classList.add('hidden');
  const heading = $('lb-heading');
  const filters = $('lb-filters');
  if (lbGame === 'mirror') {
    if (heading) heading.textContent = 'MIRROR TOP 50';
    filters?.classList.add('hidden');
  } else if (lbGame === 'drift') {
    if (heading) heading.textContent = 'DRIFT TOP 50';
    if (lbFilter === 'daily') lbFilter = driftDifficulty || 'all';
    filters?.classList.remove('hidden');
    syncLbFilters();
  } else {
    if (heading) heading.textContent = 'GLOBAL TOP 50';
    filters?.classList.remove('hidden');
    syncLbFilters();
  }
  try {
    let scores;
    let source;
    if (lbGame === 'mirror') {
      const res = await fetchScores({ game: 'mirror' });
      scores = res.scores;
      source = res.source;
    } else if (lbGame === 'drift') {
      const filter = !lbFilter || lbFilter === 'all' ? undefined : lbFilter;
      const res = await fetchScores(filter ? { difficulty: filter, game: 'drift' } : { game: 'drift' });
      scores = res.scores;
      source = res.source;
    } else if (lbFilter === 'daily') {
      const res = await fetchScores({ mode: 'daily', dailyDate: utcDateString(), game: 'rush' });
      scores = res.scores;
      source = res.source;
    } else {
      const filter = lbFilter === 'all' ? undefined : lbFilter;
      const res = await fetchScores(filter ? { difficulty: filter, game: 'rush' } : { game: 'rush' });
      scores = res.scores;
      source = res.source;
    }
    const identity = { name: loadPlayerName(), clientId: getOrCreateClientId() };
    list.innerHTML = '';
    if (!scores.length) {
      empty.classList.remove('hidden');
      if (lbGame === 'drift') {
        empty.textContent =
          source === 'local'
            ? 'Noch keine Punkte (lokal). Sei der Erste.'
            : 'Noch keine Punkte — sei der Erste.';
      } else {
        empty.textContent =
          source === 'local'
            ? 'No scores yet (local demo). Be the first.'
            : 'No scores yet — be the first.';
      }
      return;
    }
    for (const row of scores) {
      const li = document.createElement('li');
      const own = isOwnRow(row, identity);
      if (own) li.classList.add('is-you');
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = `#${row.rank}`;
      const name = document.createElement('span');
      name.className = 'name';
      const nameText = document.createElement('span');
      nameText.className = 'name-text';
      nameText.textContent = row.name;
      name.append(nameText);
      if (own) {
        const you = document.createElement('span');
        you.className = 'you-badge';
        you.textContent = 'YOU';
        name.append(you);
      }
      const badge = document.createElement('span');
      if (lbGame === 'mirror') {
        badge.className = 'diff-badge mirror';
        badge.textContent = 'Mirror';
      } else if (row.mode === 'daily' || (lbGame === 'rush' && lbFilter === 'daily')) {
        badge.className = 'diff-badge daily';
        badge.textContent = row.dailyDate ? `Daily ${String(row.dailyDate).slice(5)}` : 'Daily';
      } else {
        const d = normalizeDifficulty(row.difficulty || 'mittel');
        badge.className = `diff-badge ${d}`;
        badge.textContent = difficultyBadge(d);
      }
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = String(row.score);
      li.append(rank, name, badge, pts);
      list.appendChild(li);
    }
  } catch {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    empty.textContent = 'Could not load leaderboard.';
  }
}

$('btn-play').addEventListener('click', startRun);
$('btn-daily').addEventListener('click', startDaily);
$('btn-retry').addEventListener('click', () => {
  if (lastResult?.game === 'mirror') startMirror();
  else if (lastResult?.game === 'drift') startDrift();
  else if (lastResult?.daily || runMode === 'daily') startDaily();
  else startRun();
});
$('btn-diff-start').addEventListener('click', () => {
  saveDifficulty(selectedDifficulty);
  beginRun({ daily: false });
});
$('btn-diff-back').addEventListener('click', () => {
  audio.click();
  refreshTitleBest();
  showScreen('title');
});

document.querySelectorAll('#diff-options .diff-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.click();
    selectedDifficulty = normalizeDifficulty(btn.getAttribute('data-diff'));
    syncDiffChips();
  });
});

document.querySelectorAll('#drift-diff-options .diff-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.click();
    driftDifficulty = normalizeDifficulty(btn.getAttribute('data-drift-diff'));
    syncDriftDiffChips();
  });
});

document.querySelectorAll('.lb-filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    audio.click();
    lbFilter = btn.getAttribute('data-filter') || 'all';
    syncLbFilters();
    renderLeaderboard();
  });
});

$('btn-resume').addEventListener('click', () => {
  audio.click();
  hideAllScreens();
  hud.classList.remove('hidden');
  audio.startMusic();
  liveGame().setPaused(false);
});
$('btn-quit').addEventListener('click', () => {
  audio.click();
  const leaving = activeGame;
  liveGame().stop();
  audio.stopMusic();
  hud.classList.add('hidden');
  hudMode.classList.add('hidden');
  setHudChrome('rush');
  if (leaving === 'mirror') {
    refreshMirrorMenu();
    showScreen('mirror');
  } else if (leaving === 'drift') {
    refreshDriftMenu();
    showScreen('drift');
  } else {
    refreshTitleBest();
    showScreen('title');
  }
});
$('btn-lb-title').addEventListener('click', () => {
  audio.click();
  openLeaderboard('title');
});
$('btn-lb-over').addEventListener('click', () => {
  audio.click();
  openLeaderboard('over', resultGame(lastResult));
});
$('btn-lb-back').addEventListener('click', () => {
  audio.click();
  if (lbBackTo === 'over' && lastResult) showScreen('over');
  else if (lbBackTo === 'mirror') {
    refreshMirrorMenu();
    showScreen('mirror');
  } else if (lbBackTo === 'drift') {
    refreshDriftMenu();
    showScreen('drift');
  } else {
    refreshTitleBest();
    showScreen('title');
  }
});

$('btn-onboard-next').addEventListener('click', () => {
  audio.click();
  if (onboardStep >= ONBOARD_STEPS.length - 1) finishOnboard();
  else {
    onboardStep += 1;
    renderOnboardStep();
  }
});
$('btn-onboard-skip').addEventListener('click', () => {
  audio.click();
  finishOnboard();
});

$('btn-achievements').addEventListener('click', () => {
  audio.click();
  openAchievements();
});
$('btn-ach-back').addEventListener('click', () => {
  audio.click();
  refreshTitleBest();
  showScreen('title');
});
$('btn-skins').addEventListener('click', () => {
  audio.click();
  openSkins();
});
$('btn-skins-back').addEventListener('click', () => {
  audio.click();
  refreshTitleBest();
  showScreen('title');
});
$('btn-share').addEventListener('click', () => {
  shareScore();
});

btnPause.addEventListener('click', () => {
  const live = liveGame();
  if (!live.running || !live.alive) return;
  audio.click();
  audio.stopMusic();
  live.setPaused(true);
  hud.classList.add('hidden');
  showScreen('pause');
});

btnMute.addEventListener('click', () => {
  audio.resume();
  audio.toggleMute();
  syncMuteBtn();
  const live = liveGame();
  if (!audio.muted && live.running && live.alive && !live.paused) {
    audio.startMusic();
  }
});

$('btn-change-name').addEventListener('click', () => {
  if (submitting) return;
  audio.click();
  showNameEditor({ firstTime: false });
  const input = $('player-name');
  input.focus();
  input.select();
});

$('score-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!lastResult || submitting) return;
  const name = sanitizeName($('player-name').value);
  if (!name) {
    $('submit-status').textContent = 'Enter a name (max 16).';
    $('submit-status').classList.add('error');
    $('submit-status').classList.remove('calm');
    return;
  }
  if (lastResult.runId) autoSubmittedRun = lastResult.runId;
  await sendScore(name, { auto: false });
});

function onResize() {
  game.resize();
  mirror.resize();
  drift.resize();
  if (game.running || mirror.running || drift.running) return;
  if (activeGame === 'mirror') mirror.draw();
  else if (activeGame === 'drift') drift.draw();
  else {
    if (typeof game.seedStars === 'function') game.seedStars();
    game.draw();
  }
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

function idleDraw() {
  if (!game.running && !mirror.running && !drift.running) {
    if (activeGame === 'mirror') mirror.drawIdle();
    else if (activeGame === 'drift') drift.drawIdle();
    else {
      game.angle += 0.004;
      game.draw();
    }
  }
  requestAnimationFrame(idleDraw);
}

const aerger = mountAerger({
  onHub: () => showHub(),
  audioClick: () => {
    audio.resume();
    audio.click();
  },
});
pauseAerger = () => aerger.pause();

function openAerger() {
  activeGame = 'aerger';
  if (game.running) game.stop();
  if (mirror.running) mirror.stop();
  if (drift.running) drift.stop();
  audio.stopMusic();
  hud.classList.add('hidden');
  setHudChrome('rush');
  hudMode.classList.add('hidden');
  showScreen('aerger');
  aerger.open();
}

$('btn-hub-aerger').addEventListener('click', () => {
  audio.resume();
  audio.click();
  openAerger();
});

$('btn-hub-rush').addEventListener('click', () => {
  audio.resume();
  audio.click();
  openRushMenu();
});
$('btn-hub-mirror').addEventListener('click', () => {
  audio.resume();
  audio.click();
  openMirrorMenu();
});
$('btn-hub-drift').addEventListener('click', () => {
  audio.resume();
  audio.click();
  openDriftMenu();
});
$('btn-title-hub').addEventListener('click', () => {
  audio.click();
  showHub();
});
$('btn-mirror-play').addEventListener('click', startMirror);
$('btn-mirror-lb').addEventListener('click', () => {
  audio.click();
  openLeaderboard('mirror', 'mirror');
});
$('btn-mirror-hub').addEventListener('click', () => {
  audio.click();
  showHub();
});
$('btn-mirror-onboard').addEventListener('click', () => {
  audio.click();
  markMirrorOnboard();
  beginMirror();
});
$('btn-mirror-onboard-skip').addEventListener('click', () => {
  audio.click();
  markMirrorOnboard();
  beginMirror();
});
$('btn-drift-play').addEventListener('click', startDrift);
$('btn-drift-lb').addEventListener('click', () => {
  audio.click();
  openLeaderboard('drift', 'drift');
});
$('btn-drift-hub').addEventListener('click', () => {
  audio.click();
  showHub();
});
$('btn-drift-onboard').addEventListener('click', () => {
  audio.click();
  markDriftOnboard();
  openDriftDifficulty();
});
$('btn-drift-onboard-skip').addEventListener('click', () => {
  audio.click();
  markDriftOnboard();
  openDriftDifficulty();
});
$('btn-drift-diff-start').addEventListener('click', () => {
  saveDriftDifficulty(driftDifficulty);
  beginDrift();
});
$('btn-drift-diff-back').addEventListener('click', () => {
  audio.click();
  refreshDriftMenu();
  showScreen('drift');
});
$('btn-over-hub').addEventListener('click', () => {
  audio.click();
  showHub();
});

syncMuteBtn();
refreshTitleBest();
refreshHub();
showScreen('hub');
game.resize();
mirror.resize();
drift.setDifficulty(driftDifficulty);
drift.resize();
if (typeof game.seedStars === 'function') game.seedStars();
idleDraw();

window.__ORBIT_RUSH__ = {
  game,
  mirror,
  drift,
  computeScore,
  formatFormula,
  NEAR_MISS_POINTS,
  COMBO_STEP,
  DIFFICULTIES,
  DIFFICULTY_IDS,
  DEFAULT_DIFFICULTY,
  normalizeDifficulty,
  getDifficulty,
  startRun,
  startDaily,
  startMirror,
  startDrift,
  beginDrift,
  openDriftDifficulty,
  showHub,
  beginRun,
  openDifficultyPicker,
  sanitizeName,
  getOrCreateClientId,
  loadPlayerName,
  isOwnRow,
  getBest,
  getDailyBest,
  buildShareText,
  utcDateString,
  ACHIEVEMENTS,
  SKINS,
  get selectedDifficulty() {
    return selectedDifficulty;
  },
  get selectedSkin() {
    return selectedSkin;
  },
  get runMode() {
    return runMode;
  },
  setDifficulty(id) {
    saveDifficulty(id);
    syncDiffChips();
  },
  setDriftDifficulty(id) {
    saveDriftDifficulty(id);
    syncDriftDiffChips();
  },
  get driftDifficulty() {
    return driftDifficulty;
  },
  setSkin(id) {
    if (!skinIsUnlocked(id)) return false;
    selectedSkin = saveSkin(id);
    game.setSkin(selectedSkin);
    return true;
  },
};
