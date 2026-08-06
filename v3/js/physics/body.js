/**
 * Rigid bodies.
 *
 * Inertia is kept diagonal in the body's local frame and rotated to world each
 * step (I⁻¹_world = R · I⁻¹_local · Rᵀ). Every shape the arena builds is
 * symmetric about its own axes, so a diagonal tensor is exact for them and
 * cheap for everything else.
 */

import { Vec3, Quat, Mat3, v3, cross3 } from '../math.js';
import { SPHERE } from './shapes.js';

export const DYNAMIC = 0;
export const STATIC = 1;
export const KINEMATIC = 2;

let nextId = 1;
const _rot = new Mat3();

export class Body {
  constructor(shape, opts = {}) {
    this.id = nextId++;
    this.shape = shape;
    this.type = opts.type ?? DYNAMIC;

    this.pos = opts.pos ? opts.pos.clone() : new Vec3();
    this.quat = opts.quat ? opts.quat.clone() : new Quat();
    this.vel = new Vec3();
    this.angVel = new Vec3();

    this.force = new Vec3();
    this.torque = new Vec3();

    this.friction = opts.friction ?? 0.55;
    this.restitution = opts.restitution ?? 0.05;
    this.linearDamping = opts.linearDamping ?? 0.02;
    this.angularDamping = opts.angularDamping ?? 0.06;
    this.gravityScale = opts.gravityScale ?? 1;
    // Resists spin at contacts. Without it a sphere on a flat floor is a
    // perpetual motion machine: sliding friction does nothing once it rolls.
    this.rollingFriction = opts.rollingFriction ?? 0;

    this.group = opts.group ?? 1;
    this.mask = opts.mask ?? 0xffffffff;

    this.invInertiaLocal = new Vec3();
    this.invInertiaWorld = new Mat3();
    this._inertiaScale = opts.inertiaScale ?? 1;

    this.setDensity(opts.density ?? 1, opts.mass);

    this.sleeping = false;
    this.sleepTimer = 0;
    this.allowSleep = opts.allowSleep !== false;
    this.island = -1;

    // Pseudo-velocities for split-impulse position correction.
    this.pseudoVel = new Vec3();
    this.pseudoAng = new Vec3();

    this.aabbMin = new Vec3();
    this.aabbMax = new Vec3();

    this.userData = opts.userData ?? null;
    this.tag = opts.tag ?? '';
    this.onContact = null;
    this.enabled = true;
    this.isSensor = opts.isSensor ?? false;

    this.updateInertiaWorld();
    this.updateAABB();
  }

  setDensity(density, explicitMass) {
    if (this.type !== DYNAMIC) {
      this.mass = 0; this.invMass = 0;
      this.invInertiaLocal.zero();
      return this;
    }
    const vol = this.shape.volume();
    const mass = explicitMass ?? Math.max(vol * density, 1e-4);
    this.mass = mass;
    this.invMass = 1 / mass;

    const i = v3();
    this.shape.inertiaPerMass(i);
    i.scale(mass * this._inertiaScale);
    this.invInertiaLocal.set(1 / i.x, 1 / i.y, 1 / i.z);
    return this;
  }

  /** Make the body spin more (<1) or less (>1) readily without changing mass. */
  setInertiaScale(s) {
    this._inertiaScale = s;
    return this.setDensity(1, this.mass);
  }

  updateInertiaWorld() {
    if (this.invMass === 0) { this.invInertiaWorld.setDiagonal(0, 0, 0); return; }
    if (this.shape.type === SPHERE) {
      const i = this.invInertiaLocal.x;
      this.invInertiaWorld.setDiagonal(i, i, i);
      return;
    }
    this.invInertiaWorld.setRotatedDiagonal(
      this.quat, this.invInertiaLocal.x, this.invInertiaLocal.y, this.invInertiaLocal.z,
    );
  }

  updateAABB() {
    const s = this.shape;
    if (s.type === SPHERE) {
      const r = s.radius;
      this.aabbMin.set(this.pos.x - r, this.pos.y - r, this.pos.z - r);
      this.aabbMax.set(this.pos.x + r, this.pos.y + r, this.pos.z + r);
      return;
    }
    // Rotated-box bound: half-extent along world axis i is Σⱼ |Rᵢⱼ| · hⱼ.
    // Exact for boxes, tight for everything else, and far cheaper than
    // re-projecting every vertex. The arena floor alone makes this worth it —
    // a bounding sphere around a 80×80 slab overlaps the entire level.
    _rot.setFromQuat(this.quat);
    const e = _rot.e, h = s.localHalf;
    const ex = Math.abs(e[0]) * h.x + Math.abs(e[3]) * h.y + Math.abs(e[6]) * h.z;
    const ey = Math.abs(e[1]) * h.x + Math.abs(e[4]) * h.y + Math.abs(e[7]) * h.z;
    const ez = Math.abs(e[2]) * h.x + Math.abs(e[5]) * h.y + Math.abs(e[8]) * h.z;
    this.aabbMin.set(this.pos.x - ex, this.pos.y - ey, this.pos.z - ez);
    this.aabbMax.set(this.pos.x + ex, this.pos.y + ey, this.pos.z + ez);
  }

  localToWorld(p, out = new Vec3()) {
    return out.copy(p).applyQuat(this.quat).add(this.pos);
  }

  worldToLocal(p, out = new Vec3()) {
    return out.copy(p).sub(this.pos).applyQuatInv(this.quat);
  }

  /** Velocity of the material point at world offset r from the centre. */
  pointVelocity(r, out = new Vec3()) {
    out.setCross(this.angVel, r);
    return out.add(this.vel);
  }

  applyForce(f, worldPoint) {
    if (this.invMass === 0) return this;
    this.wake();
    this.force.add(f);
    if (worldPoint) {
      const r = worldPoint.clone().sub(this.pos);
      this.torque.add(cross3(r, f));
    }
    return this;
  }

  applyTorque(t) {
    if (this.invMass === 0) return this;
    this.wake();
    this.torque.add(t);
    return this;
  }

  applyImpulse(j, worldPoint) {
    if (this.invMass === 0) return this;
    this.wake();
    this.vel.addScaled(j, this.invMass);
    if (worldPoint) {
      const r = worldPoint.clone().sub(this.pos);
      const t = cross3(r, j);
      this.invInertiaWorld.transform(t, t);
      this.angVel.add(t);
    }
    return this;
  }

  applyAngularImpulse(j) {
    if (this.invMass === 0) return this;
    this.wake();
    const t = j.clone();
    this.invInertiaWorld.transform(t, t);
    this.angVel.add(t);
    return this;
  }

  wake() {
    if (this.type !== DYNAMIC) return this;
    this.sleeping = false;
    this.sleepTimer = 0;
    return this;
  }

  /**
   * Force this body asleep. The timer is pushed past the world's sleep
   * threshold as well, so a body parked here by hand isn't woken again on the
   * very next island pass just because it hasn't been still for long enough.
   */
  sleep() {
    if (!this.allowSleep) return this;
    this.sleeping = true;
    this.sleepTimer = 1e9;
    this.vel.zero();
    this.angVel.zero();
    return this;
  }

  setPosition(p, q) {
    this.pos.copy(p);
    if (q) this.quat.copy(q);
    this.updateInertiaWorld();
    this.updateAABB();
    this.wake();
    return this;
  }

  reset(p, q) {
    this.vel.zero();
    this.angVel.zero();
    this.force.zero();
    this.torque.zero();
    this.pseudoVel.zero();
    this.pseudoAng.zero();
    return this.setPosition(p, q ?? new Quat());
  }

  get isDynamic() { return this.type === DYNAMIC; }
}
