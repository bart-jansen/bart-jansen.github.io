/**
 * The player: a physics sphere you never see, a cartoon body you always do.
 *
 * Using a sphere body is the cheap trick that makes this feel good. It rolls
 * over the boulder rim, slides up the ramps and never catches a corner — and
 * because we zero its spin every step and drive its orientation from the
 * facing yaw instead, it never tips over or spins the character like a top.
 *
 * The camera is a critically-damped spring on a boom behind the player, with a
 * raycast that pulls it in when the boom would clip through geometry.
 */

import * as THREE from '../vendor/three/three.module.min.js';
import { Body, DYNAMIC } from '../../v3/js/physics/body.js';
import { Sphere } from '../../v3/js/physics/shapes.js';
import { v3, Vec3, Quat, clamp, damp } from '../../v3/js/math.js';
import { Bart, BART_RADIUS } from './char/bart.js';

const WALK = 7.2;
const SPRINT = 12.5;
const ACCEL = 46;
const AIR_ACCEL = 12;
const JUMP = 11.4;
const COYOTE = 0.13;
const BUFFER = 0.16;

const _tmp = new Vec3();
const _down = v3(0, -1, 0);

export class Player {
  constructor(world, scene, camera, opts = {}) {
    this.world = world;
    this.camera = camera;

    this.bart = new Bart();
    scene.add(this.bart.root);

    this.body = new Body(new Sphere(BART_RADIUS), {
      type: DYNAMIC,
      pos: v3(opts.x ?? 0, 3, opts.z ?? 5),
      mass: 6,
      friction: 0.42,
      restitution: 0,
      linearDamping: 0.02,
      angularDamping: 0.9,
      allowSleep: false,
      tag: 'player',
    });
    world.add(this.body);

    this.yaw = Math.PI;            // where the character is facing
    this.camYaw = 0;               // camera sits south, looking up the island
    this.camPitch = 0.28;
    this.camDist = 9.5;
    this.grounded = false;
    this.groundTimer = 0;
    this.jumpBuffer = 0;
    this.airVel = 0;
    this.speed = 0;
    this.sprinting = false;
    this.frozen = false;

    this.input = { f: 0, s: 0, jump: false, sprint: false };
    this.lookTarget = null;

    this._camPos = new THREE.Vector3(0, 5, 21);
    this._camAim = new THREE.Vector3();
    this._boom = new THREE.Vector3();
    this.onLand = null;
  }

  get position() { return this.body.pos; }

  /* ────────────────────────────────────────────────────────────── physics ── */

  /** Called from inside the fixed step, before the solver runs. */
  fixedUpdate(dt) {
    const b = this.body;

    // Ground probe: a short ray straight down from just inside the sphere.
    _tmp.copy(b.pos);
    _tmp.y -= BART_RADIUS * 0.55;
    const hit = this.world.raycast(_tmp, _down, BART_RADIUS * 0.75, (o) => o !== b);
    const wasGrounded = this.grounded;
    this.grounded = !!hit && b.vel.y < 3;
    if (this.grounded) this.groundTimer = COYOTE; else this.groundTimer = Math.max(0, this.groundTimer - dt);

    if (this.grounded && !wasGrounded) {
      const impact = Math.min(1, Math.abs(this.airVel) / 16);
      if (impact > 0.12) {
        this.bart.impact(impact);
        if (this.onLand) this.onLand(impact);
      }
    }
    if (!this.grounded) this.airVel = b.vel.y;

    if (this.frozen) {
      b.vel.x *= 0.82; b.vel.z *= 0.82;
      b.angVel.set(0, 0, 0);
      return;
    }

    // Desired horizontal velocity, in camera space.
    const cy = Math.cos(this.camYaw), sy = Math.sin(this.camYaw);
    let dx = this.input.s * cy - this.input.f * sy;
    let dz = -this.input.s * sy - this.input.f * cy;
    const mag = Math.hypot(dx, dz);
    if (mag > 1) { dx /= mag; dz /= mag; }

    this.sprinting = this.input.sprint && mag > 0.1;
    const top = this.sprinting ? SPRINT : WALK;
    const accel = this.grounded ? ACCEL : AIR_ACCEL;

    const tx = dx * top, tz = dz * top;
    b.vel.x += clamp(tx - b.vel.x, -accel * dt, accel * dt);
    b.vel.z += clamp(tz - b.vel.z, -accel * dt, accel * dt);

    // Standing still on flat ground? Stop dead rather than creep.
    if (mag < 0.05 && this.grounded) {
      b.vel.x *= 0.86;
      b.vel.z *= 0.86;
    }

    // Jump, with coyote time and a small input buffer.
    this.jumpBuffer = this.input.jump ? BUFFER : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.groundTimer > 0) {
      b.vel.y = JUMP;
      this.jumpBuffer = 0;
      this.groundTimer = 0;
      this.grounded = false;
      this.bart.stretch(0.55);
    }

    // Kill the roll: we drive orientation ourselves.
    b.angVel.set(0, 0, 0);
    b.quat.identity();
    b.wake();

    this.speed = Math.hypot(b.vel.x, b.vel.z);
    if (mag > 0.1) {
      const want = Math.atan2(dx, dz);
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += clamp(d, -14 * dt, 14 * dt);
    }
  }

  /* ──────────────────────────────────────────────────────── presentation ── */

  update(dt) {
    const p = this.body.pos;
    this.bart.root.position.set(p.x, p.y - BART_RADIUS, p.z);
    this.bart.root.rotation.y = this.yaw;
    this.bart.update(dt, {
      speed: this.speed,
      maxSpeed: SPRINT,
      grounded: this.grounded,
      airVel: this.body.vel.y,
    });
    if (this.lookTarget) this.bart.lookAt(this.lookTarget); else this.bart.lookAt(null);
  }

  updateCamera(dt) {
    const p = this.body.pos;
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    this._boom.set(
      Math.sin(this.camYaw) * cp,
      sp,
      Math.cos(this.camYaw) * cp,
    );

    const aimY = p.y + 1.5;
    let dist = this.camDist;

    // Pull the camera in if the boom would clip something solid.
    _tmp.set(this._boom.x, this._boom.y, this._boom.z);
    const origin = v3(p.x, aimY, p.z);
    const hit = this.world.raycast(origin, _tmp, dist + 0.6, (o) => o.tag === 'terrain');
    if (hit) dist = Math.max(2.6, hit.distance - 0.6);

    const wantX = p.x + this._boom.x * dist;
    const wantY = aimY + this._boom.y * dist;
    const wantZ = p.z + this._boom.z * dist;

    const l = this.grounded ? 9 : 6;
    this._camPos.set(
      damp(this._camPos.x, wantX, l, dt),
      damp(this._camPos.y, wantY, l * 0.8, dt),
      damp(this._camPos.z, wantZ, l, dt),
    );
    this._camAim.set(
      damp(this._camAim.x, p.x, 12, dt),
      damp(this._camAim.y, aimY - 0.35, 12, dt),
      damp(this._camAim.z, p.z, 12, dt),
    );

    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camAim);
  }

  /** Mouse / touch drag orbits the camera. */
  orbit(dx, dy) {
    this.camYaw -= dx * 0.006;
    this.camPitch = clamp(this.camPitch + dy * 0.004, -0.12, 0.85);
  }

  zoom(delta) {
    this.camDist = clamp(this.camDist + delta * 0.01, 4.5, 18);
  }

  teleport(x, z, y = 3) {
    this.body.setPosition(v3(x, y, z), new Quat());
    this.body.vel.set(0, 0, 0);
    this._camPos.set(x, y + 5, z + 9);
  }
}
