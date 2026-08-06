/**
 * The world: broadphase, persistent manifolds, solver, islands and sleeping.
 *
 * Solver structure mirrors the 2D engine that powers the front page, because
 * that one is proven:
 *   • friction is solved *before* the normal impulse, using the previous
 *     iteration's normal impulse as its clamp;
 *   • restitution is deferred to its own pass after the main iterations, so
 *     multi-contact impacts can't pump energy;
 *   • penetration recovery uses split impulses (pseudo velocities), never a
 *     Baumgarte term inside the normal constraint.
 *
 * Broadphase is a one-axis sweep-and-prune. The arena is wide and flat, and
 * the body array is nearly sorted between frames, so insertion sort is O(n).
 */

import { Vec3, Quat, v3, dot3, cross3, clamp, orthoBasis } from '../math.js';
import { DYNAMIC, STATIC } from './body.js';
import { Manifold, collide, raycastBody } from './collide.js';

export const PENETRATION_SLOP = 0.005;
export const POSITION_BETA = 0.22;
export const MAX_LINEAR_CORRECTION = 4;
/** Below this approach speed a collision is treated as inelastic. */
export const BOUNCE_THRESHOLD = 1.1;
const SLEEP_LINEAR = 0.16;
const SLEEP_ANGULAR = 0.22;
const SLEEP_TIME = 0.65;
/** Warm-start anchors this close (squared) are considered the same feature. */
const WARM_MATCH_DIST2 = 0.0025;

const _n = new Vec3(), _t1 = new Vec3(), _t2 = new Vec3();
const _rv = new Vec3(), _j = new Vec3(), _tmp = new Vec3(), _tmp2 = new Vec3();
const _wa = new Vec3(), _wb = new Vec3();

export class World {
  constructor(opts = {}) {
    this.gravity = opts.gravity ? opts.gravity.clone() : v3(0, -26, 0);
    this.bodies = [];
    this.constraints = [];
    this.manifolds = new Map();     // pairKey → Manifold
    this.velocityIterations = opts.velocityIterations ?? 8;
    this.positionIterations = opts.positionIterations ?? 3;
    this.restitutionIterations = opts.restitutionIterations ?? 2;
    this.allowSleep = opts.allowSleep !== false;

    this._sorted = [];              // SAP order
    this._pairs = [];
    this._pairCount = 0;
    this._active = [];              // manifolds worth solving this step
    this._stamp = 0;
    this._free = [];                // manifold pool

    this.onImpact = null;           // (bodyA, bodyB, speed, point) => void
    this.onSensor = null;           // (sensorBody, otherBody) => void

    this.stats = { pairs: 0, manifolds: 0, contacts: 0, awake: 0, ms: 0 };
  }

  add(body) {
    this.bodies.push(body);
    this._sorted.push(body);
    return body;
  }

  remove(body) {
    let i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    i = this._sorted.indexOf(body);
    if (i >= 0) this._sorted.splice(i, 1);
    for (const [k, m] of this.manifolds) {
      if (m.a === body || m.b === body) { this._free.push(m); this.manifolds.delete(k); }
    }
    this.constraints = this.constraints.filter((c) => c.a !== body && c.b !== body && c.body !== body);
    return this;
  }

  addConstraint(c) { this.constraints.push(c); return c; }

  removeConstraint(c) {
    const i = this.constraints.indexOf(c);
    if (i >= 0) this.constraints.splice(i, 1);
    return this;
  }

  clear() {
    this.bodies.length = 0;
    this._sorted.length = 0;
    this.constraints.length = 0;
    this.manifolds.clear();
    this._free.length = 0;
  }

  /* ──────────────────────────────────────────────────────────── step ── */

  step(dt) {
    const t0 = now();
    this._stamp++;

    this.integrateVelocities(dt);
    this.broadphase();
    this.narrowphase();
    this.prepare(dt);

    for (let i = 0; i < this.velocityIterations; i++) {
      this.solveVelocity();
      // Alternate the sweep direction. Gauss–Seidel propagates information one
      // link per iteration in whichever order you visit, so a chain converges
      // roughly twice as fast when every other pass runs anchor-to-tip.
      const cs = this.constraints;
      if (i & 1) { for (let k = cs.length - 1; k >= 0; k--) if (cs[k].enabled !== false) cs[k].solveVelocity(); }
      else { for (let k = 0; k < cs.length; k++) if (cs[k].enabled !== false) cs[k].solveVelocity(); }
    }
    // Freeze the warm-start value before restitution inflates the accumulator.
    for (const m of this._active) {
      for (let i = 0; i < m.count; i++) m.points[i].warmNormal = m.points[i].normalImpulse;
    }
    this.solveRestitution();

    this.integratePositions(dt);
    this.solvePositions(dt);

    if (this.allowSleep) this.updateSleep(dt);

    this.stats.ms = now() - t0;
    this.stats.manifolds = this._active.length;
  }

  integrateVelocities(dt) {
    const g = this.gravity;
    let awake = 0;
    for (const b of this.bodies) {
      if (b.type !== DYNAMIC || b.sleeping || !b.enabled) continue;
      awake++;
      b.vel.x += (g.x * b.gravityScale + b.force.x * b.invMass) * dt;
      b.vel.y += (g.y * b.gravityScale + b.force.y * b.invMass) * dt;
      b.vel.z += (g.z * b.gravityScale + b.force.z * b.invMass) * dt;

      b.invInertiaWorld.transform(b.torque, _tmp);
      b.angVel.addScaled(_tmp, dt);

      // Exponential damping — frame-rate independent, unlike (1 − k·dt).
      const ld = Math.exp(-b.linearDamping * dt);
      const ad = Math.exp(-b.angularDamping * dt);
      b.vel.scale(ld);
      b.angVel.scale(ad);

      b.force.zero();
      b.torque.zero();
      b.updateAABB();
    }
    this.stats.awake = awake;
  }

  /* ─────────────────────────────────────────────────────── broadphase ── */

  broadphase() {
    const arr = this._sorted;
    // Insertion sort by min.x — near-sorted between frames, so this is ~O(n).
    for (let i = 1; i < arr.length; i++) {
      const b = arr[i];
      const key = b.aabbMin.x;
      let j = i - 1;
      while (j >= 0 && arr[j].aabbMin.x > key) { arr[j + 1] = arr[j]; j--; }
      arr[j + 1] = b;
    }

    this._pairCount = 0;
    const pairs = this._pairs;

    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (!a.enabled) continue;
      const aMaxX = a.aabbMax.x;

      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.aabbMin.x > aMaxX) break;         // sweep past the end of A
        if (!b.enabled) continue;
        if (!canCollide(a, b)) continue;
        if (a.aabbMin.y > b.aabbMax.y || b.aabbMin.y > a.aabbMax.y) continue;
        if (a.aabbMin.z > b.aabbMax.z || b.aabbMin.z > a.aabbMax.z) continue;

        const p = pairs[this._pairCount] || (pairs[this._pairCount] = { a: null, b: null });
        p.a = a; p.b = b;
        this._pairCount++;
      }
    }
    this.stats.pairs = this._pairCount;
  }

  /* ─────────────────────────────────────────────────────── narrowphase ── */

  narrowphase() {
    const active = this._active;
    active.length = 0;
    const stamp = this._stamp;

    for (let i = 0; i < this._pairCount; i++) {
      const pair = this._pairs[i];
      // Always feed the narrowphase in id order. The broadphase hands pairs
      // over in sweep order, which flips whenever two jittering boxes cross on
      // x — and a flipped reference body invalidates every warm-start impulse,
      // which is exactly how a perfectly aligned stack walks itself apart.
      const a = pair.a.id < pair.b.id ? pair.a : pair.b;
      const b = pair.a.id < pair.b.id ? pair.b : pair.a;
      const key = a.id * 1048576 + b.id;
      let m = this.manifolds.get(key);

      const bothIdle = !isAwake(a) && !isAwake(b);
      if (bothIdle && m) {
        // Nothing has moved — keep the manifold (and its warm-start impulses)
        // alive without re-running SAT, but don't waste solver time on it.
        m.stamp = stamp;
        continue;
      }
      if (bothIdle) continue;

      const fresh = _scratchManifold;
      fresh.count = 0;
      const hit = collide(a, b, fresh);

      if (!hit) {
        if (m) { this._free.push(m); this.manifolds.delete(key); }
        continue;
      }

      if (a.isSensor || b.isSensor) {
        if (this.onSensor) this.onSensor(a.isSensor ? a : b, a.isSensor ? b : a);
        continue;
      }

      if (!m) {
        m = this._free.pop() || new Manifold();
        m.fresh = true;
        for (const p of m.points) {
          p.normalImpulse = 0; p.warmNormal = 0; p.warmStarted = false;
          p.tangentImpulse1 = 0; p.tangentImpulse2 = 0;
        }
        this.manifolds.set(key, m);
        // Only a *new* contact wakes bodies. Persistent ones must not, or
        // nothing in a settled pile would ever fall asleep.
        a.wake(); b.wake();
      } else {
        m.fresh = false;
      }

      transferManifold(fresh, m);
      m.friction = Math.sqrt(a.friction * b.friction);
      m.restitution = Math.max(a.restitution, b.restitution);
      m.rollingFriction = Math.max(a.rollingFriction, b.rollingFriction);
      m.rollingImpulse = 0;
      m.stamp = stamp;
      active.push(m);
    }

    // Drop manifolds whose pair left the broadphase entirely.
    if ((stamp & 15) === 0) {
      for (const [k, m] of this.manifolds) {
        if (m.stamp !== stamp && m.stamp < stamp - 2) {
          this._free.push(m);
          this.manifolds.delete(k);
        }
      }
    }
  }

  /* ───────────────────────────────────────────────────────── solver ── */

  prepare(dt) {
    const invDt = 1 / dt;
    let contacts = 0;

    for (const m of this._active) {
      const a = m.a, b = m.b;
      _n.copy(m.normal);
      orthoBasis(_n, _t1, _t2);
      m.tangent1.copy(_t1);
      m.tangent2.copy(_t2);
      let anyTouching = false;
      let peakApproach = 0;

      for (let i = 0; i < m.count; i++) {
        const c = m.points[i];
        contacts++;

        a.localToWorld(c.localA, _wa);
        b.localToWorld(c.localB, _wb);
        c.rA.setSub(_wa, a.pos);
        c.rB.setSub(_wb, b.pos);

        c.normalMass = effMass(a, b, c.rA, c.rB, _n);
        c.tangentMass1 = effMass(a, b, c.rA, c.rB, _t1);
        c.tangentMass2 = effMass(a, b, c.rA, c.rB, _t2);

        c.sep0 = -c.depth;

        relVel(a, b, c.rA, c.rB, _rv);
        c.relN0 = dot3(_rv, _n);
        if (c.depth > 0) anyTouching = true;
        if (-c.relN0 > peakApproach) peakApproach = -c.relN0;

        // Speculative margin. The constraint is vn ≥ −separation/dt: a pair
        // that still has a gap may keep approaching, but only fast enough to
        // exactly close it this step. That stops fast bodies tunnelling into a
        // stack without ever pushing a resting pair apart.
        c.speculativeBias = c.sep0 > 0 ? c.sep0 * invDt : 0;

        // Warm start.
        c.normalImpulse = c.warmNormal;
        _j.setScale(_n, c.warmNormal)
          .addScaled(_t1, c.tangentImpulse1)
          .addScaled(_t2, c.tangentImpulse2);
        applyImpulsePair(a, b, _j, c.rA, c.rB);
        c.pseudoImpulse = 0;
      }

      m.touching = anyTouching;
      if (m.fresh && this.onImpact && peakApproach > BOUNCE_THRESHOLD) {
        this.onImpact(a, b, peakApproach, m.points[0].point);
      }
    }

    for (const c of this.constraints) {
      if (c.enabled === false) continue;
      c.preStep(dt, true);
    }
    this.stats.contacts = contacts;
  }

  solveVelocity() {
    for (const m of this._active) {
      const a = m.a, b = m.b;
      _n.copy(m.normal); _t1.copy(m.tangent1); _t2.copy(m.tangent2);
      const mu = m.friction;

      // ── friction first, clamped against last iteration's normal impulse.
      for (let i = 0; i < m.count; i++) {
        const c = m.points[i];
        const maxF = mu * c.normalImpulse;
        if (maxF <= 0) { c.tangentImpulse1 = 0; c.tangentImpulse2 = 0; continue; }

        relVel(a, b, c.rA, c.rB, _rv);
        let l1 = -dot3(_rv, _t1) * c.tangentMass1;
        let l2 = -dot3(_rv, _t2) * c.tangentMass2;

        let n1 = c.tangentImpulse1 + l1;
        let n2 = c.tangentImpulse2 + l2;
        // Clamp the 2D friction vector to the cone, not each axis separately.
        const len = Math.hypot(n1, n2);
        if (len > maxF) { const s = maxF / len; n1 *= s; n2 *= s; }
        l1 = n1 - c.tangentImpulse1;
        l2 = n2 - c.tangentImpulse2;
        c.tangentImpulse1 = n1;
        c.tangentImpulse2 = n2;

        _j.setScale(_t1, l1).addScaled(_t2, l2);
        applyImpulsePair(a, b, _j, c.rA, c.rB);
      }

      // ── normal, solved for vn = 0 (no bias — restitution comes later).
      for (let i = 0; i < m.count; i++) {
        const c = m.points[i];
        relVel(a, b, c.rA, c.rB, _rv);
        const vn = dot3(_rv, _n);

        let lambda = -(vn + c.speculativeBias) * c.normalMass;
        const old = c.normalImpulse;
        c.normalImpulse = Math.max(old + lambda, 0);
        lambda = c.normalImpulse - old;

        _j.setScale(_n, lambda);
        applyImpulsePair(a, b, _j, c.rA, c.rB);
      }

      // ── rolling resistance: an angular-only impulse opposing relative spin,
      // budgeted from the normal impulse just like Coulomb friction. This is
      // what lets a ball on a flat floor eventually stop.
      if (m.rollingFriction > 0) {
        let totalN = 0;
        for (let i = 0; i < m.count; i++) totalN += m.points[i].normalImpulse;
        if (totalN > 0) {
          _rv.copy(a.angVel).sub(b.angVel);
          const spin = _rv.len();
          if (spin > 1e-5) {
            _t1.setScale(_rv, 1 / spin);
            a.invInertiaWorld.transform(_t1, _j);
            let denom = dot3(_t1, _j);
            b.invInertiaWorld.transform(_t1, _j);
            denom += dot3(_t1, _j);
            if (denom > 1e-9) {
              // Use the smallest *moving* radius: the static floor's bounding
              // radius is half the arena and would blow the budget wide open.
              let radius = Infinity;
              if (a.invMass > 0) radius = Math.min(radius, a.shape.boundingRadius);
              if (b.invMass > 0) radius = Math.min(radius, b.shape.boundingRadius);
              if (!isFinite(radius)) radius = 1;
              const maxR = m.rollingFriction * totalN * radius;
              let lambda = -spin / denom;
              const old = m.rollingImpulse;
              let acc = old + lambda;
              if (acc < -maxR) acc = -maxR; else if (acc > maxR) acc = maxR;
              lambda = acc - old;
              m.rollingImpulse = acc;
              _j.setScale(_t1, lambda);
              a.invInertiaWorld.transform(_j, _rv);
              a.angVel.add(_rv);
              b.invInertiaWorld.transform(_j, _rv);
              b.angVel.sub(_rv);
            }
          }
        }
      }
    }
  }

  /**
   * Deferred restitution. Only points that were approaching fast enough at
   * pre-step get a bounce, and each pass is clamped against the accumulated
   * normal impulse so we can never pull bodies together.
   */
  solveRestitution() {
    for (let pass = 0; pass < this.restitutionIterations; pass++) {
      for (const m of this._active) {
        if (m.restitution <= 0) continue;
        const a = m.a, b = m.b;
        _n.copy(m.normal);

        for (let i = 0; i < m.count; i++) {
          const c = m.points[i];
          if (c.relN0 > -BOUNCE_THRESHOLD || c.normalImpulse === 0) continue;
          // Only bounce on impact, never on a contact that was already
          // carrying load last step. A resting stack always has a little
          // solver residue in its approach velocities, and letting that
          // residue bounce is a slow-motion explosion.
          if (!m.fresh && c.warmStarted) continue;

          relVel(a, b, c.rA, c.rB, _rv);
          const vn = dot3(_rv, _n);
          let lambda = -c.normalMass * (vn + m.restitution * c.relN0);
          const old = c.normalImpulse;
          c.normalImpulse = Math.max(old + lambda, 0);
          lambda = c.normalImpulse - old;

          _j.setScale(_n, lambda);
          applyImpulsePair(a, b, _j, c.rA, c.rB);
        }
      }
    }
  }

  integratePositions(dt) {
    for (const b of this.bodies) {
      if (b.type !== DYNAMIC || b.sleeping || !b.enabled) continue;

      // Guard against a NaN escaping the solver and poisoning the world.
      if (!b.vel.isFinite() || !b.angVel.isFinite()) { b.vel.zero(); b.angVel.zero(); }

      const speed = b.vel.len();
      const maxStep = b.shape.boundingRadius * 1.5;
      if (speed * dt > maxStep) b.vel.scale(maxStep / (speed * dt));

      const spin = b.angVel.len();
      if (spin > 60) b.angVel.scale(60 / spin);

      b.pos.addScaled(b.vel, dt);
      b.quat.integrate(b.angVel, dt);
      b.updateInertiaWorld();
      b.updateAABB();
    }
  }

  /** Split-impulse pass: pseudo velocities only, then folded into positions. */
  solvePositions(dt) {
    for (let iter = 0; iter < this.positionIterations; iter++) {
      for (const m of this._active) {
        const a = m.a, b = m.b;
        _n.copy(m.normal);

        for (let i = 0; i < m.count; i++) {
          const c = m.points[i];
          const pen = -c.sep0 - PENETRATION_SLOP;
          if (pen <= 0) continue;

          const bias = clamp(POSITION_BETA * pen, 0, MAX_LINEAR_CORRECTION) / dt;

          _rv.setCross(b.pseudoAng, c.rB).add(b.pseudoVel);
          _tmp.setCross(a.pseudoAng, c.rA).add(a.pseudoVel);
          _rv.sub(_tmp);

          let lambda = (bias - dot3(_rv, _n)) * c.normalMass;
          const old = c.pseudoImpulse;
          c.pseudoImpulse = Math.max(old + lambda, 0);
          lambda = c.pseudoImpulse - old;

          _j.setScale(_n, lambda);
          applyPseudoPair(a, b, _j, c.rA, c.rB);
        }
      }
      for (const c of this.constraints) {
        if (c.enabled !== false && c.solvePosition) c.solvePosition(POSITION_BETA / dt);
      }
    }

    for (const b of this.bodies) {
      if (b.type !== DYNAMIC || b.sleeping || !b.enabled) continue;
      if (b.pseudoVel.lenSq() > 0 || b.pseudoAng.lenSq() > 0) {
        b.pos.addScaled(b.pseudoVel, dt);
        b.quat.integrate(b.pseudoAng, dt);
        b.pseudoVel.zero();
        b.pseudoAng.zero();
        b.updateInertiaWorld();
        b.updateAABB();
      }
    }
  }

  /* ────────────────────────────────────────────────── islands + sleep ── */

  /**
   * Union-find over contacts and constraints, then sleep an island only when
   * *every* body in it has been slow for long enough. Per-body sleeping looks
   * fine until one box in a stack nods off and the rest sink through it.
   */
  updateSleep(dt) {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) bodies[i].island = i;

    const find = (i) => {
      let r = i;
      while (bodies[r].island !== r) r = bodies[r].island;
      while (bodies[i].island !== r) { const nx = bodies[i].island; bodies[i].island = r; i = nx; }
      return r;
    };
    const index = new Map();
    for (let i = 0; i < bodies.length; i++) index.set(bodies[i], i);

    const union = (x, y) => {
      const rx = find(x), ry = find(y);
      if (rx !== ry) bodies[rx].island = ry;
    };

    for (const m of this._active) {
      if (m.a.type !== DYNAMIC || m.b.type !== DYNAMIC) continue;
      const ia = index.get(m.a), ib = index.get(m.b);
      if (ia !== undefined && ib !== undefined) union(ia, ib);
    }
    for (const c of this.constraints) {
      if (c.enabled === false) continue;
      const a = c.a || c.body, b = c.b;
      if (!a || !b || a.type !== DYNAMIC || b.type !== DYNAMIC) continue;
      const ia = index.get(a), ib = index.get(b);
      if (ia !== undefined && ib !== undefined) union(ia, ib);
    }

    // Slowest common denominator: an island's timer is its least sleepy body.
    const timers = new Map();
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.type !== DYNAMIC || !b.enabled) continue;
      if (!b.allowSleep) { timers.set(find(i), -1); continue; }

      const slow = b.vel.lenSq() < SLEEP_LINEAR * SLEEP_LINEAR
                && b.angVel.lenSq() < SLEEP_ANGULAR * SLEEP_ANGULAR;
      b.sleepTimer = slow ? b.sleepTimer + dt : 0;

      const root = find(i);
      const cur = timers.get(root);
      if (cur === undefined) timers.set(root, b.sleepTimer);
      else if (cur >= 0) timers.set(root, Math.min(cur, b.sleepTimer));
    }

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.type !== DYNAMIC || !b.enabled) continue;
      const t = timers.get(find(i));
      if (t !== undefined && t >= SLEEP_TIME) b.sleep();
      else if (b.sleeping && (t === undefined || t < SLEEP_TIME)) b.wake();
    }
  }

  /* ───────────────────────────────────────────────────────── queries ── */

  /**
   * Closest hit along a ray. `filter` gets each body and returns false to skip.
   * @returns {{body, distance, point, normal}|null}
   */
  raycast(origin, dir, maxDist = 1000, filter = null) {
    let best = null, bestT = maxDist;
    const normal = new Vec3();
    for (const b of this.bodies) {
      if (!b.enabled || b.isSensor) continue;
      if (filter && !filter(b)) continue;

      // Cheap sphere reject before the real test.
      _tmp.setSub(b.pos, origin);
      const along = dot3(_tmp, dir);
      const r = b.shape.boundingRadius;
      if (along < -r || along - r > bestT) continue;
      if (_tmp.lenSq() - along * along > r * r) continue;

      const t = raycastBody(b, origin, dir, bestT, normal);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = best || { body: null, distance: 0, point: new Vec3(), normal: new Vec3() };
        best.body = b;
        best.distance = t;
        best.point.copy(origin).addScaled(dir, t);
        best.normal.copy(normal);
      }
    }
    return best;
  }

  /** Every body whose bounding sphere overlaps the given sphere. */
  querySphere(center, radius, out = []) {
    const r2 = radius;
    for (const b of this.bodies) {
      if (!b.enabled) continue;
      const d = b.pos.dist(center) - b.shape.boundingRadius;
      if (d <= r2) out.push(b);
    }
    return out;
  }

  /** Radial impulse with linear falloff — the shockwave. */
  explode(center, radius, strength, opts = {}) {
    const upBias = opts.upBias ?? 0.35;
    const hits = [];
    for (const b of this.bodies) {
      if (b.type !== DYNAMIC || !b.enabled) continue;
      _tmp.setSub(b.pos, center);
      const d = _tmp.len();
      if (d > radius) continue;
      const falloff = 1 - d / radius;
      if (d > 1e-3) _tmp.scale(1 / d); else _tmp.set(0, 1, 0);
      _tmp.y += upBias;
      _tmp.normalize().scale(strength * falloff * falloff * b.mass);
      b.wake();
      b.applyImpulse(_tmp, opts.torque === false ? null : b.pos.clone()
        .addScaled(_tmp, 0.001 / Math.max(b.mass, 1)));
      hits.push(b);
    }
    return hits;
  }
}

/* ─────────────────────────────────────────────────────────── helpers ── */

const _scratchManifold = new Manifold();

function isAwake(b) { return b.type === DYNAMIC && !b.sleeping; }

function canCollide(a, b) {
  if (a.type !== DYNAMIC && b.type !== DYNAMIC) return false;
  return (a.mask & b.group) !== 0 && (b.mask & a.group) !== 0;
}

/**
 * Copy a freshly computed manifold onto the persistent one, carrying warm-start
 * impulses across by matching anchors that barely moved. Feature ids alone
 * aren't reliable once a body starts rolling — proximity is.
 */
function transferManifold(src, dst) {
  const oldCount = dst.a === src.a && dst.b === src.b ? dst.count : 0;
  const oldPoints = _oldPoints;
  for (let i = 0; i < oldCount; i++) {
    oldPoints[i].localA.copy(dst.points[i].localA);
    oldPoints[i].n = dst.points[i].warmNormal;
    oldPoints[i].t1 = dst.points[i].tangentImpulse1;
    oldPoints[i].t2 = dst.points[i].tangentImpulse2;
    oldPoints[i].id = dst.points[i].id;
    oldPoints[i].used = false;
  }

  dst.a = src.a; dst.b = src.b;
  dst.normal.copy(src.normal);
  dst.localNormal.copy(src.localNormal);
  dst.count = src.count;

  for (let i = 0; i < src.count; i++) {
    const s = src.points[i], d = dst.points[i];
    d.point.copy(s.point);
    d.localA.copy(s.localA);
    d.localB.copy(s.localB);
    d.depth = s.depth;
    d.id = s.id;

    let bestJ = -1, bestD = WARM_MATCH_DIST2;
    for (let j = 0; j < oldCount; j++) {
      if (oldPoints[j].used) continue;
      if (oldPoints[j].id === s.id) { bestJ = j; break; }
      const dd = oldPoints[j].localA.distSq(s.localA);
      if (dd < bestD) { bestD = dd; bestJ = j; }
    }
    if (bestJ >= 0) {
      oldPoints[bestJ].used = true;
      d.warmNormal = oldPoints[bestJ].n;
      d.normalImpulse = d.warmNormal;
      d.warmStarted = d.warmNormal > 0;
      d.tangentImpulse1 = oldPoints[bestJ].t1;
      d.tangentImpulse2 = oldPoints[bestJ].t2;
    } else {
      d.warmNormal = 0;
      d.normalImpulse = 0;
      d.warmStarted = false;
      d.tangentImpulse1 = 0;
      d.tangentImpulse2 = 0;
    }
  }
}

const _oldPoints = [];
for (let i = 0; i < 4; i++) _oldPoints.push({ localA: new Vec3(), n: 0, t1: 0, t2: 0, id: 0, used: false });

function effMass(a, b, rA, rB, dir) {
  let k = a.invMass + b.invMass;
  if (a.invMass > 0) {
    _tmp.setCross(rA, dir);
    a.invInertiaWorld.transform(_tmp, _tmp2);
    _tmp2.setCross(_tmp2, rA);
    k += dot3(_tmp2, dir);
  }
  if (b.invMass > 0) {
    _tmp.setCross(rB, dir);
    b.invInertiaWorld.transform(_tmp, _tmp2);
    _tmp2.setCross(_tmp2, rB);
    k += dot3(_tmp2, dir);
  }
  return k > 1e-12 ? 1 / k : 0;
}

function relVel(a, b, rA, rB, out) {
  out.setCross(b.angVel, rB).add(b.vel);
  _tmp.setCross(a.angVel, rA).add(a.vel);
  return out.sub(_tmp);
}

function applyImpulsePair(a, b, j, rA, rB) {
  if (a.invMass > 0) {
    a.vel.subScaled(j, a.invMass);
    _tmp.setCross(rA, j);
    a.invInertiaWorld.transform(_tmp, _tmp);
    a.angVel.sub(_tmp);
  }
  if (b.invMass > 0) {
    b.vel.addScaled(j, b.invMass);
    _tmp.setCross(rB, j);
    b.invInertiaWorld.transform(_tmp, _tmp);
    b.angVel.add(_tmp);
  }
}

function applyPseudoPair(a, b, j, rA, rB) {
  if (a.invMass > 0) {
    a.pseudoVel.subScaled(j, a.invMass);
    _tmp.setCross(rA, j);
    a.invInertiaWorld.transform(_tmp, _tmp);
    a.pseudoAng.sub(_tmp);
  }
  if (b.invMass > 0) {
    b.pseudoVel.addScaled(j, b.invMass);
    _tmp.setCross(rB, j);
    b.invInertiaWorld.transform(_tmp, _tmp);
    b.pseudoAng.add(_tmp);
  }
}

const now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Date.now();

/* ────────────────────────────────────────────────────────────  runner ── */

/** Fixed-timestep accumulator with a spiral-of-death guard. */
export class Runner {
  constructor(world, opts = {}) {
    this.world = world;
    this.fixedDt = opts.fixedDt ?? 1 / 120;
    this.maxSteps = opts.maxSteps ?? 5;
    this.accumulator = 0;
    this.alpha = 0;
    this.timeScale = 1;
  }

  advance(frameDt, beforeStep) {
    const dt = Math.min(frameDt, 0.1) * this.timeScale;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSteps) {
      if (beforeStep) beforeStep(this.fixedDt);
      this.world.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
    this.alpha = this.accumulator / this.fixedDt;
    return steps;
  }
}

export { Quat, cross3, STATIC };
