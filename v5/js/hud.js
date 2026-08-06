/**
 * The heads-up display: a status bar in the NES idiom, a chapter card that
 * announces each section of the CV, and a message box that reads out whatever
 * you are standing next to.
 *
 * All of it is drawn with the same bitmap font as the rest of the game, on the
 * same low-resolution canvas, so nothing in the frame is anti-aliased.
 */

import { text, measure, wrap } from './font.js';
import * as S from './sprites.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Hud {
  constructor(world) {
    this.world = world;
    this.banner = null;
    this.bannerT = 0;
    this.box = null;
    this.boxT = 0;
    this.reveal = 0;
    this.hint = 4.5;
  }

  showChapter(ch) {
    if (!ch) return;
    this.banner = ch;
    this.bannerT = 3.1;
  }

  showSpot(spot) {
    if (!spot) { this.box = null; return; }
    this.box = spot;
    this.boxT = 0;
    this.reveal = 0;
  }

  update(dt) {
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.box) { this.boxT = Math.min(1, this.boxT + dt * 5); this.reveal += dt * 90; }
    if (this.hint > 0 && this.world.camX > 40) this.hint -= dt;
  }

  draw(c) {
    const w = this.world;
    const { vw, vh } = w;
    const wide = vw > 250;

    this.drawBar(c, vw, wide);
    this.drawProgress(c, vw);
    if (this.bannerT > 0) this.drawBanner(c, vw, vh);
    if (this.box) this.drawBox(c, vw, vh);
    if (this.hint > 0 && w.camX > 40 && !this.box) this.drawHint(c, vw, vh);
  }

  drawBar(c, vw, wide) {
    const w = this.world;
    const y = 7;
    const dark = 'rgba(20,16,34,0.55)';

    // A scrim, so the bar stays readable no matter what scrolls under it.
    const g = c.createLinearGradient(0, 0, 0, 30);
    g.addColorStop(0, 'rgba(10,8,20,0.62)');
    g.addColorStop(1, 'rgba(10,8,20,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, vw, 30);

    if (wide) {
      text(c, 'BART', 8, y, { scale: 1, colour: '#ffffff', shadow: dark });
      text(c, String(w.coins * 200 + w.found * 300).padStart(6, '0'), 8, y + 9, { scale: 1, colour: '#ffffff', shadow: dark });
    }

    const cx = wide ? 62 : 8;
    const coin = S.coinFrames[Math.floor(w.time * 9) % 4] || S.coinFrames[0];
    c.drawImage(coin, cx, y - 1, 8, 9);
    text(c, `×${String(w.coins).padStart(2, '0')}`, cx + 11, y, { scale: 1, colour: '#ffffff', shadow: dark });

    const ch = w.chapter;
    text(c, 'WORLD 1-1', Math.round(vw / 2), y, { scale: 1, colour: '#ffffff', align: 'centre', shadow: dark });
    if (ch) text(c, ch.title, Math.round(vw / 2), y + 9, { scale: 1, colour: '#ffe98a', align: 'centre', shadow: dark });

    text(c, 'FOUND', vw - 8, y, { scale: 1, colour: '#ffffff', align: 'right', shadow: dark });
    text(c, `${w.found}/${w.total}`, vw - 8, y + 9, { scale: 1, colour: '#ffffff', align: 'right', shadow: dark });
  }

  drawProgress(c, vw) {
    const p = this.world.progress;
    c.fillStyle = 'rgba(20,16,34,0.35)';
    c.fillRect(0, 0, vw, 2);
    c.fillStyle = '#ffe98a';
    c.fillRect(0, 0, Math.round(vw * p), 2);
  }

  drawBanner(c, vw, vh) {
    const ch = this.banner;
    const t = clamp(this.bannerT / 3.1, 0, 1);
    // Fade in fast, hold, fade out.
    const a = clamp(Math.min((1 - t) * 6, t * 3.4), 0, 1);
    c.globalAlpha = a;
    const y = Math.round(vh * 0.17);
    const big = 2;
    const w = Math.max(measure(ch.title, big), measure(ch.sub, 1)) + 20;
    const x = Math.round(vw / 2 - w / 2);
    const h = 7 * big + 21;
    c.fillStyle = 'rgba(16,12,28,0.78)';
    c.fillRect(x, y - 8, w, h);
    c.fillStyle = '#ffe98a';
    c.fillRect(x, y - 8, w, 1);
    c.fillRect(x, y - 9 + h, w, 1);
    text(c, ch.title, Math.round(vw / 2), y, { scale: big, colour: '#ffffff', align: 'centre', shadow: 'rgba(0,0,0,0.7)' });
    text(c, ch.sub, Math.round(vw / 2), y + 7 * big + 6, { scale: 1, colour: '#ffe98a', align: 'centre', shadow: 'rgba(0,0,0,0.7)' });
    c.globalAlpha = 1;
  }

  drawHint(c, vw, vh) {
    const a = clamp(this.hint, 0, 1);
    c.globalAlpha = a;
    const msg = matchMedia('(pointer: coarse)').matches ? 'SWIPE UP TO RUN' : 'SCROLL TO RUN  ·  P TO AUTO-RUN';
    text(c, msg, Math.round(vw / 2), vh - 16, { scale: 1, colour: '#ffffff', align: 'centre', shadow: 'rgba(0,0,0,0.8)' });
    c.globalAlpha = 1;
  }

  drawBox(c, vw, vh) {
    const s = this.box;
    const pad = 8;
    const maxW = Math.min(vw - 20, 300);
    const inner = maxW - pad * 2;

    const head = s.title || '';
    const sub = [s.org, s.when].filter(Boolean).join('  ·  ');
    const bodyLines = s.body ? wrap(s.body, inner, 1) : [];
    // Shrink to fit: an empty half-screen box looks like a bug.
    const widest = Math.max(measure(head, 1), measure(sub, 1), ...bodyLines.map((l) => measure(l, 1)), 120);
    const bw = Math.min(maxW, widest + pad * 2 + 2);
    const x = Math.round((vw - bw) / 2);
    const tagLine = s.tags ? s.tags.join(' · ').toUpperCase() : '';

    let h = pad * 2 + 9;
    if (sub) h += 8;
    h += bodyLines.length * 8;
    if (tagLine) h += 8;

    const slide = 1 - Math.pow(1 - this.boxT, 3);
    const y = Math.round(vh - h - 12 + (1 - slide) * (h + 16));

    // Two-tone border: black outer, white inner. Very Nintendo.
    c.fillStyle = '#141022';
    c.fillRect(x, y, bw, h);
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1;
    c.strokeRect(x + 1.5, y + 1.5, bw - 3, h - 3);

    let ty = y + pad;
    text(c, head, x + pad, ty, { scale: 1, colour: '#ffe98a' });
    ty += 9;
    if (sub) { text(c, sub, x + pad, ty, { scale: 1, colour: '#8fc7f0' }); ty += 8; }

    // Typewriter: characters appear at a fixed rate across the whole block.
    let budget = Math.floor(this.reveal);
    for (const line of bodyLines) {
      if (budget <= 0) break;
      const shown = line.slice(0, budget);
      budget -= line.length;
      text(c, shown, x + pad, ty, { scale: 1, colour: '#ffffff' });
      ty += 8;
    }
    if (tagLine && tagLine.replace(/\s+/g, '') !== sub.toUpperCase().replace(/\s+/g, '')) {
      text(c, tagLine, x + bw - pad, y + h - pad - 6, { scale: 1, colour: '#9aa3b2', align: 'right' });
    }
  }
}
