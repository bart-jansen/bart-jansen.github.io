/**
 * Narrowphase collision detection.
 *
 * Three routines: sphere–sphere, sphere–convex, convex–convex. The last one is
 * SAT over face normals of both hulls plus edge×edge axes (pruned by a Gauss
 * map test), followed by Sutherland–Hodgman clipping of the incident face
 * against the reference face's side planes.
 *
 * Everything runs in the *reference hull's local frame*: transforming one
 * hull's handful of query directions is far cheaper than transforming both
 * hulls' vertices into world space, and it keeps the arithmetic well
 * conditioned for the big arena coordinates.
 *
 * Output goes into a caller-supplied manifold so the step loop allocates
 * nothing.
 */

import { Vec3, Quat, dot3, EPS } from '../math.js';
import { SPHERE, CONVEX } from './shapes.js';

/** Face axes win ties over edge axes by this much — kills manifold flicker. */
const AXIS_BIAS_ABS = 0.002;
const AXIS_BIAS_REL = 1.002;
/** Clip points further than this behind the reference plane are dropped. */
const CLIP_TOLERANCE = 0.02;
export const MAX_CONTACT_POINTS = 4;

/* ───────────────────────────────────────────────────────────── scratch ── */

const _a = new Vec3(), _b = new Vec3(), _c = new Vec3(), _d = new Vec3();
const _n = new Vec3(), _p = new Vec3(), _q = new Vec3();
const _axis = new Vec3(), _sup = new Vec3();
const _qRel = new Quat(), _qInv = new Quat();
const _tRel = new Vec3(), _tInv = new Vec3();

/** Reusable polygon buffers for clipping (ping-pong, plus a keep list). */
const _polyA = [];
const _polyB = [];
const _keepPts = [];
for (let i = 0; i < 64; i++) { _polyA.push(new Vec3()); _polyB.push(new Vec3()); _keepPts.push(new Vec3()); }

/* ───────────────────────────────────────────────────────────── results ── */

export class ManifoldPoint {
  constructor() {
    this.point = new Vec3();      // world position, midway between surfaces
    this.localA = new Vec3();     // anchor in A's local frame
    this.localB = new Vec3();     // anchor in B's local frame
    this.depth = 0;               // positive = overlapping
    this.id = 0;                  // feature hint for warm-start matching

    // Solver state, persisted across frames.
    this.normalImpulse = 0;
    // The normal impulse as it stood *before* the restitution pass. Only this
    // part is warm-started: feeding restitution impulses back in next step is
    // a positive feedback loop that shakes resting stacks apart.
    this.warmNormal = 0;
    this.warmStarted = false;
    this.tangentImpulse1 = 0;
    this.tangentImpulse2 = 0;
    this.pseudoImpulse = 0;
    this.normalMass = 0;
    this.tangentMass1 = 0;
    this.tangentMass2 = 0;
    this.rA = new Vec3();
    this.rB = new Vec3();
    this.relN0 = 0;               // approach speed captured at pre-step
    this.sep0 = 0;
  }
}

export class Manifold {
  constructor() {
    this.a = null;
    this.b = null;
    this.normal = new Vec3(0, 1, 0);     // world, points from A toward B
    this.localNormal = new Vec3(0, 1, 0); // same, in A's local frame
    this.tangent1 = new Vec3();
    this.tangent2 = new Vec3();
    this.count = 0;
    this.points = [new ManifoldPoint(), new ManifoldPoint(),
                   new ManifoldPoint(), new ManifoldPoint()];
    this.friction = 0.5;
    this.restitution = 0;
    this.rollingFriction = 0;
    this.rollingImpulse = 0;
    this.fresh = true;
    this.touching = false;
    this.stamp = 0;
  }
}

/* ───────────────────────────────────────────────────────── entry point ── */

/**
 * @returns {boolean} true when the pair touches; `out` is filled in that case.
 * Body order may be swapped internally, so `out.a`/`out.b` are authoritative.
 */
export function collide(bodyA, bodyB, out) {
  const sa = bodyA.shape, sb = bodyB.shape;

  if (sa.type === SPHERE && sb.type === SPHERE) {
    out.a = bodyA; out.b = bodyB;
    return sphereSphere(bodyA, bodyB, out);
  }
  if (sa.type === SPHERE && sb.type === CONVEX) {
    // Keep the hull as A so the normal convention stays "out of the hull".
    out.a = bodyB; out.b = bodyA;
    return sphereConvex(bodyB, bodyA, out);
  }
  if (sa.type === CONVEX && sb.type === SPHERE) {
    out.a = bodyA; out.b = bodyB;
    return sphereConvex(bodyA, bodyB, out);
  }
  out.a = bodyA; out.b = bodyB;
  return convexConvex(bodyA, bodyB, out);
}

/* ─────────────────────────────────────────────────────── sphere/sphere ── */

function sphereSphere(A, B, out) {
  const ra = A.shape.radius, rb = B.shape.radius;
  _n.setSub(B.pos, A.pos);
  const d2 = _n.lenSq();
  const r = ra + rb;
  if (d2 >= r * r) return false;

  const d = Math.sqrt(d2);
  if (d > EPS) _n.scale(1 / d);
  else _n.set(0, 1, 0);

  out.normal.copy(_n);
  out.localNormal.copy(_n).applyQuatInv(A.quat);
  out.count = 1;

  const cp = out.points[0];
  // Meet in the middle of the overlap.
  cp.point.copy(A.pos).addScaled(_n, ra - (r - d) * 0.5);
  cp.depth = r - d;
  cp.id = 0;
  cp.localA.setScale(_n, ra).applyQuatInv(A.quat);
  cp.localB.setScale(_n, -rb).applyQuatInv(B.quat);
  return true;
}

/* ─────────────────────────────────────────────────────── sphere/convex ── */

function sphereConvex(H, S, out) {
  const hull = H.shape, radius = S.shape.radius;

  // Sphere centre in the hull's local frame.
  _p.copy(S.pos).sub(H.pos).applyQuatInv(H.quat);

  // Deepest face — for a convex hull the maximum plane separation identifies
  // the Voronoi region the centre sits in (or tells us it's inside).
  let bestSep = -Infinity, bestFace = -1;
  const faces = hull.faces;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const sep = dot3(f.normal, _p) - f.offset;
    if (sep > radius) return false;         // early out: separated
    if (sep > bestSep) { bestSep = sep; bestFace = i; }
  }

  const face = faces[bestFace];

  if (bestSep < EPS) {
    // Centre is inside the hull: push straight out through the shallowest face.
    out.normal.copy(face.normal).applyQuat(H.quat);
    out.localNormal.copy(face.normal);
    out.count = 1;
    const cp = out.points[0];
    cp.depth = radius - bestSep;
    _q.copy(_p).addScaled(face.normal, -bestSep);       // projection onto face
    cp.localA.copy(_q);
    cp.localB.setScale(out.normal, -radius).applyQuatInv(S.quat);
    cp.point.copy(_q).applyQuat(H.quat).add(H.pos);
    cp.id = bestFace;
    return true;
  }

  // Outside: find the closest point of that face polygon to the centre.
  closestOnFace(hull, face, _p, _q);

  _n.setSub(_p, _q);
  const d2 = _n.lenSq();
  if (d2 > radius * radius) return false;

  const d = Math.sqrt(d2);
  if (d > EPS) _n.scale(1 / d);
  else _n.copy(face.normal);

  out.localNormal.copy(_n);
  out.normal.copy(_n).applyQuat(H.quat);
  out.count = 1;

  const cp = out.points[0];
  cp.depth = radius - d;
  cp.localA.copy(_q);
  cp.localB.setScale(out.normal, -radius).applyQuatInv(S.quat);
  cp.point.copy(_q).applyQuat(H.quat).add(H.pos);
  cp.id = bestFace;
  return true;
}

/** Closest point of a (planar, convex) face polygon to point p — all local. */
function closestOnFace(hull, face, p, out) {
  const idx = face.indices;
  const verts = hull.verts;

  // Project onto the face plane first.
  const dist = dot3(face.normal, p) - face.offset;
  out.copy(p).addScaled(face.normal, -dist);

  // Inside test: the projection is inside iff it's left of every edge.
  let inside = true;
  for (let i = 0; i < idx.length; i++) {
    const v0 = verts[idx[i]];
    const v1 = verts[idx[(i + 1) % idx.length]];
    _a.setSub(v1, v0);
    _b.setSub(out, v0);
    _c.setCross(_a, _b);
    if (dot3(_c, face.normal) < 0) { inside = false; break; }
  }
  if (inside) return out;

  // Otherwise walk the boundary for the nearest segment point.
  let bestD = Infinity;
  for (let i = 0; i < idx.length; i++) {
    const v0 = verts[idx[i]];
    const v1 = verts[idx[(i + 1) % idx.length]];
    _a.setSub(v1, v0);
    const len2 = _a.lenSq();
    _rel.setSub(p, v0);
    let t = len2 > EPS ? (dot3(_rel, _a) / len2) : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    _b.copy(v0).addScaled(_a, t);
    const dd = _b.distSq(p);
    if (dd < bestD) { bestD = dd; out.copy(_b); }
  }
  return out;
}

/* ─────────────────────────────────────────────────────── convex/convex ── */

const _faceQuery = { sep: 0, index: 0 };
const _edgeQuery = { sep: 0, ia: 0, ib: 0, normal: new Vec3() };

function convexConvex(A, B, out) {
  const hullA = A.shape, hullB = B.shape;

  // B expressed in A's frame.
  _qRel.copy(A.quat).conjugate().mul(B.quat);
  _tRel.copy(B.pos).sub(A.pos).applyQuatInv(A.quat);
  // …and A expressed in B's frame (the exact inverse).
  _qInv.copy(_qRel).conjugate();
  _tInv.copy(_tRel).neg().applyQuat(_qInv);

  const qA = queryFaceDirections(hullA, hullB, _qRel, _tRel, _faceQuery);
  if (qA > 0) return false;
  const faceA = _faceQuery.index;

  const qB = queryFaceDirections(hullB, hullA, _qInv, _tInv, _faceQuery);
  if (qB > 0) return false;
  const faceB = _faceQuery.index;

  const qE = queryEdgeDirections(hullA, hullB, _qRel, _tRel, _edgeQuery);
  if (qE > 0) return false;

  // Prefer face contacts — they give stable multi-point manifolds. Only take
  // the edge axis when it's meaningfully deeper.
  if (qE > AXIS_BIAS_REL * Math.max(qA, qB) + AXIS_BIAS_ABS) {
    return buildEdgeContact(A, B, hullA, hullB, _edgeQuery, _qRel, _tRel, out);
  }

  if (qB > AXIS_BIAS_REL * qA + AXIS_BIAS_ABS) {
    // Reference face lives on B: run the clip with the roles swapped, then
    // flip the resulting normal so it still points from A to B.
    const ok = clipFaceContact(B, A, hullB, hullA, faceB, _qInv, _tInv, out);
    if (!ok) return false;
    out.a = B; out.b = A;
    return true;
  }
  return clipFaceContact(A, B, hullA, hullB, faceA, _qRel, _tRel, out);
}

/**
 * Largest separation over `ref`'s face normals. Positive means we found a
 * separating axis and can stop everything.
 */
function queryFaceDirections(ref, inc, qRel, tRel, result) {
  let best = -Infinity, bestIdx = 0;
  const faces = ref.faces;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    // Support point of `inc` along -n, expressed in ref's frame.
    _axis.copy(f.normal).neg().applyQuatInv(qRel);   // -n into inc's frame
    inc.supportLocal(_axis, _sup);
    _sup.applyQuat(qRel).add(tRel);                  // back into ref's frame

    const sep = dot3(f.normal, _sup) - f.offset;
    if (sep > best) { best = sep; bestIdx = i; }
    if (sep > 0) break;                              // early out
  }
  result.sep = best;
  result.index = bestIdx;
  return best;
}

/**
 * Largest separation over edge×edge axes, pruned with a Gauss map test so we
 * only consider edge pairs that actually build a face on the Minkowski
 * difference. Everything is computed in A's frame.
 */
function queryEdgeDirections(hullA, hullB, qRel, tRel, result) {
  let best = -Infinity;
  const edgesA = hullA.edges, edgesB = hullB.edges;

  // Rotate all of B's face normals and edge directions into A's frame once.
  // Doing this inside the double loop instead costs |edgesA| times more work —
  // for two 12-sided prisms that's the difference between 34 rotations and
  // over 1700.
  const bn = ensureVecs(_bNormals, hullB.faces.length);
  for (let k = 0; k < hullB.faces.length; k++) bn[k].copy(hullB.faces[k].normal).applyQuat(qRel);
  const bd = ensureVecs(_bEdgeDirs, edgesB.length);
  for (let k = 0; k < edgesB.length; k++) bd[k].copy(hullB.edgeDirs[k]).applyQuat(qRel);

  for (let i = 0; i < edgesA.length; i++) {
    const ea = edgesA[i];
    const pA = hullA.verts[ea.v0];
    const dirA = hullA.edgeDirs[i];
    const n0a = hullA.faces[ea.f0].normal;
    const n1a = hullA.faces[ea.f1].normal;

    for (let j = 0; j < edgesB.length; j++) {
      const eb = edgesB[j];
      if (!buildsMinkowskiFace(n0a, n1a, bn[eb.f0], bn[eb.f1])) continue;

      _axis.setCross(dirA, bd[j]);
      const l2 = _axis.lenSq();
      if (l2 < 1e-10) continue;                     // parallel edges
      _axis.scale(1 / Math.sqrt(l2));

      // Orient the axis away from A's interior (its centroid).
      _d.setSub(pA, hullA.centroid);
      if (dot3(_axis, _d) < 0) _axis.neg();

      _p.copy(hullB.verts[eb.v0]).applyQuat(qRel).add(tRel);
      _rel.setSub(_p, pA);
      const sep = dot3(_axis, _rel);

      if (sep > best) {
        best = sep;
        result.ia = i; result.ib = j;
        result.normal.copy(_axis);
      }
      if (sep > 0) { result.sep = best; return best; }
    }
  }
  result.sep = best;
  return best;
}

const _bNormals = [], _bEdgeDirs = [];
function ensureVecs(arr, n) {
  while (arr.length < n) arr.push(new Vec3());
  return arr;
}

/**
 * Gauss map arc-intersection test (Catto). `a`/`b` are the face normals of
 * edge A, `c`/`d` those of edge B (already in A's frame). The two arcs cross
 * — meaning the edge pair spans a face of the Minkowski difference — iff the
 * endpoints of each arc straddle the plane of the other, with matching sign.
 */
function buildsMinkowskiFace(a, b, c, d) {
  // The arcs on the B side are negated, since we're on the Minkowski
  // difference A ⊖ B.
  _bxa.setCross(b, a);
  _dxc.setCross(d, c);

  const cba = -dot3(c, _bxa);
  const dba = -dot3(d, _bxa);
  const adc = dot3(a, _dxc);
  const bdc = dot3(b, _dxc);

  return cba * dba < 0 && adc * bdc < 0 && cba * bdc > 0;
}

const _bxa = new Vec3(), _dxc = new Vec3(), _rel = new Vec3();

/** Single-point contact from the closest points of two skew edges. */
function buildEdgeContact(A, B, hullA, hullB, q, qRel, tRel, out) {
  const ea = hullA.edges[q.ia];
  const eb = hullB.edges[q.ib];

  const p1 = hullA.verts[ea.v0];
  _a.setSub(hullA.verts[ea.v1], p1);                 // dA

  _p.copy(hullB.verts[eb.v0]).applyQuat(qRel).add(tRel);
  _b.copy(hullB.verts[eb.v1]).applyQuat(qRel).add(tRel).sub(_p);   // dB

  closestSegmentPoints(p1, _a, _p, _b, _c, _d);      // → _c on A, _d on B

  const depth = -q.sep;
  if (depth < 0) return false;

  out.localNormal.copy(q.normal);
  out.normal.copy(q.normal).applyQuat(A.quat);
  out.count = 1;

  const cp = out.points[0];
  cp.depth = depth;
  cp.localA.copy(_c);
  cp.localB.copy(_d).sub(tRel).applyQuatInv(qRel);
  cp.point.setLerp(_c, _d, 0.5).applyQuat(A.quat).add(A.pos);
  cp.id = 0x40000 | (q.ia << 8) | q.ib;
  return true;
}

function closestSegmentPoints(p1, d1, p2, d2, outA, outB) {
  const r = _rel.setSub(p1, p2);
  const a = dot3(d1, d1), e = dot3(d2, d2), f = dot3(d2, r);
  let s = 0, t = 0;
  if (a < EPS && e < EPS) { outA.copy(p1); outB.copy(p2); return; }
  if (a < EPS) { t = clamp01(f / e); }
  else {
    const c = dot3(d1, r);
    if (e < EPS) { s = clamp01(-c / a); }
    else {
      const bb = dot3(d1, d2);
      const denom = a * e - bb * bb;
      s = denom > EPS ? clamp01((bb * f - c * e) / denom) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); }
      else if (t > 1) { t = 1; s = clamp01((bb - c) / a); }
    }
  }
  outA.copy(p1).addScaled(d1, s);
  outB.copy(p2).addScaled(d2, t);
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Reference face on `ref`, incident face on `inc`. Clips the incident polygon
 * against the reference face's side planes, keeps whatever is behind the
 * reference plane, and reduces to at most 4 well-spread points.
 *
 * `qRel`/`tRel` map inc's local space into ref's local space.
 */
function clipFaceContact(refBody, incBody, ref, inc, refFaceIdx, qRel, tRel, out) {
  const refFace = ref.faces[refFaceIdx];
  const rn = refFace.normal;

  // Incident face = the one on `inc` whose normal is most anti-parallel to the
  // reference normal, i.e. most aligned with -rn.
  _axis.copy(rn).neg().applyQuatInv(qRel);           // -rn expressed in inc's frame
  let bestDot = -Infinity, incIdx = 0;
  for (let i = 0; i < inc.faces.length; i++) {
    const d = dot3(inc.faces[i].normal, _axis);
    if (d > bestDot) { bestDot = d; incIdx = i; }
  }
  const incFace = inc.faces[incIdx];

  // Incident polygon, moved into ref's frame.
  let src = _polyA, dst = _polyB;
  let n = Math.min(incFace.indices.length, _polyA.length);
  for (let i = 0; i < n; i++) {
    src[i].copy(inc.verts[incFace.indices[i]]).applyQuat(qRel).add(tRel);
  }

  // Clip against every side plane of the reference face. cross(edge, refNormal)
  // points outward from a CCW loop, so the keep-test is dot(n, p) <= dot(n, v0).
  const idx = refFace.indices;
  for (let i = 0; i < idx.length; i++) {
    if (n === 0) return false;
    const v0 = ref.verts[idx[i]];
    const v1 = ref.verts[idx[(i + 1) % idx.length]];
    _a.setSub(v1, v0);
    _n.setCross(_a, rn);
    const l = _n.len();
    if (l < EPS) continue;
    _n.scale(1 / l);

    n = clipPolygon(src, n, _n, dot3(_n, v0), dst);
    const swap = src; src = dst; dst = swap;
  }
  if (n === 0) return false;

  // Keep only the points actually at or below the reference plane.
  const depths = _depthScratch;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const sep = dot3(rn, src[i]) - refFace.offset;
    if (sep > CLIP_TOLERANCE) continue;
    _keepPts[count].copy(src[i]);
    depths[count] = -sep;
    count++;
  }
  if (count === 0) return false;

  if (count > MAX_CONTACT_POINTS) count = reducePoints(_keepPts, depths, count, rn);

  out.localNormal.copy(rn);
  out.normal.copy(rn).applyQuat(refBody.quat);
  out.count = count;

  for (let i = 0; i < count; i++) {
    const cp = out.points[i];
    cp.depth = depths[i];
    // Anchor A sits on the reference surface so position correction pushes
    // cleanly along the plane normal.
    cp.localA.copy(_keepPts[i]).addScaled(rn, depths[i]);
    cp.localB.copy(_keepPts[i]).sub(tRel).applyQuatInv(qRel);
    cp.point.copy(_keepPts[i]).addScaled(rn, depths[i] * 0.5)
      .applyQuat(refBody.quat).add(refBody.pos);
    cp.id = (refFaceIdx << 20) | (incIdx << 8) | i;
  }
  void incBody;
  return true;
}

const _depthScratch = new Float64Array(64);
const _keepDepth = new Float64Array(64);

/** Sutherland–Hodgman against one plane: keep dot(n, p) <= d. */
function clipPolygon(src, n, planeN, planeD, dst) {
  let out = 0;
  for (let i = 0; i < n; i++) {
    const cur = src[i];
    const nxt = src[(i + 1) % n];
    const dc = dot3(planeN, cur) - planeD;
    const dn = dot3(planeN, nxt) - planeD;

    if (dc <= 0) {
      if (out < dst.length) dst[out++].copy(cur);
    }
    if ((dc > 0) !== (dn > 0)) {
      const t = dc / (dc - dn);
      if (out < dst.length) dst[out++].setLerp(cur, nxt, t);
    }
  }
  return out;
}

/**
 * Reduce a contact polygon to 4 points: the deepest one, the point furthest
 * from it, then the two that maximise the area of the quad. This keeps the
 * manifold's support region as wide as possible, which is what stops stacks
 * from wobbling.
 */
function reducePoints(pts, depths, count, normal) {
  // 1 — deepest.
  let i0 = 0;
  for (let i = 1; i < count; i++) if (depths[i] > depths[i0]) i0 = i;

  // 2 — furthest from it.
  let i1 = -1, best = -1;
  for (let i = 0; i < count; i++) {
    if (i === i0) continue;
    const d = pts[i].distSq(pts[i0]);
    if (d > best) { best = d; i1 = i; }
  }
  if (i1 < 0) return keepIndices(pts, depths, [i0]);

  // 3 & 4 — extremes of signed area on either side of the i0→i1 line.
  _a.setSub(pts[i1], pts[i0]);
  let i2 = -1, i3 = -1, maxA = 1e-9, minA = -1e-9;
  for (let i = 0; i < count; i++) {
    if (i === i0 || i === i1) continue;
    _b.setSub(pts[i], pts[i0]);
    _c.setCross(_a, _b);
    const area = dot3(_c, normal);
    if (area > maxA) { maxA = area; i2 = i; }
    if (area < minA) { minA = area; i3 = i; }
  }

  const keep = [i0, i1];
  if (i2 >= 0) keep.push(i2);
  if (i3 >= 0) keep.push(i3);
  return keepIndices(pts, depths, keep);
}

function keepIndices(pts, depths, keep) {
  for (let i = 0; i < keep.length; i++) {
    _tmpPts[i].copy(pts[keep[i]]);
    _keepDepth[i] = depths[keep[i]];
  }
  for (let i = 0; i < keep.length; i++) {
    pts[i].copy(_tmpPts[i]);
    depths[i] = _keepDepth[i];
  }
  return keep.length;
}

const _tmpPts = [new Vec3(), new Vec3(), new Vec3(), new Vec3()];

/* ─────────────────────────────────────────────────────────── raycasting ── */

/**
 * Ray vs a single body. Returns hit distance along `dir` (assumed unit) or -1.
 * Used by telekinesis aiming and the camera's wall-avoidance probe.
 */
export function raycastBody(body, origin, dir, maxDist, outNormal) {
  const shape = body.shape;
  // Into the body's local frame.
  _p.copy(origin).sub(body.pos).applyQuatInv(body.quat);
  _q.copy(dir).applyQuatInv(body.quat);

  if (shape.type === SPHERE) {
    const r = shape.radius;
    const b = dot3(_p, _q);
    const c = _p.lenSq() - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c;
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = 0;
    if (t > maxDist) return -1;
    if (outNormal) {
      outNormal.copy(_p).addScaled(_q, t).normalize().applyQuat(body.quat);
    }
    return t;
  }

  // Convex: slab method over the face planes.
  let tMin = 0, tMax = maxDist, hitFace = -1;
  const faces = shape.faces;
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const denom = dot3(f.normal, _q);
    const dist = f.offset - dot3(f.normal, _p);
    if (Math.abs(denom) < EPS) {
      if (dist < 0) return -1;                   // parallel and outside
    } else {
      const t = dist / denom;
      if (denom < 0) {
        if (t > tMin) { tMin = t; hitFace = i; }
      } else if (t < tMax) {
        tMax = t;
      }
      if (tMin > tMax) return -1;
    }
  }
  if (hitFace < 0) return -1;
  if (outNormal) outNormal.copy(faces[hitFace].normal).applyQuat(body.quat);
  return tMin;
}
