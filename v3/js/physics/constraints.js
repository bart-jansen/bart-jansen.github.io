/**
 * Constraints.
 *
 * All of them follow the same shape: `preStep` computes effective masses and
 * applies the warm-start impulse, `solveVelocity` runs once per iteration.
 * They never touch positions directly — penetration and drift recovery both
 * go through the world's pseudo-velocity pass.
 */

import { Vec3, Quat, Mat3, v3, cross3, dot3, clamp, EPS } from '../math.js';

const _r1 = new Vec3(), _r2 = new Vec3(), _v = new Vec3(), _j = new Vec3();
const _t = new Vec3(), _u = new Vec3(), _w = new Vec3();
const _old = new Vec3(), _oldA = new Vec3();
const _m2 = new Mat3();

/** K = invM1 + invM2 − skew(r1)·I1⁻¹·skew(r1) − skew(r2)·I2⁻¹·skew(r2) */
function effectiveMassMatrix(bodyA, bodyB, rA, rB, out) {
  const e = out.e;
  const im = bodyA.invMass + bodyB.invMass;
  e[0] = im; e[1] = 0; e[2] = 0;
  e[3] = 0; e[4] = im; e[5] = 0;
  e[6] = 0; e[7] = 0; e[8] = im;

  addSkewTerm(bodyA.invInertiaWorld, rA, out);
  addSkewTerm(bodyB.invInertiaWorld, rB, out);
  return out;
}

/**
 * out += Sᵀ·I·S where S = skew(r). Column j is −r × (I · (r × eⱼ)), which
 * evaluates without building or multiplying any matrices.
 */
function addSkewTerm(I, r, out) {
  const o = out.e;
  for (let j = 0; j < 3; j++) {
    // S·eⱼ = r × eⱼ
    _sa.set(
      j === 1 ? -r.z : j === 2 ? r.y : 0,
      j === 0 ? r.z : j === 2 ? -r.x : 0,
      j === 0 ? -r.y : j === 1 ? r.x : 0,
    );
    I.transform(_sa, _sb);
    // Sᵀ·_sb = −r × _sb
    o[j * 3] += -(r.y * _sb.z - r.z * _sb.y);
    o[j * 3 + 1] += -(r.z * _sb.x - r.x * _sb.z);
    o[j * 3 + 2] += -(r.x * _sb.y - r.y * _sb.x);
  }
}

const _sa = new Vec3(), _sb = new Vec3();

function solve3(m, b, out) {
  const inv = _m2.copy(m).invert();
  return inv.transform(b, out);
}

/* ══════════════════════════════════════════════════ ball-and-socket ══ */

/** Locks two points together — the backbone of chains and wrecking balls. */
export class PointConstraint {
  constructor(bodyA, bodyB, localA, localB, opts = {}) {
    this.a = bodyA; this.b = bodyB;
    this.localA = localA.clone();
    this.localB = localB.clone();
    this.impulse = new Vec3();
    this.mass = new Mat3();
    this.maxForce = opts.maxForce ?? Infinity;
    this.enabled = true;
    this.broken = false;
    this.breakImpulse = opts.breakImpulse ?? Infinity;
  }

  preStep(dt, warm) {
    const a = this.a, b = this.b;
    _r1.copy(this.localA).applyQuat(a.quat);
    _r2.copy(this.localB).applyQuat(b.quat);
    this.rA = this.rA || new Vec3();
    this.rB = this.rB || new Vec3();
    this.rA.copy(_r1); this.rB.copy(_r2);

    effectiveMassMatrix(a, b, _r1, _r2, this.mass);

    if (warm) {
      applyPair(a, b, this.impulse, _r1, _r2);
    } else {
      this.impulse.zero();
    }
    this.maxImpulse = this.maxForce * dt;
  }

  solveVelocity() {
    const a = this.a, b = this.b;
    relativeVelocity(a, b, this.rA, this.rB, _v);
    solve3(this.mass, _v.neg(), _j);

    _old.copy(this.impulse);
    this.impulse.add(_j);
    if (this.impulse.lenSq() > this.maxImpulse * this.maxImpulse) {
      this.impulse.clampLength(this.maxImpulse);
    }
    if (this.impulse.lenSq() > this.breakImpulse * this.breakImpulse) {
      this.broken = true;
      this.enabled = false;
      return;
    }
    _j.setSub(this.impulse, _old);
    applyPair(a, b, _j, this.rA, this.rB);
  }

  /**
   * Positional drift removal, run in the pseudo-velocity pass. `rate` is
   * already beta/dt, since pseudo velocities are integrated over one dt.
   */
  solvePosition(rate) {
    const a = this.a, b = this.b;
    a.localToWorld(this.localA, _u);
    b.localToWorld(this.localB, _w);
    _v.setSub(_w, _u);
    const err = _v.len();
    if (err < 1e-5) return err;

    // B must move *toward* A, so the corrective impulse opposes the error.
    _v.scale(-rate);
    solve3(this.mass, _v, _j);
    applyPseudoPair(a, b, _j, this.rA, this.rB);
    return err;
  }
}

/* ═════════════════════════════════════════════════════════ distance ══ */

/** Fixed or ranged distance — rope links, springs, tethers. */
export class DistanceConstraint {
  constructor(bodyA, bodyB, localA, localB, opts = {}) {
    this.a = bodyA; this.b = bodyB;
    this.localA = localA.clone();
    this.localB = localB.clone();

    const pa = bodyA.localToWorld(this.localA, new Vec3());
    const pb = bodyB.localToWorld(this.localB, new Vec3());
    this.length = opts.length ?? pa.dist(pb);
    this.minLength = opts.minLength ?? this.length;
    this.maxLength = opts.maxLength ?? this.length;

    this.stiffness = opts.stiffness ?? 1;     // 0..1 — soft rope vs steel rod
    this.impulse = 0;
    this.rA = new Vec3(); this.rB = new Vec3();
    this.axis = new Vec3(0, 1, 0);
    this.mass = 0;
    this.enabled = true;
  }

  preStep(dt, warm) {
    const a = this.a, b = this.b;
    this.rA.copy(this.localA).applyQuat(a.quat);
    this.rB.copy(this.localB).applyQuat(b.quat);

    _u.copy(a.pos).add(this.rA);
    _w.copy(b.pos).add(this.rB);
    this.axis.setSub(_w, _u);
    const d = this.axis.len();
    this.curLength = d;
    if (d > EPS) this.axis.scale(1 / d); else this.axis.set(0, 1, 0);

    // Which limit (if any) is active this step?
    this.lower = d < this.minLength;
    this.upper = d > this.maxLength;
    this.slack = !this.lower && !this.upper;

    const crossA = cross3(this.rA, this.axis);
    const crossB = cross3(this.rB, this.axis);
    a.invInertiaWorld.transform(crossA, _t);
    b.invInertiaWorld.transform(crossB, _v);
    const k = a.invMass + b.invMass + dot3(crossA, _t) + dot3(crossB, _v);
    this.mass = k > EPS ? 1 / k : 0;

    // Baumgarte term folded into the velocity target — a rope that has gone
    // taut this frame should also pull the overshoot back out.
    const err = this.upper ? d - this.maxLength : this.lower ? d - this.minLength : 0;
    this.bias = (0.2 / dt) * clamp(err, -0.4, 0.4) * this.stiffness;

    if (warm && !this.slack) {
      _j.setScale(this.axis, this.impulse);
      applyPair(a, b, _j, this.rA, this.rB);
    } else {
      this.impulse = 0;
    }
  }

  solveVelocity() {
    if (this.slack) return;
    const a = this.a, b = this.b;
    relativeVelocity(a, b, this.rA, this.rB, _v);
    const vn = dot3(_v, this.axis);

    let lambda = -this.mass * (vn + this.bias) * this.stiffness;
    const old = this.impulse;
    this.impulse += lambda;
    // A taut rope can only pull; a compressed one can only push.
    if (this.upper && this.impulse > 0) this.impulse = 0;
    if (this.lower && this.impulse < 0) this.impulse = 0;
    lambda = this.impulse - old;

    _j.setScale(this.axis, lambda);
    applyPair(a, b, _j, this.rA, this.rB);
  }

  solvePosition() { return 0; }
}

/* ════════════════════════════════════════════════════════════ hinge ══ */

/**
 * Revolute joint: locks the anchor points together and kills the two angular
 * DOFs perpendicular to the hinge axis. Used by the seesaw and the swing gate.
 */
export class HingeConstraint {
  constructor(bodyA, bodyB, localA, localB, axisA, opts = {}) {
    this.a = bodyA; this.b = bodyB;
    this.localA = localA.clone();
    this.localB = localB.clone();
    this.axisA = axisA.clone().normalize();
    // Same axis expressed in B's frame at bind time.
    this.axisB = axisA.clone().applyQuat(bodyA.quat).applyQuatInv(bodyB.quat).normalize();

    this.point = new PointConstraint(bodyA, bodyB, localA, localB);
    this.angImpulse = new Vec3();     // only x,y components used
    this.angMass = new Mat3();
    this.motorSpeed = opts.motorSpeed ?? 0;
    this.maxMotorTorque = opts.maxMotorTorque ?? 0;
    this.motorImpulse = 0;
    this.enabled = true;
  }

  preStep(dt, warm) {
    this.point.preStep(dt, warm);

    const a = this.a, b = this.b;
    this.worldAxisA = (this.worldAxisA || new Vec3()).copy(this.axisA).applyQuat(a.quat);
    this.worldAxisB = (this.worldAxisB || new Vec3()).copy(this.axisB).applyQuat(b.quat);

    // Two directions perpendicular to the hinge — the DOFs we cancel.
    this.t1 = this.t1 || new Vec3();
    this.t2 = this.t2 || new Vec3();
    orthoPair(this.worldAxisA, this.t1, this.t2);

    const Ia = a.invInertiaWorld, Ib = b.invInertiaWorld;
    Ia.transform(this.t1, _u); Ib.transform(this.t1, _w);
    this.k11 = dot3(this.t1, _u) + dot3(this.t1, _w);
    Ia.transform(this.t2, _u); Ib.transform(this.t2, _w);
    this.k22 = dot3(this.t2, _u) + dot3(this.t2, _w);
    this.k11 = this.k11 > EPS ? 1 / this.k11 : 0;
    this.k22 = this.k22 > EPS ? 1 / this.k22 : 0;

    // Error in the axis alignment, corrected softly through velocity.
    _v.setCross(this.worldAxisA, this.worldAxisB);
    this.bias1 = -(0.2 / dt) * dot3(_v, this.t1);
    this.bias2 = -(0.2 / dt) * dot3(_v, this.t2);

    if (!warm) this.angImpulse.zero();

    Ia.transform(this.worldAxisA, _u);
    Ib.transform(this.worldAxisA, _w);
    const km = dot3(this.worldAxisA, _u) + dot3(this.worldAxisA, _w);
    this.motorMass = km > EPS ? 1 / km : 0;
    this.maxMotorImpulse = this.maxMotorTorque * dt;
    if (!warm) this.motorImpulse = 0;
  }

  solveVelocity() {
    const a = this.a, b = this.b;
    _v.setSub(b.angVel, a.angVel);

    if (this.maxMotorTorque > 0) {
      const cur = dot3(_v, this.worldAxisA);
      let lambda = this.motorMass * (this.motorSpeed - cur);
      const old = this.motorImpulse;
      this.motorImpulse = clamp(old + lambda, -this.maxMotorImpulse, this.maxMotorImpulse);
      lambda = this.motorImpulse - old;
      _j.setScale(this.worldAxisA, lambda);
      applyAngularPair(a, b, _j);
      _v.setSub(b.angVel, a.angVel);
    }

    const l1 = -this.k11 * (dot3(_v, this.t1) + this.bias1);
    const l2 = -this.k22 * (dot3(_v, this.t2) + this.bias2);
    _j.setScale(this.t1, l1).addScaled(this.t2, l2);
    applyAngularPair(a, b, _j);

    this.point.solveVelocity();
  }

  solvePosition(rate) { return this.point.solvePosition(rate); }
}

/* ═════════════════════════════════════════════════════════════ grab ══ */

/**
 * Soft point-to-world-target constraint — the telekinesis beam. Modelled as a
 * spring-damper solved implicitly (soft constraint), so it stays stable even
 * when you fling a 200 kg monolith around.
 */
export class GrabConstraint {
  constructor(body, worldPoint, opts = {}) {
    this.body = body;
    this.local = body.worldToLocal(worldPoint, new Vec3());
    this.target = worldPoint.clone();
    this.frequency = opts.frequency ?? 5;
    this.damping = opts.damping ?? 0.8;
    this.maxForce = opts.maxForce ?? 4000;
    this.impulse = new Vec3();
    this.mass = new Mat3();
    this.rA = new Vec3();
    this.enabled = true;

    // Optional angular spring, so a grabbed slab holds its facing.
    this.targetQuat = opts.targetQuat ? opts.targetQuat.clone() : null;
    this.angFrequency = opts.angFrequency ?? 3;
    this.angDamping = opts.angDamping ?? 0.9;
    this.angImpulse = new Vec3();
  }

  setTarget(p) { this.target.copy(p); return this; }

  preStep(dt) {
    const b = this.body;
    b.wake();
    this.rA.copy(this.local).applyQuat(b.quat);

    const omega = 2 * Math.PI * this.frequency;
    const m = b.mass;
    const k = m * omega * omega;
    const c = 2 * m * this.damping * omega;
    this.gamma = 1 / (dt * (c + dt * k));
    if (!Number.isFinite(this.gamma)) this.gamma = 0;
    const beta = dt * k * this.gamma;

    b.localToWorld(this.local, _u);
    _v.setSub(_u, this.target).scale(beta);
    this.biasVec = (this.biasVec || new Vec3()).copy(_v);

    effectiveMassMatrix(b, ZERO_BODY, this.rA, ZERO_VEC, this.mass);
    const e = this.mass.e;
    e[0] += this.gamma; e[4] += this.gamma; e[8] += this.gamma;

    this.maxImpulse = this.maxForce * dt;

    // Warm start.
    b.vel.addScaled(this.impulse, b.invMass);
    _t.setCross(this.rA, this.impulse);
    b.invInertiaWorld.transform(_t, _t);
    b.angVel.add(_t);

    if (this.targetQuat) {
      const aOmega = 2 * Math.PI * this.angFrequency;
      const ak = aOmega * aOmega;
      const ac = 2 * this.angDamping * aOmega;
      this.angGamma = 1 / (dt * (ac + dt * ak));
      const abeta = dt * ak * this.angGamma;
      // Small-angle error vector from the relative quaternion.
      _q.copy(this.targetQuat).mul(conjugateOf(b.quat, _q2));
      if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
      this.angBias = (this.angBias || new Vec3()).set(-_q.x * 2, -_q.y * 2, -_q.z * 2).scale(abeta);
      this.angMassM = (this.angMassM || new Mat3()).copy(b.invInertiaWorld).invert();
    }
  }

  solveVelocity() {
    const b = this.body;
    _v.setCross(b.angVel, this.rA).add(b.vel);
    _v.add(this.biasVec).addScaled(this.impulse, this.gamma).neg();

    solve3(this.mass, _v, _j);
    _old.copy(this.impulse);
    this.impulse.add(_j);
    this.impulse.clampLength(this.maxImpulse);
    _j.setSub(this.impulse, _old);

    b.vel.addScaled(_j, b.invMass);
    _t.setCross(this.rA, _j);
    b.invInertiaWorld.transform(_t, _t);
    b.angVel.add(_t);

    if (this.targetQuat) {
      _v.copy(b.angVel).add(this.angBias).addScaled(this.angImpulse, this.angGamma).neg();
      this.angMassM.transform(_v, _j);
      _oldA.copy(this.angImpulse);
      this.angImpulse.add(_j);
      this.angImpulse.clampLength(this.maxImpulse * 0.5);
      _j.setSub(this.angImpulse, _oldA);
      b.invInertiaWorld.transform(_j, _j);
      b.angVel.add(_j);
    }
  }

  solvePosition() { return 0; }
}

const _q = new Quat(), _q2 = new Quat();
const ZERO_VEC = new Vec3();
const ZERO_BODY = {
  invMass: 0,
  invInertiaWorld: new Mat3().setDiagonal(0, 0, 0),
};

function conjugateOf(q, out) {
  return out.set(-q.x, -q.y, -q.z, q.w);
}

/* ══════════════════════════════════════════════════════════ helpers ══ */

export function relativeVelocity(a, b, rA, rB, out) {
  out.setCross(b.angVel, rB).add(b.vel);
  _t.setCross(a.angVel, rA).add(a.vel);
  return out.sub(_t);
}

export function applyPair(a, b, impulse, rA, rB) {
  if (a.invMass > 0) {
    a.vel.subScaled(impulse, a.invMass);
    _t.setCross(rA, impulse);
    a.invInertiaWorld.transform(_t, _t);
    a.angVel.sub(_t);
  }
  if (b.invMass > 0) {
    b.vel.addScaled(impulse, b.invMass);
    _t.setCross(rB, impulse);
    b.invInertiaWorld.transform(_t, _t);
    b.angVel.add(_t);
  }
}

export function applyPseudoPair(a, b, impulse, rA, rB) {
  if (a.invMass > 0) {
    a.pseudoVel.subScaled(impulse, a.invMass);
    _t.setCross(rA, impulse);
    a.invInertiaWorld.transform(_t, _t);
    a.pseudoAng.sub(_t);
  }
  if (b.invMass > 0) {
    b.pseudoVel.addScaled(impulse, b.invMass);
    _t.setCross(rB, impulse);
    b.invInertiaWorld.transform(_t, _t);
    b.pseudoAng.add(_t);
  }
}

function applyAngularPair(a, b, impulse) {
  if (a.invMass > 0) {
    a.invInertiaWorld.transform(impulse, _t);
    a.angVel.sub(_t);
  }
  if (b.invMass > 0) {
    b.invInertiaWorld.transform(impulse, _t);
    b.angVel.add(_t);
  }
}

function orthoPair(n, t1, t2) {
  const sign = n.z >= 0 ? 1 : -1;
  const a = -1 / (sign + n.z);
  const b = n.x * n.y * a;
  t1.set(1 + sign * n.x * n.x * a, sign * b, -sign * n.x);
  t2.set(b, sign + n.y * n.y * a, -n.y);
}

export { v3 };
