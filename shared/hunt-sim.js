/**
 * Deterministic Orbit Hunt.
 * The client and the worker both run this. A run token carries the seed.
 * The log is shots, reloads, and the sampled camera/aim. Score comes from
 * the replay, not from the numbers the client claims.
 *
 * Time is integer 20ms steps so survival does not drift. Camera and mouse
 * aim are sampled every 80ms; both sides apply that same sample.
 */
import { COMBO_GAP_SEC, COMBO_MAX, COMBO_STEP } from '../src/game.js';
import {
  HUNT_AWARDS,
  HUNT_BIRD_MAX_SEC,
  HUNT_LUNGE_SEC,
  HUNT_MAG,
  HUNT_RELOAD_SEC,
  HUNT_SPECIES,
  HUNT_WORLD_SCREENS,
  getHuntDifficulty,
  settleHuntScore,
} from '../src/hunt.js';
import { mulberry32 } from '../src/rng.js';

export const HUNT_STEP_MS = 20;
export const HUNT_DT = HUNT_STEP_MS / 1000;
/** Aim and touch-camera latch. Edge scroll still runs every step from the latch. */
const SAMPLE_EVERY = 4;
const MAX_EVENTS = 4500;
const MAX_LOG_CHARS = 14000;

const SPECIES_DEF = {
  puff: { speed: 1, size: 1, y: 0 },
  hamster: { speed: 0.62, size: 1.16, y: 0.5 },
  bunny: { speed: 0.92, size: 1.02, y: 0.46 },
  chick: { speed: 1.28, size: 0.74, y: 0.3 },
  mole: { speed: 0.35, size: 0.96, y: 0.6 },
  bat: { speed: 1.22, size: 0.88, y: 0.18 },
};

const KIND_FLIGHT = {
  near: { depth: 1, speed: 78, r: 48, y: 0.5 },
  mid: { depth: 0.72, speed: 128, r: 32, y: 0.34 },
  far: { depth: 0.42, speed: 196, r: 18, y: 0.18 },
  gold: { depth: 0.55, speed: 360, r: 24, y: 0.24 },
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function huntSizeOk(w, h) {
  return Number.isInteger(w) && Number.isInteger(h) && w >= 240 && w <= 480 && h >= 360 && h <= 1600;
}

export class HuntSim {
  /**
   * @param {{ seed: number, difficulty: string, w: number, h: number, pointer?: 'mouse'|'touch', record?: boolean }} opts
   */
  constructor(opts) {
    this.seed = opts.seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.diff = getHuntDifficulty(opts.difficulty);
    this.difficultyId = this.diff.id;
    this.w = Math.floor(opts.w);
    this.h = Math.floor(opts.h);
    this.pointer = opts.pointer === 'touch' ? 'touch' : 'mouse';
    this.record = !!opts.record;
    this.events = [];
    this.tick = 0;
    this.clock = 0;
    this.survivalMs = 0;
    this.ending = false;
    this.endT = 0;
    this.finished = false;
    this.caught = false;
    this.score = 0;
    this.orbs = 0;
    this.comboBonus = 0;
    this.nearMisses = 0;
    this.debt = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboPeak = 0;
    this.mag = this.diff.mag;
    this.roundMs = Math.round(this.diff.roundSec * 1000);
    this.ammo = this.mag;
    this.reloadT = 0;
    this.shots = 0;
    this.hits = 0;
    this.penalties = 0;
    this.birds = [];
    this.props = [];
    this.popup = null;
    this.popupGap = 1.4 + this.rng() * 2.2;
    this.spawnT = 0.18 + this.rng() * 0.55;
    this.goldT = 4.5 + this.rng() * 3;
    this.cam = 0;
    this.pendingCam = 0;
    this.sampledCam = 0;
    this.worldW = Math.max(this.w + 80, Math.round(this.w * HUNT_WORLD_SCREENS));
    this.maxCam = Math.max(0, this.worldW - this.w);
    this.aim = { x: this.w * 0.5, y: this.h * 0.4 };
    this.pendingAim = { x: this.aim.x, y: this.aim.y };
    this.sampledAimX = Math.round(this.aim.x);
    this.sampledAimY = Math.round(this.aim.y);
    this.shake = 0;
    this.hitStop = 0;
    this.bannerT = 2.6;
    this.attacker = null;
    this.attackerT = this.diff.attacker ? this.diff.attackerFirst : 1e9;
    this.flash = 0;
    this.crack = 0;
    this.armed = true;
    this.maxTicks = Math.ceil(this.roundMs / HUNT_STEP_MS) + Math.ceil(1000 / HUNT_STEP_MS);
    this.layoutProps();
    this.seedFlock();
    this.syncScore();
  }

  layoutProps() {
    const ground = this.h * 0.63;
    const w = this.worldW || this.w;
    const defs = [
      { id: 'wind', kind: 'windmill', x: w * 0.18, y: ground, depth: 0.86, h: this.h * 0.28, peekX: 8 },
      { id: 'tree', kind: 'tree', x: w * 0.46, y: ground, depth: 0.96, h: this.h * 0.24, peekX: this.h * 0.04 },
      { id: 'hay', kind: 'hay', x: w * 0.73, y: ground, depth: 1, h: this.h * 0.12, peekX: 0 },
      { id: 'sign', kind: 'sign', x: w * 0.32, y: ground, depth: 1, h: this.h * 0.16 },
      { id: 'lantern', kind: 'penalty', sub: 'laterne', x: w * 0.1, y: ground, depth: 1, h: this.h * 0.14, r: 26 },
      { id: 'basket', kind: 'penalty', sub: 'korb', x: w * 0.58, y: ground, depth: 1, h: this.h * 0.08, r: 30 },
      { id: 'sleeper', kind: 'penalty', sub: 'wolke', x: w * 0.86, y: this.h * 0.3, depth: 0.7, h: 40, r: 36 },
    ];
    this.props = defs.map((d) => ({ ...d, up: true, cool: 0, fall: 0, respawn: 0 }));
  }

  noteAim(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.pendingAim = { x, y };
  }

  noteCam(cam) {
    if (!Number.isFinite(cam)) return;
    this.pendingCam = clamp(cam, 0, this.maxCam);
  }

  sample() {
    if (this.tick % SAMPLE_EVERY !== 0) return;
    if (this.pointer === 'touch') {
      const cam = clamp(Math.round(this.pendingCam), 0, this.maxCam);
      if (this.record && cam !== this.sampledCam) {
        this.events.push({ kind: 'c', tick: this.tick, cam });
        this.sampledCam = cam;
      }
      this.cam = cam;
      return;
    }
    const x = Math.round(this.pendingAim.x);
    const y = Math.round(this.pendingAim.y);
    if (this.record && (x !== this.sampledAimX || y !== this.sampledAimY)) {
      this.events.push({ kind: 'a', tick: this.tick, x, y });
      this.sampledAimX = x;
      this.sampledAimY = y;
    }
    this.aim = { x, y };
  }

  step() {
    if (this.finished) return;
    this.sample();
    const dt = HUNT_DT;
    this.clock += dt;
    if (!this.ending) this.survivalMs += HUNT_STEP_MS;
    if (!this.ending && this.survivalMs >= this.roundMs) {
      this.survivalMs = this.roundMs;
      this.ending = true;
      this.endT = 0.7;
      if (this.attacker?.phase === 'warn') this.attacker = null;
    }
    if (this.ending) {
      this.endT -= dt;
      if (this.endT <= 0) {
        this.finish();
        this.tick += 1;
        return;
      }
    }
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.shake = Math.max(0, this.shake - dt * 2.6);
    if (!(this.attacker && this.attacker.phase === 'lunge')) {
      this.flash = Math.max(0, this.flash - dt * 1.7);
      this.crack = Math.max(0, this.crack - dt * 1.4);
    }
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      if (this.reloadT === 0) this.ammo = this.mag || HUNT_MAG;
    }
    this.guardBirds(dt);
    this.advanceAttacker(dt);
    if (this.finished) {
      this.tick += 1;
      return;
    }
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.birds = this.birds.filter((bird) => !bird.doom);
      this.tick += 1;
      this.syncScore();
      return;
    }
    if (this.pointer === 'mouse' && !this.ending) {
      const edge = this.w * 0.16;
      let push = 0;
      if (this.aim.x < edge) push = -((edge - this.aim.x) / edge);
      else if (this.aim.x > this.w - edge) push = (this.aim.x - (this.w - edge)) / edge;
      if (push) this.cam = clamp(this.cam + push * 720 * dt, 0, this.maxCam);
    }
    if (!this.ending && this.attacker?.phase !== 'lunge') this.spawn(dt);
    this.advanceBirds(dt);
    this.advanceProps(dt);
    this.tick += 1;
    this.syncScore();
  }

  /**
   * Real frames accumulate into 20ms steps. A stall cannot skip the round.
   * @param {number} frameDt seconds
   */
  consume(frameDt) {
    const capped = Math.min(0.05, Math.max(0, Number(frameDt) || 0));
    this.acc = (this.acc || 0) + capped;
    let guard = 0;
    while (this.acc >= HUNT_DT - 1e-8 && !this.finished && guard < 4) {
      this.step();
      this.acc -= HUNT_DT;
      guard += 1;
    }
  }

  rollPuffKind() {
    const roll = this.rng();
    return roll < 0.34 ? 'near' : roll < 0.68 ? 'mid' : 'far';
  }

  rollSpecies() {
    if (this.rng() < 0.4) return 'puff';
    return HUNT_SPECIES[(this.rng() * HUNT_SPECIES.length) | 0];
  }

  speciesKind(species) {
    if (species === 'hamster' || species === 'mole') return 'near';
    if (species === 'chick') return 'far';
    return 'mid';
  }

  spawn(dt) {
    const spawnScale = this.diff.spawnScale ?? 1;
    const surprise = this.diff.surprise ?? 1;
    this.spawnT -= dt;
    this.goldT -= dt;
    this.popupGap -= dt;
    const alive = this.birds.filter((b) => !b.falling && !b.leaving).length;
    const cap = surprise > 1.3 ? 8 : 7;
    if (this.spawnT <= 0 && alive < cap) {
      let gap = (0.22 + this.rng() * this.rng() * 1.15) * spawnScale;
      if (this.rng() < 0.16) gap += (0.4 + this.rng() * 0.7) * (surprise > 1 ? 0.5 : 1);
      this.spawnT = gap;
      let burst = this.rng() < 0.2 * Math.min(1.35, surprise) && alive < 5 ? 2 : 1;
      if (surprise > 1.4 && this.rng() < 0.28 && alive < 4) burst = 3;
      for (let i = 0; i < burst; i++) {
        const species = this.rollSpecies();
        const kind = species === 'puff' ? this.rollPuffKind() : this.speciesKind(species);
        this.birds.push(this.surpriseBird(kind, species));
      }
    }
    if (this.goldT <= 0) {
      this.goldT = 6.2 + this.rng() * 5.5;
      if (!this.birds.some((b) => b.kind === 'gold' && !b.falling)) {
        this.birds.push(this.surpriseBird('gold'));
      }
    }
    if (this.popupGap <= 0 && !this.popup) {
      this.popupGap = 2.6 + this.rng() * 4.8;
      const hosts = this.props.filter((p) => p.kind === 'windmill' || p.kind === 'tree' || p.kind === 'hay');
      const host = hosts[Math.floor(this.rng() * hosts.length)];
      if (host) this.popup = { id: host.id, t: 0, dur: 0.72 + this.rng() * 0.22 };
    }
    if (this.popup) {
      this.popup.t += dt;
      if (this.popup.t >= this.popup.dur) this.popup = null;
    }
  }

  makeBird(kind, x, species = 'puff') {
    const spec = SPECIES_DEF[species] || SPECIES_DEF.puff;
    const flight = KIND_FLIGHT[kind] || KIND_FLIGHT.mid;
    const planted = x != null;
    const dir = this.rng() < 0.5 ? -1 : 1;
    const scale = clamp((this.h || 780) / 780, 0.72, 1.15);
    const diffSpeed = this.diff.speed ?? 1;
    const diffSize = this.diff.size ?? 1;
    const y = (this.h || 780) * (species === 'puff' ? flight.y : spec.y);
    const vx = dir * flight.speed * (0.88 + this.rng() * 0.28) * diffSpeed * spec.speed;
    return {
      kind,
      species,
      x: planted ? x : 0,
      y,
      flightY: y,
      hideY: null,
      vx,
      cruise: vx,
      emerge: 1,
      age: 0,
      depth: flight.depth,
      r: flight.r * scale * diffSize * spec.size,
      falling: false,
      vy: 0,
      rot: 0,
      spin: 0,
      flap: this.rng() * 6,
      bob: this.rng() * 6,
      pop: planted ? 1 : 0,
      intro: planted ? 0 : 0.15,
      entrance: planted ? 'live' : 'hill',
      peekLife: 0,
      leaving: false,
      flash: 0,
      bounces: 0,
      rest: 0,
    };
  }

  propOnScreen(id) {
    const prop = this.props.find((p) => p.id === id);
    if (!prop || !this.w) return null;
    const sx = prop.x - this.cam * prop.depth;
    if (sx < this.w * 0.06 || sx > this.w * 0.94) return null;
    return prop;
  }

  surpriseBird(kind, species = 'puff') {
    const bird = this.makeBird(kind, undefined, species);
    const flight = KIND_FLIGHT[kind] || KIND_FLIGHT.mid;
    const wind = this.propOnScreen('wind');
    const tree = this.propOnScreen('tree');
    const hay = this.propOnScreen('hay');
    const options = ['hill', 'grass', 'drop', 'dash', 'peek'];
    if (wind) options.push('wind', 'wind');
    if (tree) options.push('tree', 'tree');
    if (hay) options.push('hay', 'hay');
    if (kind === 'gold') options.push('dash', 'drop', 'drop');
    const surprise = this.diff.surprise ?? 1;
    if (surprise > 1.25) options.push('dash', 'drop', 'peek', 'dash');
    if (surprise < 0.7) options.push('hill', 'grass', 'hill');
    const entrance = options[(this.rng() * options.length) | 0];
    bird.entrance = entrance;
    const introScale = surprise > 1 ? Math.min(surprise, 1.55) : surprise < 1 ? Math.max(surprise, 0.72) : 1;
    bird.intro = (0.12 + this.rng() * 0.07) / introScale;
    bird.pop = 0;
    bird.flightY = bird.y + (this.rng() - 0.5) * this.h * 0.035;
    const sx = this.w * (0.16 + this.rng() * 0.68);
    const place = (screenX) => {
      bird.x = screenX + this.cam * bird.depth;
    };
    if (entrance === 'dash') {
      const fromLeft = this.rng() < 0.5;
      const edge = fromLeft ? -(22 + this.rng() * 18) : this.w + 22 + this.rng() * 18;
      place(edge);
      const kick = kind === 'gold' ? 1.45 : 2.05 + this.rng() * 0.35;
      const diffSpeed = this.diff.speed ?? 1;
      bird.vx = (fromLeft ? 1 : -1) * flight.speed * kick * diffSpeed * (SPECIES_DEF[species]?.speed || 1);
      bird.cruise = bird.vx;
      bird.emerge = 1;
      bird.y = bird.flightY;
    } else if (entrance === 'drop') {
      place(sx);
      bird.hideY = -bird.r - 6;
      bird.y = bird.hideY;
      bird.emerge = 0.35;
    } else if (entrance === 'peek') {
      place(sx);
      bird.y = bird.flightY;
      bird.peekLife = 0.68 + this.rng() * 0.42;
      bird.vx = bird.cruise * 0.12;
      bird.emerge = 1;
    } else if (entrance === 'wind' || entrance === 'tree' || entrance === 'hay') {
      const prop = entrance === 'wind' ? wind : entrance === 'tree' ? tree : hay;
      this.perchOn(bird, prop);
    } else if (entrance === 'grass') {
      place(sx);
      bird.hideY = this.h * 0.7;
      bird.y = bird.hideY;
      bird.emerge = 0.22;
    } else {
      place(sx);
      bird.hideY = Math.max(this.h * 0.54, bird.flightY + this.h * 0.11);
      bird.y = bird.hideY;
      bird.emerge = 0.28;
    }
    if (species === 'mole') {
      const moleX = this.w * (0.16 + this.rng() * 0.68);
      bird.species = 'mole';
      bird.entrance = 'peek';
      bird.depth = 1;
      bird.x = moleX + this.cam * bird.depth;
      bird.flightY = this.h * 0.6;
      bird.hideY = this.h * 0.74;
      bird.y = bird.hideY;
      bird.pop = 0;
      bird.intro = 0.16;
      bird.emerge = 0.2;
      bird.peekLife = 0.72 + this.rng() * 0.38;
      bird.vx = (this.rng() < 0.5 ? -1 : 1) * 28;
      bird.cruise = bird.vx;
    } else if (species === 'bat' && bird.entrance !== 'dash') {
      bird.flightY = this.h * (0.12 + this.rng() * 0.08);
      if (bird.entrance === 'peek' || bird.hideY == null) bird.y = bird.flightY;
    }
    return bird;
  }

  seedFlock() {
    this.birds = [];
    const lineup = [
      ['near', 'puff'],
      ['mid', 'hamster'],
      ['far', 'chick'],
    ];
    for (const [kind, species] of lineup) {
      const bird = this.surpriseBird(kind, species);
      bird.pop = 0.08 + this.rng() * 0.2;
      this.birds.push(bird);
    }
  }

  guardBirds(dt) {
    for (const bird of this.birds) {
      bird.age = (bird.age || 0) + dt;
      if (bird.age >= HUNT_BIRD_MAX_SEC) bird.doom = true;
    }
  }

  beyondMeadow(bird) {
    const margin = (bird.r || 20) + 90;
    const depth = bird.depth || 0;
    const minSx = bird.x - this.maxCam * depth;
    const maxSx = bird.x;
    return maxSx < -margin || minSx > this.w + margin;
  }

  perchOn(bird, prop) {
    const psx = prop.x - this.cam * prop.depth + (prop.peekX || 0) * 0.15;
    bird.depth = Math.min(1.2, (prop.depth || 1) + 0.06);
    bird.x = psx + this.cam * bird.depth;
    const hay = bird.entrance === 'hay';
    bird.hideY = prop.y - prop.h * (hay ? 0.2 : 0.42);
    bird.y = bird.hideY;
    bird.emerge = 0.18;
  }

  finishEntrance(bird) {
    if (bird.entrance === 'peek' || bird.entrance === 'dash') return;
    const cruise = bird.cruise || bird.vx;
    if (Math.abs(cruise) >= 48) bird.vx = cruise;
  }

  advanceBirds(dt) {
    const ground = this.h * 0.78;
    for (const bird of this.birds) {
      if (bird.doom) continue;
      bird.flap += dt * (bird.kind === 'gold' ? 16 : 9);
      if (bird.flash > 0) bird.flash = Math.max(0, bird.flash - dt * 7);
      if (bird.falling) {
        bird.fallAge = (bird.fallAge || 0) + dt;
        bird.vy += 1400 * dt;
        bird.y += bird.vy * dt;
        bird.x += bird.vx * dt;
        bird.rot += dt * (bird.spin || 11);
        if (bird.y >= ground && bird.vy > 0) {
          bird.y = ground;
          bird.bounces = (bird.bounces || 0) + 1;
          if (bird.bounces >= 3 || bird.vy < 220) {
            bird.vy = 0;
            bird.vx *= 0.35;
          } else {
            bird.vy = -bird.vy * 0.4;
            bird.vx *= 0.62;
            bird.spin *= 0.55;
          }
        }
        if (bird.vy === 0 && bird.bounces > 0) {
          bird.y = ground;
          bird.rest += dt;
        }
        if ((bird.rest || 0) > 1.05 || bird.fallAge > 3.6 || bird.y > this.h + (bird.r || 20) + 120) {
          bird.doom = true;
        }
        continue;
      }
      if (bird.leaving) {
        bird.leaveAge = (bird.leaveAge || 0) + dt;
        bird.pop = Math.max(0, (bird.pop ?? 1) - dt * 5.2);
        bird.x += (bird.vx || 0) * dt * 0.35;
        if (bird.pop <= 0.02 || bird.leaveAge > 0.6) bird.doom = true;
        continue;
      }
      if ((bird.pop ?? 1) < 1) {
        const intro = Math.min(0.22, Math.max(0.08, bird.intro || 0.15));
        bird.pop = Math.min(1, bird.pop + dt / intro);
        if (bird.hideY != null) {
          const e = 1 - (1 - bird.pop) * (1 - bird.pop);
          bird.y = bird.hideY + (bird.flightY - bird.hideY) * e;
        }
        bird.x += bird.vx * (bird.emerge ?? 1) * dt;
        if (bird.pop >= 1 || (bird.age || 0) > 0.85) {
          bird.pop = 1;
          if (bird.hideY != null && (bird.age || 0) > 0.85) bird.y = bird.flightY;
          this.finishEntrance(bird);
        }
        continue;
      }
      if (bird.entrance === 'peek') {
        bird.peekLife = (bird.peekLife || 0) - dt;
        if (bird.peekLife <= 0 || (bird.age || 0) > 2.6) bird.leaving = true;
      } else if (Math.abs(bird.vx) < 48) {
        const cruise = bird.cruise || 0;
        if (Math.abs(cruise) >= 48) bird.vx = cruise;
        else bird.vx = (Math.sign(cruise || bird.vx) || 1) * 72;
      }
      if (bird.entrance !== 'peek') this.steerSpecies(bird);
      bird.bob += dt * (bird.kind === 'gold' ? 11 : 6);
      bird.x += bird.vx * dt;
      if (this.beyondMeadow(bird)) bird.doom = true;
    }
    this.birds = this.birds.filter((bird) => !bird.doom);
  }

  steerSpecies(bird) {
    if (!bird.baseVx) {
      const seeded = bird.cruise || bird.vx || 72;
      bird.baseVx = Math.abs(seeded) < 36 ? Math.sign(seeded || 1) * 72 : seeded;
    }
    const cruise = bird.baseVx;
    if (bird.species === 'bunny') {
      const hop = Math.abs(Math.sin(bird.bob * 1.35));
      bird.vx = hop < 0.15 ? cruise * 0.22 : cruise;
    } else if (bird.species === 'chick') {
      bird.vx = cruise + Math.sin((bird.age || 0) * 9) * Math.abs(cruise) * 0.55;
    } else if (bird.species === 'bat') {
      bird.vx = cruise * (0.65 + 0.7 * Math.sin((bird.age || 0) * 3.2));
    } else if (bird.species === 'hamster') {
      bird.vx = cruise * 0.72;
    }
  }

  advanceProps(dt) {
    for (const prop of this.props) {
      if (prop.cool > 0) prop.cool = Math.max(0, prop.cool - dt);
      if (prop.kind === 'sign' && !prop.up) {
        prop.fall += dt;
        prop.respawn -= dt;
        if (prop.respawn <= 0) {
          prop.up = true;
          prop.fall = 0;
          prop.respawn = 0;
        }
      }
    }
  }

  reload() {
    if (this.finished || this.ending) return false;
    if (this.reloadT > 0 || this.ammo >= HUNT_MAG) return false;
    this.reloadT = HUNT_RELOAD_SEC;
    if (this.record) this.events.push({ kind: 'r', tick: this.tick });
    return true;
  }

  shoot(x, y) {
    if (this.finished || this.ending) return null;
    if (this.reloadT > 0) return null;
    if (this.ammo <= 0) return null;
    const sx = Math.round(Number(x));
    const sy = Math.round(Number(y));
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
    this.ammo -= 1;
    this.shots += 1;
    this.shake = Math.min(1.15, this.shake + 0.34);
    if (this.record) this.events.push({ kind: 's', tick: this.tick, x: sx, y: sy });
    const hit = this.pick(sx, sy);
    if (hit) this.resolve(hit);
    this.syncScore();
    return hit || { kind: 'miss', x: sx, y: sy };
  }

  birdScreen(bird) {
    const rising = bird.pop != null && bird.pop < 1;
    let bob = 0;
    if (!bird.falling && !rising) {
      if (bird.species === 'bunny') bob = -Math.abs(Math.sin(bird.bob * 1.35)) * bird.r * 0.9;
      else if (bird.species === 'bat') bob = Math.sin((bird.age || 0) * 5) * bird.r * 1.1;
      else if (bird.species === 'chick') bob = Math.sin((bird.age || 0) * 7) * bird.r * 0.4;
      else if (bird.species === 'hamster') bob = Math.sin(bird.bob) * bird.r * 0.34;
      else bob = Math.sin(bird.bob) * bird.r * 0.22;
    }
    return {
      x: bird.x - this.cam * bird.depth,
      y: bird.y + bob,
      r: bird.r,
    };
  }

  popupHost() {
    if (!this.popup) return null;
    return this.props.find((p) => p.id === this.popup.id) || null;
  }

  popupPoint(prop) {
    if (!prop || !this.popup) return null;
    const peek = Math.sin(clamp(this.popup.t / this.popup.dur, 0, 1) * Math.PI);
    const sx = prop.x - this.cam * prop.depth + (prop.peekX || 0);
    const y = prop.y - prop.h * (0.25 + 0.7 * peek);
    return { x: sx, y, r: Math.max(22, this.h * 0.03), peek };
  }

  signPoint(prop) {
    const sx = prop.x - this.cam * prop.depth;
    const drop = prop.up ? 0 : Math.min(80, prop.fall * 140);
    return { x: sx, y: prop.y - prop.h * 0.82 + drop, r: Math.max(24, prop.h * 0.28) };
  }

  penaltyPoint(prop) {
    const sx = prop.x - this.cam * prop.depth;
    const y = prop.sub === 'wolke' ? prop.y : prop.y - prop.h * 0.45;
    return { x: sx, y, r: prop.r || 28 };
  }

  birdHittable(bird) {
    if (!bird || bird.falling || bird.leaving || bird.doom) return false;
    if ((bird.pop ?? 1) >= 0.3) return true;
    return (bird.age || 0) >= 0.4;
  }

  popScale(bird) {
    const t = bird.pop == null ? 1 : bird.pop;
    const dash = bird.entrance === 'dash' && !bird.falling;
    if (t >= 1) return dash ? [1.12, 0.9] : [1, 1];
    let sx;
    let sy;
    if (t < 0.4) {
      const u = t / 0.4;
      sx = 0.12 + u * 1.18;
      sy = 0.12 + u * 0.55;
    } else if (t < 0.72) {
      const u = (t - 0.4) / 0.32;
      sx = 1.3 - u * 0.5;
      sy = 0.67 + u * 0.58;
    } else {
      const u = (t - 0.72) / 0.28;
      sx = 0.8 + u * 0.2;
      sy = 1.25 - u * 0.25;
    }
    if (dash) {
      sx *= 1.16;
      sy *= 0.84;
    }
    return [sx, sy];
  }

  birdHitExtents(bird) {
    const [sx, sy] = this.popScale(bird);
    const r = Math.max(8, bird.r || 16);
    const pad = Math.max(14, r * 0.22);
    return {
      hx: r * 1.2 * Math.max(sx, 0.2) + pad,
      hy: r * 1.22 * Math.max(sy, 0.2) + pad,
    };
  }

  attackerContains(attacker, sx, sy) {
    const pop = Math.max(0.35, attacker.pop || 0);
    const pad = Math.max(16, attacker.r * 0.08);
    const rad = attacker.r * (0.78 + 0.22 * pop) + pad;
    const dx = attacker.x - sx;
    const dy = attacker.y - sy;
    return dx * dx + dy * dy <= rad * rad;
  }

  pick(sx, sy) {
    const threat = this.attacker;
    if (threat && threat.phase === 'warn' && (threat.pop ?? 0) >= 0.18 && this.attackerContains(threat, sx, sy)) {
      return { kind: 'attacker', depth: 4, d: 0, attacker: threat, x: threat.x, y: threat.y };
    }
    let best = null;
    for (const bird of this.birds) {
      if (!this.birdHittable(bird)) continue;
      const p = this.birdScreen(bird);
      const ext = this.birdHitExtents(bird);
      const dx = p.x - sx;
      const dy = p.y - sy;
      const nx = dx / ext.hx;
      const ny = dy / ext.hy;
      if (nx * nx + ny * ny > 1) continue;
      const d = Math.hypot(dx, dy);
      if (!best || bird.depth > best.depth + 1e-6 || (Math.abs(bird.depth - best.depth) <= 1e-6 && d < best.d)) {
        best = { kind: 'bird', depth: bird.depth, d, bird, x: p.x, y: p.y };
      }
    }
    if (best) return best;
    const hits = [];
    const host = this.popupHost();
    const pop = host ? this.popupPoint(host) : null;
    if (pop && pop.peek > 0.42) {
      const d = Math.hypot(pop.x - sx, pop.y - sy);
      if (d <= pop.r) hits.push({ kind: 'hidden', depth: host?.depth || 1, d, prop: host, x: pop.x, y: pop.y });
    }
    for (const prop of this.props) {
      if (prop.kind === 'sign' && prop.up) {
        const p = this.signPoint(prop);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d <= p.r) hits.push({ kind: 'sign', depth: prop.depth, d, prop, x: p.x, y: p.y });
      } else if (prop.kind === 'penalty' && prop.cool <= 0) {
        const p = this.penaltyPoint(prop);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d <= p.r) hits.push({ kind: 'penalty', depth: prop.depth, d, prop, x: p.x, y: p.y });
      }
    }
    hits.sort((a, b) => {
      if (b.depth !== a.depth) return b.depth - a.depth;
      return a.d - b.d;
    });
    return hits[0] || null;
  }

  resolve(hit) {
    if (hit.kind === 'attacker' && this.attacker) {
      this.award('attacker');
      this.attacker = null;
      const gap = this.diff.attackerGap || 12;
      this.attackerT = gap * (0.85 + this.rng() * 0.35);
      this.hitStop = 0.1;
      this.shake = Math.min(1.7, this.shake + 1.05);
      this.flash = 0.62;
      return;
    }
    if (hit.kind === 'bird' && hit.bird) {
      const bird = hit.bird;
      const awardKind = bird.species && bird.species !== 'puff' && HUNT_AWARDS[bird.species] ? bird.species : bird.kind;
      bird.falling = true;
      bird.leaving = false;
      bird.pop = 1;
      bird.vy = -130;
      bird.vx *= 0.18;
      bird.spin = (this.rng() < 0.5 ? -1 : 1) * (11 + this.rng() * 6);
      bird.flash = 1;
      bird.bounces = 0;
      bird.rest = 0;
      bird.rot = (this.rng() - 0.5) * 0.6;
      this.award(awardKind);
      this.hitStop = 0.072;
      this.shake = Math.min(1.25, this.shake + 0.78);
      return;
    }
    if (hit.kind === 'hidden' && hit.prop) {
      this.popup = null;
      this.popupGap = 3.2 + this.rng() * 2;
      this.award('hidden');
      this.hitStop = 0.06;
      this.shake = Math.min(1.2, this.shake + 0.55);
      return;
    }
    if (hit.kind === 'sign' && hit.prop) {
      hit.prop.up = false;
      hit.prop.fall = 0;
      hit.prop.respawn = 8;
      this.award('sign');
      this.hitStop = 0.05;
      this.shake = Math.min(1.1, this.shake + 0.4);
      return;
    }
    if (hit.kind === 'penalty' && hit.prop) {
      hit.prop.cool = 2.4;
      this.penalize();
      this.shake = Math.min(1.15, this.shake + 0.5);
    }
  }

  award(kind) {
    const spec = HUNT_AWARDS[kind];
    if (!spec) return 0;
    const before = this.score;
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = COMBO_GAP_SEC;
    const mult = Math.min(COMBO_MAX, this.comboCount);
    if (this.comboCount > this.comboPeak) this.comboPeak = this.comboCount;
    this.orbs += spec.orbs;
    this.nearMisses += spec.near;
    if (spec.orbs > 0) this.comboBonus += (mult - 1) * COMBO_STEP;
    this.hits += 1;
    this.syncScore();
    return this.score - before;
  }

  penalize() {
    this.debt += 100;
    this.penalties += 1;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.syncScore();
  }

  beginAttacker() {
    if (this.attacker) return this.attacker;
    const pool = ['puff', ...HUNT_SPECIES];
    const id = pool[(this.rng() * pool.length) | 0];
    const short = Math.min(this.w || 390, this.h || 780);
    this.attacker = {
      species: id,
      phase: 'warn',
      t: 0,
      window: Math.max(0.4, this.diff.attackerWindow || 2),
      x: (this.w || 390) * (0.46 + this.rng() * 0.08),
      y: (this.h || 780) * (0.4 + this.rng() * 0.05),
      r: short * 0.34,
      pop: 0,
      depth: 4,
    };
    this.shake = Math.max(this.shake, 0.5);
    return this.attacker;
  }

  advanceAttacker(dt) {
    const attacker = this.attacker;
    if (!attacker) {
      if (!this.armed || this.ending || this.finished || !this.diff.attacker) return;
      this.attackerT -= dt;
      if (this.attackerT > 0) return;
      if (this.ammo <= 0 || this.reloadT > 0) {
        this.attackerT = 0.3;
        return;
      }
      this.beginAttacker();
      return;
    }
    if (attacker.phase === 'warn') {
      attacker.pop = Math.min(1, (attacker.pop || 0) + dt / 0.11);
      attacker.t += dt;
      this.shake = Math.max(this.shake, 0.12 + clamp(attacker.t / attacker.window, 0, 1) * 0.9);
      if (attacker.t >= attacker.window) {
        attacker.phase = 'lunge';
        attacker.t = 0;
        this.shake = 1.8;
      }
      return;
    }
    if (attacker.phase === 'lunge') {
      attacker.t += dt;
      const u = clamp(attacker.t / HUNT_LUNGE_SEC, 0, 1);
      this.crack = u;
      this.flash = u < 0.22 ? u / 0.22 : Math.max(0.35, 1 - (u - 0.22) * 0.45);
      this.shake = 1.45 + u;
      if (attacker.t >= HUNT_LUNGE_SEC) {
        this.caught = true;
        this.finish();
      }
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (!this.caught) this.survivalMs = Math.min(this.survivalMs, this.roundMs);
    this.syncScore();
  }

  syncScore() {
    this.settledStats = settleHuntScore(this.survivalMs, this.orbs, this.comboBonus, this.nearMisses, this.debt);
    this.score = this.settledStats.score;
  }

  settled() {
    this.syncScore();
    return { ...this.settledStats };
  }

  exportLog() {
    return encodeHuntLog(this);
  }
}

export function encodeHuntLog(sim) {
  const pointer = sim.pointer === 'touch' ? 't' : 'm';
  const parts = [`${sim.w},${sim.h},${pointer}`];
  for (const e of sim.events) {
    if (e.kind === 's') parts.push(`${e.tick}s${e.x},${e.y}`);
    else if (e.kind === 'r') parts.push(`${e.tick}r`);
    else if (e.kind === 'c') parts.push(`${e.tick}c${e.cam}`);
    else if (e.kind === 'a') parts.push(`${e.tick}a${e.x},${e.y}`);
  }
  return parts.join(';');
}

/**
 * @param {unknown} log
 * @returns {{ ok: true, w: number, h: number, pointer: 'mouse'|'touch', events: object[] } | { ok: false, error: string }}
 */
export function decodeHuntLog(log) {
  if (typeof log !== 'string' || !log || log.length > MAX_LOG_CHARS) {
    return { ok: false, error: 'Hunt replay invalid' };
  }
  const parts = log.split(';');
  const head = /^(\d+),(\d+),([mt])$/.exec(parts[0] || '');
  if (!head) return { ok: false, error: 'Hunt replay invalid' };
  const w = Number(head[1]);
  const h = Number(head[2]);
  if (!huntSizeOk(w, h)) return { ok: false, error: 'Hunt replay invalid' };
  if (parts.length - 1 > MAX_EVENTS) return { ok: false, error: 'Hunt replay invalid' };
  /** @type {object[]} */
  const events = [];
  let lastTick = 0;
  for (let i = 1; i < parts.length; i++) {
    const piece = parts[i];
    if (!piece) return { ok: false, error: 'Hunt replay invalid' };
    const shot = /^(\d+)s(-?\d+),(-?\d+)$/.exec(piece);
    const reload = /^(\d+)r$/.exec(piece);
    const cam = /^(\d+)c(\d+)$/.exec(piece);
    const aim = /^(\d+)a(-?\d+),(-?\d+)$/.exec(piece);
    const hit = shot || reload || cam || aim;
    if (!hit) return { ok: false, error: 'Hunt replay invalid' };
    const tick = Number(hit[1]);
    if (tick < lastTick || tick > 20000) return { ok: false, error: 'Hunt replay invalid' };
    lastTick = tick;
    if (shot) events.push({ kind: 's', tick, x: Number(shot[2]), y: Number(shot[3]) });
    else if (reload) events.push({ kind: 'r', tick });
    else if (cam) events.push({ kind: 'c', tick, cam: Number(cam[2]) });
    else events.push({ kind: 'a', tick, x: Number(aim[2]), y: Number(aim[3]) });
  }
  return { ok: true, w, h, pointer: head[3] === 't' ? 'touch' : 'mouse', events };
}

/**
 * @param {number} seed
 * @param {string} difficulty
 * @param {unknown} log
 */
export function replayHunt(seed, difficulty, log) {
  const decoded = decodeHuntLog(log);
  if (!decoded.ok) return decoded;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    return { ok: false, error: 'Hunt replay invalid' };
  }
  const sim = new HuntSim({
    seed,
    difficulty,
    w: decoded.w,
    h: decoded.h,
    pointer: decoded.pointer,
    record: false,
  });
  /** @type {Map<number, object[]>} */
  const byTick = new Map();
  for (const event of decoded.events) {
    const list = byTick.get(event.tick);
    if (list) list.push(event);
    else byTick.set(event.tick, [event]);
  }
  let guard = 0;
  while (!sim.finished && guard < sim.maxTicks) {
    const list = byTick.get(sim.tick) || [];
    for (const event of list) {
      if (event.kind === 'r') sim.reload();
      else if (event.kind === 's') sim.shoot(event.x, event.y);
    }
    for (const event of list) {
      if (event.kind === 'c') sim.pendingCam = event.cam;
      else if (event.kind === 'a') sim.pendingAim = { x: event.x, y: event.y };
    }
    sim.step();
    guard += 1;
  }
  if (!sim.finished) return { ok: false, error: 'Hunt replay invalid' };
  const stats = sim.settled();
  return { ok: true, ...stats, caught: sim.caught };
}
