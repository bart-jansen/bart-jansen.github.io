/**
 * gravity-well · a small 2D rigid body physics engine
 * ---------------------------------------------------
 * Impulse-based sequential solver with warm starting, SAT narrowphase with
 * reference/incident face clipping, spatial-hash broadphase, distance & mouse
 * joints, and body sleeping. Written from scratch, zero dependencies.
 *
 * Units are pixels; gravity is px/s².
 */

/* ------------------------------------------------------------------ math -- */

export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  clone() { return new Vec2(this.x, this.y); }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  scale(s) { this.x *= s; this.y *= s; return this; }
  neg() { this.x = -this.x; this.y = -this.y; return this; }
  dot(v) { return this.x * v.x + this.y * v.y; }
  lenSq() { return this.x * this.x + this.y * this.y; }
  len() { return Math.hypot(this.x, this.y); }
  normalize() { const l = this.len(); if (l > 1e-9) { this.x /= l; this.y /= l; } return this; }
}

export const v2 = (x, y) => new Vec2(x, y);
const sub2 = (a, b) => new Vec2(a.x - b.x, a.y - b.y);
const add2 = (a, b) => new Vec2(a.x + b.x, a.y + b.y);
const mul2 = (a, s) => new Vec2(a.x * s, a.y * s);

/** 2D scalar cross product a × b. */
const crossVV = (a, b) => a.x * b.y - a.y * b.x;
/** s × a → vector. */
const crossSV = (s, a) => new Vec2(-s * a.y, s * a.x);

/** Rotate a local vector by angle a. */
function rot(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
/** Inverse-rotate a world vector by angle a. */
function invRot(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- shapes -- */

export const CIRCLE = 0;
export const POLY = 1;

export function circleShape(radius) {
  return { type: CIRCLE, radius };
}

/** Vertices must describe a convex polygon wound counter-clockwise. */
export function polyShape(vertices) {
  let verts = vertices.map((p) => new Vec2(p.x, p.y));

  // Shift to the centroid so the mass properties below stay valid.
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i], q = verts[(i + 1) % verts.length];
    const cross = p.x * q.y - q.x * p.y;
    area += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(area) > 1e-9) {
    cx /= 3 * area; cy /= 3 * area;
    verts = verts.map((p) => new Vec2(p.x - cx, p.y - cy));
  }

  const normals = verts.map((p, i) => {
    const q = verts[(i + 1) % verts.length];
    return new Vec2(q.y - p.y, -(q.x - p.x)).normalize();
  });
  let radius = 0;
  for (const p of verts) radius = Math.max(radius, p.len());
  return { type: POLY, verts, normals, radius, centroid: new Vec2(cx, cy) };
}

export function boxShape(halfW, halfH) {
  return polyShape([
    v2(-halfW, -halfH), v2(halfW, -halfH), v2(halfW, halfH), v2(-halfW, halfH),
  ]);
}

/** Regular n-gon with optional radial jitter — handy for debris. */
export function ngonShape(radius, sides, jitter = 0) {
  const verts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const r = radius * (1 - Math.random() * jitter);
    verts.push(v2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return polyShape(verts);
}

/* ------------------------------------------------------------------ body -- */

let BODY_ID = 0;

export class Body {
  constructor(opts = {}) {
    this.id = ++BODY_ID;
    this.shape = opts.shape || circleShape(10);
    this.position = new Vec2(opts.x || 0, opts.y || 0);
    this.velocity = new Vec2(opts.vx || 0, opts.vy || 0);
    this.angle = opts.angle || 0;
    this.angularVelocity = opts.av || 0;
    this.force = new Vec2();
    this.torque = 0;

    this.restitution = opts.restitution ?? 0.25;
    this.friction = opts.friction ?? 0.4;
    this.linearDamping = opts.linearDamping ?? 0.004;
    this.angularDamping = opts.angularDamping ?? 0.02;
    this.gravityScale = opts.gravityScale ?? 1;
    this.density = opts.density ?? 0.0012;

    this.isStatic = !!opts.isStatic;
    this.fixedRotation = !!opts.fixedRotation;
    this.collisionGroup = opts.group ?? 1;
    this.collisionMask = opts.mask ?? 0xffffffff;
    this.isSensor = !!opts.sensor;

    this.allowSleep = opts.allowSleep !== false;
    this.sleeping = false;
    this.sleepTimer = 0;

    this.el = opts.el || null;      // optional DOM element driven by this body
    this.data = opts.data || null;  // arbitrary payload

    this.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.computeMass();
    this.updateAABB();
  }

  computeMass() {
    if (this.isStatic) {
      this.mass = 0; this.invMass = 0; this.inertia = 0; this.invInertia = 0;
      return;
    }
    const s = this.shape;
    if (s.type === CIRCLE) {
      this.mass = Math.PI * s.radius * s.radius * this.density;
      this.inertia = 0.5 * this.mass * s.radius * s.radius;
    } else {
      let area = 0, inertia = 0;
      const n = s.verts.length;
      for (let i = 0; i < n; i++) {
        const p = s.verts[i], q = s.verts[(i + 1) % n];
        const cross = Math.abs(crossVV(p, q));
        area += cross * 0.5;
        inertia += (cross / 12) * (p.dot(p) + p.dot(q) + q.dot(q));
      }
      this.mass = area * this.density;
      this.inertia = inertia * this.density;
    }
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;
    this.invInertia = this.fixedRotation || this.inertia <= 0 ? 0 : 1 / this.inertia;
  }

  updateAABB() {
    const s = this.shape;
    if (s.type === CIRCLE) {
      const r = s.radius;
      this.aabb.minX = this.position.x - r; this.aabb.maxX = this.position.x + r;
      this.aabb.minY = this.position.y - r; this.aabb.maxY = this.position.y + r;
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const c = Math.cos(this.angle), sn = Math.sin(this.angle);
      for (const lv of s.verts) {
        const x = this.position.x + (c * lv.x - sn * lv.y);
        const y = this.position.y + (sn * lv.x + c * lv.y);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      this.aabb.minX = minX; this.aabb.minY = minY;
      this.aabb.maxX = maxX; this.aabb.maxY = maxY;
    }
  }

  applyImpulse(impulse, contactOffset) {
    if (this.invMass === 0) return;
    this.wake();
    this.velocity.addScaled(impulse, this.invMass);
    if (contactOffset) this.angularVelocity += this.invInertia * crossVV(contactOffset, impulse);
  }

  applyForce(f) { this.force.add(f); this.wake(); }

  wake() {
    if (this.isStatic) return;
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  setPosition(x, y) {
    this.position.set(x, y);
    this.updateAABB();
    this.wake();
  }

  worldVerts() {
    return this.shape.verts.map((lv) => add2(this.position, rot(lv, this.angle)));
  }

  containsPoint(p) {
    const s = this.shape;
    if (s.type === CIRCLE) return sub2(p, this.position).lenSq() <= s.radius * s.radius;
    const local = invRot(sub2(p, this.position), this.angle);
    for (let i = 0; i < s.verts.length; i++) {
      if (sub2(local, s.verts[i]).dot(s.normals[i]) > 0) return false;
    }
    return true;
  }
}

/* ------------------------------------------------------------- collision -- */

const PENETRATION_SLOP = 0.05;
const BAUMGARTE = 0.22;
const POSITION_BAUMGARTE = 0.25;
const MAX_LINEAR_CORRECTION = 6;
const BOUNCE_THRESHOLD = 150; // px/s — below this, collisions are inelastic

class Manifold {
  constructor(a, b) {
    this.a = a; this.b = b;
    this.normal = new Vec2();   // always points a → b
    this.tangent = new Vec2();
    this.contacts = [];
    this.e = 0;
    this.mu = 0;
  }
}

function collideCircleCircle(m, a, b) {
  const d = sub2(b.position, a.position);
  const r = a.shape.radius + b.shape.radius;
  const distSq = d.lenSq();
  if (distSq > r * r) return false;
  const dist = Math.sqrt(distSq);
  if (dist < 1e-6) {
    m.normal.set(0, -1);
    m.contacts.push({ point: a.position.clone(), separation: -r, Pn: 0, Pt: 0, feature: 0 });
  } else {
    m.normal.copy(d).scale(1 / dist);
    m.contacts.push({
      point: add2(a.position, mul2(m.normal, a.shape.radius)),
      separation: dist - r, Pn: 0, Pt: 0, feature: 0,
    });
  }
  return true;
}

/** `flip` is true when the circle is manifold body B rather than A. */
function collideCirclePoly(m, circle, poly, flip) {
  const c = invRot(sub2(circle.position, poly.position), poly.angle);
  const r = circle.shape.radius;
  const s = poly.shape;

  let bestSep = -Infinity, bestIdx = 0;
  for (let i = 0; i < s.verts.length; i++) {
    const sep = sub2(c, s.verts[i]).dot(s.normals[i]);
    if (sep > r) return false;
    if (sep > bestSep) { bestSep = sep; bestIdx = i; }
  }

  const n = s.verts.length;
  const v1 = s.verts[bestIdx];
  const v2b = s.verts[(bestIdx + 1) % n];
  let normalLocal, contactLocal, separation;

  if (bestSep < 1e-6) {
    normalLocal = s.normals[bestIdx].clone();
    contactLocal = sub2(c, mul2(normalLocal, r));
    separation = bestSep - r;
  } else {
    const d1 = sub2(c, v1).dot(sub2(v2b, v1));
    const d2 = sub2(c, v2b).dot(sub2(v1, v2b));
    if (d1 <= 0) {
      const d = sub2(c, v1), dist = d.len();
      if (dist > r) return false;
      normalLocal = dist > 1e-6 ? d.scale(1 / dist) : s.normals[bestIdx].clone();
      contactLocal = v1.clone();
      separation = dist - r;
    } else if (d2 <= 0) {
      const d = sub2(c, v2b), dist = d.len();
      if (dist > r) return false;
      normalLocal = dist > 1e-6 ? d.scale(1 / dist) : s.normals[bestIdx].clone();
      contactLocal = v2b.clone();
      separation = dist - r;
    } else {
      normalLocal = s.normals[bestIdx].clone();
      contactLocal = sub2(c, mul2(normalLocal, r));
      separation = bestSep - r;
    }
  }

  const worldNormal = rot(normalLocal, poly.angle); // points poly → circle
  const worldContact = add2(poly.position, rot(contactLocal, poly.angle));
  if (flip) m.normal.copy(worldNormal); else m.normal.copy(worldNormal).neg();
  m.contacts.push({ point: worldContact, separation, Pn: 0, Pt: 0, feature: bestIdx });
  return true;
}

function findAxisOfLeastPenetration(A, B) {
  const sa = A.shape, sb = B.shape;
  let bestDist = -Infinity, bestIdx = 0;
  for (let i = 0; i < sa.verts.length; i++) {
    const nWorld = rot(sa.normals[i], A.angle);
    const nInB = invRot(nWorld, B.angle);
    let best = -Infinity, support = sb.verts[0];
    for (const vtx of sb.verts) {
      const proj = vtx.x * -nInB.x + vtx.y * -nInB.y;
      if (proj > best) { best = proj; support = vtx; }
    }
    const vWorld = add2(A.position, rot(sa.verts[i], A.angle));
    const sWorld = add2(B.position, rot(support, B.angle));
    const d = sub2(sWorld, vWorld).dot(nWorld);
    if (d > bestDist) { bestDist = d; bestIdx = i; }
  }
  return { distance: bestDist, index: bestIdx };
}

/** Prefer keeping the current reference face to avoid flip-flopping frame to frame. */
const biasGreaterThan = (a, b) => a >= b * 0.95 + a * 0.01;

function incidentEdge(refNormalWorld, inc) {
  const s = inc.shape;
  let minDot = Infinity, idx = 0;
  for (let i = 0; i < s.normals.length; i++) {
    const d = rot(s.normals[i], inc.angle).dot(refNormalWorld);
    if (d < minDot) { minDot = d; idx = i; }
  }
  const n = s.verts.length;
  return [
    add2(inc.position, rot(s.verts[idx], inc.angle)),
    add2(inc.position, rot(s.verts[(idx + 1) % n], inc.angle)),
    idx,
  ];
}

/** Clip segment [a,b] to the half-space (n · p) <= offset. */
function clipSegment(a, b, n, offset) {
  const out = [];
  const da = n.dot(a) - offset;
  const db = n.dot(b) - offset;
  if (da <= 0) out.push(a);
  if (db <= 0) out.push(b);
  if (da * db < 0) out.push(add2(a, mul2(sub2(b, a), da / (da - db))));
  return out.slice(0, 2);
}

function collidePolyPoly(m, A, B) {
  const penA = findAxisOfLeastPenetration(A, B);
  if (penA.distance > 0) return false;
  const penB = findAxisOfLeastPenetration(B, A);
  if (penB.distance > 0) return false;

  let ref, inc, refIdx;
  if (biasGreaterThan(penA.distance, penB.distance)) {
    ref = A; inc = B; refIdx = penA.index;
  } else {
    ref = B; inc = A; refIdx = penB.index;
  }

  const rs = ref.shape;
  const rn = rot(rs.normals[refIdx], ref.angle); // outward from ref → towards inc
  const rv1 = add2(ref.position, rot(rs.verts[refIdx], ref.angle));
  const rv2 = add2(ref.position, rot(rs.verts[(refIdx + 1) % rs.verts.length], ref.angle));
  // Along the reference edge, i.e. rv1 → rv2.
  const tangent = sub2(rv2, rv1).normalize();

  const [ip1, ip2, incIdx] = incidentEdge(rn, inc);
  let clipped = clipSegment(ip1, ip2, mul2(tangent, -1), -tangent.dot(rv1));
  if (clipped.length < 2) return false;
  clipped = clipSegment(clipped[0], clipped[1], tangent, tangent.dot(rv2));
  if (clipped.length < 2) return false;

  // Stable ordering keeps contact feature ids consistent for warm starting.
  clipped.sort((p, q) => tangent.dot(p) - tangent.dot(q));

  // Feature id encodes which body owned the reference face plus both edge
  // indices, so cached impulses are only reused for genuinely matching contacts.
  const featureBase = (ref === m.a ? 1 : 0) | (refIdx << 1) | (incIdx << 6);

  const refOffset = rn.dot(rv1);
  let count = 0;
  for (let i = 0; i < clipped.length; i++) {
    const sep = rn.dot(clipped[i]) - refOffset;
    if (sep <= 0) {
      m.contacts.push({
        point: clipped[i], separation: sep, Pn: 0, Pt: 0,
        feature: featureBase | (i << 11),
      });
      count++;
    }
  }
  if (count === 0) return false;

  if (ref === m.a) m.normal.copy(rn); else m.normal.copy(rn).neg();
  return true;
}

function collide(a, b) {
  const m = new Manifold(a, b);
  let hit;
  if (a.shape.type === CIRCLE && b.shape.type === CIRCLE) hit = collideCircleCircle(m, a, b);
  else if (a.shape.type === CIRCLE) hit = collideCirclePoly(m, a, b, false);
  else if (b.shape.type === CIRCLE) hit = collideCirclePoly(m, b, a, true);
  else hit = collidePolyPoly(m, a, b);
  if (!hit) return null;
  m.e = Math.max(a.restitution, b.restitution);
  m.mu = Math.sqrt(a.friction * b.friction);
  // Anchor the contact in each body's local frame so the position solver can
  // re-evaluate separation after the velocity pass without a second narrowphase.
  m.localNormal = invRot(m.normal, a.angle);
  for (const c of m.contacts) {
    c.localA = invRot(sub2(c.point, a.position), a.angle);
    c.localB = invRot(sub2(c.point, b.position), b.angle);
    c.sep0 = c.separation;
  }
  return m;
}

/* ---------------------------------------------------------------- joints -- */

export class DistanceJoint {
  /** Soft (frequency > 0) or rigid (frequency = 0) distance constraint. */
  constructor(a, b, opts = {}) {
    this.a = a; this.b = b;
    this.localA = opts.localA ? new Vec2(opts.localA.x, opts.localA.y) : new Vec2();
    this.localB = opts.localB ? new Vec2(opts.localB.x, opts.localB.y) : new Vec2();
    this.length = opts.length ?? sub2(b.position, a.position).len();
    this.frequency = opts.frequency ?? 0;
    this.damping = opts.damping ?? 1;
    this.impulse = 0;
    this.gamma = 0;
    this.bias = 0;
    this.mass = 0;
    this.n = new Vec2();
    this.rA = new Vec2();
    this.rB = new Vec2();
  }

  preStep(dt) {
    const { a, b } = this;
    this.rA = rot(this.localA, a.angle);
    this.rB = rot(this.localB, b.angle);
    const d = sub2(add2(b.position, this.rB), add2(a.position, this.rA));
    const dist = d.len();
    this.n = dist > 1e-6 ? d.scale(1 / dist) : new Vec2(0, 1);

    const crA = crossVV(this.rA, this.n);
    const crB = crossVV(this.rB, this.n);
    let invMass = a.invMass + b.invMass + a.invInertia * crA * crA + b.invInertia * crB * crB;

    const C = dist - this.length;
    if (this.frequency > 0) {
      const omega = 2 * Math.PI * this.frequency;
      const mEff = invMass > 0 ? 1 / invMass : 0;
      const k = mEff * omega * omega;
      const c = mEff * 2 * this.damping * omega;
      const g = dt * (c + dt * k);
      this.gamma = g !== 0 ? 1 / g : 0;
      this.bias = C * dt * k * this.gamma;
      invMass += this.gamma;
    } else {
      this.gamma = 0;
      this.bias = (BAUMGARTE / dt) * C * 0.6;
    }
    this.mass = invMass > 0 ? 1 / invMass : 0;

    const P = mul2(this.n, this.impulse);
    a.velocity.addScaled(P, -a.invMass);
    a.angularVelocity -= a.invInertia * crossVV(this.rA, P);
    b.velocity.addScaled(P, b.invMass);
    b.angularVelocity += b.invInertia * crossVV(this.rB, P);
    a.wake(); b.wake();
  }

  solve() {
    const { a, b, n } = this;
    const vA = add2(a.velocity, crossSV(a.angularVelocity, this.rA));
    const vB = add2(b.velocity, crossSV(b.angularVelocity, this.rB));
    const cdot = sub2(vB, vA).dot(n);
    const impulse = -this.mass * (cdot + this.bias + this.gamma * this.impulse);
    this.impulse += impulse;
    const P = mul2(n, impulse);
    a.velocity.addScaled(P, -a.invMass);
    a.angularVelocity -= a.invInertia * crossVV(this.rA, P);
    b.velocity.addScaled(P, b.invMass);
    b.angularVelocity += b.invInertia * crossVV(this.rB, P);
  }
}

export class MouseJoint {
  constructor(body, target, opts = {}) {
    this.body = body;
    this.target = new Vec2(target.x, target.y);
    // A grab pins the point under the cursor; an anchor pins the centre of mass.
    this.localAnchor = opts.localAnchor
      ? new Vec2(opts.localAnchor.x, opts.localAnchor.y)
      : invRot(sub2(target, body.position), body.angle);
    this.maxForce = opts.maxForce ?? 12000 * Math.max(body.mass, 0.05);
    this.frequency = opts.frequency ?? 8;
    this.damping = opts.damping ?? 0.9;
    this.targetAngle = opts.targetAngle ?? null;
    this.angularFrequency = opts.angularFrequency ?? 2.2;
    this.angularDamping = opts.angularDamping ?? 0.22;
    this.impulse = new Vec2();
    this.r = new Vec2();
    this.C = new Vec2();
    this.gamma = 0;
    this.beta = 0;
    this.mass = [1, 0, 0, 1];
  }

  preStep(dt) {
    const b = this.body;
    b.wake();
    const omega = 2 * Math.PI * this.frequency;
    const m = b.mass || 1;
    const k = m * omega * omega;
    const c = m * 2 * this.damping * omega;
    const g = dt * (c + dt * k);
    this.gamma = g !== 0 ? 1 / g : 0;
    this.beta = dt * k * this.gamma;

    this.r = rot(this.localAnchor, b.angle);
    const im = b.invMass, ii = b.invInertia;
    const k11 = im + ii * this.r.y * this.r.y + this.gamma;
    const k12 = -ii * this.r.x * this.r.y;
    const k22 = im + ii * this.r.x * this.r.x + this.gamma;
    const det = k11 * k22 - k12 * k12;
    const invDet = det !== 0 ? 1 / det : 0;
    this.mass = [k22 * invDet, -k12 * invDet, -k12 * invDet, k11 * invDet];

    this.C = sub2(add2(b.position, this.r), this.target).scale(this.beta);
    b.velocity.addScaled(this.impulse, im);
    b.angularVelocity += ii * crossVV(this.r, this.impulse);
  }

  solve(dt) {
    const b = this.body;
    const cdot = add2(b.velocity, crossSV(b.angularVelocity, this.r));
    const rx = -(cdot.x + this.C.x + this.gamma * this.impulse.x);
    const ry = -(cdot.y + this.C.y + this.gamma * this.impulse.y);
    const imp = new Vec2(
      this.mass[0] * rx + this.mass[1] * ry,
      this.mass[2] * rx + this.mass[3] * ry,
    );
    const old = this.impulse.clone();
    this.impulse.add(imp);
    const maxImpulse = dt * this.maxForce;
    if (this.impulse.lenSq() > maxImpulse * maxImpulse) {
      this.impulse.scale(maxImpulse / this.impulse.len());
    }
    const applied = sub2(this.impulse, old);
    b.velocity.addScaled(applied, b.invMass);
    b.angularVelocity += b.invInertia * crossVV(this.r, applied);

    if (this.targetAngle !== null && b.invInertia > 0) {
      // Soft rotational spring back to the resting orientation.
      let err = (b.angle - this.targetAngle) % TAU;
      if (err > Math.PI) err -= TAU;
      else if (err < -Math.PI) err += TAU;
      const desired = -err * 2 * Math.PI * this.angularFrequency;
      b.angularVelocity += (desired - b.angularVelocity) * this.angularDamping;
    }
  }
}

/* ----------------------------------------------------------------- world -- */

const SLEEP_LINEAR = 20;     // px/s
const SLEEP_ANGULAR = 0.32;  // rad/s
const SLEEP_TIME = 0.7;      // s

export class World {
  constructor(opts = {}) {
    this.gravity = new Vec2(opts.gravityX ?? 0, opts.gravityY ?? 2200);
    this.bodies = [];
    this.joints = [];
    this.iterations = opts.iterations ?? 8;
    this.positionIterations = opts.positionIterations ?? 3;
    this.cellSize = opts.cellSize ?? 96;
    this.manifolds = new Map();
    this.enableSleep = opts.enableSleep !== false;
    this.onCollision = opts.onCollision || null;
    this._grid = new Map();
  }

  add(body) { this.bodies.push(body); return body; }
  addJoint(j) { this.joints.push(j); return j; }
  removeJoint(j) { const i = this.joints.indexOf(j); if (i >= 0) this.joints.splice(i, 1); }

  remove(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    for (const [key, m] of this.manifolds) {
      if (m.a === body || m.b === body) {
        // Anything this body was supporting has to fall again.
        m.a.wake(); m.b.wake();
        this.manifolds.delete(key);
      }
    }
    this.joints = this.joints.filter((j) => j.a !== body && j.b !== body && j.body !== body);
  }

  clear() {
    this.bodies.length = 0;
    this.joints.length = 0;
    this.manifolds.clear();
  }

  wakeAll() { for (const b of this.bodies) b.wake(); }

  queryPoint(p, pad = 0) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.isStatic || b.invMass === 0) continue;
      if (p.x < b.aabb.minX - pad || p.x > b.aabb.maxX + pad) continue;
      if (p.y < b.aabb.minY - pad || p.y > b.aabb.maxY + pad) continue;
      if (pad > 0 || b.containsPoint(p)) return b;
    }
    return null;
  }

  /** Radial impulse — the "blast" primitive. */
  explode(center, { radius = 260, strength = 1.4, upward = 0.35 } = {}) {
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      const d = sub2(b.position, center);
      const dist = d.len();
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;
      const dir = dist > 1e-4 ? d.scale(1 / dist) : new Vec2(rand(-1, 1), -1);
      dir.y -= upward;
      dir.normalize();
      b.applyImpulse(mul2(dir, strength * falloff * b.mass * 1000), null);
      b.angularVelocity += rand(-7, 7) * falloff;
    }
  }

  /** Attract/repel every dynamic body towards a point (used by the cursor field). */
  attract(center, radius, strength) {
    const r2 = radius * radius;
    for (const b of this.bodies) {
      if (b.isStatic) continue;
      const d = sub2(center, b.position);
      const dsq = d.lenSq();
      if (dsq > r2 || dsq < 1) continue;
      const falloff = 1 - Math.sqrt(dsq) / radius;
      d.normalize().scale(strength * falloff * b.mass);
      b.applyForce(d);
    }
  }

  _canCollide(a, b) {
    if (a.isStatic && b.isStatic) return false;
    if (a.invMass === 0 && b.invMass === 0) return false;
    return (a.collisionGroup & b.collisionMask) !== 0 && (b.collisionGroup & a.collisionMask) !== 0;
  }

  _broadphase() {
    const grid = this._grid;
    grid.clear();
    const cs = this.cellSize;
    const pairs = [];
    const seen = new Set();

    for (const b of this.bodies) {
      const x0 = Math.floor(b.aabb.minX / cs), x1 = Math.floor(b.aabb.maxX / cs);
      const y0 = Math.floor(b.aabb.minY / cs), y1 = Math.floor(b.aabb.maxY / cs);
      if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) continue; // runaway body guard
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = (x * 73856093) ^ (y * 19349663);
          let cell = grid.get(key);
          if (!cell) { cell = []; grid.set(key, cell); }
          for (const other of cell) {
            const lo = Math.min(other.id, b.id), hi = Math.max(other.id, b.id);
            const pk = lo * 1e6 + hi;
            if (seen.has(pk)) continue;
            seen.add(pk);
            if (!this._canCollide(other, b)) continue;
            if (other.aabb.maxX < b.aabb.minX || other.aabb.minX > b.aabb.maxX) continue;
            if (other.aabb.maxY < b.aabb.minY || other.aabb.minY > b.aabb.maxY) continue;
            pairs.push(other.id < b.id ? [other, b] : [b, other]);
          }
          cell.push(b);
        }
      }
    }
    return pairs;
  }

  step(dt) {
    if (dt <= 0) return;

    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      b.velocity.x += (this.gravity.x * b.gravityScale + b.force.x * b.invMass) * dt;
      b.velocity.y += (this.gravity.y * b.gravityScale + b.force.y * b.invMass) * dt;
      b.angularVelocity += b.torque * b.invInertia * dt;
      b.velocity.scale(1 / (1 + dt * b.linearDamping * 60));
      b.angularVelocity /= 1 + dt * b.angularDamping * 60;
    }

    const pairs = this._broadphase();
    const prevManifolds = this.manifolds;
    const live = new Map();
    for (const [a, b] of pairs) {
      const key = a.id + ':' + b.id;
      const prev = prevManifolds.get(key);
      const m = collide(a, b);
      if (!m) continue;
      if (prev) {
        for (const c of m.contacts) {
          const old = prev.contacts.find((o) => o.feature === c.feature);
          if (old) { c.Pn = old.Pn; c.Pt = old.Pt; }
        }
      } else {
        // A brand new touch is the only contact event that wakes bodies up;
        // persistent resting contacts must not keep resetting sleep timers.
        a.wake(); b.wake();
        if (this.onCollision) this.onCollision(a, b, m);
      }
      live.set(key, m);
    }
    // Losing support has to wake a sleeper, or it would hang in mid-air.
    for (const [key, m] of prevManifolds) {
      if (!live.has(key)) {
        if (m.a.sleeping) m.a.wake();
        if (m.b.sleeping) m.b.wake();
      }
    }
    this.manifolds = live;

    const manifolds = [];
    for (const m of live.values()) {
      if (m.a.isSensor || m.b.isSensor) continue;
      const aActive = !m.a.isStatic && !m.a.sleeping;
      const bActive = !m.b.isStatic && !m.b.sleeping;
      if (!aActive && !bActive) continue;
      if (aActive && m.b.sleeping) m.b.wake();
      if (bActive && m.a.sleeping) m.a.wake();
      manifolds.push(m);
    }

    // Sequential impulses converge far faster when contacts are relaxed from
    // the bottom of a pile upwards, so order them along the gravity vector.
    const gl = this.gravity.len();
    if (gl > 1e-3 && manifolds.length > 1) {
      const gx = this.gravity.x / gl, gy = this.gravity.y / gl;
      for (const m of manifolds) {
        const p = m.contacts[0].point;
        m._depth = p.x * gx + p.y * gy;
      }
      manifolds.sort((p, q) => q._depth - p._depth);
    }

    for (const m of manifolds) preStepContact(m, dt);
    for (const m of manifolds) warmStartContact(m);
    for (const j of this.joints) j.preStep(dt);

    for (let i = 0; i < this.iterations; i++) {
      for (const j of this.joints) j.solve(dt);
      for (const m of manifolds) solveContact(m);
    }
    for (let i = 0; i < 2; i++) {
      for (const m of manifolds) applyRestitution(m);
    }

    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      b.position.addScaled(b.velocity, dt);
      if (!b.fixedRotation) b.angle += b.angularVelocity * dt;
      b.force.set(0, 0);
      b.torque = 0;
    }

    // Split-impulse position correction.
    for (let i = 0; i < this.positionIterations; i++) {
      let worst = 0;
      for (const m of manifolds) worst = Math.min(worst, solveContactPosition(m));
      if (worst > -3 * PENETRATION_SLOP) break;
    }

    for (const b of this.bodies) {
      if (!b.isStatic) b.updateAABB();
    }

    if (this.enableSleep) this._updateSleep(dt);
  }

  /**
   * Island-based sleeping: bodies connected through contacts or joints sleep
   * and wake as one group, so a resting pile settles instead of trickling
   * awake one body at a time.
   */
  _updateSleep(dt) {
    const bodies = this.bodies;
    for (const b of bodies) { b._root = b; b._rank = 0; }

    const find = (b) => {
      let r = b;
      while (r._root !== r) r = r._root;
      while (b._root !== r) { const next = b._root; b._root = r; b = next; }
      return r;
    };
    const union = (p, q) => {
      let x = find(p), y = find(q);
      if (x === y) return;
      if (x._rank < y._rank) { const t = x; x = y; y = t; }
      y._root = x;
      if (x._rank === y._rank) x._rank++;
    };

    for (const m of this.manifolds.values()) {
      if (m.a.isStatic || m.b.isStatic) continue;
      union(m.a, m.b);
    }
    for (const j of this.joints) {
      const a = j.a || j.body, b = j.b;
      if (a && b && !a.isStatic && !b.isStatic) union(a, b);
    }

    for (const b of bodies) {
      if (b.isStatic) continue;
      if (!b.allowSleep) { b.sleepTimer = 0; continue; }
      const still = b.velocity.lenSq() < SLEEP_LINEAR * SLEEP_LINEAR &&
                    Math.abs(b.angularVelocity) < SLEEP_ANGULAR;
      b.sleepTimer = still ? b.sleepTimer + dt : 0;
    }

    const islandTimer = new Map();
    for (const b of bodies) {
      if (b.isStatic) continue;
      const root = find(b);
      const t = b.allowSleep ? b.sleepTimer : 0;
      const cur = islandTimer.get(root);
      if (cur === undefined || t < cur) islandTimer.set(root, t);
    }

    for (const b of bodies) {
      if (b.isStatic) continue;
      const asleep = islandTimer.get(find(b)) > SLEEP_TIME;
      if (asleep) {
        if (!b.sleeping) {
          b.sleeping = true;
          b.velocity.set(0, 0);
          b.angularVelocity = 0;
        }
      } else {
        b.sleeping = false;
      }
    }
  }
}

function preStepContact(m, dt) {
  const { a, b } = m;
  m.tangent.set(m.normal.y, -m.normal.x);
  const tangent = m.tangent;
  for (const c of m.contacts) {
    c.rA = sub2(c.point, a.position);
    c.rB = sub2(c.point, b.position);

    const rnA = crossVV(c.rA, m.normal), rnB = crossVV(c.rB, m.normal);
    const kN = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
    c.massNormal = kN > 0 ? 1 / kN : 0;

    const rtA = crossVV(c.rA, tangent), rtB = crossVV(c.rB, tangent);
    const kT = a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;
    c.massTangent = kT > 0 ? 1 / kT : 0;

    // Snapshot the approach speed now; restitution is applied later from this
    // value so simultaneous contacts can't amplify each other.
    const vA = add2(a.velocity, crossSV(a.angularVelocity, c.rA));
    const vB = add2(b.velocity, crossSV(b.angularVelocity, c.rB));
    c.relN0 = sub2(vB, vA).dot(m.normal);
    c.maxPn = 0;
  }
}

function warmStartContact(m) {
  const { a, b, normal, tangent } = m;
  for (const c of m.contacts) {
    const P = new Vec2(
      normal.x * c.Pn + tangent.x * c.Pt,
      normal.y * c.Pn + tangent.y * c.Pt,
    );
    a.velocity.addScaled(P, -a.invMass);
    a.angularVelocity -= a.invInertia * crossVV(c.rA, P);
    b.velocity.addScaled(P, b.invMass);
    b.angularVelocity += b.invInertia * crossVV(c.rB, P);
  }
}

function solveContact(m) {
  const { a, b, normal, tangent } = m;
  for (const c of m.contacts) {
    let vA = add2(a.velocity, crossSV(a.angularVelocity, c.rA));
    let vB = add2(b.velocity, crossSV(b.angularVelocity, c.rB));
    const vn = sub2(vB, vA).dot(normal);

    let dPn = c.massNormal * -vn;
    const Pn0 = c.Pn;
    c.Pn = Math.max(Pn0 + dPn, 0);
    if (c.Pn > c.maxPn) c.maxPn = c.Pn;
    dPn = c.Pn - Pn0;
    const Pn = mul2(normal, dPn);
    a.velocity.addScaled(Pn, -a.invMass);
    a.angularVelocity -= a.invInertia * crossVV(c.rA, Pn);
    b.velocity.addScaled(Pn, b.invMass);
    b.angularVelocity += b.invInertia * crossVV(c.rB, Pn);

    vA = add2(a.velocity, crossSV(a.angularVelocity, c.rA));
    vB = add2(b.velocity, crossSV(b.angularVelocity, c.rB));
    const vt = sub2(vB, vA).dot(tangent);

    let dPt = c.massTangent * -vt;
    const maxPt = m.mu * c.Pn;
    const Pt0 = c.Pt;
    c.Pt = clamp(Pt0 + dPt, -maxPt, maxPt);
    dPt = c.Pt - Pt0;
    const Pt = mul2(tangent, dPt);
    a.velocity.addScaled(Pt, -a.invMass);
    a.angularVelocity -= a.invInertia * crossVV(c.rA, Pt);
    b.velocity.addScaled(Pt, b.invMass);
    b.angularVelocity += b.invInertia * crossVV(c.rB, Pt);
  }
}

/** Separate bounce pass driven by the pre-solve approach speed. */
function applyRestitution(m) {
  if (m.e <= 0) return;
  const { a, b, normal } = m;
  for (const c of m.contacts) {
    if (c.relN0 > -BOUNCE_THRESHOLD || c.maxPn === 0) continue;
    const vA = add2(a.velocity, crossSV(a.angularVelocity, c.rA));
    const vB = add2(b.velocity, crossSV(b.angularVelocity, c.rB));
    const vn = sub2(vB, vA).dot(normal);
    let impulse = -c.massNormal * (vn + m.e * c.relN0);
    const Pn0 = c.Pn;
    c.Pn = Math.max(Pn0 + impulse, 0);
    impulse = c.Pn - Pn0;
    const P = mul2(normal, impulse);
    a.velocity.addScaled(P, -a.invMass);
    a.angularVelocity -= a.invInertia * crossVV(c.rA, P);
    b.velocity.addScaled(P, b.invMass);
    b.angularVelocity += b.invInertia * crossVV(c.rB, P);
  }
}

/**
 * Non-linear Gauss-Seidel position correction (split impulse). Runs after the
 * velocity pass on positions only, so overlap is resolved without pumping
 * energy back into the simulation the way Baumgarte stabilisation does.
 * Returns the worst remaining penetration.
 */
function solveContactPosition(m) {
  const { a, b } = m;
  const normal = rot(m.localNormal, a.angle);
  let worst = 0;
  for (const c of m.contacts) {
    const rA = rot(c.localA, a.angle);
    const rB = rot(c.localB, b.angle);
    const pA = add2(a.position, rA);
    const pB = add2(b.position, rB);
    const separation = c.sep0 + sub2(pB, pA).dot(normal);
    if (separation < worst) worst = separation;

    const C = clamp(POSITION_BAUMGARTE * (separation + PENETRATION_SLOP), -MAX_LINEAR_CORRECTION, 0);
    const rnA = crossVV(rA, normal), rnB = crossVV(rB, normal);
    const k = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
    if (k <= 0) continue;
    const impulse = -C / k;
    const P = mul2(normal, impulse);

    a.position.addScaled(P, -a.invMass);
    a.angle -= a.invInertia * crossVV(rA, P);
    b.position.addScaled(P, b.invMass);
    b.angle += b.invInertia * crossVV(rB, P);
  }
  return worst;
}

/* ---------------------------------------------------------------- runner -- */

const FIXED_DT = 1 / 120;
const MAX_STEPS = 5;

/** Fixed-timestep loop with an accumulator, so physics is frame-rate independent. */
export class Runner {
  constructor(world, onFrame) {
    this.world = world;
    this.onFrame = onFrame;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.raf = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  _tick(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._tick);
    let frame = (now - this.last) / 1000;
    this.last = now;
    if (frame > 0.25) frame = 0.25;
    this.acc += frame;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS) {
      this.world.step(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    if (this.onFrame) this.onFrame(frame, now);
  }
}
