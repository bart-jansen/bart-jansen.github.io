/**
 * The four zones plus the playground. Everything in here is generated from the
 * same CV data the v3 build uses, so there is exactly one copy of the content
 * in the repository.
 *
 * Zone design:
 *   work    — an arc of framed screenshots you walk along
 *   career  — a rising spiral of signposts, oldest at the bottom
 *   skills  — 31 skittles you are very much encouraged to bowl over
 *   school  — five little buildings on the mound
 *   yard    — crates, balls, dominoes and a see-saw, for no reason at all
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { Body, DYNAMIC } from '../../../v3/js/physics/body.js';
import { Sphere, boxShape, prismShape } from '../../../v3/js/physics/shapes.js';
import { v3, Quat } from '../../../v3/js/math.js';
import { PROJECTS, JOBS, SKILLS, EDUCATION, PROFILE, tagColor } from '../../../v3/js/game/content.js';
import { toon, flat, outline, outlineAll, C } from '../gfx/toon.js';
import { box, sphere, cyl, cone, at, signpost } from '../gfx/shapes.js';
import { ZONE_AT, staticBody } from './island.js';

/* ─────────────────────────────────────────────────────────────── textures ── */

const _texCache = new Map();

/** A rounded label plate drawn on a canvas. Cached by its full parameter set. */
export function labelTexture(lines, opts = {}) {
  const key = JSON.stringify([lines, opts]);
  let t = _texCache.get(key);
  if (t) return t;

  const W = opts.w ?? 512, H = opts.h ?? 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  g.fillStyle = opts.bg ?? '#fffaf0';
  roundRect(g, 6, 6, W - 12, H - 12, opts.radius ?? 28);
  g.fill();
  if (opts.stroke !== false) {
    g.lineWidth = opts.lineWidth ?? 10;
    g.strokeStyle = opts.strokeColor ?? '#2b2440';
    g.stroke();
  }
  if (opts.accent) {
    g.fillStyle = opts.accent;
    roundRect(g, 6, 6, W - 12, 30, 14);
    g.fill();
  }

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = lines.length;
  const base = opts.size ?? Math.min(64, (H - 60) / n);
  lines.forEach((line, i) => {
    const big = i === (opts.emphasise ?? 0);
    const size = big ? base * 1.12 : base * 0.74;
    g.font = `${big ? 800 : 600} ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
    g.fillStyle = big ? (opts.fg ?? '#2b2440') : (opts.fg2 ?? '#6d6484');
    const y = H / 2 + (i - (n - 1) / 2) * (base * 1.02) + (opts.accent ? 12 : 0);
    fitText(g, line, W - 56, size);
    g.fillText(line, W / 2, y);
  });

  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _texCache.set(key, t);
  return t;
}

function fitText(g, text, maxW, size) {
  let s = size;
  while (g.measureText(text).width > maxW && s > 10) {
    s -= 2;
    g.font = g.font.replace(/[\d.]+px/, `${s}px`);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * A pill-shaped name chip sized to its text, so every label in the world ends
 * up with the same physical letter height however long the word is.
 * Returns the texture plus its aspect ratio.
 */
export function chipTexture(text, opts = {}) {
  const key = 'chip|' + text + JSON.stringify(opts);
  const hit = _texCache.get(key);
  if (hit) return hit;

  const H = 128, size = 78, padX = 40;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `800 ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  const W = Math.ceil(probe.measureText(text).width) + padX * 2;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = opts.bg ?? '#fffaf0';
  roundRect(g, 5, 5, W - 10, H - 10, H / 2 - 5);
  g.fill();
  g.lineWidth = 9;
  g.strokeStyle = '#2b2440';
  g.stroke();
  g.font = `800 ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  g.fillStyle = opts.fg ?? '#2b2440';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 2);

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const out = { texture: t, aspect: W / H };
  _texCache.set(key, out);
  return out;
}

const hex = (rgb) => '#' + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

/* ───────────────────────────────────────────────────────────────── builder ── */

export function createZones(world, rng, loader) {
  const group = new THREE.Group();
  const props = [];        // { body, mesh } pairs synced every frame
  const spots = [];        // { x, z, r, id, kind, data, mesh }
  const animated = [];

  const addProp = (mesh, body) => { props.push({ mesh, body }); group.add(mesh); world.add(body); return body; };

  buildHub(group, world, spots);
  buildWork(group, world, spots, loader, animated);
  buildCareer(group, world, spots);
  buildSkills(group, world, spots, addProp, rng);
  buildSchool(group, world, spots);
  buildYard(group, world, addProp, rng);

  group.userData.update = (t) => { for (const f of animated) f(t); };
  return { group, props, spots };
}

/* ───────────────────────────────────────────────────────────────────── hub ── */

function buildHub(group, world, spots) {
  const { x, z } = ZONE_AT.hub;

  // A big welcome arch with his name on it.
  const arch = new THREE.Group();
  arch.position.set(x, 0, z + 5.4);
  group.add(arch);
  for (const side of [-1, 1]) {
    const leg = at(cyl(0.24, 0.3, 4.4, C.wood, { seg: 10 }), side * 3.1, 2.2, 0);
    arch.add(leg);
    outline(leg, 0.04);
    staticBody(world, boxShape(0.34, 2.2, 0.34), x + side * 3.1, 2.2, z + 5.4, 0, 'terrain');
  }
  const beam = at(box(7.4, 1.5, 0.42, C.wood), 0, 4.9, 0);
  arch.add(beam);
  // The beam is solid to the camera too, or walking under the arch buries the
  // view inside it.
  staticBody(world, boxShape(3.7, 0.75, 0.25), x, 4.9, z + 5.4, 0, 'terrain');
  outline(beam, 0.045);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.9, 1.25),
    flat(0xffffff, { map: labelTexture([PROFILE.name, `${PROFILE.role} · ${PROFILE.city}`], { w: 1024, h: 200, size: 78, stroke: false, bg: '#fff3d9' }), toneMapped: false }));
  plate.position.set(0, 4.9, 0.23);
  plate.userData.noOutline = true;
  arch.add(plate);

  // Four direction signs on the plaza, one per spur.
  const dirs = [
    ['work', 'WORK →', 0],
    ['career', 'CAREER →', -Math.PI / 2],
    ['skills', 'SKILLS →', Math.PI],
    ['school', 'SCHOOL →', Math.PI / 2],
  ];
  const post = at(cyl(0.16, 0.2, 3.2, C.woodDark, { seg: 8 }), x, 1.6, z);
  group.add(post);
  outline(post, 0.035);
  staticBody(world, boxShape(0.26, 1.6, 0.26), x, 1.6, z);
  dirs.forEach(([key, text, ry], i) => {
    const t = ZONE_AT[key];
    const ang = Math.atan2(t.x, t.z);
    const arm = new THREE.Group();
    arm.position.set(x, 2.85 - i * 0.5, z);
    arm.rotation.y = ang;
    const plank = at(box(2.1, 0.44, 0.13, C.wood), 0, 0, 0.95);
    arm.add(plank);
    outline(plank, 0.028);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36),
      flat(0xffffff, { map: labelTexture([text], { w: 512, h: 100, size: 62, stroke: false, bg: '#fffaf0' }), toneMapped: false }));
    face.position.set(0, 0, 1.02);
    face.userData.noOutline = true;
    arm.add(face);
    group.add(arm);
  });

  spots.push({
    x, z: z + 5.4, r: 5, id: 'hello', kind: 'intro',
    data: { title: 'Hey — I’m Bart', body: `${PROFILE.role} at ${PROFILE.org}, based in ${PROFILE.city}. Walk the paths: every signpost, frame and skittle out here is a piece of my CV. Knock things over. It’s fine.`, links: [{ label: 'Email me', href: `mailto:${PROFILE.email}` }, { label: 'Download CV', href: PROFILE.cv.replace('../', '../') }] },
  });
}

/* ──────────────────────────────────────────────────────────────── the work ── */

function buildWork(group, world, spots, loader, animated) {
  const { x, z } = ZONE_AT.work;
  const n = PROJECTS.length;
  const cols = 7;
  const spacing = 4.6;

  PROJECTS.forEach((p, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    const px = x + (col - (inRow - 1) / 2) * spacing;
    const pz = z - row * 5.6 + 5;

    const frame = new THREE.Group();
    frame.position.set(px, 0, pz);
    frame.rotation.y = (px - x) * -0.035;
    group.add(frame);

    const postH = 1.25;
    const leg = at(cyl(0.12, 0.15, postH, C.woodDark, { seg: 8 }), 0, postH / 2, 0);
    frame.add(leg);
    outline(leg, 0.03);

    const W = 3.2, H = 2.1;
    const accent = hex(tagColor(p.tags));
    const border = at(box(W + 0.34, H + 0.34, 0.24, C.paper), 0, postH + H / 2, 0);
    frame.add(border);
    outline(border, 0.045);

    const strip = at(box(W + 0.34, 0.26, 0.26, parseInt(accent.slice(1), 16)), 0, postH + H + 0.03, 0);
    strip.userData.noOutline = true;
    frame.add(strip);

    const shotMat = flat(0xdad4c8, { toneMapped: false });
    const shot = new THREE.Mesh(new THREE.PlaneGeometry(W, H), shotMat);
    shot.position.set(0, postH + H / 2, 0.13);
    shot.userData.noOutline = true;
    frame.add(shot);
    loader.load(p.img, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      shotMat.map = tex;
      shotMat.color.set(0xffffff);
      shotMat.needsUpdate = true;
    }, undefined, () => { /* a missing screenshot just stays a blank card */ });

    const cap = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.62),
      flat(0xffffff, { map: labelTexture([p.title, p.blurb], { w: 640, h: 160, size: 60, stroke: false, bg: '#fffaf0' }), toneMapped: false }));
    cap.position.set(0, postH - 0.16, 0.14);
    cap.userData.noOutline = true;
    frame.add(cap);

    staticBody(world, boxShape(W / 2 + 0.2, (postH + H) / 2, 0.22), px, (postH + H) / 2, pz, frame.rotation.y);

    const bob = 0.06 + (i % 3) * 0.02;
    animated.push((t) => { frame.position.y = Math.sin(t * 1.1 + i) * bob; });

    spots.push({
      x: px, z: pz + 2.2, r: 2.6, id: `p-${p.id}`, kind: 'project',
      data: { title: p.title, body: p.blurb, tag: p.tags[0], img: p.img, accent },
    });
  });

  zoneSign(group, world, x - 7, z + 13, 'WORK', '19 things I built', 0.4);
}

/* ────────────────────────────────────────────────────────────── the career ── */

function buildCareer(group, world, spots) {
  const { x, z } = ZONE_AT.career;
  const n = JOBS.length;

  // Newest first in the data, so walk it backwards: you arrive at today.
  JOBS.slice().reverse().forEach((job, i) => {
    const t = i / (n - 1);
    const side = i % 2 ? 1 : -1;
    const px = 13 + t * 20;
    const pz = Math.sin(t * Math.PI * 1.4) * 4.5 + side * 3.4;

    const tex = labelTexture([job.role, job.org, job.when], {
      w: 640, h: 300, size: 56, accent: i === n - 1 ? '#ffc244' : undefined,
    });
    const sp = signpost(tex, 2.6, 1.35, 1.4 + t * 1.1);
    sp.position.set(px, 0, pz);
    sp.rotation.y = side > 0 ? Math.PI + 0.25 : -0.25;
    group.add(sp);
    staticBody(world, boxShape(0.3, 1.4, 0.3), px, 1.4, pz);

    spots.push({
      x: px, z: pz - side * 1.8, r: 2.4, id: `j-${i}`, kind: 'job',
      data: { title: `${job.role} · ${job.org}`, body: job.desc, tag: job.when, accent: '#a98cf0' },
    });
  });

  zoneSign(group, world, x - 13, z - 7.5, 'CAREER', 'twelve stops so far', -0.64);
}

/* ────────────────────────────────────────────────────────────── the skills ── */

function buildSkills(group, world, spots, addProp, rng) {
  const { x, z } = ZONE_AT.skills;

  // Set out like a bowling rack: six ranks of five or six, staggered.
  const COLS = 6, PITCH = 2.5;
  SKILLS.forEach((skill, i) => {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const px = x + (col - (COLS - 1) / 2) * PITCH + (row % 2 ? PITCH / 2 : 0);
    const pz = z + (row - 2.5) * PITCH;

    const hue = (i * 47) % 360;
    const color = new THREE.Color().setHSL(hue / 360, 0.68, 0.52).getHex();

    // A skittle: fat base, narrow neck, a bobble on top.
    const pin = new THREE.Group();
    const body = at(cyl(0.26, 0.42, 1.15, color, { seg: 12 }), 0, 0.575, 0);
    pin.add(body);
    const neck = at(sphere(0.3, color, { seg: 12 }), 0, 1.22, 0);
    pin.add(neck);
    const chip = chipTexture(skill);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.44 * chip.aspect, 0.44),
      flat(0xffffff, { map: chip.texture, toneMapped: false, transparent: true }));
    // Stagger the ranks vertically or the back rows disappear behind the front.
    tag.position.set(0, 1.62 + (row % 2) * 0.46, 0);
    tag.userData.noOutline = true;
    tag.userData.billboard = true;
    pin.add(tag);
    outlineAll(pin, 0.04);
    pin.position.set(px, 0, pz);

    const b = new Body(boxShape(0.34, 0.78, 0.34), {
      type: DYNAMIC, pos: v3(px, 0.8, pz),
      mass: 1.7, friction: 0.5, restitution: 0.12, angularDamping: 0.22, tag: 'skill',
    });
    b.userData = { home: v3(px, 0.8, pz), label: skill };
    pin.userData.offsetY = -0.8;
    addProp(pin, b);
  });

  zoneSign(group, world, x + 8.5, z - 9, 'SKILLS', '31 skittles · knock them down', -2.62);
  spots.push({
    x: x + 8.5, z: z - 9, r: 3.4, id: 'skills-note', kind: 'note',
    data: { title: 'The skill garden', body: 'Every skittle is something I work with. Charge through them — they reset themselves after a while.', accent: '#5fe0c0' },
  });
}

/* ─────────────────────────────────────────────────────────────── the school ── */

function buildSchool(group, world, spots) {
  const { x, z } = ZONE_AT.school;
  const n = EDUCATION.length;

  EDUCATION.forEach((e, i) => {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const r = 4.6;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    const h = 2.0 + (i % 3) * 0.5;
    const w = 2.2, d = 2.0;
    const tint = [C.cream, C.paper, 0xffe6c9, 0xe8f2ff, 0xfde4e4][i % 5];

    const hut = new THREE.Group();
    hut.position.set(px, 1.1, pz);
    hut.rotation.y = -a + Math.PI / 2;
    group.add(hut);

    const walls = at(box(w, h, d, tint), 0, h / 2, 0);
    hut.add(walls);
    const roof = at(cone(w * 0.92, 1.25, C.coral, { seg: 4 }), 0, h + 0.6, 0, 0, Math.PI / 4);
    hut.add(roof);
    for (const sx of [-w / 2 + 0.01, w / 2 - 0.01]) {
      const win = at(box(0.12, 0.55, 0.55, C.sky), sx, h * 0.6, 0);
      win.userData.noOutline = true;
      hut.add(win);
    }
    outline(walls, 0.045);
    outline(roof, 0.05);

    // The plaque is the whole front wall, so it stays readable from the path.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, h - 0.4),
      flat(0xffffff, { map: labelTexture([e.what, e.where, e.when], { w: 640, h: 420, size: 52 }), toneMapped: false }));
    sign.position.set(0, h / 2, d / 2 + 0.02);
    sign.userData.noOutline = true;
    hut.add(sign);

    staticBody(world, boxShape(w / 2, h / 2 + 0.6, d / 2), px, 1.1 + h / 2, pz, hut.rotation.y, 'terrain');

    spots.push({
      x: px, z: pz, r: 3.2, id: `e-${i}`, kind: 'school',
      data: { title: e.what, body: `${e.where} · ${e.when}`, accent: '#ff7a6b' },
    });
  });

  zoneSign(group, world, x + 13, z - 7.5, 'SCHOOL', 'where the theory came from', 0.64);
}

/* ───────────────────────────────────────────────────────────────── the yard ── */

function buildYard(group, world, addProp, rng) {
  const spread = (cx, cz, k) => [cx + (rng() - 0.5) * k, cz + (rng() - 0.5) * k];

  // Crates, stacked in two lopsided towers.
  for (let s = 0; s < 2; s++) {
    const [cx, cz] = [s ? 13 : -13, s ? -12 : 12];
    for (let i = 0; i < 7; i++) {
      const size = 0.9;
      const px = cx + (rng() - 0.5) * 0.5;
      const pz = cz + (rng() - 0.5) * 0.5;
      const py = size / 2 + i * (size + 0.02);
      const mesh = box(size, size, size, i % 2 ? C.wood : C.woodDark, { radius: 0.1 });
      outline(mesh, 0.035);
      const body = new Body(boxShape(size / 2, size / 2, size / 2), {
        type: DYNAMIC, pos: v3(px, py, pz), mass: 2.4, friction: 0.62, restitution: 0.05, tag: 'crate',
      });
      addProp(mesh, body);
    }
  }

  // Beach balls — light, bouncy, extremely satisfying to punt.
  const ballColors = [C.coral, C.amber, C.mint, C.violet, C.sky];
  for (let i = 0; i < 14; i++) {
    const [px, pz] = spread(0, 0, 44);
    if (Math.hypot(px, pz) > 20 || Math.hypot(px, pz - 12) < 5) continue;
    const r = 0.5 + rng() * 0.45;
    const mesh = sphere(r, ballColors[i % ballColors.length], { seg: 16 });
    outline(mesh, 0.04);
    const body = new Body(new Sphere(r), {
      type: DYNAMIC, pos: v3(px, 2 + rng() * 3, pz),
      mass: 0.9, friction: 0.35, restitution: 0.62, rollingFriction: 0.02, tag: 'ball',
    });
    addProp(mesh, body);
  }

  // A domino run curving through the empty quarter between skills and school.
  for (let i = 0; i < 22; i++) {
    const t = i / 21;
    const a = -0.7 + t * 1.9;
    const r = 7.5;
    const px = -17 + Math.cos(a) * r;
    const pz = 15 + Math.sin(a) * r;
    const mesh = box(0.7, 1.2, 0.14, i % 3 === 0 ? C.amber : C.paper, { radius: 0.04 });
    outline(mesh, 0.03);
    const body = new Body(boxShape(0.35, 0.6, 0.07), {
      type: DYNAMIC, pos: v3(px, 0.6, pz),
      quat: new Quat().setEuler(0, a + Math.PI / 2, 0),
      mass: 1.1, friction: 0.6, restitution: 0.02, tag: 'domino',
    });
    addProp(mesh, body);
  }

  // A see-saw: a static fulcrum with a heavy plank resting on it.
  const fx = -15, fz = -14;
  const wedge = at(cone(0.9, 1.2, C.rockDark, { seg: 4 }), fx, 0.6, fz, 0, Math.PI / 4);
  outline(wedge, 0.04);
  group.add(wedge);
  staticBody(world, prismShape(0.9, 0.6, 4), fx, 0.6, fz);

  const plank = box(7.5, 0.28, 1.5, C.wood, { radius: 0.08 });
  outline(plank, 0.035);
  addProp(plank, new Body(boxShape(3.75, 0.14, 0.75), {
    type: DYNAMIC, pos: v3(fx, 1.4, fz), mass: 5, friction: 0.7, restitution: 0.03, tag: 'plank',
  }));

  // A pyramid of barrels to charge into.
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i <= row; i++) {
      const px = 15 + (i - row / 2) * 1.4;
      const py = (2 - row) * 1.25 + 0.62;
      const pz = 14;
      const mesh = cyl(0.55, 0.55, 1.15, i % 2 ? C.mint : C.steel, { seg: 12 });
      outline(mesh, 0.035);
      addProp(mesh, new Body(prismShape(0.55, 0.575, 12), {
        type: DYNAMIC, pos: v3(px, py, pz), mass: 2.8, friction: 0.55, restitution: 0.1, tag: 'barrel',
      }));
    }
  }
}

/* ──────────────────────────────────────────────────────────────── zone sign ── */

function zoneSign(group, world, x, z, title, sub, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  group.add(g);

  for (const side of [-1, 1]) {
    const leg = at(cyl(0.15, 0.18, 3.1, C.woodDark, { seg: 8 }), side * 1.9, 1.55, 0);
    g.add(leg);
    outline(leg, 0.032);
  }
  const board = at(box(4.6, 1.5, 0.24, C.wood), 0, 3.3, 0);
  g.add(board);
  outline(board, 0.045);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.28),
    flat(0xffffff, { map: labelTexture([title, sub], { w: 768, h: 230, size: 82, stroke: false, bg: '#fff3d9' }), toneMapped: false }));
  face.position.set(0, 3.3, 0.13);
  face.userData.noOutline = true;
  g.add(face);

  staticBody(world, boxShape(2.2, 2.1, 0.2), x, 2.1, z, ry);
}
