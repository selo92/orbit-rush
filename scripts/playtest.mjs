/**
 * Headless Chrome playtest: difficulty picker, start run, exercise hooks, game over, submit.
 * v1.3
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'data');
const userData = path.join(outDir, 'chrome-playtest-profile');
fs.mkdirSync(userData, { recursive: true });

const chrome = '/usr/bin/google-chrome';
const url = 'http://127.0.0.1:5173/';

const port = 9222;
const chromeProc = spawn(
  chrome,
  [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--user-data-dir=${userData}`,
    '--window-size=390,844',
    url,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!version) throw new Error('Chrome CDP not ready');

  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page =
    targets.find((t) => t.type === 'page' && t.url.includes('5173')) ||
    targets.find((t) => t.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No page target');

  try {
    await import('ws');
  } catch {
    await new Promise((resolve, reject) => {
      const n = spawn('npm', ['install', 'ws', '--no-save'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
      });
      n.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('ws install'))));
    });
  }
  const WS = (await import('ws')).default;

  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (msg.params.type === 'error') consoleErrors.push(text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.text || 'exception');
    }
  });

  function send(method, params = {}) {
    const msgId = ++id;
    ws.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      setTimeout(() => {
        if (pending.has(msgId)) {
          pending.delete(msgId);
          reject(new Error('CDP timeout ' + method));
        }
      }, 15000);
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(900);

  // Skip onboard if present (fresh profile)
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('orbit-rush-onboard-v1','1')`,
    returnByValue: true,
  });

  // Reload so onboard flag is respected on title
  await send('Page.reload', { ignoreCache: true });
  await sleep(1000);

  const clickPlay = await send('Runtime.evaluate', {
    expression: `(() => {
      document.getElementById('btn-hub-rush')?.click();
      const b = document.getElementById('btn-play');
      if (!b) return 'no-btn';
      b.click();
      const diff = document.getElementById('screen-diff');
      return diff && !diff.classList.contains('hidden') ? 'diff-open' : 'no-diff';
    })()`,
    returnByValue: true,
  });
  console.log('play→diff:', clickPlay.result?.value);

  // Select Baba then start (covers extreme + chip UI)
  const startBaba = await send('Runtime.evaluate', {
    expression: `(() => {
      const chip = document.querySelector('.diff-chip[data-diff="baba"]');
      chip?.click();
      window.__ORBIT_RUSH__.setDifficulty('baba');
      document.getElementById('btn-diff-start').click();
      const g = window.__ORBIT_RUSH__?.game;
      return {
        running: !!g?.running,
        difficulty: g?.difficultyId,
        label: window.__ORBIT_RUSH__.getDifficulty('baba').label,
      };
    })()`,
    returnByValue: true,
  });
  console.log('start baba:', startBaba.result?.value);

  await sleep(500);

  const exercised = await send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.__ORBIT_RUSH__.game;
      const { computeScore, NEAR_MISS_POINTS, DIFFICULTY_IDS } = window.__ORBIT_RUSH__;
      g.orbsCollected = 3;
      g.comboBonus = 150;
      g.nearMisses = 2;
      g.survivalMs = 5000;
      g.score = computeScore(g.survivalMs, g.orbsCollected, g.comboBonus, g.nearMisses);
      g.shieldCharges = 1;
      g.slowMo = 2;
      g.magnet = 2;
      g.emitHud();
      const expected = Math.floor(5)*10 + 3*100 + 150 + 2*NEAR_MISS_POINTS;
      return {
        score: g.score,
        expected,
        match: g.score === expected,
        difficulty: g.difficultyId,
        enumOk: Array.isArray(DIFFICULTY_IDS) && DIFFICULTY_IDS.includes('baba'),
        ramp: typeof g.ramp === 'number',
      };
    })()`,
    returnByValue: true,
  });
  console.log('v1.3 fields:', exercised.result?.value);

  const running = await send('Runtime.evaluate', {
    expression: `!!window.__ORBIT_RUSH__?.game?.running && window.__ORBIT_RUSH__.game.alive`,
    returnByValue: true,
  });
  console.log('alive:', running.result?.value);

  await send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.__ORBIT_RUSH__.game;
      const p = g.playerPos();
      g.die(p.x, p.y);
      return 'died';
    })()`,
    returnByValue: true,
  });

  await sleep(900);
  const overVisible = await send('Runtime.evaluate', {
    expression: `(() => {
      const over = !document.getElementById('screen-over').classList.contains('hidden');
      const badge = document.getElementById('over-diff-badge')?.textContent;
      return { over, badge };
    })()`,
    returnByValue: true,
  });
  console.log('gameover:', overVisible.result?.value);

  const formula = await send('Runtime.evaluate', {
    expression: `document.getElementById('over-formula').textContent`,
    returnByValue: true,
  });
  console.log('formula:', formula.result?.value);

  await send('Runtime.evaluate', {
    expression: `(() => {
      document.getElementById('player-name').value = 'Playtest';
      document.getElementById('score-form').requestSubmit();
      return 'submitted';
    })()`,
    returnByValue: true,
  });
  await sleep(700);

  const status = await send('Runtime.evaluate', {
    expression: `document.getElementById('submit-status').textContent`,
    returnByValue: true,
  });
  console.log('submit:', status.result?.value);

  const realErrors = consoleErrors.filter(
    (e) => e && !/favicon/i.test(e) && !/Deprecated/i.test(e) && !/Autofill/i.test(e)
  );

  const v = exercised.result?.value;
  const ov = overVisible.result?.value;
  const fieldsOk = v?.match === true && v?.enumOk === true && v?.difficulty === 'baba';
  const flowOk = clickPlay.result?.value === 'diff-open' && startBaba.result?.value?.difficulty === 'baba';
  const overOk = ov?.over === true && ov?.badge === 'Baba';
  console.log('consoleErrors:', realErrors);
  const ok = realErrors.length === 0 && fieldsOk && flowOk && overOk;
  
  // v1.3 surface checks (daily button, achievements/skins hooks, share)
  const v13 = await send('Runtime.evaluate', {
    expression: `(() => {
      const dailyBtn = !!document.getElementById('btn-daily');
      const achBtn = !!document.getElementById('btn-achievements');
      const skinsBtn = !!document.getElementById('btn-skins');
      const shareBtn = !!document.getElementById('btn-share');
      const api = window.__ORBIT_RUSH__;
      return {
        dailyBtn, achBtn, skinsBtn, shareBtn,
        hasStartDaily: typeof api?.startDaily === 'function',
        hasAchievements: Array.isArray(api?.ACHIEVEMENTS) && api.ACHIEVEMENTS.length >= 6,
        hasSkins: !!api?.SKINS,
        hasUtc: typeof api?.utcDateString === 'function',
      };
    })()`,
    returnByValue: true,
  });
  console.log('v1.3 ui:', v13.result?.value);
  const v13v = v13.result?.value;
  const v13ok =
    v13v?.dailyBtn &&
    v13v?.achBtn &&
    v13v?.skinsBtn &&
    v13v?.shareBtn &&
    v13v?.hasStartDaily &&
    v13v?.hasAchievements &&
    v13v?.hasSkins &&
    v13v?.hasUtc;

  await sleep(2200);
  const driftStart = await send('Runtime.evaluate', {
    expression: `(() => {
      localStorage.setItem('orbit-drift-onboard-v1', '1');
      document.getElementById('btn-over-hub')?.click();
      const tile = document.getElementById('btn-hub-drift');
      const blurb = tile?.querySelector('span')?.textContent || '';
      tile?.click();
      const menu = document.getElementById('screen-drift');
      const copy = menu?.innerText || '';
      document.getElementById('btn-drift-play')?.click();
      const picker = document.getElementById('screen-drift-diff');
      const pickerCopy = picker?.innerText || '';
      const pickerOpen = !!(picker && !picker.classList.contains('hidden'));
      picker?.querySelector('[data-drift-diff="schwer"]')?.click();
      document.getElementById('btn-drift-diff-start')?.click();
      const d = window.__ORBIT_RUSH__.drift;
      return {
        blurb,
        menuWasOpen: !!(menu && copy.includes('Halt die Bahn')),
        pickerOpen,
        labels: pickerCopy,
        running: !!d?.running,
        hull: d?.hull,
        difficulty: d?.difficultyId,
        german: copy.includes('SPIELEN') && pickerCopy.includes('Schwer') && pickerCopy.includes('Einfach'),
      };
    })()`,
    returnByValue: true,
  });
  console.log('drift start:', driftStart.result?.value);
  await sleep(400);
  await send('Runtime.evaluate', {
    expression: `(() => {
      const d = window.__ORBIT_RUSH__.drift;
      d.grace = 0;
      d.invuln = 0;
      d.hull = 1;
      const lane = d.sampleAt(d.playerZ);
      d.x = lane.center + lane.half + 1;
      d.hitWall(lane);
      return d.hull;
    })()`,
    returnByValue: true,
  });
  await sleep(1000);
  const driftOver = await send('Runtime.evaluate', {
    expression: `(() => {
      const over = !document.getElementById('screen-over').classList.contains('hidden');
      return {
        over,
        title: document.getElementById('over-title')?.textContent,
        badge: document.getElementById('over-diff-badge')?.textContent,
        formula: document.getElementById('over-formula')?.textContent,
        status: document.getElementById('submit-status')?.textContent,
      };
    })()`,
    returnByValue: true,
  });
  console.log('drift over:', driftOver.result?.value);
  await sleep(800);
  const driftBoard = await send('Runtime.evaluate', {
    expression: `(() => {
      document.getElementById('btn-lb-over')?.click();
      const heading = document.getElementById('lb-heading')?.textContent;
      const filters = document.getElementById('lb-filters');
      const filtersOpen = !!(filters && !filters.classList.contains('hidden'));
      const filterLabels = [...(filters?.querySelectorAll('.lb-filter') || [])]
        .filter((btn) => !btn.classList.contains('hidden'))
        .map((btn) => btn.textContent);
      document.getElementById('btn-lb-back')?.click();
      document.getElementById('btn-over-hub')?.click();
      const hub = !document.getElementById('screen-hub').classList.contains('hidden');
      const games = ['btn-hub-rush', 'btn-hub-mirror', 'btn-hub-aerger', 'btn-hub-drift'].map((id) => !!document.getElementById(id));
      document.getElementById('btn-hub-aerger')?.click();
      const aerger = !document.getElementById('screen-aerger').classList.contains('hidden');
      return {
        heading,
        filtersOpen,
        filterLabels,
        hub,
        games,
        aerger,
        status: document.getElementById('submit-status')?.textContent,
      };
    })()`,
    returnByValue: true,
  });
  console.log('drift board:', driftBoard.result?.value);

  const dv = driftStart.result?.value;
  const ovd = driftOver.result?.value;
  const db = driftBoard.result?.value;
  const driftOk =
    dv?.running === true &&
    dv?.hull === 3 &&
    dv?.difficulty === 'schwer' &&
    dv?.pickerOpen === true &&
    dv?.blurb?.includes('Tunnel') &&
    dv?.german === true &&
    ovd?.over === true &&
    ovd?.title === 'BAHN VERLASSEN' &&
    ovd?.badge === 'Schwer' &&
    typeof ovd?.formula === 'string' &&
    ovd.formula.includes('× 10') &&
    db?.heading === 'DRIFT TOP 50' &&
    db?.filtersOpen === true &&
    Array.isArray(db?.filterLabels) &&
    db.filterLabels.includes('Alle') &&
    db.filterLabels.includes('Schwer') &&
    !db.filterLabels.includes('Daily') &&
    db?.hub === true &&
    Array.isArray(db?.games) &&
    db.games.every(Boolean) &&
    db?.aerger === true;

  console.log('PLAYTEST', ok && v13ok && driftOk ? 'OK' : 'FAIL');

  ws.close();
  chromeProc.kill('SIGTERM');
  process.exit(ok && v13ok && driftOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  chromeProc.kill('SIGTERM');
  process.exit(1);
});
