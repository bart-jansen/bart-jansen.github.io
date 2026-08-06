/**
 * 3D math — Vec3, Quat, Mat3, Mat4.
 *
 * Mutating methods return `this` so chains don't allocate. Every operation that
 * has to produce a new value is either a `*_out` variant or a free function
 * ending in `2` (binary, allocating). The hot loops in the solver use the
 * scratch pool at the bottom of this file instead.
 */

export const EPS = 1e-9;
export const DEG = Math.PI / 180;

/* ═══════════════════════════════════════════════════════════════ Vec3 ══ */

export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }

  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  zero() { this.x = this.y = this.z = 0; return this; }

  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  mul(v) { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  neg() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }

  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  subScaled(v, s) { this.x -= v.x * s; this.y -= v.y * s; this.z -= v.z * s; return this; }

  setSub(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  setAdd(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  setScale(v, s) { this.x = v.x * s; this.y = v.y * s; this.z = v.z * s; return this; }
  setCross(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  setLerp(a, b, t) {
    this.x = a.x + (b.x - a.x) * t;
    this.y = a.y + (b.y - a.y) * t;
    this.z = a.z + (b.z - a.z) * t;
    return this;
  }

  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  lenSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }

  distSq(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  dist(v) { return Math.sqrt(this.distSq(v)); }

  normalize() {
    const l = this.len();
    if (l > EPS) { this.x /= l; this.y /= l; this.z /= l; }
    return this;
  }

  clampLength(max) {
    const l = this.len();
    if (l > max && l > EPS) this.scale(max / l);
    return this;
  }

  lerp(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  /** Rotate this vector by a quaternion, in place. */
  applyQuat(q) {
    const { x, y, z } = this;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + (qy * tz - qz * ty);
    this.y = y + qw * ty + (qz * tx - qx * tz);
    this.z = z + qw * tz + (qx * ty - qy * tx);
    return this;
  }

  /** Rotate by the conjugate of q — i.e. world → local. */
  applyQuatInv(q) {
    const { x, y, z } = this;
    const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + (qy * tz - qz * ty);
    this.y = y + qw * ty + (qz * tx - qx * tz);
    this.z = z + qw * tz + (qx * ty - qy * tx);
    return this;
  }

  applyMat3(m) {
    const { x, y, z } = this, e = m.e;
    this.x = e[0] * x + e[3] * y + e[6] * z;
    this.y = e[1] * x + e[4] * y + e[7] * z;
    this.z = e[2] * x + e[5] * y + e[8] * z;
    return this;
  }

  /** Full 4×4 transform including translation. */
  applyMat4(m) {
    const { x, y, z } = this, e = m.e;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
    return this;
  }

  isFinite() {
    return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z);
  }

  toArray() { return [this.x, this.y, this.z]; }
}

export const v3 = (x, y, z) => new Vec3(x, y, z);
export const sub3 = (a, b) => new Vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const add3 = (a, b) => new Vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const cross3 = (a, b) => new Vec3(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x,
);
export const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const scale3 = (v, s) => new Vec3(v.x * s, v.y * s, v.z * s);

/** Any unit vector perpendicular to n, plus its partner — a stable basis. */
export function orthoBasis(n, t1, t2) {
  // Branchless Frisvad / Duff et al.; avoids the degeneracy near n.z === -1.
  const sign = n.z >= 0 ? 1 : -1;
  const a = -1 / (sign + n.z);
  const b = n.x * n.y * a;
  t1.set(1 + sign * n.x * n.x * a, sign * b, -sign * n.x);
  t2.set(b, sign + n.y * n.y * a, -n.y);
}

/* ═══════════════════════════════════════════════════════════════ Quat ══ */

export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }

  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  identity() { return this.set(0, 0, 0, 1); }
  conjugate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }

  setAxisAngle(axis, angle) {
    const h = angle * 0.5, s = Math.sin(h);
    this.x = axis.x * s; this.y = axis.y * s; this.z = axis.z * s;
    this.w = Math.cos(h);
    return this;
  }

  setEuler(x, y, z) {
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    // YXZ order — matches yaw/pitch/roll cameras.
    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 - s1 * s2 * c3;
    this.w = c1 * c2 * c3 + s1 * s2 * s3;
    return this;
  }

  /** Shortest-arc rotation taking unit vector `from` to unit vector `to`. */
  setFromTo(from, to) {
    const d = dot3(from, to);
    if (d >= 1 - 1e-6) return this.identity();
    if (d <= -1 + 1e-6) {
      // Antiparallel — any perpendicular axis will do.
      const t1 = new Vec3(), t2 = new Vec3();
      orthoBasis(from, t1, t2);
      return this.setAxisAngle(t1, Math.PI);
    }
    const c = cross3(from, to);
    this.x = c.x; this.y = c.y; this.z = c.z;
    this.w = 1 + d;
    return this.normalize();
  }

  mul(q) { return this.setMul(this, q); }

  setMul(a, b) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w;
    const bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = aw * bx + ax * bw + ay * bz - az * by;
    this.y = aw * by - ax * bz + ay * bw + az * bx;
    this.z = aw * bz + ax * by - ay * bx + az * bw;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }

  normalize() {
    const l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (l > EPS) { this.x /= l; this.y /= l; this.z /= l; this.w /= l; }
    else this.identity();
    return this;
  }

  /**
   * Integrate an angular velocity for dt: q' = normalize(q + 0.5 · ω ⊗ q · dt).
   * First-order but stable once renormalised, which is all a game needs.
   */
  integrate(omega, dt) {
    const h = dt * 0.5;
    const ox = omega.x * h, oy = omega.y * h, oz = omega.z * h;
    const { x, y, z, w } = this;
    this.x += ox * w + oy * z - oz * y;
    this.y += oy * w + oz * x - ox * z;
    this.z += oz * w + ox * y - oy * x;
    this.w += -(ox * x + oy * y + oz * z);
    return this.normalize();
  }

  slerp(q, t) {
    let cos = this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
    let bx = q.x, by = q.y, bz = q.z, bw = q.w;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let s0, s1;
    if (cos > 0.9995) { s0 = 1 - t; s1 = t; }
    else {
      const theta = Math.acos(cos), sin = Math.sin(theta);
      s0 = Math.sin((1 - t) * theta) / sin;
      s1 = Math.sin(t * theta) / sin;
    }
    this.x = s0 * this.x + s1 * bx;
    this.y = s0 * this.y + s1 * by;
    this.z = s0 * this.z + s1 * bz;
    this.w = s0 * this.w + s1 * bw;
    return this.normalize();
  }

  isFinite() {
    return Number.isFinite(this.x) && Number.isFinite(this.y)
        && Number.isFinite(this.z) && Number.isFinite(this.w);
  }
}

export const quat = (x, y, z, w) => new Quat(x, y, z, w);

/* ═══════════════════════════════════════════════════════════════ Mat3 ══ */

/** Column-major 3×3, matching the GL convention used by Mat4. */
export class Mat3 {
  constructor() { this.e = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]); }

  identity() {
    const e = this.e;
    e[0] = 1; e[1] = 0; e[2] = 0;
    e[3] = 0; e[4] = 1; e[5] = 0;
    e[6] = 0; e[7] = 0; e[8] = 1;
    return this;
  }

  setDiagonal(x, y, z) {
    const e = this.e;
    e[0] = x; e[1] = 0; e[2] = 0;
    e[3] = 0; e[4] = y; e[5] = 0;
    e[6] = 0; e[7] = 0; e[8] = z;
    return this;
  }

  copy(m) { this.e.set(m.e); return this; }
  clone() { return new Mat3().copy(this); }

  setFromQuat(q) {
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const e = this.e;
    e[0] = 1 - (yy + zz); e[1] = xy + wz;       e[2] = xz - wy;
    e[3] = xy - wz;       e[4] = 1 - (xx + zz); e[5] = yz + wx;
    e[6] = xz + wy;       e[7] = yz - wx;       e[8] = 1 - (xx + yy);
    return this;
  }

  /** this = A · B */
  setMul(A, B) {
    const a = A.e, b = B.e, e = this.e;
    const a00 = a[0], a01 = a[3], a02 = a[6];
    const a10 = a[1], a11 = a[4], a12 = a[7];
    const a20 = a[2], a21 = a[5], a22 = a[8];
    const b00 = b[0], b01 = b[3], b02 = b[6];
    const b10 = b[1], b11 = b[4], b12 = b[7];
    const b20 = b[2], b21 = b[5], b22 = b[8];
    e[0] = a00 * b00 + a01 * b10 + a02 * b20;
    e[1] = a10 * b00 + a11 * b10 + a12 * b20;
    e[2] = a20 * b00 + a21 * b10 + a22 * b20;
    e[3] = a00 * b01 + a01 * b11 + a02 * b21;
    e[4] = a10 * b01 + a11 * b11 + a12 * b21;
    e[5] = a20 * b01 + a21 * b11 + a22 * b21;
    e[6] = a00 * b02 + a01 * b12 + a02 * b22;
    e[7] = a10 * b02 + a11 * b12 + a12 * b22;
    e[8] = a20 * b02 + a21 * b12 + a22 * b22;
    return this;
  }

  transpose() {
    const e = this.e;
    let t;
    t = e[1]; e[1] = e[3]; e[3] = t;
    t = e[2]; e[2] = e[6]; e[6] = t;
    t = e[5]; e[5] = e[7]; e[7] = t;
    return this;
  }

  /** this = R · D · Rᵀ — the world-space inertia tensor of a diagonal body. */
  setRotatedDiagonal(q, dx, dy, dz) {
    const r = _m3a.setFromQuat(q).e;
    const e = this.e;
    // R · diag(d)
    const m00 = r[0] * dx, m01 = r[3] * dy, m02 = r[6] * dz;
    const m10 = r[1] * dx, m11 = r[4] * dy, m12 = r[7] * dz;
    const m20 = r[2] * dx, m21 = r[5] * dy, m22 = r[8] * dz;
    // (R · diag(d)) · Rᵀ
    e[0] = m00 * r[0] + m01 * r[3] + m02 * r[6];
    e[1] = m10 * r[0] + m11 * r[3] + m12 * r[6];
    e[2] = m20 * r[0] + m21 * r[3] + m22 * r[6];
    e[3] = m00 * r[1] + m01 * r[4] + m02 * r[7];
    e[4] = m10 * r[1] + m11 * r[4] + m12 * r[7];
    e[5] = m20 * r[1] + m21 * r[4] + m22 * r[7];
    e[6] = m00 * r[2] + m01 * r[5] + m02 * r[8];
    e[7] = m10 * r[2] + m11 * r[5] + m12 * r[8];
    e[8] = m20 * r[2] + m21 * r[5] + m22 * r[8];
    return this;
  }

  /** out = this · v */
  transform(v, out) {
    const e = this.e, x = v.x, y = v.y, z = v.z;
    out.x = e[0] * x + e[3] * y + e[6] * z;
    out.y = e[1] * x + e[4] * y + e[7] * z;
    out.z = e[2] * x + e[5] * y + e[8] * z;
    return out;
  }

  invert() {
    const e = this.e;
    const a = e[0], b = e[1], c = e[2];
    const d = e[3], f = e[4], g = e[5];
    const h = e[6], i = e[7], j = e[8];
    const A = f * j - g * i, B = g * h - d * j, C = d * i - f * h;
    let det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-16) return this.identity();
    det = 1 / det;
    e[0] = A * det;               e[1] = (c * i - b * j) * det; e[2] = (b * g - c * f) * det;
    e[3] = B * det;               e[4] = (a * j - c * h) * det; e[5] = (c * d - a * g) * det;
    e[6] = C * det;               e[7] = (b * h - a * i) * det; e[8] = (a * f - b * d) * det;
    return this;
  }
}

/* ═══════════════════════════════════════════════════════════════ Mat4 ══ */

/** Column-major 4×4, directly uploadable to GL. */
export class Mat4 {
  constructor() {
    this.e = new Float32Array(16);
    this.identity();
  }

  identity() {
    const e = this.e;
    e[0] = 1; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
    e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
    return this;
  }

  copy(m) { this.e.set(m.e); return this; }
  clone() { return new Mat4().copy(this); }

  /** Compose translation · rotation · scale. */
  compose(pos, q, sx = 1, sy = sx, sz = sx) {
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const e = this.e;
    e[0] = (1 - (yy + zz)) * sx; e[1] = (xy + wz) * sx;       e[2] = (xz - wy) * sx;       e[3] = 0;
    e[4] = (xy - wz) * sy;       e[5] = (1 - (xx + zz)) * sy; e[6] = (yz + wx) * sy;       e[7] = 0;
    e[8] = (xz + wy) * sz;       e[9] = (yz - wx) * sz;       e[10] = (1 - (xx + yy)) * sz; e[11] = 0;
    e[12] = pos.x; e[13] = pos.y; e[14] = pos.z; e[15] = 1;
    return this;
  }

  setMul(A, B) {
    const a = A.e, b = B.e, e = this.e;
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      e[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      e[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      e[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      e[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return this;
  }

  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const e = this.e;
    e[0] = f / aspect; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = f; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[11] = -1;
    e[12] = 0; e[13] = 0; e[15] = 0;
    const nf = 1 / (near - far);
    e[10] = (far + near) * nf;
    e[14] = 2 * far * near * nf;
    return this;
  }

  ortho(l, r, b, t, n, f) {
    const e = this.e;
    const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    e[0] = -2 * lr; e[1] = 0; e[2] = 0; e[3] = 0;
    e[4] = 0; e[5] = -2 * bt; e[6] = 0; e[7] = 0;
    e[8] = 0; e[9] = 0; e[10] = 2 * nf; e[11] = 0;
    e[12] = (l + r) * lr; e[13] = (t + b) * bt; e[14] = (f + n) * nf; e[15] = 1;
    return this;
  }

  lookAt(eye, center, up) {
    const zx = eye.x - center.x, zy = eye.y - center.y, zz = eye.z - center.z;
    let zl = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (zl < EPS) return this.identity();
    zl = 1 / zl;
    const z0 = zx * zl, z1 = zy * zl, z2 = zz * zl;
    let x0 = up.y * z2 - up.z * z1;
    let x1 = up.z * z0 - up.x * z2;
    let x2 = up.x * z1 - up.y * z0;
    let xl = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (xl < EPS) { x0 = 1; x1 = 0; x2 = 0; } else { xl = 1 / xl; x0 *= xl; x1 *= xl; x2 *= xl; }
    const y0 = z1 * x2 - z2 * x1;
    const y1 = z2 * x0 - z0 * x2;
    const y2 = z0 * x1 - z1 * x0;
    const e = this.e;
    e[0] = x0; e[1] = y0; e[2] = z0; e[3] = 0;
    e[4] = x1; e[5] = y1; e[6] = z1; e[7] = 0;
    e[8] = x2; e[9] = y2; e[10] = z2; e[11] = 0;
    e[12] = -(x0 * eye.x + x1 * eye.y + x2 * eye.z);
    e[13] = -(y0 * eye.x + y1 * eye.y + y2 * eye.z);
    e[14] = -(z0 * eye.x + z1 * eye.y + z2 * eye.z);
    e[15] = 1;
    return this;
  }

  invert() {
    const m = this.e;
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return this.identity();
    det = 1 / det;
    m[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    m[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    m[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    m[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    m[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    m[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    m[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    m[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    m[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    m[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    m[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    m[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    m[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    m[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    m[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    m[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return this;
  }

  /** Upper-left 3×3, inverse-transposed — for transforming normals. */
  normalMatrix(out) {
    const e = this.e, o = out.e;
    o[0] = e[0]; o[1] = e[1]; o[2] = e[2];
    o[3] = e[4]; o[4] = e[5]; o[5] = e[6];
    o[6] = e[8]; o[7] = e[9]; o[8] = e[10];
    return out.invert().transpose();
  }
}

export const mat4 = () => new Mat4();

/* ═════════════════════════════════════════════════════════════ scalars ══ */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Deterministic PRNG — used so the arena layout is identical every reload. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════════════════════════════════════════════════════════ pool ══ */

const _m3a = new Mat3();

/**
 * A tiny stack allocator. Solver inner loops call `pushVec()` at the top and
 * `popVecs(n)` at the bottom instead of allocating, which keeps the GC quiet
 * during a 120 Hz simulation.
 */
const POOL = [];
let poolTop = 0;
for (let i = 0; i < 256; i++) POOL.push(new Vec3());

export function pushVec(x = 0, y = 0, z = 0) {
  if (poolTop >= POOL.length) POOL.push(new Vec3());
  return POOL[poolTop++].set(x, y, z);
}
export function poolMark() { return poolTop; }
export function poolRelease(mark) { poolTop = mark; }
