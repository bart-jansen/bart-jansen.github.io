/**
 * The island: one chunky disc of grass sitting in a flat cartoon sea, with a
 * sand rim, a soil underside and four spurs radiating out to the zones.
 *
 * Collision is deliberately coarse. The whole island is a single static prism
 * whose top face is y = 0, plus a ring of boulders that keeps you (and the
 * loose props) from wandering into the water. Everything else you can walk on
 * is an explicit static box or wedge, so what you see and what you hit never
 * drift apart.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { Body, STATIC } from '../../../v3/js/physics/body.js';
import { boxShape, prismShape, wedgeShape } from '../../../v3/js/physics/shapes.js';
import { v3, Quat } from '../../../v3/js/math.js';
import { toon, flat, C } from '../gfx/toon.js';
import { tree, rock, grassTuft } from '../gfx/shapes.js';

export const ISLAND_RADIUS = 42;
export const SHORE_RADIUS = 47;

/** Zone anchors, in world XZ. The hub is the spawn. */
export const ZONE_AT = {
  hub: { x: 0, z: 0 },
  work: { x: 0, z: -27 },
  career: { x: 27, z: 0 },
  skills: { x: 0, z: 27 },
  school: { x: -27, z: 0 },
};

/** Static collider helper: keeps the mesh and the body in one place. */
function staticBody(world, shape, x, y, z, ry = 0, tag = '') {
  const b = new Body(shape, {
    type: STATIC,
    pos: v3(x, y, z),
    quat: ry ? new Quat().setEuler(0, ry, 0) : undefined,
    friction: 0.9,
    // Only bodies tagged 'terrain' push the camera in. Signs and frames are
    // thin enough that clipping through them for a frame beats the camera
    // slamming into your back every time you walk past one.
    tag,
  });
  world.add(b);
  return b;
}

export function createIsland(world, rng) {
  const group = new THREE.Group();
  const walkables = [];

  /* ─────────────────────────────────────────────────────────── the disc ── */

  // Physics: one prism, top face flush with y = 0.
  staticBody(world, prismShape(ISLAND_RADIUS + 1.5, 4, 22), 0, -4, 0, 0, 'terrain');

  const grassTop = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS, 1.4, 64, 1),
    toon(C.grass, { steps: 3 }));
  grassTop.position.y = -0.7;
  grassTop.receiveShadow = true;
  grassTop.userData.noOutline = true;
  group.add(grassTop);

  const sandRim = new THREE.Mesh(
    new THREE.CylinderGeometry(SHORE_RADIUS, SHORE_RADIUS - 1.2, 1.5, 64, 1),
    toon(C.sand, { steps: 3 }));
  sandRim.position.y = -1.05;
  sandRim.receiveShadow = true;
  sandRim.userData.noOutline = true;
  group.add(sandRim);

  // The underside: a fat inverted cone so the island reads as a floating chunk.
  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(SHORE_RADIUS - 1.2, 11, 13, 40, 1),
    toon(C.soil, { steps: 3 }));
  soil.position.y = -8.3;
  soil.userData.noOutline = true;
  group.add(soil);

  // Sea. Two discs: the flat body of water and a paler foam collar.
  const foam = new THREE.Mesh(
    new THREE.CylinderGeometry(SHORE_RADIUS + 3.2, SHORE_RADIUS + 3.2, 0.4, 64, 1),
    flat(C.foam, { transparent: true, opacity: 0.9 }));
  foam.position.y = -1.5;
  foam.userData.noOutline = true;
  group.add(foam);

  const seaMat = toon(C.water, { steps: 3, transparent: true, opacity: 0.94 });
  const sea = new THREE.Mesh(new THREE.CircleGeometry(340, 72), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -1.7;
  sea.userData.noOutline = true;
  group.add(sea);

  // A couple of lazy concentric ripples so the sea isn't a dead plate.
  const ripples = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(
      new THREE.RingGeometry(SHORE_RADIUS + 5 + i * 9, SHORE_RADIUS + 6.6 + i * 9, 72),
      flat(C.foam, { transparent: true, opacity: 0.3 - i * 0.07 }));
    r.rotation.x = -Math.PI / 2;
    r.position.y = -1.62 + i * 0.01;
    r.userData.noOutline = true;
    group.add(r);
    ripples.push(r);
  }

  /* ────────────────────────────────────────────────────────────── paths ── */

  const pathMat = toon(C.sand, { steps: 2 });
  for (const key of ['work', 'career', 'skills', 'school']) {
    const t = ZONE_AT[key];
    const len = Math.hypot(t.x, t.z);
    const spur = new THREE.Mesh(new THREE.PlaneGeometry(3.4, len + 6), pathMat);
    spur.rotation.x = -Math.PI / 2;
    spur.rotation.z = -Math.atan2(t.x, -t.z);
    spur.position.set(t.x / 2, 0.012, t.z / 2);
    spur.receiveShadow = true;
    spur.userData.noOutline = true;
    group.add(spur);
  }
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(6.5, 40), pathMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.02;
  plaza.receiveShadow = true;
  plaza.userData.noOutline = true;
  group.add(plaza);

  /* ─────────────────────────────────────────────────── boulder guardrail ── */

  const rimCount = 44;
  for (let i = 0; i < rimCount; i++) {
    const a = (i / rimCount) * Math.PI * 2;
    const r = ISLAND_RADIUS - 1.3;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    staticBody(world, boxShape(2.4, 1.6, 1.4), x, 0.7, z, -a, 'terrain');

    const g = rock(rng, 1.5 + rng() * 0.7);
    g.position.set(x, 0, z);
    g.rotation.y = rng() * 6.283;
    group.add(g);
  }

  /* ──────────────────────────────────────────────────── raised platforms ── */

  // A stepped mound under the education campus so it reads as a small hill.
  const campus = ZONE_AT.school;
  for (let i = 0; i < 2; i++) {
    const r = 9 - i * 3.4, h = 0.55, y = i * h;
    staticBody(world, prismShape(r, h / 2, 16), campus.x, y + h / 2, campus.z, 0, 'terrain');
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.3, h + 0.2, 20, 1),
      toon(i ? C.grass : C.grassDark, { steps: 3 }));
    m.position.set(campus.x, y + h / 2 - 0.1, campus.z);
    m.receiveShadow = true;
    m.castShadow = true;
    m.userData.noOutline = true;
    group.add(m);
    walkables.push(m);
  }

  // Ramps up the mound, from the hub side.
  for (const [dx, dz, ry] of [[9.4, 0, 0], [-9.4, 0, Math.PI]]) {
    const hx = 2.4, hy = 0.6, hz = 1.5;
    staticBody(world, wedgeShape(hx, hy, hz), campus.x + dx, hy, campus.z + dz, ry, 'terrain');
    const w = new THREE.Mesh(rampGeo(hx, hy * 2, hz * 2), toon(C.sand, { steps: 3 }));
    w.position.set(campus.x + dx, 0, campus.z + dz);
    w.rotation.y = ry;
    w.receiveShadow = true;
    w.userData.noOutline = true;
    group.add(w);
  }

  /* ──────────────────────────────────────────────────────────── scenery ── */

  const scatter = new THREE.Group();
  group.add(scatter);
  for (let i = 0; i < 34; i++) {
    const a = rng() * Math.PI * 2;
    const r = 9 + rng() * (ISLAND_RADIUS - 13);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // Keep the spurs and zone floors clear.
    if (nearZone(x, z, 9)) { continue; }
    if (Math.abs(x) < 3 || Math.abs(z) < 3) continue;
    const t = tree(rng, Math.floor(rng() * 3), 0.9 + rng() * 0.8);
    t.position.set(x, 0, z);
    t.rotation.y = rng() * 6.283;
    scatter.add(t);
    // Trunks are solid, so you can bump into them.
    staticBody(world, boxShape(0.35, 1.4, 0.35), x, 1.4, z);
  }
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const r = 4 + rng() * (ISLAND_RADIUS - 6);
    const g = grassTuft(rng, 0.9 + rng() * 0.9);
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.rotation.y = rng() * 6.283;
    scatter.add(g);
  }
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const r = 8 + rng() * (ISLAND_RADIUS - 12);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (nearZone(x, z, 8)) continue;
    const g = rock(rng, 0.6 + rng() * 0.6);
    g.position.set(x, 0, z);
    scatter.add(g);
  }

  group.userData.update = (t) => {
    for (let i = 0; i < ripples.length; i++) {
      const s = 1 + Math.sin(t * 0.6 + i * 1.7) * 0.012;
      ripples[i].scale.set(s, s, 1);
    }
    sea.position.y = -1.7 + Math.sin(t * 0.8) * 0.04;
  };

  return { group, walkables };
}

function nearZone(x, z, pad) {
  for (const k of ['work', 'career', 'skills', 'school']) {
    const t = ZONE_AT[k];
    if (Math.hypot(x - t.x, z - t.z) < pad) return true;
  }
  return Math.hypot(x, z) < pad;
}

/** A right-triangular prism matching `wedgeShape`: the slope faces +X. */
const _rampCache = new Map();
function rampGeo(hx, h, d) {
  const key = `${hx}|${h}|${d}`;
  let g = _rampCache.get(key);
  if (g) return g;
  const hz = d / 2;
  const v = new Float32Array([
    // slope
    -hx, 0, -hz, hx, 0, -hz, -hx, h, -hz,
    -hx, 0, hz, -hx, h, hz, hx, 0, hz,
    // sloped face
    hx, 0, -hz, -hx, h, hz, -hx, h, -hz,
    hx, 0, -hz, hx, 0, hz, -hx, h, hz,
    // back wall
    -hx, 0, -hz, -hx, h, -hz, -hx, h, hz,
    -hx, 0, -hz, -hx, h, hz, -hx, 0, hz,
    // bottom
    -hx, 0, -hz, -hx, 0, hz, hx, 0, hz,
    -hx, 0, -hz, hx, 0, hz, hx, 0, -hz,
  ]);
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  _rampCache.set(key, g);
  return g;
}

export { staticBody };
