/**
 * THE YARD — the level.
 *
 * Every piece of the CV is a physical object. Nothing here is decoration: the
 * nameplate is 190 loose cubes, the employment history is a Jenga tower you
 * can topple, and the portfolio is a row of monoliths you discover by rolling
 * into them. If you can see it, you can hit it.
 */

import { Vec3, Quat, v3, quat, mulberry32, clamp } from '../math.js';
import { Body, DYNAMIC, STATIC, KINEMATIC } from '../physics/body.js';
import {
  Sphere, boxShape, prismShape, wedgeShape, rockShape,
} from '../physics/shapes.js';
import { DistanceConstraint, HingeConstraint } from '../physics/constraints.js';
import { meshFromHull, icosphere, groundPlane } from '../gl/geometry.js';
import { drawLabel, drawPlaque, textToGrid } from '../gl/text.js';
import { PROJECTS, JOBS, SKILLS, EDUCATION, PROFILE, tagColor } from './content.js';

export const ARENA_HALF = 40;
const ROCK_SIZES = [0.55, 0.8, 1.15, 1.55];
const WALL_H = 7;

/** Collision groups — the grab ray and the shockwave both filter on these. */
export const G_WORLD = 1;
export const G_PROP = 2;
export const G_PLAYER = 4;
export const G_MONOLITH = 8;

const PALETTE = {
  floor: [0.085, 0.09, 0.115, 1],
  wall: [0.13, 0.135, 0.17, 1],
  nameplate: [0.97, 0.75, 0.14, 1],
  tower: [0.30, 0.33, 0.42, 1],
  pedestal: [0.16, 0.17, 0.22, 1],
  rock: [0.19, 0.19, 0.23, 1],
  steel: [0.30, 0.32, 0.38, 1],
  edu: [0.45, 0.86, 0.95, 1],
};

export class Arena {
  constructor(world, renderer) {
    this.world = world;
    this.renderer = renderer;
    this.props = [];            // everything drawn every frame
    this.monoliths = [];
    this.skillCubes = [];
    this.jobSlabs = [];
    this.dominoes = [];
    this.zones = [];            // named landmarks for the compass
    this.rng = mulberry32(20260214);
    this._rockHulls = [];
    this._resetState = [];
  }

  /* ─────────────────────────────────────────────────────────── meshes ── */

  registerMeshes() {
    const r = this.renderer;
    r.registerMesh('ground', groundPlane(ARENA_HALF, 24), 2);
    r.registerMesh('box', meshFromHull(boxShape(0.5), -1), 512);
    // Same cube, but its +z face is tagged so it can wear a texture.
    r.registerMesh('panel', meshFromHull(boxShape(0.5), 0), 128);
    r.registerMesh('ball', icosphere(1, 2), 192);
    r.registerMesh('hex', meshFromHull(prismShape(0.5, 0.5, 6), -1), 64);
    r.registerMesh('cyl', meshFromHull(prismShape(0.5, 0.5, 16), -1), 96);
    r.registerMesh('wedge', meshFromHull(wedgeShape(0.5, 0.5, 0.5), -1), 64);
    // Four rock sizes, each its own hull *and* its own mesh, so a rock's
    // silhouette is literally the thing the solver collides with.
    ROCK_SIZES.forEach((size, i) => {
      const hull = rockShape(size, this.rng, 1);
      this._rockHulls.push(hull);
      r.registerMesh(`rock${i}`, meshFromHull(hull, -1), 32);
    });
  }

  /* ───────────────────────────────────────────────────────────── build ── */

  build() {
    this.buildShell();
    this.buildNameplate();
    this.buildProjectGallery();
    this.buildCareerTower();
    this.buildSkillPit();
    this.buildWreckingBall();
    this.buildDominoSpiral();
    this.buildSeesaw();
    this.buildEducation();
    this.buildCannon();
    this.buildDebris();
    this.snapshot();
    return this;
  }

  /** Adds a body plus its render record in one go. */
  prop(body, mesh, scale, color, opts = {}) {
    this.world.add(body);
    const rec = {
      body,
      mesh,
      sx: scale[0], sy: scale[1], sz: scale[2],
      color,
      emissive: opts.emissive ?? 0,
      texLayer: opts.texLayer ?? -1,
      texKind: opts.texKind ?? 0,
      gloss: opts.gloss ?? 0.25,
    };
    this.props.push(rec);
    body.userData = body.userData || {};
    body.userData.rec = rec;
    return rec;
  }

  buildShell() {
    const W = ARENA_HALF;
    const floor = new Body(boxShape(W, 1, W), {
      type: STATIC, pos: v3(0, -1, 0), friction: 0.72, restitution: 0, group: G_WORLD,
    });
    this.world.add(floor);
    this.floor = floor;
    // The floor is drawn as a separate tessellated plane so the fragment
    // shader's grid has vertices to interpolate across.
    this.props.push({
      body: { pos: v3(0, 0, 0), quat: new Quat() },
      mesh: 'ground', sx: 1, sy: 1, sz: 1,
      color: PALETTE.floor, emissive: 0, texLayer: -1, texKind: 0, gloss: 0.06,
    });

    const walls = [
      [0, WALL_H / 2, -W, W, WALL_H / 2, 1],
      [0, WALL_H / 2, W, W, WALL_H / 2, 1],
      [-W, WALL_H / 2, 0, 1, WALL_H / 2, W],
      [W, WALL_H / 2, 0, 1, WALL_H / 2, W],
    ];
    for (const [x, y, z, hx, hy, hz] of walls) {
      const b = new Body(boxShape(hx, hy, hz), {
        type: STATIC, pos: v3(x, y, z), friction: 0.4, restitution: 0.25, group: G_WORLD,
      });
      this.prop(b, 'box', [hx * 2, hy * 2, hz * 2], PALETTE.wall, { gloss: 0.1 });
    }
  }

  /* ── the nameplate: BART / JANSEN spelled out in loose cubes ────────── */

  buildNameplate() {
    const S = 0.62;                      // cube edge
    const lines = ['BART', 'JANSEN'];
    const z = -31;
    let rowBase = 0.31;

    for (let li = lines.length - 1; li >= 0; li--) {
      const { cells, width } = textToGrid(lines[li]);
      const x0 = -width * S / 2;
      for (const { col, row } of cells) {
        const b = new Body(boxShape(S / 2), {
          pos: v3(x0 + col * S + S / 2, rowBase + row * S, z + (this.rng() - 0.5) * 0.02),
          density: 2.4, friction: 0.62, restitution: 0.08, group: G_PROP,
          angularDamping: 0.25, rollingFriction: 0.05, tag: 'name',
        });
        const warm = 0.86 + this.rng() * 0.14;
        this.prop(b, 'box', [S, S, S],
          [PALETTE.nameplate[0] * warm, PALETTE.nameplate[1] * warm, PALETTE.nameplate[2], 1],
          { emissive: 0.35, gloss: 0.45 });
      }
      rowBase += 7 * S + S * 0.8;
    }

    // The word has to read as a word before anyone touches it, and a loose
    // stack of glyph strokes would slump the moment gravity hits. Park the
    // cubes asleep instead — the first nudge wakes the whole island and the
    // name falls apart, which is the point.
    for (const b of this.world.bodies) if (b.tag === 'name') b.sleep();

    // A backing wall so the letters have something to stand against.
    const back = new Body(boxShape(20, 5, 0.5), {
      type: STATIC, pos: v3(0, 5, z - 1.2), friction: 0.5, group: G_WORLD,
    });
    this.prop(back, 'box', [40, 10, 1], [0.1, 0.105, 0.14, 1], { gloss: 0.35 });

    this.zones.push({ name: PROFILE.name, pos: v3(0, 4, z) });
  }

  /* ── 19 project monoliths on pedestals, in a west-facing arc ────────── */

  buildProjectGallery() {
    const R = 27;
    const n = PROJECTS.length;
    const a0 = 118 * Math.PI / 180, a1 = 242 * Math.PI / 180;

    PROJECTS.forEach((proj, i) => {
      const a = a0 + (a1 - a0) * (i / (n - 1));
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      // Face the middle of the arena.
      const yaw = Math.atan2(-x, -z);
      const q = new Quat().setAxisAngle(v3(0, 1, 0), yaw);

      const ped = new Body(prismShape(1.15, 0.55, 8), {
        type: STATIC, pos: v3(x, 0.55, z), quat: q, friction: 0.8, group: G_WORLD,
      });
      this.prop(ped, 'hex', [2.3, 1.1, 2.3], PALETTE.pedestal, { gloss: 0.3 });

      const hw = 1.35, hh = 1.0, hd = 0.16;
      const slab = new Body(boxShape(hw, hh, hd), {
        pos: v3(x, 1.1 + hh, z), quat: q,
        density: 1.5, friction: 0.6, restitution: 0.1,
        group: G_MONOLITH, angularDamping: 0.3, tag: 'project',
      });
      slab.userData = { kind: 'project', index: i, project: proj };
      const layer = this.renderer.addPhoto(proj.image);
      const col = tagColor(proj.tags);
      const rec = this.prop(slab, 'panel', [hw * 2, hh * 2, hd * 2],
        [col[0], col[1], col[2], 1], { texLayer: layer, texKind: 0, gloss: 0.55, emissive: 0.12 });
      rec.baseEmissive = 0.12;

      // The plaque underneath: title + tags, rendered to a label layer.
      const plaqueLayer = this.renderer.addLabel(
        `proj:${proj.id}`, drawPlaque(proj.title, proj.blurb),
      );
      const plaque = new Body(boxShape(1.1, 0.28, 0.07), {
        type: STATIC, pos: v3(x, 0.72, z).addScaled(v3(Math.sin(yaw), 0, Math.cos(yaw)), 1.1),
        quat: q, group: G_WORLD,
      });
      this.prop(plaque, 'panel', [2.2, 0.56, 0.14], [0.06, 0.07, 0.1, 1],
        { texLayer: plaqueLayer, texKind: 1, gloss: 0.2, emissive: 0.5 });

      this.monoliths.push({ body: slab, rec, project: proj, index: i, found: false });
    });

    this.zones.push({ name: 'The gallery', pos: v3(-R, 3, 0) });
  }

  /* ── employment: a Jenga tower, oldest at the bottom ────────────────── */

  buildCareerTower() {
    const cx = 25, cz = -8;
    const list = [...JOBS].reverse();       // oldest first, so it holds up the rest
    let y = 0;
    list.forEach((job, i) => {
      const hh = 0.42;
      const hw = 3.0 - i * 0.09;
      const hd = 1.5;
      const yaw = (i % 2) * Math.PI / 2 + (this.rng() - 0.5) * 0.02;
      const q = new Quat().setAxisAngle(v3(0, 1, 0), yaw);
      y += hh;
      const b = new Body(boxShape(hw, hh, hd), {
        pos: v3(cx, y, cz), quat: q,
        density: 2.2, friction: 0.72, restitution: 0.03,
        group: G_PROP, angularDamping: 0.2, tag: 'job',
      });
      b.userData = { kind: 'job', job };
      const layer = this.renderer.addLabel(
        `job:${i}`, drawPlaque(job.role, `${job.org} · ${job.when}`),
      );
      const t = i / (list.length - 1);
      const rec = this.prop(b, 'panel', [hw * 2, hh * 2, hd * 2],
        [PALETTE.tower[0] + t * 0.3, PALETTE.tower[1] + t * 0.24, PALETTE.tower[2] + t * 0.1, 1],
        { texLayer: layer, texKind: 1, gloss: 0.35, emissive: 0.18 });
      this.jobSlabs.push({ body: b, rec, job });
      y += hh + 0.004;
    });

    const base = new Body(boxShape(4, 0.35, 2.4), {
      type: STATIC, pos: v3(cx, -0.35, cz), friction: 0.85, group: G_WORLD,
    });
    this.prop(base, 'box', [8, 0.7, 4.8], PALETTE.pedestal, { gloss: 0.2 });
    this.zones.push({ name: 'Career tower', pos: v3(cx, 6, cz) });
  }

  /* ── skill pit: a recessed box of labelled cubes ────────────────────── */

  buildSkillPit() {
    const cx = 17, cz = 22, half = 8.5, wallH = 1.1;
    const rims = [
      [cx, wallH / 2, cz - half, half, wallH / 2, 0.35],
      [cx, wallH / 2, cz + half, half, wallH / 2, 0.35],
      [cx - half, wallH / 2, cz, 0.35, wallH / 2, half],
      [cx + half, wallH / 2, cz, 0.35, wallH / 2, half],
    ];
    for (const [x, y, z, hx, hy, hz] of rims) {
      const b = new Body(boxShape(hx, hy, hz), {
        type: STATIC, pos: v3(x, y, z), friction: 0.6, restitution: 0.2, group: G_WORLD,
      });
      this.prop(b, 'box', [hx * 2, hy * 2, hz * 2], [0.14, 0.15, 0.2, 1], { gloss: 0.3 });
    }

    SKILLS.forEach((skill, i) => {
      const hw = 0.95, hh = 0.3, hd = 0.42;
      const col = i % 6, row = Math.floor(i / 6);
      const b = new Body(boxShape(hw, hh, hd), {
        pos: v3(cx - 6.4 + col * 2.6 + (this.rng() - 0.5) * 0.3,
          0.4 + row * 1.4,
          cz - 5.6 + row * 2.2 + (this.rng() - 0.5) * 0.3),
        quat: new Quat().setAxisAngle(v3(0, 1, 0), (this.rng() - 0.5) * 0.5),
        density: 1.1, friction: 0.5, restitution: 0.26,
        group: G_PROP, angularDamping: 0.15, tag: 'skill',
      });
      b.userData = { kind: 'skill', skill };
      const layer = this.renderer.addLabel(`skill:${i}`, drawLabel(skill, {
        bg: 'rgba(10,11,16,0.95)', fg: '#f6f2e8', accent: '#f4c024',
      }));
      const hue = i / SKILLS.length;
      this.prop(b, 'panel', [hw * 2, hh * 2, hd * 2],
        hsl(hue * 0.8 + 0.5, 0.35, 0.6), { texLayer: layer, texKind: 1, gloss: 0.4, emissive: 0.22 });
      this.skillCubes.push(b);
    });

    this.zones.push({ name: 'Skill pit', pos: v3(cx, 3, cz) });
  }

  /* ── wrecking ball on a real chain, hanging over the pit ────────────── */

  buildWreckingBall() {
    const cx = 17, cz = 22, topY = 12.5;
    const gantry = new Body(boxShape(0.55, 0.55, 9.5), {
      type: STATIC, pos: v3(cx, topY, cz), group: G_WORLD,
    });
    this.prop(gantry, 'box', [1.1, 1.1, 19], PALETTE.steel, { gloss: 0.6 });
    for (const sz of [-9, 9]) {
      const leg = new Body(boxShape(0.4, topY / 2, 0.4), {
        type: STATIC, pos: v3(cx, topY / 2, cz + sz), group: G_WORLD,
      });
      this.prop(leg, 'box', [0.8, topY, 0.8], PALETTE.steel, { gloss: 0.6 });
    }

    const links = 9;
    const linkH = 0.42;
    let prev = gantry;
    let prevLocal = v3(0, -0.55, 0);
    this.chain = [];
    for (let i = 0; i < links; i++) {
      const b = new Body(boxShape(0.16, linkH, 0.16), {
        pos: v3(cx, topY - 0.55 - linkH * (2 * i + 1), cz),
        density: 9, friction: 0.4, group: G_PROP, angularDamping: 0.6,
        allowSleep: true, tag: 'chain',
      });
      // Links pass through each other — a chain solved as a rigid stack of
      // colliding boxes is far more expensive and no more convincing.
      b.mask = G_WORLD | G_PLAYER;
      this.prop(b, 'box', [0.32, linkH * 2, 0.32], PALETTE.steel, { gloss: 0.75 });
      this.world.addConstraint(new DistanceConstraint(
        prev, b, prevLocal, v3(0, linkH, 0), { stiffness: 1 },
      ));
      prev = b;
      prevLocal = v3(0, -linkH, 0);
      this.chain.push(b);
    }

    const ball = new Body(new Sphere(1.5), {
      pos: v3(cx, topY - 0.55 - linkH * 2 * links - 1.5, cz),
      density: 22, friction: 0.5, restitution: 0.2,
      group: G_PROP, rollingFriction: 0.02, tag: 'wrecking',
    });
    ball.mask = G_WORLD | G_PROP | G_PLAYER | G_MONOLITH;
    this.world.addConstraint(new DistanceConstraint(prev, ball, prevLocal, v3(0, 1.5, 0)));
    this.prop(ball, 'ball', [1.5, 1.5, 1.5], [0.2, 0.21, 0.25, 1], { gloss: 0.85 });
    this.wreckingBall = ball;
  }

  /* ── domino spiral through the middle of the yard ───────────────────── */

  buildDominoSpiral() {
    const count = 64;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const a = t * Math.PI * 3.4 + 0.7;
      const r = 5 + t * 8.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // Stand each domino across the direction of travel.
      const tangent = Math.atan2(Math.cos(a) * r + Math.sin(a), -Math.sin(a) * r + Math.cos(a));
      const q = new Quat().setAxisAngle(v3(0, 1, 0), tangent);
      const b = new Body(boxShape(0.42, 0.85, 0.1), {
        pos: v3(x, 0.85, z), quat: q,
        density: 1.6, friction: 0.55, restitution: 0.02,
        group: G_PROP, angularDamping: 0.1, tag: 'domino',
      });
      this.prop(b, 'box', [0.84, 1.7, 0.2],
        hsl(0.55 + t * 0.35, 0.5, 0.55 + t * 0.1), { gloss: 0.5, emissive: 0.1 + t * 0.25 });
      this.dominoes.push(b);
    }
  }

  /* ── hinged seesaw catapult ─────────────────────────────────────────── */

  buildSeesaw() {
    const cx = -8, cz = 15;
    const fulcrum = new Body(prismShape(0.6, 0.9, 3), {
      type: STATIC, pos: v3(cx, 0.9, cz), group: G_WORLD,
    });
    this.prop(fulcrum, 'hex', [1.2, 1.8, 1.2], PALETTE.pedestal, { gloss: 0.3 });

    const plank = new Body(boxShape(4.5, 0.16, 1.1), {
      pos: v3(cx, 1.9, cz), density: 2.6, friction: 0.7, restitution: 0.15,
      group: G_PROP, angularDamping: 0.05, allowSleep: false, tag: 'seesaw',
    });
    this.prop(plank, 'box', [9, 0.32, 2.2], [0.62, 0.44, 0.22, 1], { gloss: 0.4 });
    this.world.addConstraint(new HingeConstraint(
      fulcrum, plank, v3(0, 1.0, 0), v3(0, -0.16, 0), v3(0, 0, 1),
    ));
    this.seesaw = plank;

    // Something worth launching.
    for (let i = 0; i < 4; i++) {
      const r = 0.45 + this.rng() * 0.3;
      const b = new Body(new Sphere(r), {
        pos: v3(cx - 3.6 + i * 0.1, 3.2 + i * 1.2, cz + (this.rng() - 0.5) * 1.2),
        density: 4.5, friction: 0.5, restitution: 0.45,
        group: G_PROP, rollingFriction: 0.03, tag: 'ammo',
      });
      this.prop(b, 'ball', [r, r, r], hsl(this.rng(), 0.6, 0.6), { gloss: 0.8, emissive: 0.5 });
    }
  }

  /* ── education: five plinths, tallest = most recent ─────────────────── */

  buildEducation() {
    const cx = 27, cz = 27;
    EDUCATION.forEach((e, i) => {
      const h = 1.2 + (EDUCATION.length - i) * 0.75;
      const x = cx - i * 2.9, z = cz - i * 0.6;
      const b = new Body(prismShape(1.05, h / 2, 6), {
        type: STATIC, pos: v3(x, h / 2, z), friction: 0.7, group: G_WORLD,
      });
      this.prop(b, 'hex', [2.1, h, 2.1], PALETTE.pedestal, { gloss: 0.3 });

      const layer = this.renderer.addLabel(`edu:${i}`, drawPlaque(
        e.what.length > 34 ? `${e.what.slice(0, 32)}…` : e.what,
        `${e.where} · ${e.when}`,
      ));
      const cap = new Body(boxShape(1.15, 0.3, 0.09), {
        pos: v3(x, h + 0.3, z),
        quat: new Quat().setAxisAngle(v3(0, 1, 0), -0.75),
        density: 1.4, friction: 0.6, group: G_PROP, tag: 'edu',
      });
      cap.userData = { kind: 'education', entry: e };
      this.prop(cap, 'panel', [2.3, 0.6, 0.18], PALETTE.edu,
        { texLayer: layer, texKind: 1, gloss: 0.4, emissive: 0.45 });
    });
    this.zones.push({ name: 'Education', pos: v3(cx - 5, 4, cz) });
  }

  /* ── the cannon: aim with the mouse, fire heavy shot ────────────────── */

  buildCannon() {
    const cx = -22, cz = 24;
    const base = new Body(prismShape(1.5, 0.6, 10), {
      type: STATIC, pos: v3(cx, 0.6, cz), group: G_WORLD,
    });
    this.prop(base, 'cyl', [3, 1.2, 3], PALETTE.pedestal, { gloss: 0.35 });

    // Kinematic so the player can aim it without the solver fighting back.
    const barrel = new Body(prismShape(0.62, 2.2, 12), {
      type: KINEMATIC, pos: v3(cx, 2.2, cz),
      quat: new Quat().setAxisAngle(v3(1, 0, 0), Math.PI / 2 - 0.6),
      group: G_WORLD, friction: 0.4,
    });
    this.prop(barrel, 'cyl', [1.24, 4.4, 1.24], PALETTE.steel, { gloss: 0.8, emissive: 0.1 });
    this.cannon = { base, barrel, pos: v3(cx, 2.2, cz), yaw: 0.9, pitch: 0.55, cooldown: 0 };
    this.zones.push({ name: 'Cannon', pos: v3(cx, 3, cz) });
  }

  /** Spawns a cannonball travelling along the barrel. */
  fireCannon(power = 1) {
    const c = this.cannon;
    if (c.cooldown > 0) return null;
    c.cooldown = 0.45;
    const dir = cannonDir(c);
    const r = 0.62;
    const b = new Body(new Sphere(r), {
      pos: c.pos.clone().addScaled(dir, 2.9),
      density: 16, friction: 0.4, restitution: 0.42,
      group: G_PROP, rollingFriction: 0.02, tag: 'shot',
    });
    b.vel.copy(dir).scale(44 * power);
    this.prop(b, 'ball', [r, r, r], [1, 0.72, 0.25, 1], { gloss: 0.9, emissive: 1.6 });
    this.shots = this.shots || [];
    this.shots.push(b);
    // Keep the yard from filling up with iron.
    if (this.shots.length > 14) this.despawn(this.shots.shift());
    return b;
  }

  despawn(body) {
    this.world.remove(body);
    const i = this.props.findIndex((p) => p.body === body);
    if (i >= 0) this.props.splice(i, 1);
  }

  /* ── loose rocks and crates, for texture ────────────────────────────── */

  buildDebris() {
    for (let i = 0; i < 26; i++) {
      const a = this.rng() * Math.PI * 2;
      const rad = 20 + this.rng() * 16;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (Math.abs(x) > 36 || Math.abs(z) > 36) continue;
      const k = Math.floor(this.rng() * ROCK_SIZES.length);
      const hull = this._rockHulls[k];
      const b = new Body(hull, {
        pos: v3(x, ROCK_SIZES[k] + 0.4, z),
        quat: randomQuat(this.rng),
        density: 3.2, friction: 0.8, restitution: 0.05,
        group: G_PROP, rollingFriction: 0.08, angularDamping: 0.3, tag: 'rock',
      });
      const g = 0.85 + this.rng() * 0.3;
      this.prop(b, `rock${k}`, [1, 1, 1],
        [PALETTE.rock[0] * g, PALETTE.rock[1] * g, PALETTE.rock[2] * g, 1], { gloss: 0.18 });
    }

    for (let i = 0; i < 16; i++) {
      const s = 0.45 + this.rng() * 0.35;
      const b = new Body(boxShape(s), {
        pos: v3((this.rng() - 0.5) * 40, 6 + this.rng() * 8, (this.rng() - 0.5) * 40),
        quat: randomQuat(this.rng),
        density: 1.4, friction: 0.6, restitution: 0.2,
        group: G_PROP, rollingFriction: 0.04, tag: 'crate',
      });
      this.prop(b, 'box', [s * 2, s * 2, s * 2], [0.44, 0.33, 0.2, 1], { gloss: 0.25 });
    }
  }

  /* ────────────────────────────────────────────────────────── runtime ── */

  update(dt) {
    if (this.cannon.cooldown > 0) this.cannon.cooldown -= dt;
    // The barrel is kinematic: drive its orientation, not its velocity.
    const c = this.cannon;
    c.barrel.quat.setEuler(c.pitch - Math.PI / 2, c.yaw, 0);
    c.barrel.updateInertiaWorld();
    c.barrel.updateAABB();

    // Anything that escapes the arena gets recycled rather than falling forever.
    for (const rec of this.props) {
      const b = rec.body;
      if (b.type !== DYNAMIC) continue;
      if (b.pos.y < -20 || !b.pos.isFinite()) {
        b.pos.set(clamp(b.pos.x, -30, 30), 14, clamp(b.pos.z, -30, 30));
        b.vel.zero(); b.angVel.zero(); b.wake();
      }
    }
  }

  /** Records the starting transform of everything dynamic, for R (reset). */
  snapshot() {
    this._resetState = this.props
      .filter((p) => p.body.type === DYNAMIC)
      .map((p) => ({ body: p.body, pos: p.body.pos.clone(), quat: p.body.quat.clone() }));
  }

  reset() {
    for (const s of this._resetState) {
      s.body.pos.copy(s.pos);
      s.body.quat.copy(s.quat);
      s.body.vel.zero();
      s.body.angVel.zero();
      s.body.updateInertiaWorld();
      s.body.updateAABB();
      s.body.wake();
    }
    for (const m of this.monoliths) { m.found = false; m.rec.emissive = m.rec.baseEmissive; }
    // The name has to read as a name again, so park those cubes back to sleep.
    for (const b of this.world.bodies) if (b.tag === 'name') b.sleep();
    if (this.shots) { for (const s of this.shots) this.despawn(s); this.shots.length = 0; }
  }
}

/* ────────────────────────────────────────────────────────────── utils ── */

export function cannonDir(c, out = new Vec3()) {
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  return out.set(Math.sin(c.yaw) * cp, sp, Math.cos(c.yaw) * cp).normalize();
}

function randomQuat(rng) {
  const u1 = rng(), u2 = rng(), u3 = rng();
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  return quat(
    s1 * Math.sin(2 * Math.PI * u2), s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3), s2 * Math.cos(2 * Math.PI * u3),
  );
}

/** Cheap HSL→linear-ish RGB for palette variety. */
function hsl(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return [f(0), f(8), f(4), 1];
}
