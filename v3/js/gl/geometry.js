/**
 * Procedural geometry.
 *
 * Render meshes are generated *from the physics hulls themselves*, so what you
 * see is exactly what the solver collides with — no separate art asset can
 * drift out of sync with the simulation.
 *
 * Vertex layout (interleaved, 9 floats):
 *   0  position  vec3
 *   3  normal    vec3
 *   6  uv        vec2
 *   8  tag       float   — 1 on the face that should receive a texture
 *
 * Instance layout (18 floats): position, quaternion, scale, colour, params.
 */

import { Vec3, v3, dot3, orthoBasis } from '../math.js';

const UP = v3(0, 1, 0);

export const VERT_STRIDE = 9;
export const INSTANCE_FLOATS = 18;

export class MeshData {
  constructor() {
    this.verts = [];
    this.indices = [];
  }

  get vertexCount() { return this.verts.length / VERT_STRIDE; }

  push(px, py, pz, nx, ny, nz, u, v, tag) {
    this.verts.push(px, py, pz, nx, ny, nz, u, v, tag);
    return this.vertexCount - 1;
  }

  tri(a, b, c) { this.indices.push(a, b, c); return this; }

  toArrays() {
    return {
      verts: new Float32Array(this.verts),
      indices: (this.verts.length / VERT_STRIDE > 65535)
        ? new Uint32Array(this.indices)
        : new Uint16Array(this.indices),
    };
  }
}

/**
 * Flat-shaded mesh from a convex hull.
 * @param {Convex} hull
 * @param {number|number[]} texturedFaces face index (or indices) tagged for texturing
 */
export function meshFromHull(hull, texturedFaces = -1) {
  const tagged = Array.isArray(texturedFaces) ? new Set(texturedFaces)
    : texturedFaces >= 0 ? new Set([texturedFaces]) : new Set();

  const md = new MeshData();
  const t1 = new Vec3(), t2 = new Vec3(), rel = new Vec3();

  hull.faces.forEach((face, fi) => {
    const n = face.normal;
    const tag = tagged.has(fi) ? 1 : 0;
    if (tag) {
      // Textured faces need an upright basis or the screenshot ends up
      // sideways — orthoBasis only promises orthogonality, not "up is up".
      if (Math.abs(n.y) > 0.999) { t1.set(1, 0, 0); t2.set(0, 0, -Math.sign(n.y)); }
      else { t1.setCross(UP, n).normalize(); t2.setCross(n, t1).normalize(); }
    } else {
      orthoBasis(n, t1, t2);
    }

    // Planar UVs normalised to the face's own bounding box, so every face maps
    // the full [0,1] range regardless of its size or orientation. Textures are
    // uploaded with UNPACK_FLIP_Y, which is what keeps V the right way up.
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    const us = [], vs = [];
    for (const vi of face.indices) {
      rel.copy(hull.verts[vi]);
      const u = dot3(rel, t1), v = dot3(rel, t2);
      us.push(u); vs.push(v);
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const du = maxU - minU || 1, dv = maxV - minV || 1;

    const base = md.vertexCount;
    face.indices.forEach((vi, k) => {
      const p = hull.verts[vi];
      const u = (us[k] - minU) / du;
      const v = (vs[k] - minV) / dv;
      md.push(p.x, p.y, p.z, n.x, n.y, n.z, u, v, tag);
    });
    for (let k = 1; k < face.indices.length - 1; k++) md.tri(base, base + k, base + k + 1);
  });

  return md;
}

/** Smooth icosphere. `subdiv` 2 is plenty at gameplay distances. */
export function icosphere(radius = 1, subdiv = 2) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => v3(...p).normalize());

  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let s = 0; s < subdiv; s++) {
    const mid = new Map();
    const next = [];
    const midpoint = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(key);
      if (i !== undefined) return i;
      i = verts.length;
      verts.push(verts[a].clone().add(verts[b]).normalize());
      mid.set(key, i);
      return i;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  const md = new MeshData();
  // Duplicate per triangle so the equirect seam doesn't smear a whole band.
  for (const [a, b, c] of faces) {
    const tri = [verts[a], verts[b], verts[c]];
    const uvs = tri.map((p) => [Math.atan2(p.z, p.x) / (Math.PI * 2) + 0.5, Math.asin(p.y) / Math.PI + 0.5]);
    // Unwrap the seam: if the triangle straddles u=0/1, pull the low ones over.
    const maxU = Math.max(...uvs.map((u) => u[0]));
    if (maxU - Math.min(...uvs.map((u) => u[0])) > 0.5) {
      for (const u of uvs) if (u[0] < 0.5) u[0] += 1;
    }
    const base = md.vertexCount;
    tri.forEach((p, i) => md.push(
      p.x * radius, p.y * radius, p.z * radius,
      p.x, p.y, p.z, uvs[i][0], uvs[i][1], 0,
    ));
    md.tri(base, base + 1, base + 2);
  }
  return md;
}

/** Flat ground plane subdivided so vertex-level effects have somewhere to go. */
export function groundPlane(size, segments = 1) {
  const md = new MeshData();
  const step = (size * 2) / segments;
  for (let z = 0; z <= segments; z++) {
    for (let x = 0; x <= segments; x++) {
      md.push(-size + x * step, 0, -size + z * step, 0, 1, 0, x / segments, z / segments, 0);
    }
  }
  const row = segments + 1;
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const i = z * row + x;
      md.tri(i, i + row, i + 1);
      md.tri(i + 1, i + row, i + row + 1);
    }
  }
  return md;
}

/** Torus — used for the goal rings and the grab reticle in world space. */
export function torus(radius = 1, tube = 0.15, radial = 24, tubular = 10) {
  const md = new MeshData();
  for (let i = 0; i <= radial; i++) {
    const u = (i / radial) * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= tubular; j++) {
      const v = (j / tubular) * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      const x = (radius + tube * cv) * cu;
      const y = tube * sv;
      const z = (radius + tube * cv) * su;
      md.push(x, y, z, cv * cu, sv, cv * su, i / radial, j / tubular, 0);
    }
  }
  const row = tubular + 1;
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < tubular; j++) {
      const a = i * row + j;
      md.tri(a, a + row, a + 1);
      md.tri(a + 1, a + row, a + row + 1);
    }
  }
  return md;
}

/* ═══════════════════════════════════════════════════════════════ GPU ══ */

/**
 * One geometry uploaded once, drawn many times with per-instance transforms.
 * The instance buffer is a persistent Float32Array re-uploaded each frame —
 * simpler than mapped buffers and fast enough for the few thousand instances
 * this arena contains.
 */
export class Mesh {
  constructor(gl, meshData, capacity = 64) {
    this.gl = gl;
    const { verts, indices } = meshData.toArrays();
    this.indexCount = indices.length;
    this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const stride = VERT_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);

    this.ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    this.capacity = capacity;
    this.data = new Float32Array(capacity * INSTANCE_FLOATS);
    this.count = 0;

    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this._bindInstanceAttribs();

    gl.bindVertexArray(null);
  }

  _bindInstanceAttribs() {
    const gl = this.gl;
    const s = INSTANCE_FLOATS * 4;
    // 4: position, 5: quaternion, 6: scale, 7: colour, 8: params
    const layout = [[4, 3, 0], [5, 4, 12], [6, 3, 28], [7, 4, 40], [8, 4, 56]];
    for (const [loc, size, offset] of layout) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, s, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
  }

  begin() { this.count = 0; return this; }

  /** Append one instance. Grows the buffer if the arena spawns more debris. */
  add(pos, quat, sx, sy, sz, r, g, b, a, p0, p1, p2, p3) {
    if (this.count >= this.capacity) this._grow();
    const o = this.count * INSTANCE_FLOATS;
    const d = this.data;
    d[o] = pos.x; d[o + 1] = pos.y; d[o + 2] = pos.z;
    d[o + 3] = quat.x; d[o + 4] = quat.y; d[o + 5] = quat.z; d[o + 6] = quat.w;
    d[o + 7] = sx; d[o + 8] = sy; d[o + 9] = sz;
    d[o + 10] = r; d[o + 11] = g; d[o + 12] = b; d[o + 13] = a;
    d[o + 14] = p0; d[o + 15] = p1; d[o + 16] = p2; d[o + 17] = p3;
    this.count++;
  }

  _grow() {
    const gl = this.gl;
    this.capacity *= 2;
    const next = new Float32Array(this.capacity * INSTANCE_FLOATS);
    next.set(this.data);
    this.data = next;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this._bindInstanceAttribs();
    gl.bindVertexArray(null);
  }

  draw() {
    if (this.count === 0) return 0;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ibo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * INSTANCE_FLOATS);
    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, this.indexType, 0, this.count);
    gl.bindVertexArray(null);
    return 1;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ebo);
    gl.deleteBuffer(this.ibo);
  }
}
