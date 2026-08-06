/**
 * Six sound effects, no samples.
 *
 * Square waves through a short gain envelope, which is roughly what the NES
 * did with two pulse channels. Muted until you ask for it, because a website
 * that makes noise at you unprompted is a website nobody visits twice.
 */

const NOTES = { C4: 261.6, E4: 329.6, G4: 392, C5: 523.3, E5: 659.3, G5: 784, B5: 987.8, C6: 1046.5, E6: 1318.5, G6: 1568 };

export class Audio {
  constructor() {
    this.on = false;
    this.ctx = null;
    this.master = null;
    this.last = 0;
  }

  enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.on = true;
    return true;
  }

  disable() { this.on = false; }
  toggle() { return this.on ? (this.disable(), false) : this.enable(); }

  blip(freq, when, dur, type = 'square', vol = 1, slide = 0) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(this.master);
    o.start(when); o.stop(when + dur + 0.02);
  }

  play(kind) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    // Coins can arrive four at a time; do not stack them into a buzz.
    if (kind === 'coin' && t - this.last < 0.045) return;
    this.last = t;
    switch (kind) {
      case 'coin':
        this.blip(NOTES.B5, t, 0.06, 'square', 0.5);
        this.blip(NOTES.E6, t + 0.055, 0.16, 'square', 0.5);
        break;
      case 'bump':
        this.blip(180, t, 0.09, 'square', 0.55, 0.4);
        break;
      case 'stomp':
        this.blip(360, t, 0.1, 'sawtooth', 0.4, 0.25);
        break;
      case 'spot':
        this.blip(NOTES.G5, t, 0.05, 'triangle', 0.5);
        this.blip(NOTES.C6, t + 0.05, 0.09, 'triangle', 0.4);
        break;
      case 'jump':
        this.blip(NOTES.C5, t, 0.14, 'square', 0.42, 2.2);
        break;
      case 'clear': {
        const seq = [NOTES.G4, NOTES.C5, NOTES.E5, NOTES.G5, NOTES.E5, NOTES.G5, NOTES.C6];
        seq.forEach((f, i) => this.blip(f, t + i * 0.13, 0.16, 'square', 0.5));
        break;
      }
      default: break;
    }
  }
}
