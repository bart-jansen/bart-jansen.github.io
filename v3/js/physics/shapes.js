/**
 * Collision shapes.
 *
 * Two kinds only: SPHERE and CONVEX. Everything in the arena — boxes, wedges,
 * cylinders, prisms, capsule-ish pills — is a convex hull, which means one SAT
 * routine covers the whole world.
 *
 * A hull carries more than its vertices: SAT needs face planes and a *deduped*
 * edge list (an edge shared by two faces must only be tested once, or the
 * axis count explodes). We precompute both at construction time since arena
 * geometry never changes shape.
 */

import { Vec3, v3, cross3, sub3, dot3, EPS } from '../math.js';

export const SPHERE = 0;
export const CONVEX = 1;

let shapeId = 0;

/* ════════════════════════════════════════════════════════════ Sphere ══ */

export class Sphere {
  constructor(radius) {
    this.id = shapeId++;
    this.type = SPHERE;
    this.radius = radius;
    this.boundingRadius = radius;
  }

  /** Solid-sphere inertia about the centre, per unit mass. */
  inertiaPerMass(out) {
    const i = 0.4 * this.radius * this.radius;
    return out.set(i, i, i);
  }

  volume() { return (4 / 3) * Math.PI * this.radius ** 3; }

  supportLocal(dir, out) {
    return out.copy(dir).normalize().scale(this.radius);
  }
}

/* ══════════════════════════════════════════════════════════════ Hull ══ */

export class Face {
  constructor(indices, normal, offset) {
    this.indices = indices;   // vertex indices, CCW when seen from outside
    this.normal = normal;     // unit outward normal
    this.offset = offset;     // plane: dot(n, x) = offset
  }
}

export class Convex {
  /**
   * @param {number[][]} verts  raw [x,y,z] triples
   * @param {number[][]} faces  index loops, CCW from outside
   */
  constructor(verts, faces) {
    this.id = shapeId++;
    this.type = CONVEX;

    this.verts = verts.map(([x, y, z]) => v3(x, y, z));

    this.faces = faces.map((loop) => {
      const n = faceNormal(this.verts, loop);
      const p = this.verts[loop[0]];
      return new Face(loop, n, dot3(n, p));
    });

    // Deduped edges, each tagged with the two faces that share it. The face
    // pair is what makes Gauss-map pruning possible in the SAT edge query —
    // without it, box-vs-box would test 144 axes instead of a handful.
    this.edges = uniqueEdges(faces);
    this.edgeDirs = this.edges.map((e) => sub3(this.verts[e.v1], this.verts[e.v0]).normalize());

    let br = 0;
    // Half-extents of the local AABB about the origin. Combined with the
    // rotation matrix these give a tight world AABB without re-projecting
    // every vertex each frame.
    this.localHalf = new Vec3();
    for (const v of this.verts) {
      br = Math.max(br, v.lenSq());
      this.localHalf.x = Math.max(this.localHalf.x, Math.abs(v.x));
      this.localHalf.y = Math.max(this.localHalf.y, Math.abs(v.y));
      this.localHalf.z = Math.max(this.localHalf.z, Math.abs(v.z));
    }
    this.boundingRadius = Math.sqrt(br);

    const props = hullMassProperties(this.verts, this.faces);
    this._volume = props.volume;
    this._inertia = props.inertia;   // per unit mass, about the centroid
    this.centroid = props.centroid;
  }

  inertiaPerMass(out) { return out.copy(this._inertia); }
  volume() { return this._volume; }

  /** Furthest vertex along `dir` (local space). */
  supportLocal(dir, out) {
    let best = -Infinity, bi = 0;
    const vs = this.verts;
    for (let i = 0; i < vs.length; i++) {
      const d = vs[i].x * dir.x + vs[i].y * dir.y + vs[i].z * dir.z;
      if (d > best) { best = d; bi = i; }
    }
    return out.copy(vs[bi]);
  }
}

function faceNormal(verts, loop) {
  // Newell's method — robust for slightly non-planar loops, which cylinder
  // caps and rounded prisms will produce after float rounding.
  const n = new Vec3();
  for (let i = 0; i < loop.length; i++) {
    const a = verts[loop[i]];
    const b = verts[loop[(i + 1) % loop.length]];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.normalize();
}

function uniqueEdges(faces) {
  const map = new Map();
  faces.forEach((loop, fi) => {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = map.get(key);
      if (hit) { if (hit.f1 < 0) hit.f1 = fi; }
      else map.set(key, { v0: a, v1: b, f0: fi, f1: -1 });
    }
  });
  const out = [];
  for (const e of map.values()) {
    // An open edge (only one adjacent face) means the hull isn't closed; keep
    // it but point both slots at the same face so the Gauss test degenerates
    // safely instead of reading a -1 normal.
    if (e.f1 < 0) e.f1 = e.f0;
    out.push(e);
  }
  return out;
}

/**
 * Exact volume + inertia of a closed polyhedron by tetrahedral decomposition
 * from the origin. Signed volumes cancel correctly for any origin inside or
 * outside, so we don't need a point known to be interior.
 */
function hullMassProperties(verts, faces) {
  let volume = 0;
  const centroid = new Vec3();
  // Accumulate the covariance integrals of the solid.
  let xx = 0, yy = 0, zz = 0, xy = 0, xz = 0, yz = 0;

  const canonical = new Vec3(0.5, 0.5, 0.5);
  const CANON = [
    [1 / 60, 1 / 120, 1 / 120],
    [1 / 120, 1 / 60, 1 / 120],
    [1 / 120, 1 / 120, 1 / 60],
  ];

  for (const f of faces) {
    const idx = f.indices;
    const a = verts[idx[0]];
    for (let i = 1; i < idx.length - 1; i++) {
      const b = verts[idx[i]];
      const c = verts[idx[i + 1]];

      const det = dot3(a, cross3(b, c));   // 6 × signed tet volume
      const vol = det / 6;
      volume += vol;

      centroid.x += vol * (a.x + b.x + c.x) * 0.25;
      centroid.y += vol * (a.y + b.y + c.y) * 0.25;
      centroid.z += vol * (a.z + b.z + c.z) * 0.25;

      // Second moments of a tet (0,a,b,c) — standard closed form.
      for (let p = 0; p < 3; p++) {
        const ap = comp(a, p), bp = comp(b, p), cp = comp(c, p);
        const diag = det * (ap * ap + bp * bp + cp * cp + ap * bp + ap * cp + bp * cp) / 60;
        if (p === 0) xx += diag; else if (p === 1) yy += diag; else zz += diag;
      }
      xy += det * pairMoment(a, b, c, 0, 1);
      xz += det * pairMoment(a, b, c, 0, 2);
      yz += det * pairMoment(a, b, c, 1, 2);
    }
  }
  void canonical; void CANON;

  if (Math.abs(volume) < 1e-12) {
    return { volume: 1e-9, inertia: v3(1, 1, 1), centroid: new Vec3() };
  }
  centroid.scale(1 / volume);

  const invV = 1 / volume;
  xx *= invV; yy *= invV; zz *= invV;
  xy *= invV; xz *= invV; yz *= invV;

  // Shift the covariance from the origin to the centroid (parallel axis).
  const { x: cx, y: cy, z: cz } = centroid;
  xx -= cx * cx; yy -= cy * cy; zz -= cz * cz;
  xy -= cx * cy; xz -= cx * cz; yz -= cy * cz;

  // Inertia diagonal per unit mass. Off-diagonals are dropped: every hull the
  // arena builds is symmetric about its own axes, so they're ~0 anyway, and a
  // diagonal tensor keeps the solver's invI cheap.
  const inertia = v3(yy + zz, xx + zz, xx + yy);
  if (inertia.x < EPS) inertia.x = EPS;
  if (inertia.y < EPS) inertia.y = EPS;
  if (inertia.z < EPS) inertia.z = EPS;

  return { volume: Math.abs(volume), inertia, centroid };
}

const comp = (v, i) => (i === 0 ? v.x : i === 1 ? v.y : v.z);

function pairMoment(a, b, c, i, j) {
  const ai = comp(a, i), bi = comp(b, i), ci = comp(c, i);
  const aj = comp(a, j), bj = comp(b, j), cj = comp(c, j);
  return (2 * (ai * aj + bi * bj + ci * cj)
        + ai * bj + bi * aj
        + ai * cj + ci * aj
        + bi * cj + ci * bj) / 120;
}

/* ═════════════════════════════════════════════════════════ generators ══ */

/** Axis-aligned box of half-extents (hx, hy, hz). */
export function boxShape(hx, hy = hx, hz = hx) {
  const v = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const f = [
    [4, 5, 6, 7],   // +z
    [1, 0, 3, 2],   // -z
    [5, 1, 2, 6],   // +x
    [0, 4, 7, 3],   // -x
    [3, 7, 6, 2],   // +y
    [0, 1, 5, 4],   // -y
  ];
  return new Convex(v, f);
}

/**
 * n-gon prism along Y — the workhorse for cylinders (n = 12+), hexagonal
 * plinths, triangular wedges (n = 3) and so on.
 */
export function prismShape(radius, halfHeight, sides = 12, twist = 0) {
  const v = [];
  for (let i = 0; i < sides; i++) {
    const a = twist + (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    v.push([x, halfHeight, z]);
  }
  for (let i = 0; i < sides; i++) {
    const a = twist + (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    v.push([x, -halfHeight, z]);
  }
  const top = [];
  for (let i = 0; i < sides; i++) top.push(i);
  const bottom = [];
  for (let i = sides - 1; i >= 0; i--) bottom.push(sides + i);

  const faces = [top.slice().reverse(), bottom.slice().reverse()];
  // Winding chosen so every side quad faces outward.
  faces[0] = top;
  faces[1] = bottom;
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faces.push([i, sides + i, sides + j, j]);
  }
  return fixWinding(new Convex(v, faces));
}

/** Right-angled wedge (a ramp): full size x by y by z, sloping down along +x. */
export function wedgeShape(hx, hy, hz) {
  const v = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, hz],
  ];
  const f = [
    [0, 1, 4, 3],   // bottom
    [2, 5, 4, 1],   // slope
    [0, 3, 5, 2],   // back
    [0, 2, 1],      // -z cap
    [3, 4, 5],      // +z cap
  ];
  return fixWinding(new Convex(v, f));
}

/** Flip any face whose normal points at the hull's own centre. */
function fixWinding(hull) {
  const c = new Vec3();
  for (const v of hull.verts) c.add(v);
  c.scale(1 / hull.verts.length);

  let flipped = false;
  const loops = hull.faces.map((f) => {
    const p = hull.verts[f.indices[0]];
    if (dot3(f.normal, sub3(p, c)) < 0) {
      flipped = true;
      return f.indices.slice().reverse();
    }
    return f.indices;
  });
  if (!flipped) return hull;
  return new Convex(hull.verts.map((v) => [v.x, v.y, v.z]), loops);
}

/**
 * Convex hull of an arbitrary point cloud (incremental / gift-wrap hybrid).
 * Used for the shattered debris chunks so no two are the same.
 */
export function hullFromPoints(points) {
  const pts = points.map((p) => (Array.isArray(p) ? v3(p[0], p[1], p[2]) : p.clone()));
  if (pts.length < 4) return boxShape(0.5);

  // Seed tetrahedron: extreme point pair, furthest from that line, furthest
  // from that plane.
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = pts[i].distSq(pts[j]);
      if (d > best) { best = d; i0 = i; i1 = j; }
    }
  }
  const lineDir = sub3(pts[i1], pts[i0]).normalize();
  let i2 = -1; best = 1e-8;
  for (let i = 0; i < pts.length; i++) {
    if (i === i0 || i === i1) continue;
    const w = sub3(pts[i], pts[i0]);
    const d = cross3(w, lineDir).lenSq();
    if (d > best) { best = d; i2 = i; }
  }
  if (i2 < 0) return boxShape(0.5);

  const planeN = cross3(sub3(pts[i1], pts[i0]), sub3(pts[i2], pts[i0])).normalize();
  let i3 = -1; best = 1e-8;
  for (let i = 0; i < pts.length; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    const d = Math.abs(dot3(sub3(pts[i], pts[i0]), planeN));
    if (d > best) { best = d; i3 = i; }
  }
  if (i3 < 0) return boxShape(0.5);

  let tris = [];
  const addTri = (a, b, c) => {
    const n = cross3(sub3(pts[b], pts[a]), sub3(pts[c], pts[a]));
    if (n.lenSq() < 1e-14) return;
    tris.push([a, b, c]);
  };
  // Orient the seed tet so all normals face outward from its own centroid.
  const seed = [i0, i1, i2, i3];
  const cen = new Vec3();
  for (const i of seed) cen.add(pts[i]);
  cen.scale(0.25);
  const faces4 = [[i0, i1, i2], [i0, i2, i3], [i0, i3, i1], [i1, i3, i2]];
  for (const [a, b, c] of faces4) {
    const n = cross3(sub3(pts[b], pts[a]), sub3(pts[c], pts[a]));
    if (dot3(n, sub3(pts[a], cen)) < 0) addTri(a, c, b); else addTri(a, b, c);
  }

  const used = new Set(seed);
  for (let p = 0; p < pts.length; p++) {
    if (used.has(p)) continue;
    const point = pts[p];

    const visible = [];
    for (const t of tris) {
      const a = pts[t[0]];
      const n = cross3(sub3(pts[t[1]], a), sub3(pts[t[2]], a));
      if (dot3(n, sub3(point, a)) > 1e-10) visible.push(t);
    }
    if (!visible.length) continue;

    // Horizon = edges appearing exactly once across the visible set.
    const counts = new Map();
    for (const t of visible) {
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const cur = counts.get(key);
        if (cur) cur.n++; else counts.set(key, { a, b, n: 1 });
      }
    }
    const vis = new Set(visible);
    tris = tris.filter((t) => !vis.has(t));
    for (const { a, b, n } of counts.values()) {
      if (n === 1) addTri(a, b, p);
    }
    used.add(p);
  }

  if (tris.length < 4) return boxShape(0.5);

  // Compact to only the vertices actually referenced.
  const remap = new Map();
  const outVerts = [];
  const outFaces = tris.map((t) => t.map((i) => {
    if (!remap.has(i)) {
      remap.set(i, outVerts.length);
      outVerts.push([pts[i].x, pts[i].y, pts[i].z]);
    }
    return remap.get(i);
  }));

  return mergeCoplanar(new Convex(outVerts, outFaces));
}

/**
 * Merge coplanar triangles into polygons. SAT is much happier with 6 quad
 * faces than 12 triangles — fewer axes, and the clipping produces flat,
 * well-conditioned manifolds instead of slivers.
 */
function mergeCoplanar(hull, tol = 1e-4) {
  const groups = [];
  for (const f of hull.faces) {
    let g = groups.find((x) =>
      Math.abs(dot3(x.normal, f.normal) - 1) < tol
      && Math.abs(x.offset - f.offset) < 1e-3);
    if (!g) { g = { normal: f.normal.clone(), offset: f.offset, tris: [] }; groups.push(g); }
    g.tris.push(f.indices);
  }
  if (groups.length === hull.faces.length) return hull;

  const loops = [];
  for (const g of groups) {
    if (g.tris.length === 1) { loops.push(g.tris[0]); continue; }
    // Boundary edges of the group, walked into a single loop.
    const edgeCount = new Map();
    for (const t of g.tris) {
      for (let e = 0; e < t.length; e++) {
        const a = t[e], b = t[(e + 1) % t.length];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const cur = edgeCount.get(key);
        if (cur) cur.n++; else edgeCount.set(key, { a, b, n: 1 });
      }
    }
    const next = new Map();
    for (const { a, b, n } of edgeCount.values()) if (n === 1) next.set(a, b);
    if (!next.size) { for (const t of g.tris) loops.push(t); continue; }

    const start = next.keys().next().value;
    const loop = [start];
    let cur = next.get(start);
    let guard = 0;
    while (cur !== undefined && cur !== start && guard++ < 64) {
      loop.push(cur);
      cur = next.get(cur);
    }
    if (loop.length >= 3 && cur === start) loops.push(loop);
    else for (const t of g.tris) loops.push(t);
  }

  try {
    return new Convex(hull.verts.map((v) => [v.x, v.y, v.z]), loops);
  } catch {
    return hull;
  }
}

/** Jittered box — a "rock". Deterministic when you pass a seeded rng. */
export function rockShape(radius, rng = Math.random, detail = 1) {
  const pts = [];
  const n = 6 + detail * 4;
  for (let i = 0; i < n; i++) {
    // Fibonacci sphere, jittered.
    const t = (i + 0.5) / n;
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = radius * (0.68 + rng() * 0.42);
    pts.push([
      Math.sin(phi) * Math.cos(theta) * r,
      Math.cos(phi) * r,
      Math.sin(phi) * Math.sin(theta) * r,
    ]);
  }
  return hullFromPoints(pts);
}
