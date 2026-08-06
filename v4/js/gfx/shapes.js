/**
 * The shape kit. Every object in the yard is assembled from these — there are
 * no imported models anywhere in v4, which keeps the whole world in source
 * control as readable code.
 *
 * Geometries are cached and shared aggressively; a hundred blades of grass
 * should cost one buffer, not a hundred.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { RoundedBoxGeometry } from '../../vendor/three/addons/RoundedBoxGeometry.js';
import { toon, flat, outline, C, INK } from './toon.js';

const _geo = new Map();
function cached(key, make) {
  let g = _geo.get(key);
  if (!g) { g = make(); _geo.set(key, g); }
  return g;
}

/* ───────────────────────────────────────────────────────────── primitives ── */

export function boxGeo(w, h, d, r = Math.min(w, h, d) * 0.16, seg = 3) {
  return cached(`box|${w}|${h}|${d}|${r}|${seg}`,
    () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) * 0.49)));
}

export function box(w, h, d, color, opts = {}) {
  const { radius, seg, ...matOpts } = opts;
  return new THREE.Mesh(boxGeo(w, h, d, radius, seg), toon(color, matOpts));
}

export function sphereGeo(r, seg = 20) {
  return cached(`sph|${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)));
}

export function sphere(r, color, opts = {}) {
  const { seg, ...matOpts } = opts;
  return new THREE.Mesh(sphereGeo(r, seg), toon(color, matOpts));
}

export function capsuleGeo(r, len, seg = 14) {
  return cached(`cap|${r}|${len}|${seg}`, () => new THREE.CapsuleGeometry(r, len, 4, seg));
}

export function capsule(r, len, color, opts = {}) {
  const { seg, ...matOpts } = opts;
  return new THREE.Mesh(capsuleGeo(r, len, seg), toon(color, matOpts));
}

export function cylGeo(rt, rb, h, seg = 16) {
  return cached(`cyl|${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}

export function cyl(rt, rb, h, color, opts = {}) {
  const { seg, ...matOpts } = opts;
  return new THREE.Mesh(cylGeo(rt, rb, h, seg), toon(color, matOpts));
}

export function coneGeo(r, h, seg = 16) {
  return cached(`cone|${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
}

export function cone(r, h, color, opts = {}) {
  const { seg, ...matOpts } = opts;
  return new THREE.Mesh(coneGeo(r, h, seg), toon(color, matOpts));
}

export function torusGeo(r, tube, seg = 20, rings = 10, arc = Math.PI * 2) {
  return cached(`tor|${r}|${tube}|${seg}|${rings}|${arc}`,
    () => new THREE.TorusGeometry(r, tube, rings, seg, arc));
}

export function torus(r, tube, color, opts = {}) {
  const { seg, rings, arc, ...matOpts } = opts;
  return new THREE.Mesh(torusGeo(r, tube, seg, rings, arc), toon(color, matOpts));
}

/** Convenience: place a mesh and return it, so builders stay declarative. */
export function at(mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

export function group(...children) {
  const g = new THREE.Group();
  for (const c of children) if (c) g.add(c);
  return g;
}

/* ─────────────────────────────────────────────────────────────── scenery ── */

/**
 * A chunky cartoon tree. `kind` 0 is a rounded ball canopy, 1 is a stack of
 * cones (pine), 2 is a wide flat palm-ish umbrella.
 */
export function tree(rng, kind = Math.floor(rng() * 3), scale = 1) {
  const g = new THREE.Group();
  const h = (1.5 + rng() * 0.9) * scale;
  const trunk = at(cyl(0.14 * scale, 0.2 * scale, h, C.trunk, { seg: 8 }), 0, h / 2, 0);
  trunk.rotation.z = (rng() - 0.5) * 0.12;
  g.add(trunk);

  const leafColor = rng() > 0.5 ? C.leaf : C.leafAlt;
  if (kind === 1) {
    for (let i = 0; i < 3; i++) {
      const r = (0.85 - i * 0.2) * scale;
      g.add(at(cone(r, 1.0 * scale, leafColor, { seg: 9 }), 0, h + 0.15 * scale + i * 0.55 * scale, 0));
    }
  } else if (kind === 2) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rng();
      const frond = at(box(1.5 * scale, 0.12 * scale, 0.5 * scale, leafColor),
        Math.cos(a) * 0.6 * scale, h + 0.1 * scale, Math.sin(a) * 0.6 * scale, 0, -a, -0.35);
      g.add(frond);
    }
  } else {
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const r = (0.62 + rng() * 0.34) * scale;
      g.add(at(sphere(r, leafColor, { seg: 12 }),
        (rng() - 0.5) * 0.55 * scale, h + (0.25 + rng() * 0.45) * scale, (rng() - 0.5) * 0.55 * scale));
    }
  }
  return g;
}

/** Lumpy rock cluster — spheres squashed on Y so they read as boulders. */
export function rock(rng, scale = 1) {
  const g = new THREE.Group();
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const r = (0.3 + rng() * 0.4) * scale;
    const s = sphere(r, rng() > 0.4 ? C.rock : C.rockDark, { seg: 7 });
    s.scale.set(1, 0.68 + rng() * 0.25, 1);
    g.add(at(s, (rng() - 0.5) * scale, r * 0.55, (rng() - 0.5) * scale));
  }
  return g;
}

/** Tufts of grass — three thin blades fanned out. */
export function grassTuft(rng, scale = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const h = (0.28 + rng() * 0.3) * scale;
    const blade = at(box(0.07 * scale, h, 0.05 * scale, C.grassDark, { radius: 0.02 }),
      (rng() - 0.5) * 0.25 * scale, h / 2, (rng() - 0.5) * 0.25 * scale,
      (rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5);
    blade.userData.noOutline = true;
    g.add(blade);
  }
  return g;
}

/** A fluffy cloud made of overlapping spheres, unlit so it stays bright. */
export function cloud(rng, scale = 1) {
  const g = new THREE.Group();
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const r = (0.8 + rng() * 0.8) * scale;
    const m = new THREE.Mesh(sphereGeo(r, 10), flat(0xffffff, { transparent: true, opacity: 0.94 }));
    m.userData.noOutline = true;
    g.add(at(m, (i - n / 2) * 0.9 * scale + (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.35 * scale, (rng() - 0.5) * 0.6 * scale));
  }
  return g;
}

/* ─────────────────────────────────────────────────────────── signs & UI ── */

/**
 * A wooden signpost with a canvas-textured board. Returns the group with
 * `.board` exposed so callers can retexture or animate it.
 */
export function signpost(texture, w = 2.2, h = 1.3, postH = 1.5) {
  const g = new THREE.Group();
  const post = at(cyl(0.09, 0.11, postH, C.woodDark, { seg: 8 }), 0, postH / 2, 0);
  g.add(post);

  const frame = at(box(w + 0.18, h + 0.18, 0.16, C.wood), 0, postH + h / 2 - 0.05, 0);
  g.add(frame);

  const board = at(new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    flat(0xffffff, { map: texture, toneMapped: false }),
  ), 0, postH + h / 2 - 0.05, 0.085);
  board.userData.noOutline = true;
  g.add(board);

  outline(post, 0.03);
  outline(frame, 0.035);
  g.board = board;
  g.frame = frame;
  return g;
}

/** A floating "!" style prompt bubble that hovers over interactables. */
export function bubble(texture, w = 1.1, h = 1.1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    flat(0xffffff, { map: texture, transparent: true, toneMapped: false }),
  );
  m.userData.noOutline = true;
  m.material.depthWrite = false;
  m.renderOrder = 4;
  return m;
}
