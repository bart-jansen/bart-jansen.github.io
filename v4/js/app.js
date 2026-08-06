/**
 * v4 — "SUNDAY ISLAND".
 *
 * The renderer is three.js. The simulation is not: it is the same hand-written
 * rigid-body engine that drives v3, imported straight from `/v3/js/physics`.
 * So this build is a straight swap of the presentation layer, which is a nice
 * way to prove the engine was worth writing.
 */

import * as THREE from '../vendor/three/three.module.min.js';
import { World, Runner } from '../../v3/js/physics/world.js';
import { DYNAMIC } from '../../v3/js/physics/body.js';
import { v3, mulberry32, clamp, damp } from '../../v3/js/math.js';
import { createSky, createLights, createClouds, SKY } from './gfx/sky.js';
import { outlineAll, setShadows } from './gfx/toon.js';
import { createIsland, ISLAND_RADIUS } from './world/island.js';
import { createZones } from './world/zones.js';
import { Player } from './player.js';
import { Hud } from './hud.js';

const SPAWN = { x: 0, z: 12 };

export class App {
  constructor(canvas, hudRoot) {
    this.canvas = canvas;
    this.time = 0;
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.paused = false;

    /* ─────────────────────────────────────────────────────────── renderer ── */
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, powerPreference: 'high-performance', alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY.horizon, 90, 320);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 900);
    this.camera.position.set(0, 6, 18);

    /* ────────────────────────────────────────────────────────────── world ── */
    const rng = mulberry32(0x5ea51de);
    this.world = new World({
      gravity: v3(0, -30, 0),
      velocityIterations: 7,
      positionIterations: 3,
    });
    this.runner = new Runner(this.world, { fixedDt: 1 / 90, maxSteps: 4 });

    this.scene.add(createSky(460));
    const lights = createLights(ISLAND_RADIUS + 10);
    this.scene.add(lights);
    this.sun = lights.sun;

    this.clouds = createClouds(rng, 18, 150);
    this.scene.add(this.clouds);

    const island = createIsland(this.world, rng);
    this.scene.add(island.group);
    this.island = island.group;

    const loader = new THREE.TextureLoader();
    const zones = createZones(this.world, rng, loader);
    this.scene.add(zones.group);
    this.zones = zones.group;
    this.props = zones.props;
    this.spots = zones.spots;

    outlineAll(island.group, 0.05);
    outlineAll(zones.group, 0.04);
    setShadows(island.group, true, true);
    setShadows(zones.group, true, true);

    this.player = new Player(this.world, this.scene, this.camera, SPAWN);
    setShadows(this.player.bart.root, true, false);
    this.player.teleport(SPAWN.x, SPAWN.z, 2);

    /* ──────────────────────────────────────────────────────────────── hud ── */
    this.hud = new Hud(hudRoot, this.spots.length);
    this.hud.onAction = () => this.interact();
    this.player.onLand = (i) => { if (i > 0.55) this.shake(i * 0.35); };
    this._shake = 0;

    this.bindInput();
    this.resize();
    addEventListener('resize', () => this.resize(), { passive: true });

    this._loop = this._loop.bind(this);
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  /* ─────────────────────────────────────────────────────────────── input ── */

  bindInput() {
    const p = this.player;
    const keys = this.keys = new Set();
    const down = (k) => keys.has(k);

    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { this.hud.close(); return; }
      if (k === 'e' || k === 'enter') { this.interact(); e.preventDefault(); return; }
      if (k === 'r') { p.teleport(SPAWN.x, SPAWN.z, 2); this.hud.say('Back to the arch.'); return; }
      if ([' ', 'w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      keys.add(k);
      if (k === 'shift') keys.add('shift');
    });
    addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => keys.clear());

    this.readKeys = () => {
      p.input.f = (down('w') || down('arrowup') ? 1 : 0) - (down('s') || down('arrowdown') ? 1 : 0);
      p.input.s = (down('d') || down('arrowright') ? 1 : 0) - (down('a') || down('arrowleft') ? 1 : 0);
      p.input.jump = down(' ');
      p.input.sprint = down('shift');
    };

    // Drag to orbit.
    let dragging = false, lx = 0, ly = 0, moved = 0;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      dragging = true; moved = 0; lx = e.clientX; ly = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      p.orbit(dx, dy);
    });
    const up = (e) => {
      if (dragging && moved < 6) this.interact();
      dragging = false;
      if (c.hasPointerCapture?.(e.pointerId)) c.releasePointerCapture(e.pointerId);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { p.zoom(e.deltaY); e.preventDefault(); }, { passive: false });

    // Touch stick, bottom-left.
    const stick = document.querySelector('[data-stick]');
    if (stick) this.bindStick(stick, p);
    const jumpBtn = document.querySelector('[data-jump]');
    if (jumpBtn) {
      jumpBtn.addEventListener('pointerdown', (e) => { p.input.jump = true; e.preventDefault(); });
      jumpBtn.addEventListener('pointerup', () => { p.input.jump = false; });
      jumpBtn.addEventListener('pointerleave', () => { p.input.jump = false; });
    }
  }

  bindStick(stick, p) {
    const knob = stick.querySelector('[data-knob]');
    let id = null;
    const set = (dx, dy) => {
      const r = 46;
      const d = Math.hypot(dx, dy);
      const k = d > r ? r / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.stickF = clamp(-dy / r, -1, 1);
      this.stickS = clamp(dx / r, -1, 1);
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId; stick.setPointerCapture(id);
      stick.classList.add('on');
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const r = stick.getBoundingClientRect();
      set(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    });
    const end = () => {
      id = null; this.stickF = 0; this.stickS = 0;
      knob.style.transform = 'translate(0,0)';
      stick.classList.remove('on');
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    this.stickF = 0; this.stickS = 0;
  }

  /* ──────────────────────────────────────────────────────────── interact ── */

  interact() {
    if (this.hud.isOpen) { this.hud.close(); return; }
    const s = this.hud.current;
    if (s) this.hud.open(s);
  }

  nearestSpot() {
    const p = this.player.position;
    let best = null, bestD = Infinity;
    for (const s of this.spots) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < s.r && d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  shake(amount) { this._shake = Math.min(1, this._shake + amount); }

  /* ────────────────────────────────────────────────────────────── resize ── */

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ──────────────────────────────────────────────────────────────── loop ── */

  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min((now - this._last) / 1000, 0.1);
    this._last = now;
    if (dt <= 0) return;
    this.time += dt;

    this._fpsAccum += dt; this._fpsFrames++;
    if (this._fpsAccum > 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
    }

    this.readKeys();
    const p = this.player;
    if (this.stickF || this.stickS) { p.input.f = this.stickF; p.input.s = this.stickS; }

    this.runner.advance(dt, (fdt) => {
      p.fixedUpdate(fdt);
      this.tidy(fdt);
    });

    p.update(dt);
    p.updateCamera(dt);

    this.syncProps();
    this.island.userData.update?.(this.time);
    this.zones.userData.update?.(this.time);
    this.clouds.userData.update?.(dt);
    this.billboards();

    // Keep the sun's shadow box centred on the player.
    this.sun.position.set(p.position.x + 40, 62, p.position.z + 28);
    this.sun.target.position.set(p.position.x, 0, p.position.z);
    this.sun.target.updateMatrixWorld();

    if (this._shake > 0.001) {
      this._shake = damp(this._shake, 0, 7, dt);
      const s = this._shake * 0.22;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    const near = this.nearestSpot();
    this.hud.setNear(near);
    this.hud.update(dt);
    p.lookTarget = near ? { x: near.x, y: 1.6, z: near.z } : null;

    this.renderer.render(this.scene, this.camera);
  }

  /** Sync every dynamic prop's mesh to its body. */
  syncProps() {
    for (const { mesh, body } of this.props) {
      mesh.quaternion.set(body.quat.x, body.quat.y, body.quat.z, body.quat.w);
      const o = mesh.userData.offsetY;
      if (o) {
        const v = new THREE.Vector3(0, o, 0).applyQuaternion(mesh.quaternion);
        mesh.position.set(body.pos.x + v.x, body.pos.y + v.y, body.pos.z + v.z);
      } else {
        mesh.position.set(body.pos.x, body.pos.y, body.pos.z);
      }
    }
  }

  /**
   * Housekeeping inside the fixed step: fish anything that fell in the sea back
   * out, and slowly stand the skittles up again so the garden re-grows.
   */
  tidy(dt) {
    for (const { body } of this.props) {
      if (body.type !== DYNAMIC) continue;
      const home = body.userData?.home;

      const r = Math.hypot(body.pos.x, body.pos.z);
      if (body.pos.y < -6 || r > ISLAND_RADIUS + 6) {
        this.respawn(body, home);
        continue;
      }

      // Skittles stand themselves back up once they have been lying still for
      // a while, so the garden re-grows behind you.
      if (!home) continue;
      const q = body.quat;
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);   // local +Y, world Y component
      const settled = body.vel.lenSq() < 0.4 && body.angVel.lenSq() < 0.4;
      const wrong = upY < 0.86 || Math.hypot(body.pos.x - home.x, body.pos.z - home.z) > 1.2;
      body.userData.idle = (settled && wrong) ? (body.userData.idle || 0) + dt : 0;
      if (body.userData.idle > 9) this.respawn(body, home);
    }
  }

  respawn(body, home) {
    body.setPosition(home ? v3(home.x, home.y + 0.4, home.z)
      : v3((Math.random() - 0.5) * 24, 7, (Math.random() - 0.5) * 24));
    body.vel.set(0, 0, 0);
    body.angVel.set(0, 0, 0);
    body.wake();
    if (body.userData) body.userData.idle = 0;
  }

  /** Skill tags always face the camera. */
  billboards() {
    if (!this._bbs) {
      this._bbs = [];
      this.scene.traverse((o) => { if (o.userData.billboard) this._bbs.push(o); });
    }
    for (const b of this._bbs) {
      // lookAt already strips the parent rotation for us.
      b.getWorldPosition(_wp);
      _look.set(this.camera.position.x, _wp.y, this.camera.position.z);
      b.lookAt(_look);
    }
  }
}

const _wp = new THREE.Vector3();
const _look = new THREE.Vector3();
