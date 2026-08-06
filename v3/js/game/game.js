/**
 * The game: input, loop, discovery, effects.
 *
 * Physics runs at a fixed 120 Hz through Runner; rendering runs at whatever
 * the display gives us. Everything the player does goes through the solver —
 * there is no scripted animation anywhere in this file.
 */

import { Vec3, v3, clamp, mulberry32 } from '../math.js';
import { World, Runner } from '../physics/world.js';
import { DYNAMIC } from '../physics/body.js';
import { Renderer } from '../gl/renderer.js';
import { icosphere, MeshData } from '../gl/geometry.js';
import { Arena, cannonDir } from './arena.js';
import { Player } from './player.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { PROJECTS, PROFILE } from './content.js';

const DISCOVER_DIST = 3.4;

export class Game {
  constructor(canvas, hudRoot) {
    this.canvas = canvas;
    this.hud = new Hud(hudRoot);
    this.audio = new Audio();

    this.world = new World({ gravity: v3(0, -26, 0) });
    this.runner = new Runner(this.world, { fixedDt: 1 / 120, maxSteps: 4 });
    this.renderer = new Renderer(canvas);
    this.arena = new Arena(this.world, this.renderer);

    this.input = {
      forward: false, back: false, left: false, right: false,
      sprint: false, grabbing: false,
    };
    this.pointerLocked = false;
    this.paused = true;
    this.running = false;
    this.found = 0;
    this.time = 0;
    this.slowmo = 1;
    this.lowGravity = false;
    this.particles = [];
    this.rng = mulberry32(1337);
    this._proj = { x: 0, y: 0, visible: false, depth: 0 };
    this._v = new Vec3();
    this._v2 = new Vec3();
  }

  /* ─────────────────────────────────────────────────────────── loading ── */

  async load() {
    this.hud.progress(0.05, 'compiling shaders');
    this.arena.registerMeshes();

    this.hud.progress(0.15, 'loading project screenshots');
    let done = 0;
    await Promise.all(PROJECTS.map(async (p) => {
      p.image = await loadImage(p.img);
      done++;
      this.hud.progress(0.15 + (done / PROJECTS.length) * 0.55, `loading ${p.title}`);
    }));

    this.hud.progress(0.75, 'building the yard');
    // Give the browser a frame so the progress bar actually paints.
    await nextFrame();
    this.arena.build();
    this.renderer.finalizeTextures();

    this.player = new Player(this.world, this.arena, v3(0, 3, 26));
    this.renderer.registerMesh('player', playerMesh(), 4);
    this.playerRec = {
      body: this.player.body, mesh: 'player', sx: 0.85, sy: 0.85, sz: 0.85,
      color: [0.97, 0.78, 0.2, 1], emissive: 0.9, texLayer: -1, texKind: 0, gloss: 0.95,
    };

    this.wireCallbacks();
    this.bindInput();
    this.hud.progress(1, 'ready');
    this.hud.setFound(0, PROJECTS.length);
    this.hud.ready();
    return this;
  }

  wireCallbacks() {
    this.world.onImpact = (a, b, speed, point) => {
      const heavy = Math.max(a.mass, b.mass);
      const hardness = clamp(1 - Math.min(heavy, 40) / 60, 0.15, 0.95);
      // Pan by which side of the screen the hit happened on.
      this.renderer.project(point, this._proj);
      const pan = this._proj.visible
        ? clamp((this._proj.x / this.canvas.clientWidth - 0.5) * 2, -1, 1) : 0;
      this.audio.impact(speed, hardness, pan);
      if (speed > 4) this.sparks(point, Math.min(speed / 4, 7) | 0, hardness);
      if (speed > 12) this.renderer.flash = Math.min(this.renderer.flash + 0.05, 0.2);
    };

    this.player.onJump = () => this.audio.blip(320, 0.09, 'sine');
    this.player.onLand = (v) => { if (v > 6) this.shake(Math.min(v / 40, 0.35)); };
  }

  /* ───────────────────────────────────────────────────────────── input ── */

  bindInput() {
    const canvas = this.canvas;

    this.hud.el.start.addEventListener('click', () => this.begin());

    document.addEventListener('keydown', (e) => {
      if (e.repeat && !MOVE_KEYS.has(e.code)) return;
      if (this.handleKey(e.code, true, e)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      this.handleKey(e.code, false, e);
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked) { this.requestLock(); return; }
      if (e.button === 0) {
        this.input.grabbing = true;
        const body = this.player.tryGrab();
        if (body) { this.audio.blip(880, 0.07); this.hud.setReticle('hold'); }
        else this.hud.setReticle('miss');
      } else if (e.button === 2) {
        this.shockwave();
      } else if (e.button === 1) {
        this.fire();
      }
      e.preventDefault();
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.input.grabbing) {
        this.input.grabbing = false;
        this.player.releaseGrab(1);
        this.audio.blip(440, 0.06);
        this.hud.setReticle('');
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      if (!this.pointerLocked) return;
      if (this.player.grab) this.player.reelGrab(-e.deltaY * 0.01);
      else this.player.camDist = clamp(this.player.camDist + e.deltaY * 0.01, 4, 22);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.player.look(e.movementX, e.movementY);
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.paused = !this.pointerLocked;
      this.hud.setPaused(this.paused);
    });

    this.hud.el.paused.addEventListener('click', () => this.requestLock());
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.input)) this.input[k] = false;
    });
  }

  handleKey(code, down, e) {
    const i = this.input;
    switch (code) {
      case 'KeyW': case 'ArrowUp': i.forward = down; return true;
      case 'KeyS': case 'ArrowDown': i.back = down; return true;
      case 'KeyA': case 'ArrowLeft': i.left = down; return true;
      case 'KeyD': case 'ArrowRight': i.right = down; return true;
      case 'ShiftLeft': case 'ShiftRight': i.sprint = down; return true;
      case 'Space':
        if (down) this.player.requestJump();
        return true;
      case 'KeyQ':
        if (down && this.player.dash()) { this.audio.blip(1200, 0.12, 'sawtooth'); this.shake(0.12); }
        return true;
      case 'KeyE':
        if (down) this.fire();
        return true;
      case 'KeyR':
        if (down) { this.arena.reset(); this.found = 0; this.hud.setFound(0, PROJECTS.length); this.hud.toast('Yard reset'); }
        return true;
      case 'KeyT':
        if (down) { this.player.respawn(); this.hud.toast('Back to the spawn pad'); }
        return true;
      case 'KeyG':
        if (down) {
          this.lowGravity = !this.lowGravity;
          this.world.gravity.y = this.lowGravity ? -5 : -26;
          for (const b of this.world.bodies) if (b.type === DYNAMIC) b.wake();
          this.hud.toast(this.lowGravity ? 'Gravity: 0.2 g' : 'Gravity: normal');
        }
        return true;
      case 'KeyF':
        if (down) {
          this.slowmo = this.slowmo === 1 ? 0.28 : 1;
          this.runner.timeScale = this.slowmo;
          this.hud.toast(this.slowmo === 1 ? 'Normal time' : 'Slow motion');
        }
        return true;
      case 'KeyM':
        if (down) this.hud.toast(this.audio.toggle() ? 'Sound on' : 'Sound off');
        return true;
      case 'Escape':
        return false;
      default:
        return false;
    }
  }

  requestLock() {
    this.canvas.requestPointerLock?.();
  }

  begin() {
    this.audio.start();
    this.hud.enterGame();
    this.requestLock();
    if (!this.running) { this.running = true; this.loop(performance.now()); }
    this.hud.toast('Roll into a monolith to open a project', 4000);
  }

  /* ─────────────────────────────────────────────────────────── actions ── */

  shockwave() {
    const p = this.player.pos;
    this.world.explode(p, 13, 21, { upBias: 0.5 });
    this.audio.boom();
    this.shake(0.42);
    this.renderer.flash = 0.55;
    for (let i = 0; i < 90; i++) {
      const a = this.rng() * Math.PI * 2;
      const e = (this.rng() - 0.2) * 1.1;
      const speed = 9 + this.rng() * 12;
      this.particles.push({
        p: p.clone(),
        v: v3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).scale(speed),
        life: 0.55 + this.rng() * 0.5, max: 1.05,
        size: 0.16 + this.rng() * 0.3,
        c: [1, 0.72 + this.rng() * 0.25, 0.3],
      });
    }
  }

  fire() {
    // Aim the cannon at wherever the player is looking, then shoot.
    const c = this.arena.cannon;
    const dir = this.player.lookDir(this._v);
    c.yaw = Math.atan2(dir.x, dir.z);
    c.pitch = clamp(Math.asin(dir.y) + 0.25, -0.2, 1.2);
    const shot = this.arena.fireCannon(1);
    if (!shot) return;
    this.audio.boom();
    this.shake(0.2);
    const muzzle = cannonDir(c, this._v2).scale(3.2).add(c.pos);
    for (let i = 0; i < 26; i++) {
      this.particles.push({
        p: muzzle.clone(),
        v: cannonDir(c, new Vec3()).scale(10 + this.rng() * 16)
          .add(v3((this.rng() - 0.5) * 7, (this.rng() - 0.5) * 7, (this.rng() - 0.5) * 7)),
        life: 0.3 + this.rng() * 0.4, max: 0.7,
        size: 0.2 + this.rng() * 0.35,
        c: [1, 0.8, 0.4],
      });
    }
  }

  sparks(point, n, hardness) {
    for (let i = 0; i < n && this.particles.length < 900; i++) {
      this.particles.push({
        p: point.clone(),
        v: v3((this.rng() - 0.5) * 8, this.rng() * 6, (this.rng() - 0.5) * 8),
        life: 0.18 + this.rng() * 0.3, max: 0.48,
        size: 0.07 + this.rng() * 0.12,
        c: hardness > 0.6 ? [1, 0.9, 0.6] : [0.7, 0.75, 0.95],
      });
    }
  }

  shake(amount) {
    this.shakeAmount = Math.min((this.shakeAmount || 0) + amount, 1);
  }

  /* ──────────────────────────────────────────────────────── discovery ── */

  checkDiscovery() {
    const p = this.player.pos;
    for (const m of this.arena.monoliths) {
      if (m.found) continue;
      const near = m.body.pos.dist(p) < DISCOVER_DIST;
      // Knocking it flat counts too — the up axis of the slab tipped over.
      const tipped = Math.abs(upDot(m.body.quat)) < 0.55;
      if (!near && !tipped) continue;
      m.found = true;
      m.rec.emissive = 1.35;
      this.found++;
      this.hud.setFound(this.found, PROJECTS.length);
      this.hud.showProject(m.project, m.index);
      this.audio.chime(this.found);
      this.renderer.flash = Math.max(this.renderer.flash, 0.22);
      if (this.found === PROJECTS.length) {
        this.hud.toast(`All ${PROJECTS.length} projects found — ${PROFILE.email}`, 8000);
        this.finale();
      }
    }
  }

  finale() {
    this.world.explode(v3(0, 1, 0), 60, 26, { upBias: 0.9 });
    for (let i = 0; i < 400; i++) {
      const a = this.rng() * Math.PI * 2;
      this.particles.push({
        p: v3(Math.cos(a) * this.rng() * 30, 1, Math.sin(a) * this.rng() * 30),
        v: v3((this.rng() - 0.5) * 8, 14 + this.rng() * 20, (this.rng() - 0.5) * 8),
        life: 1.4 + this.rng() * 1.6, max: 3,
        size: 0.2 + this.rng() * 0.4,
        c: [this.rng() * 0.5 + 0.5, this.rng() * 0.6 + 0.4, this.rng() * 0.8 + 0.2],
      });
    }
    this.renderer.flash = 1;
    this.shake(1);
  }

  /* ───────────────────────────────────────────────────────────── frame ── */

  loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - (this._last || now)) / 1000, 0.05);
    this._last = now;
    this.time += dt;

    if (!this.paused) {
      this.runner.advance(dt, (fdt) => {
        this.player.fixedUpdate(fdt, this.input);
        this.arena.update(fdt);
      });
      this.player.updateCamera(dt);
      this.checkDiscovery();
      this.updateParticles(dt);
      this.audio.rollLevel(this.player.speed);
    }

    this.draw(dt);
    this.hud.update(dt, {
      speed: this.player.speed,
      awake: this.world.stats.awake,
      bodies: this.world.bodies.length,
    });
    requestAnimationFrame((t) => this.loop(t));
  }

  updateParticles(dt) {
    const g = this.world.gravity.y;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.v.y += g * 0.55 * dt;
      p.v.scale(1 - 1.1 * dt);
      p.p.addScaled(p.v, dt);
      if (p.p.y < 0.05) { p.p.y = 0.05; p.v.y = Math.abs(p.v.y) * 0.35; p.v.x *= 0.6; p.v.z *= 0.6; }
    }
  }

  draw(dt) {
    const r = this.renderer;
    r.beginFrame(dt);

    // Camera, with a decaying shake applied to the eye only so the target
    // stays put and the world doesn't appear to slide.
    const shake = this.shakeAmount || 0;
    this._v.copy(this.player.camPos);
    if (shake > 0.001) {
      const t = this.time * 47;
      this._v.x += Math.sin(t * 1.7) * shake * 0.5;
      this._v.y += Math.sin(t * 2.3 + 1.1) * shake * 0.5;
      this._v.z += Math.sin(t * 1.9 + 2.7) * shake * 0.5;
      this.shakeAmount = Math.max(0, shake - dt * 2.4);
    }
    r.setCamera(this._v, this.player.camTarget, UP, this.player.fov, 0.12, 320);
    r.setLightFrustum(ORIGIN, 46, 180);
    r.flash = Math.max(0, r.flash - dt * 1.8);

    // Pulse the grabbed body so it's obvious what you're holding.
    if (this.player.grab) {
      r.highlight.copy(this.player.grab.body.pos);
      r.highlightRadius = this.player.grab.body.shape.boundingRadius + 0.9;
    } else {
      r.highlightRadius = 0;
    }

    for (const rec of this.arena.props) {
      const b = rec.body;
      r.submit(rec.mesh, b.pos, b.quat, rec.sx, rec.sy, rec.sz,
        rec.color, rec.emissive, rec.texLayer, rec.texKind, rec.gloss);
    }

    const pl = this.playerRec;
    const pulse = 0.75 + Math.sin(this.time * 3) * 0.25 + Math.min(this.player.speed / 30, 1);
    r.submit(pl.mesh, pl.body.pos, pl.body.quat, pl.sx, pl.sy, pl.sz,
      pl.color, pulse, -1, 0, pl.gloss);

    // Speed trail.
    for (const t of this.player.trail) {
      const a = t.life / 0.45;
      r.particle(t.p.x, t.p.y, t.p.z, 0.7 * a, 1, 0.75 * a, 0.25, a * 0.5);
    }

    for (const p of this.particles) {
      const a = clamp(p.life / p.max, 0, 1);
      r.particle(p.p.x, p.p.y, p.p.z, p.size * (0.4 + a), p.c[0], p.c[1], p.c[2], a);
    }

    // The grab beam and the chain, drawn as lines.
    if (this.player.grab) {
      r.line(this.player.pos, this.player.grab.body.pos, 0.5, 0.95, 1, 0.85);
    }
    this.drawCompass();

    r.render();
  }

  /** Screen-space markers for the landmarks, clamped to the viewport edge. */
  drawCompass() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const items = [];
    for (const z of this.arena.zones) {
      const pr = this.renderer.project(z.pos, this._proj);
      let x = pr.x, y = pr.y, edge = false;
      if (!pr.visible) {
        // Behind the camera: pin it to the bottom edge on the correct side.
        this._v.setSub(z.pos, this.player.pos);
        const side = Math.sign(this._v.x * Math.cos(this.player.yaw) - this._v.z * Math.sin(this.player.yaw)) || 1;
        x = side > 0 ? w - 40 : 40;
        y = h - 70;
        edge = true;
      } else if (x < 40 || x > w - 40 || y < 40 || y > h - 40) {
        x = clamp(x, 40, w - 40);
        y = clamp(y, 40, h - 40);
        edge = true;
      }
      const dist = z.pos.dist(this.player.pos);
      items.push({
        x: Math.round(x), y: Math.round(y), edge,
        alpha: clamp(1 - dist / 70, 0.25, 1),
        label: z.name,
      });
    }
    this.hud.updateCompass(items);
  }
}

/* ────────────────────────────────────────────────────────────── utils ── */

const UP = v3(0, 1, 0);
const ORIGIN = v3(0, 0, 0);
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** The local +y axis of a quaternion, dotted with world up. */
function upDot(q) {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(placeholderCanvas());
    img.src = src;
  });
}

function placeholderCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, 8, 8);
  return c;
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** A faceted marble — flat shading makes the spin legible at a glance. */
function playerMesh() {
  return icosphereFlat(1, 2);
}

function icosphereFlat(radius, subdiv) {
  const smooth = icosphere(radius, subdiv);
  const md = new MeshData();
  const v = smooth.verts;
  const idx = smooth.indices;
  const a = new Vec3(), b = new Vec3(), c = new Vec3(), n = new Vec3(), e1 = new Vec3(), e2 = new Vec3();
  for (let i = 0; i < idx.length; i += 3) {
    const p = [];
    for (let k = 0; k < 3; k++) {
      const o = idx[i + k] * 9;
      p.push([v[o], v[o + 1], v[o + 2]]);
    }
    a.set(...p[0]); b.set(...p[1]); c.set(...p[2]);
    e1.setSub(b, a); e2.setSub(c, a);
    n.setCross(e1, e2).normalize();
    const base = md.vertexCount;
    md.push(a.x, a.y, a.z, n.x, n.y, n.z, 0, 0, 0);
    md.push(b.x, b.y, b.z, n.x, n.y, n.z, 1, 0, 0);
    md.push(c.x, c.y, c.z, n.x, n.y, n.z, 0.5, 1, 0);
    md.tri(base, base + 1, base + 2);
  }
  return md;
}
