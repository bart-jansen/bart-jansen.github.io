/**
 * The world: sky, terrain, props, creatures, and the man himself.
 *
 * Everything renders into a small logical canvas (roughly 384×240 on a laptop)
 * which CSS then blows up with nearest-neighbour scaling. That is the whole
 * trick behind the look — there is no filtering anywhere, so a pixel is a
 * pixel no matter how big the window gets.
 */

import * as S from './sprites.js';
import { text, measure } from './font.js';
import { PAL } from './pixel.js';
import { buildLevel, skyAt, TILE } from './level.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.level = buildLevel();
    this.camX = 0;
    this.camY = -160;
    this.time = 0;
    this.facing = 1;
    this.speed = 0;
    this.coins = 0;
    this.found = 0;
    this.total = this.level.coins.length + this.level.spots.length
      + this.level.props.filter((p) => p.t === 'qblock').length;
    this.parts = [];
    this.images = new Map();
    this.activeSpot = null;
    this.chapter = this.level.chapters[0];
    this.onSpot = null;
    this.onChapter = null;
    this.onSound = null;
    this.stars = makeStars();
    this.resize();
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    const vw = Math.max(1, Math.round(box.width) || window.innerWidth);
    const vh = Math.max(1, Math.round(box.height) || window.innerHeight);
    const scale = clamp(Math.min(vw / 340, vh / 216), 1.4, 7);
    this.scale = scale;
    this.vw = Math.round(vw / scale);
    this.vh = Math.round(vh / scale);
    this.canvas.width = this.vw;
    this.canvas.height = this.vh;
    this.ctx.imageSmoothingEnabled = false;
    this.groundY = Math.round(Math.min(this.vh - 38, this.vh * 0.80));
  }

  /** How far along the level the camera is, 0…1. */
  get progress() { return clamp(this.camX / Math.max(1, this.level.length - this.vw), 0, 1); }

  /* ─────────────────────────────────────────────────────────── update ─── */

  update(dt, camX) {
    this.time += dt;
    const prev = this.camX;
    this.camX = camX;
    const anchor = Math.round(this.vw * 0.36);
    const bx = camX + anchor;
    const at = this.level.path.at(bx);

    this.speed = (camX - prev) / Math.max(dt, 1e-4);
    if (Math.abs(this.speed) > 6) this.facing = this.speed > 0 ? 1 : -1;
    if (at.air && !this.wasAir && Math.abs(this.speed) > 20) this.ping('jump');
    this.wasAir = at.air;

    this.bart = { x: bx, y: at.y, air: at.air, rise: at.rise, sx: anchor };

    // Camera height: normally the ground sits low on screen; when Bart climbs
    // above the middle of the frame the view follows him up.
    const base = -this.groundY;
    const want = Math.min(base, at.y - this.vh * 0.52);
    this.camY = lerp(this.camY, want, 1 - Math.pow(0.0015, dt));

    const ch = chapterAt(this.level.chapters, bx);
    if (ch !== this.chapter) {
      this.chapter = ch;
      if (this.onChapter) this.onChapter(ch);
    }

    this.moveCreatures();
    this.collect(bx, at);
    this.updateParts(dt);
    this.updateSpots(bx);
  }

  moveCreatures() {
    for (const g of this.level.props) {
      if (g.t !== 'goomba') continue;
      const range = g.x1 - g.x0;
      const t = (this.time * 26) % (range * 2);
      g.gx = g.x0 + (t < range ? t : range * 2 - t);
      g.face = t < range ? 0 : 1;
    }
  }

  /**
   * Collection sweeps the whole x interval Bart covered this frame, not just
   * where he happens to be standing. Scroll fast enough and a per-frame point
   * test skips coins entirely, and a resume you cannot 100% is a broken toy.
   */
  collect(bx, at) {
    const path = this.level.path;
    const prev = this.prevX == null ? bx : this.prevX;
    this.prevX = bx;
    const lo = Math.min(prev, bx);
    const hi = Math.max(prev, bx);

    for (const c of this.level.coins) {
      if (c.got || c.x < lo - 13 || c.x > hi + 13) continue;
      const p = path.at(c.x);
      if (Math.abs(c.y - (p.y - 11)) > 22) continue;
      c.got = true;
      this.coins++; this.found++;
      this.pop(c.x, c.y, c.label || '+200', '#ffe98a');
      this.ping('coin');
    }

    for (const p of this.level.props) {
      if (p.t !== 'qblock' || p.hit) continue;
      const cx = p.x + 8;
      if (cx < lo - 12 || cx > hi + 12) continue;
      // A bump counts when he is on the way up and his head is in the block.
      const a = path.at(cx);
      const head = a.y - S.BART_H;
      if (a.rise >= 0 || head > p.y + TILE || head < p.y - 16) continue;
      p.hit = true;
      p.bump = this.time;
      this.coins++; this.found++;
      this.pop(cx, p.y - 10, p.mushroom ? '1-UP' : '+200', '#ffe98a');
      if (p.mushroom) p.spawned = this.time;
      this.ping('bump');
    }

    for (const g of this.level.props) {
      if (g.t !== 'goomba' || g.dead) continue;
      const gx = g.gx == null ? g.x : g.gx;
      if (gx < lo - 12 || gx > hi + 12) continue;
      const a = path.at(gx);
      if (a.rise > 0.02 && a.y > -TILE - 12 && a.y < 8) {
        g.dead = this.time;
        this.pop(gx, -20, '+100', '#ffffff');
        this.ping('stomp');
      }
    }
  }

  updateSpots(bx) {
    let best = null;
    let bestD = 62;
    for (const s of this.level.spots) {
      const d = Math.abs(s.x - bx);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best !== this.activeSpot) {
      this.activeSpot = best;
      if (best && !best.seen) { best.seen = true; this.found++; this.ping('spot'); }
      if (this.onSpot) this.onSpot(best);
    }
  }

  pop(x, y, label, colour) {
    this.parts.push({ x, y, vy: -46, life: 1.5, label, colour });
  }

  ping(kind) { if (this.onSound) this.onSound(kind); }

  updateParts(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy += 46 * dt;
      if (p.life <= 0) this.parts.splice(i, 1);
    }
  }

  /* ───────────────────────────────────────────────────────────── draw ─── */

  draw() {
    const c = this.ctx;
    const { vw, vh } = this;
    c.imageSmoothingEnabled = false;
    const sky = skyAt(this.level.chapters, this.camX + vw * 0.5);

    this.drawSky(c, sky);
    this.drawFar(c);
    this.drawClouds(c, sky);
    this.drawTerrain(c);
    this.drawProps(c);
    this.drawCoins(c);
    this.drawCreatures(c);
    this.drawBart(c);
    this.drawParts(c);
  }

  sy(worldY) { return Math.round(worldY - this.camY); }
  sx(worldX) { return Math.round(worldX - this.camX); }

  drawSky(c, sky) {
    const { vw, vh } = this;
    const g = c.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, sky.top);
    g.addColorStop(0.55, sky.mid);
    g.addColorStop(1, sky.low);
    c.fillStyle = g;
    c.fillRect(0, 0, vw, vh);

    if (sky.stars > 0.02) {
      c.globalAlpha = sky.stars;
      c.fillStyle = '#ffffff';
      for (const s of this.stars) {
        const x = Math.round(((s.x - this.camX * 0.06) % 400 + 400) % 400 / 400 * vw);
        const y = Math.round(s.y * vh * 0.6);
        const tw = 0.6 + 0.4 * Math.sin(this.time * 2 + s.p);
        c.globalAlpha = sky.stars * tw;
        c.fillRect(x, y, s.b, s.b);
      }
      c.globalAlpha = 1;
    }

    // A sun that crosses the sky as the resume goes on.
    const t = this.progress;
    const sunX = Math.round(vw * (0.16 + 0.68 * ((t * 1.4) % 1)));
    const sunY = Math.round(vh * (0.30 - 0.14 * Math.sin(((t * 1.4) % 1) * Math.PI)));
    c.globalAlpha = 0.22;
    S.disc(c, sunX, sunY, 16, sky.sun);
    c.globalAlpha = 1;
    S.disc(c, sunX, sunY, 10, sky.sun);
  }

  drawClouds(c, sky) {
    const { vw } = this;
    for (const cl of this.level.clouds) {
      const px = Math.round(cl.x - this.camX * cl.depth);
      if (px < -90 || px > vw + 90) continue;
      // Anchored to the ground line, so clouds sit where they were authored and
      // only lag behind when the camera climbs.
      const py = Math.round(cl.y + this.groundY + (-this.camY - this.groundY) * cl.depth);
      S.drawCloud(c, px, py, cl.w);
    }
  }

  drawFar(c) {
    const { vw } = this;
    const horizon = this.sy(0);
    for (const f of this.level.far) {
      const px = Math.round(f.x - this.camX * 0.55);
      if (px < -220 || px > vw + 220) continue;
      const py = Math.round(this.groundY + (horizon - this.groundY) * 0.4) + 2;
      if (f.t === 'mountain') drawMountain(c, px, py, f.w, f.dark);
      else S.drawHill(c, px, py, f.w, f.dark);
    }
  }

  drawTerrain(c) {
    const { vw, vh } = this;
    const x0 = Math.floor(this.camX / TILE) * TILE - TILE;
    const x1 = this.camX + vw + TILE;
    const stone = this.chapter && (this.chapter.id === 'career');
    const top = stone ? S.stoneTop : S.groundTop;
    const fill = stone ? S.stoneFill : S.groundFill;
    const gy = this.sy(0);

    if (gy < vh) {
      for (let x = x0; x < x1; x += TILE) {
        if (inGap(this.level.gaps, x + TILE / 2)) continue;
        const px = this.sx(x);
        c.drawImage(top, px, gy);
        for (let y = gy + TILE; y < vh; y += TILE) c.drawImage(fill, px, y);
      }
    }

    for (const p of this.level.plats) {
      if (p.x1 < this.camX - TILE || p.x0 > x1) continue;
      const ty = this.sy(p.top);
      if (ty > vh) continue;
      const isStone = p.kind === 'stone';
      const t2 = isStone ? S.stoneTop : S.slab;
      const f2 = isStone ? S.stoneFill : S.groundFill;
      const bottom = isStone ? Math.min(vh, this.sy(0) + TILE * 6) : ty + TILE * 2;
      for (let x = Math.floor(p.x0 / TILE) * TILE; x < p.x1; x += TILE) {
        const px = this.sx(Math.max(x, p.x0));
        const w = Math.min(TILE, p.x1 - Math.max(x, p.x0));
        if (w <= 0) continue;
        c.drawImage(t2, 0, 0, w, TILE, px, ty, w, TILE);
        for (let y = ty + TILE; y < bottom; y += TILE) c.drawImage(f2, 0, 0, w, TILE, px, y, w, TILE);
      }
    }
  }

  drawCoins(c) {
    const f = Math.floor(this.time * 9) % 4;
    for (const co of this.level.coins) {
      if (co.got) continue;
      const px = this.sx(co.x);
      if (px < -40 || px > this.vw + 40) continue;
      const py = this.sy(co.y);
      const img = S.coinFrames[f] || S.coinFrames[0];
      c.drawImage(img, px - (img.width >> 1), py - (S.COIN_H >> 1));
      if (co.label) {
        // Above the coin: below lands on top of hills and bushes.
        const yy = py - 16 - (co.label.length % 2 ? 0 : 9);
        text(c, co.label, px, yy, { scale: 1, colour: '#ffffff', align: 'centre', shadow: 'rgba(20,16,30,0.85)' });
      }
    }
  }

  drawCreatures(c) {
    for (const g of this.level.props) {
      if (g.t !== 'goomba' || g.gx == null) continue;
      const px = this.sx(g.gx);
      if (px < -30 || px > this.vw + 30) continue;
      if (g.dead) {
        if (this.time - g.dead < 4) c.drawImage(S.goombaFlat, px - 8, this.sy(0) - 16);
        continue;
      }
      c.drawImage(S.goomba[g.face], px - 8, this.sy(0) - 16);
    }
  }

  drawBart(c) {
    const b = this.bart;
    if (!b) return;
    const spr = this.facing > 0 ? S.bartFrames : S.bartLeft;
    let img;
    const moving = Math.abs(this.speed) > 8;
    if (b.air) img = b.rise < 0 ? spr.jump : spr.fall;
    else if (moving) img = spr.run[Math.floor(this.time * 13) % 4];
    else img = (this.time % 4.2 < 0.14) ? spr.blink : spr.idle;

    const px = Math.round(b.sx - S.BART_W / 2);
    const py = this.sy(b.y) - S.BART_H;

    // Shadow, so he does not look pasted on.
    const gy = this.sy(this.groundUnder(b.x));
    if (gy - (py + S.BART_H) < 90) {
      c.globalAlpha = 0.16;
      c.fillStyle = '#000000';
      const w = Math.max(6, 14 - (gy - py - S.BART_H) * 0.1);
      c.fillRect(Math.round(b.sx - w / 2), gy - 2, Math.round(w), 2);
      c.globalAlpha = 1;
    }
    c.drawImage(img, px, py + (!b.air && moving && Math.floor(this.time * 13) % 2 ? 1 : 0));
  }

  /** Nearest surface below Bart, used only for his shadow. */
  groundUnder(x) {
    let best = inGap(this.level.gaps, x) ? 400 : 0;
    for (const p of this.level.plats) {
      if (x >= p.x0 && x <= p.x1) best = Math.min(best, p.top);
    }
    return best;
  }

  drawProps(c) {
    const { vw } = this;
    for (const p of this.level.props) {
      const px = this.sx(p.x);
      if (px < -240 || px > vw + 240) continue;
      switch (p.t) {
        case 'bush': S.drawBush(c, px, this.sy(0), p.w); break;
        case 'banner': this.drawBanner(c, px, p); break;
        case 'sign': this.drawSign(c, px, this.sy(0), p.lines); break;
        case 'post': this.drawPost(c, px, this.sy(p.y), p); break;
        case 'qblock': this.drawQBlock(c, px, p); break;
        case 'brickrow': for (let i = 0; i < p.n; i++) c.drawImage(S.brick, px + i * TILE, this.sy(p.y)); break;
        case 'stair': for (let i = 0; i < p.n; i++) c.drawImage(S.slab, px, this.sy(-TILE * (i + 1))); break;
        case 'pipe': this.drawPipe(c, px, p); break;
        case 'screen': this.drawScreen(c, px, this.sy(p.y), p); break;
        case 'school': this.drawSchool(c, px, this.sy(0), p); break;
        case 'castle': S.drawCastle(c, px, this.sy(0), p.w); break;
        case 'flag': this.drawFlag(c, px, p); break;
        case 'flagtop': this.drawSummit(c, px, this.sy(p.y)); break;
        default: break;
      }
    }
  }

  drawBanner(c, px, p) {
    const y = this.sy(p.y);
    const scales = [3, 1, 1];
    let yy = y;
    p.lines.forEach((line, i) => {
      const s = scales[i] || 1;
      text(c, line, px, yy, { scale: s, colour: i === 0 ? '#ffffff' : '#fff6cf', align: 'centre', shadow: 'rgba(20,16,40,0.65)' });
      yy += 7 * s + (i === 0 ? 10 : 5);
    });
    // Arrow that bobs, to make the scroll instruction unmissable.
    const bob = Math.round(Math.sin(this.time * 3) * 2);
    const ax = px + bob;
    const ay = yy + 12;
    c.fillStyle = 'rgba(20,16,40,0.5)';
    arrow(c, ax + 1, ay + 1);
    c.fillStyle = '#ffe98a';
    arrow(c, ax, ay);
  }

  drawSign(c, px, gy, lines) {
    const w = Math.max(...lines.map((l) => measure(l, 1))) + 10;
    const h = lines.length * 8 + 8;
    const top = gy - h - 18;
    c.fillStyle = PAL.D; c.fillRect(px - 2, top + h, 4, 20);
    c.fillStyle = PAL.k; c.fillRect(px - w / 2 - 2, top - 2, w + 4, h + 4);
    c.fillStyle = '#f4e3bd'; c.fillRect(px - w / 2, top, w, h);
    lines.forEach((l, i) => text(c, l, px, top + 4 + i * 8, { scale: 1, colour: '#4a3119', align: 'centre' }));
  }

  drawPost(c, px, ty, p) {
    const post = 22;
    const w = Math.max(measure(p.role, 1), measure(p.org, 1), measure(p.lines[0], 1)) + 10;
    const h = 33;
    const cy = ty - post - h;
    c.fillStyle = PAL.D; c.fillRect(px, ty - post, 3, post);
    c.fillStyle = PAL.k; c.fillRect(px - 1, cy - 2, w + 6, h + 4);
    c.fillStyle = '#fdf6e3'; c.fillRect(px + 1, cy, w + 2, h);
    c.fillStyle = 'rgba(24,20,37,0.12)'; c.fillRect(px + 1, cy + h - 2, w + 2, 2);
    text(c, p.lines[0], px + 5, cy + 3, { scale: 1, colour: '#a06a1f' });
    text(c, p.role, px + 5, cy + 13, { scale: 1, colour: '#181425' });
    text(c, p.org, px + 5, cy + 23, { scale: 1, colour: '#3a5f9f' });
  }

  drawQBlock(c, px, p) {
    let y = this.sy(p.y);
    if (p.bump != null) {
      const e = (this.time - p.bump) / 0.32;
      if (e < 1) y -= Math.round(Math.sin(e * Math.PI) * 7);
    }
    if (p.spawned != null) {
      const t = clamp((this.time - p.spawned) / 0.8, 0, 1);
      c.drawImage(S.mushroom, px, this.sy(p.y) - Math.round(t * 22));
    }
    if (p.hit) c.drawImage(S.usedBlock, px, y);
    else c.drawImage(S.qBlock[Math.floor(this.time * 5) % 3], px, y);
  }

  drawPipe(c, px, p) {
    const gy = this.sy(0);
    if (p.piranha) {
      const near = this.bart ? Math.abs(this.bart.x - (p.x + p.w / 2)) < 46 : false;
      const t = (Math.sin(this.time * 1.5 + p.x * 0.01) + 1) / 2;
      const out = near ? 0 : t;
      const top = gy - p.h;
      const ph = S.piranha.height;
      const show = Math.round(out * (ph + 8));
      if (show > 2) {
        c.save();
        c.beginPath();
        c.rect(px, top - ph - 10, p.w, ph + 10);
        c.clip();
        c.fillStyle = PAL.g;
        c.fillRect(px + p.w / 2 - 3, top - show + ph - 6, 6, show);
        c.drawImage(S.piranha, px + (p.w >> 1) - 8, top - show);
        c.restore();
      }
    }
    S.drawPipe(c, px, this.sy(0) - p.h, p.w, p.h);
  }

  drawScreen(c, px, py, p) {
    const w = 100;
    const h = 58;
    const x = px - (w >> 1);
    // Mounting pole down to the pipe.
    c.fillStyle = PAL.M; c.fillRect(px - 2, py + h, 4, p.pole || 40);
    c.fillStyle = PAL.k; c.fillRect(x - 2, py - 2, w + 4, h + 4);
    c.fillStyle = '#2b2b3c'; c.fillRect(x, py, w, h);
    c.fillStyle = '#12121c'; c.fillRect(x + 3, py + 3, w - 6, h - 21);

    const img = this.image(p.project.img);
    if (img && img.complete && img.naturalWidth) {
      c.drawImage(img, x + 4, py + 4, w - 8, h - 23);
      // Scanlines, because it is a CRT.
      c.fillStyle = 'rgba(0,0,0,0.22)';
      for (let yy = py + 4; yy < py + h - 19; yy += 2) c.fillRect(x + 4, yy, w - 8, 1);
    } else {
      c.fillStyle = '#1b1b2c'; c.fillRect(x + 4, py + 4, w - 8, h - 23);
      text(c, '...', px, py + h / 2 - 12, { scale: 1, colour: '#6d6d8f', align: 'centre' });
    }
    const fits = Math.floor((w - 8) / 6);
    const title = clip(p.project.title.toUpperCase(), fits);
    text(c, title, px, py + h - 16, { scale: 1, colour: '#ffe98a', align: 'centre' });
    text(c, clip(p.project.tags.join(' · ').toUpperCase(), fits), px, py + h - 8, { scale: 1, colour: '#8fb6d8', align: 'centre' });
    // Power LED.
    c.fillStyle = Math.floor(this.time * 2) % 2 ? '#4ee06a' : '#1c6a2a';
    c.fillRect(x + w - 7, py + h - 6, 3, 3);
  }

  drawSchool(c, px, gy, p) {
    const w = Math.max(96, measure(p.when, 1) + 22);
    const h = 78;
    const top = gy - h;
    c.fillStyle = PAL.k; c.fillRect(px - 2, top - 2, w + 4, h + 4);
    c.fillStyle = '#e8dcc4'; c.fillRect(px, top, w, h);
    c.fillStyle = '#c4b291';
    for (let y = top + 4; y < gy - 4; y += 10) c.fillRect(px + 2, y, w - 4, 1);
    // Roof
    c.fillStyle = '#8f4c3a';
    for (let i = 0; i < 8; i++) c.fillRect(px - 6 + i * 2, top - 14 + i * 2, w + 12 - i * 4, 3);
    c.fillStyle = PAL.k; c.fillRect(px - 6, top - 2, w + 12, 3);
    // Clock tower
    c.fillStyle = '#e8dcc4'; c.fillRect(px + w / 2 - 12, top - 34, 24, 24);
    c.fillStyle = PAL.k; c.fillRect(px + w / 2 - 14, top - 36, 28, 4);
    c.fillStyle = '#fdf6e3'; c.fillRect(px + w / 2 - 7, top - 30, 14, 14);
    c.fillStyle = PAL.k;
    c.fillRect(px + w / 2 - 1, top - 26, 2, 6);
    c.fillRect(px + w / 2, top - 23, 5, 2);
    // Door and windows
    c.fillStyle = '#5a3b22'; c.fillRect(px + w / 2 - 9, gy - 26, 18, 26);
    c.fillStyle = '#7a5230'; c.fillRect(px + w / 2 - 7, gy - 23, 14, 23);
    c.fillStyle = '#9fd4f0';
    for (const wx of [px + 12, px + w - 28]) { c.fillRect(wx, top + 18, 16, 16); }
    c.fillStyle = PAL.k;
    for (const wx of [px + 12, px + w - 28]) { c.fillRect(wx + 7, top + 18, 2, 16); c.fillRect(wx, top + 25, 16, 2); }
    // Plaque
    const line = p.when;
    const lw = measure(line, 1) + 8;
    c.fillStyle = PAL.k; c.fillRect(px + w / 2 - lw / 2 - 1, gy - 40, lw + 2, 11);
    c.fillStyle = '#fdf6e3'; c.fillRect(px + w / 2 - lw / 2, gy - 39, lw, 9);
    text(c, line, px + w / 2, gy - 37, { scale: 1, colour: '#4a3119', align: 'centre' });
  }

  drawFlag(c, px, p) {
    const gy = this.sy(0);
    const top = gy - p.h;
    c.fillStyle = '#2f7d20'; c.fillRect(px - 1, top, 3, p.h);
    c.fillStyle = '#8ee06a'; c.fillRect(px - 1, top, 1, p.h);
    c.fillStyle = PAL.y; c.fillRect(px - 4, top - 6, 9, 7);
    c.fillStyle = PAL.k; c.fillRect(px - 4, top - 6, 9, 1);
    // The flag itself slides down as you approach, like clearing the level.
    const t = this.bart ? clamp((this.bart.x - (p.x - 190)) / 190, 0, 1) : 0;
    const fy = top + 8 + Math.round(t * (p.h - 40));
    c.fillStyle = '#e8503a';
    c.beginPath();
    c.moveTo(px - 2, fy);
    c.lineTo(px - 30, fy + 9);
    c.lineTo(px - 2, fy + 18);
    c.closePath();
    c.fill();
    c.fillStyle = '#ffffff';
    c.fillRect(px - 14, fy + 7, 4, 4);
  }

  drawSummit(c, px, ty) {
    c.fillStyle = '#6b7fa0'; c.fillRect(px, ty - 26, 2, 26);
    c.fillStyle = '#ffd35c';
    c.beginPath(); c.moveTo(px + 2, ty - 26); c.lineTo(px + 22, ty - 21); c.lineTo(px + 2, ty - 16); c.closePath(); c.fill();
    text(c, 'NOW', px + 12, ty - 38, { scale: 1, colour: '#ffffff', align: 'centre', shadow: 'rgba(0,0,0,0.6)' });
  }

  drawParts(c) {
    for (const p of this.parts) {
      const px = this.sx(p.x);
      if (px < -60 || px > this.vw + 60) continue;
      const a = clamp(p.life / 1.5, 0, 1);
      c.globalAlpha = a;
      text(c, p.label, px, this.sy(p.y), { scale: 1, colour: p.colour, align: 'centre', shadow: 'rgba(20,16,30,0.8)' });
      c.globalAlpha = 1;
    }
  }

  image(src) {
    let img = this.images.get(src);
    if (img === undefined) {
      img = new Image();
      img.decoding = 'async';
      img.src = src;
      this.images.set(src, img);
    }
    return img;
  }
}

/* ─────────────────────────────────────────────────────────── helpers ──── */

function chapterAt(chapters, x) {
  for (const ch of chapters) if (x >= ch.x0 && x < ch.x1) return ch;
  return chapters[chapters.length - 1];
}

function inGap(gaps, x) {
  for (const g of gaps) if (x > g.x0 && x < g.x1) return true;
  return false;
}

function makeStars() {
  const out = [];
  let seed = 1337;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) out.push({ x: rnd() * 400, y: rnd(), b: rnd() < 0.25 ? 2 : 1, p: rnd() * 6.28 });
  return out;
}

function clip(s, n) {
  return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '.';
}

function arrow(c, x, y) {
  c.fillRect(x - 14, y - 2, 20, 5);
  for (let i = 0; i < 6; i++) c.fillRect(x + 6 + i, y - 8 + i, 1, 17 - i * 2);
}

function drawMountain(c, x, baseY, w, dark) {
  const h = Math.round(w * 0.78);
  c.fillStyle = dark ? '#2f3550' : '#454d70';
  c.beginPath();
  c.moveTo(x - w / 2, baseY);
  c.lineTo(x, baseY - h);
  c.lineTo(x + w / 2, baseY);
  c.closePath();
  c.fill();
  c.fillStyle = dark ? '#5b6488' : '#78829f';
  c.beginPath();
  c.moveTo(x - w * 0.12, baseY - h * 0.72);
  c.lineTo(x, baseY - h);
  c.lineTo(x + w * 0.14, baseY - h * 0.7);
  c.lineTo(x + w * 0.05, baseY - h * 0.76);
  c.lineTo(x - w * 0.04, baseY - h * 0.68);
  c.closePath();
  c.fill();
}
