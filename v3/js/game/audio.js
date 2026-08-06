/**
 * All sound is synthesised — no audio files, in keeping with the rest of the
 * site. Impacts come straight off the physics world's onImpact hook, so what
 * you hear is literally the solver's contact velocities.
 */

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.lastImpact = 0;
    this.impactBudget = 0;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;

    // A gentle limiter keeps a hundred simultaneous impacts from clipping.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    this.master.connect(comp).connect(this.ctx.destination);

    this.noise = this._noiseBuffer();
    this._drone();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? 0.5 : 0;
    return this.enabled;
  }

  _noiseBuffer() {
    const n = this.ctx.sampleRate * 0.5;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A slow two-oscillator pad so the yard never feels dead. */
  _drone() {
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    for (const f of [55, 82.5, 110.5]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lg = this.ctx.createGain();
      lg.gain.value = 0.6;
      lfo.connect(lg).connect(o.detune);
      lfo.start();
      o.connect(filter);
      o.start();
    }
    filter.connect(g).connect(this.master);
  }

  /** Percussive hit. `hardness` 0 = thud, 1 = clack. */
  impact(speed, hardness = 0.5, pan = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    // Rate-limit: a collapsing tower can fire 200 contacts in one frame.
    if (t - this.lastImpact < 0.012) return;
    this.lastImpact = t;

    const amp = Math.min(speed / 14, 1);
    if (amp < 0.04) return;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(amp * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + hardness * 0.12);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6 + hardness * 1.4;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 140 + hardness * 2200 + amp * 400;
    bp.Q.value = 1.2 + hardness * 4;

    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));

    src.connect(bp).connect(g).connect(p).connect(this.master);
    src.start(t);
    src.stop(t + 0.3);

    // A pitched body for heavier hits, so big things sound big.
    if (amp > 0.25) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const f0 = 90 + (1 - hardness) * 40;
      o.frequency.setValueAtTime(f0 * 2, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.18);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(amp * 0.35, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(og).connect(p);
      o.start(t); o.stop(t + 0.3);
    }
  }

  /** Rising arpeggio for discovering a project. */
  chime(step = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const scale = [0, 3, 5, 7, 10, 12, 15, 17];
    const root = 330;
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      const semi = scale[(step + i * 2) % scale.length] + (i === 2 ? 12 : 0);
      o.frequency.value = root * Math.pow(2, semi / 12);
      const g = this.ctx.createGain();
      const at = t + i * 0.07;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.16, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
      o.connect(g).connect(this.master);
      o.start(at); o.stop(at + 0.7);
    }
  }

  /** Low whump for the shockwave. */
  boom() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.7);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2000, t);
    hp.frequency.exponentialRampToValueAtTime(200, t + 0.4);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(hp).connect(ng).connect(this.master);
    src.start(t); src.stop(t + 0.5);
  }

  /** Short blip for UI and grabs. */
  blip(freq = 660, dur = 0.08, type = 'square') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Continuous rolling rumble, driven by the player's speed. */
  rollLevel(speed) {
    if (!this.ctx || !this.enabled) return;
    if (!this.roll) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(lp).connect(g).connect(this.master);
      src.start();
      this.roll = { g, lp };
    }
    const target = Math.min(speed / 22, 1);
    this.roll.g.gain.value += (target * 0.16 - this.roll.g.gain.value) * 0.15;
    this.roll.lp.frequency.value = 180 + target * 900;
  }
}
