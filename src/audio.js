/**
 * Tiny Web Audio juice — no external assets. Includes optional music bed.
 */
export class AudioBus {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._master = null;
    this._musicGain = null;
    this._musicNodes = [];
    this._musicPlaying = false;
    this._musicTimer = null;
    this._clip = null;
    this._wantClip = false;
    this._clipHold = false;
    try {
      const v = localStorage.getItem('orbit-rush-mute');
      this.muted = v === '1';
    } catch {
      /* ignore */
    }
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this._master = this.ctx.createGain();
    this._master.gain.value = this.muted ? 0 : 0.22;
    this._master.connect(this.ctx.destination);
    this._musicGain = this.ctx.createGain();
    this._musicGain.gain.value = 0.045;
    this._musicGain.connect(this._master);
  }

  resume() {
    this.ensure();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = !!m;
    try {
      localStorage.setItem('orbit-rush-mute', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this._master) this._master.gain.value = this.muted ? 0 : 0.22;
    if (this._clip) this._clip.muted = this.muted;
    if (this.muted) this.stopMusic();
    else if (this._wantClip && !this._clipHold) this.resumeClip();
    else if (!this._wantClip && this._wantMusic) this.startMusic();
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  tone(freq, dur = 0.08, type = 'sine', gain = 0.4, slideTo) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx || !this._master) return;
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this._master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  collect(comboMult = 1) {
    const base = 880 + (comboMult - 1) * 110;
    this.tone(base, 0.07, 'triangle', 0.32);
    this.tone(base * 1.5, 0.1, 'sine', 0.22);
  }

  combo(mult) {
    this.tone(660, 0.06, 'square', 0.12);
    this.tone(880 + mult * 80, 0.14, 'triangle', 0.2);
    this.tone(1320, 0.18, 'sine', 0.15);
  }

  nearMiss() {
    this.tone(720, 0.05, 'sine', 0.18);
    this.tone(960, 0.08, 'triangle', 0.12, 1280);
  }

  powerup(type) {
    if (type === 'shield') {
      this.tone(392, 0.12, 'triangle', 0.25);
      this.tone(523, 0.16, 'sine', 0.2);
    } else if (type === 'slow') {
      this.tone(220, 0.2, 'sine', 0.22, 110);
      this.tone(330, 0.25, 'triangle', 0.15);
    } else {
      this.tone(520, 0.08, 'square', 0.14);
      this.tone(780, 0.12, 'sine', 0.18);
      this.tone(1040, 0.1, 'triangle', 0.12);
    }
  }

  shieldBreak() {
    this.tone(180, 0.15, 'sawtooth', 0.28, 90);
    this.tone(240, 0.1, 'square', 0.12);
  }

  hit() {
    this.tone(110, 0.25, 'sawtooth', 0.45);
    this.tone(55, 0.35, 'square', 0.2);
  }

  click() {
    this.tone(440, 0.04, 'square', 0.15);
  }

  warn() {
    this.tone(320, 0.05, 'triangle', 0.12);
  }

  /**
   * File bed for Orbit Pulse. The chart follows `currentTime`, so mute keeps
   * the element running and only silences it. Pause holds the playhead.
   * @param {string} url
   * @param {{ playbackRate?: number }} [opts]
   */
  playClip(url, opts = {}) {
    this.stopClip();
    this.stopMusic();
    this._wantMusic = false;
    this._wantClip = true;
    this._clipHold = false;
    const el = new Audio();
    el.preload = 'auto';
    el.loop = false;
    const rate = Number(opts.playbackRate);
    el.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    el.muted = this.muted;
    el.src = url;
    this._clip = el;
    const pending = el.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  }

  pauseClip() {
    this._clipHold = true;
    this._clip?.pause();
  }

  resumeClip() {
    this._clipHold = false;
    if (!this._clip) return;
    this._clip.muted = this.muted;
    if (!this._clip.paused) return;
    const pending = this._clip.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  }

  stopClip() {
    this._wantClip = false;
    this._clipHold = false;
    if (!this._clip) return;
    this._clip.pause();
    this._clip.removeAttribute('src');
    this._clip.load?.();
    this._clip = null;
  }

  /** True once a Pulse clip element exists, including while currentTime is still 0. */
  hasClip() {
    return !!this._clip;
  }

  clipTime() {
    const t = this._clip?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : 0;
  }

  clipActive() {
    return !!this._clip && !this._clip.paused && !this._clip.ended;
  }

  clipEnded() {
    return !!this._clip?.ended;
  }

  /** Soft procedural arpeggio bed — lightweight, loops via setInterval */
  startMusic() {
    this._wantMusic = true;
    if (this._wantClip) return;
    this.ensure();
    if (this.muted || !this.ctx || this._musicPlaying) return;
    this._musicPlaying = true;
    const notes = [130.81, 164.81, 196.0, 246.94, 196.0, 164.81]; // C3 Em-ish
    let i = 0;
    const step = () => {
      if (!this._musicPlaying || this.muted || !this.ctx || !this._musicGain) return;
      const freq = notes[i % notes.length];
      i++;
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
      o.connect(g);
      g.connect(this._musicGain);
      o.start(t0);
      o.stop(t0 + 0.6);
      // Quiet fifth pad
      if (i % 3 === 0) {
        const o2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        o2.type = 'triangle';
        o2.frequency.setValueAtTime(freq * 1.5, t0);
        g2.gain.setValueAtTime(0.0001, t0);
        g2.gain.exponentialRampToValueAtTime(0.12, t0 + 0.05);
        g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
        o2.connect(g2);
        g2.connect(this._musicGain);
        o2.start(t0);
        o2.stop(t0 + 0.85);
      }
    };
    step();
    this._musicTimer = setInterval(step, 480);
  }

  stopMusic() {
    this._musicPlaying = false;
    if (this._musicTimer) {
      clearInterval(this._musicTimer);
      this._musicTimer = null;
    }
  }
}
