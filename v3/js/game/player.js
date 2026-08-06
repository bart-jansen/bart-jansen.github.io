/**
 * The player is a heavy marble.
 *
 * Rolling is driven by torque, not by setting the velocity — so the marble has
 * real momentum, spins up against friction, and can be knocked off course by
 * anything heavier than it. A small direct force is mixed in so it still feels
 * responsive rather than sluggish, and an air-control term keeps jumps
 * steerable.
 */

import { Vec3, v3, clamp, damp, lerp } from '../math.js';
import { Body, DYNAMIC } from '../physics/body.js';
import { Sphere } from '../physics/shapes.js';
import { GrabConstraint } from '../physics/constraints.js';
import { G_PLAYER, ARENA_HALF } from './arena.js';

const RADIUS = 0.85;
const ROLL_TORQUE = 168;
const AIR_CONTROL = 0.24;
const JUMP_SPEED = 15.5;
const DASH_SPEED = 22;
const MAX_SPEED = 30;

export class Player {
  constructor(world, arena, spawn = v3(0, 3, 26)) {
    this.world = world;
    this.arena = arena;
    this.spawn = spawn.clone();

    this.body = new Body(new Sphere(RADIUS), {
      pos: spawn.clone(),
      density: 6.5,
      friction: 0.9,
      restitution: 0.18,
      linearDamping: 0.04,
      angularDamping: 0.05,
      rollingFriction: 0.012,
      group: G_PLAYER,
      allowSleep: false,
      tag: 'player',
    });
    this.body.userData = { kind: 'player' };
    world.add(this.body);

    this.yaw = Math.PI;          // looking back toward the nameplate
    this.pitch = -0.16;
    this.grounded = false;
    this.groundTimer = 0;        // coyote time
    this.jumpBuffer = 0;
    this.dashCooldown = 0;
    this.jumpsLeft = 2;
    this.grab = null;
    this.grabDistance = 6;
    this.charge = 0;

    this.camPos = spawn.clone().add(v3(0, 4, 9));
    this.camTarget = spawn.clone();
    this.camDist = 9.5;
    this.fov = 1.12;
    this._fwd = new Vec3();
    this._right = new Vec3();
    this._tmp = new Vec3();
    this.trail = [];
  }

  get pos() { return this.body.pos; }
  get speed() { return this.body.vel.len(); }

  /** Camera-relative basis, flattened onto the ground plane. */
  basis() {
    this._fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
    this._right.set(this._fwd.z, 0, -this._fwd.x);
    return this;
  }

  /** Full look direction, including pitch — used for aiming and grabbing. */
  lookDir(out = new Vec3()) {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
  }

  look(dx, dy, sensitivity = 0.0022) {
    this.yaw -= dx * sensitivity;
    this.pitch = clamp(this.pitch - dy * sensitivity, -1.32, 1.15);
  }

  /* ────────────────────────────────────────────────────────── physics ── */

  /** Called once per fixed physics step. */
  fixedUpdate(dt, input) {
    const b = this.body;
    this.checkGround();

    this.basis();
    let mx = 0, mz = 0;
    if (input.forward) mz += 1;
    if (input.back) mz -= 1;
    if (input.right) mx += 1;
    if (input.left) mx -= 1;
    const mag = Math.hypot(mx, mz);

    if (mag > 0) {
      mx /= mag; mz /= mag;
      this._tmp.setScale(this._fwd, mz).addScaled(this._right, mx);

      if (this.grounded) {
        // Torque about the axis perpendicular to travel: up × dir.
        const tx = -this._tmp.z, tz = this._tmp.x;
        const boost = input.sprint ? 1.55 : 1;
        b.torque.x += tx * ROLL_TORQUE * boost;
        b.torque.z += tz * ROLL_TORQUE * boost;
        // A little direct push so it doesn't feel like driving on ice.
        b.force.addScaled(this._tmp, b.mass * 24 * boost);
      } else {
        b.force.addScaled(this._tmp, b.mass * 26 * AIR_CONTROL);
      }
    } else if (this.grounded && !input.sprint) {
      // Active braking, otherwise a heavy marble takes a week to stop.
      b.angVel.scale(1 - 2.2 * dt);
      b.vel.x -= b.vel.x * 1.6 * dt;
      b.vel.z -= b.vel.z * 1.6 * dt;
    }

    // Jump — with coyote time and an input buffer, both of which cost nothing
    // and are the difference between "responsive" and "broken".
    this.groundTimer = this.grounded ? 0.12 : Math.max(0, this.groundTimer - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && (this.groundTimer > 0 || this.jumpsLeft > 0)) {
      const first = this.groundTimer > 0;
      b.vel.y = first ? JUMP_SPEED : JUMP_SPEED * 0.85;
      this.jumpBuffer = 0;
      this.groundTimer = 0;
      this.jumpsLeft = first ? 1 : this.jumpsLeft - 1;
      this.onJump?.(first);
    }

    if (this.dashCooldown > 0) this.dashCooldown -= dt;

    const sp = b.vel.len();
    if (sp > MAX_SPEED) b.vel.scale(MAX_SPEED / sp);

    // Keep the marble inside the yard even if the solver has a bad day.
    const lim = ARENA_HALF - 2;
    if (Math.abs(b.pos.x) > lim || Math.abs(b.pos.z) > lim) {
      b.pos.x = clamp(b.pos.x, -lim, lim);
      b.pos.z = clamp(b.pos.z, -lim, lim);
    }
    if (b.pos.y < -12) this.respawn();

    if (this.grab) this.updateGrab();
  }

  checkGround() {
    const hit = this.world.raycast(
      this.body.pos, DOWN, RADIUS + 0.28,
      (o) => o !== this.body && !o.isSensor,
    );
    const was = this.grounded;
    this.grounded = !!hit;
    if (this.grounded) {
      this.jumpsLeft = 1;
      if (!was) this.onLand?.(Math.abs(this.body.vel.y));
    }
    this.groundNormal = hit ? hit.normal : UP;
  }

  requestJump() { this.jumpBuffer = 0.14; }

  dash() {
    if (this.dashCooldown > 0) return false;
    this.dashCooldown = 0.85;
    this.lookDir(this._tmp);
    // Dash along the look direction but never straight into the floor.
    this._tmp.y = Math.max(this._tmp.y, 0.06);
    this._tmp.normalize();
    this.body.vel.addScaled(this._tmp, DASH_SPEED);
    this.body.wake();
    return true;
  }

  respawn() {
    const b = this.body;
    b.pos.copy(this.spawn);
    b.vel.zero();
    b.angVel.zero();
    b.quat.identity();
    b.updateInertiaWorld();
    b.updateAABB();
    this.releaseGrab();
  }

  /* ────────────────────────────────────────────────────── telekinesis ── */

  /** Raycast from the camera through the crosshair and latch onto whatever's there. */
  tryGrab(maxDist = 26) {
    if (this.grab) return null;
    const dir = this.lookDir(new Vec3());
    const origin = this.camPos.clone();
    const hit = this.world.raycast(origin, dir, maxDist,
      (b) => b !== this.body && b.type === DYNAMIC && !b.isSensor);
    if (!hit) return null;

    this.grabDistance = clamp(hit.distance, 3.5, maxDist);
    this.grab = new GrabConstraint(hit.body, hit.point, {
      frequency: 3.6,
      damping: 0.9,
      // Scale the force budget with mass so a wrecking ball is still heavy.
      maxForce: 220 * hit.body.mass + 2600,
    });
    this.world.addConstraint(this.grab);
    this.grabPoint = hit.point.clone();
    return hit.body;
  }

  updateGrab() {
    const dir = this.lookDir(this._tmp);
    this.grabPoint = this.grabPoint || new Vec3();
    this.grabPoint.copy(this.camPos).addScaled(dir, this.grabDistance);
    this.grab.setTarget(this.grabPoint);
  }

  reelGrab(delta) {
    this.grabDistance = clamp(this.grabDistance + delta, 3, 30);
  }

  /** Let go, optionally with a shove along the look direction. */
  releaseGrab(throwPower = 0) {
    if (!this.grab) return null;
    const body = this.grab.body;
    this.world.removeConstraint(this.grab);
    this.grab = null;
    if (throwPower > 0) {
      this.lookDir(this._tmp);
      body.vel.addScaled(this._tmp, throwPower * 26 / Math.sqrt(Math.max(body.mass, 1)));
      body.angVel.x += (Math.random() - 0.5) * 6;
      body.angVel.z += (Math.random() - 0.5) * 6;
      body.wake();
    }
    return body;
  }

  /* ─────────────────────────────────────────────────────────── camera ── */

  /**
   * Third-person orbit with a spring, plus a raycast so the camera never ends
   * up inside a wall. Also pulls back and widens the FOV with speed, which is
   * the cheapest way to make 20 m/s feel like 20 m/s.
   */
  updateCamera(dt) {
    const b = this.body;
    const speed = b.vel.len();

    const cp = Math.cos(this.pitch);
    const offset = v3(
      -Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp,
    ).normalize();

    const wanted = this.camDist + speed * 0.09;
    const focus = this._tmp.copy(b.pos).addScaled(UP, 1.1);

    let dist = wanted;
    const hit = this.world.raycast(focus, offset, wanted + 0.6,
      (o) => o !== b && o.type !== DYNAMIC);
    if (hit) dist = Math.max(2.2, hit.distance - 0.6);

    this.camTarget.setLerp(this.camTarget, focus, 1 - Math.exp(-18 * dt));
    const goal = focus.clone().addScaled(offset, dist);
    // Snap in hard when a wall pushes the camera forward, ease out gently.
    const rate = goal.dist(this.camPos) > dist ? 26 : 11;
    this.camPos.x = damp(this.camPos.x, goal.x, rate, dt);
    this.camPos.y = damp(this.camPos.y, goal.y, rate, dt);
    this.camPos.z = damp(this.camPos.z, goal.z, rate, dt);

    this.fov = lerp(this.fov, 1.12 + clamp(speed / MAX_SPEED, 0, 1) * 0.2, 1 - Math.exp(-6 * dt));

    // Ribbon of ghosts behind a fast marble.
    if (speed > 9) {
      this.trail.push({ p: b.pos.clone(), life: 0.45 });
      if (this.trail.length > 40) this.trail.shift();
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
  }
}

const DOWN = v3(0, -1, 0);
const UP = v3(0, 1, 0);
