/**
 * The level *is* the CV.
 *
 * Nineteen projects are warp pipes with a screen bolted on top, twelve jobs
 * are a staircase you climb, thirty-one skills are coins strung along jump
 * arcs, five schools are little castles. Everything is generated from the same
 * content module the other three versions of this site use, so the level
 * changes shape the day the CV does.
 *
 * The builder emits three things at once and keeps them in step: the geometry
 * you can see, the path Bart walks, and the props hanging off it.
 */

import { PROJECTS, JOBS, SKILLS, EDUCATION, PROFILE } from '../../v3/js/game/content.js';
import { Path } from './path.js';

export const TILE = 16;

/* Sky anchors. The colour under the level lerps between these as you scroll,
   so the resume runs from morning to dusk to night and back to morning. */
const SKY = {
  morning: { top: '#4fa8e8', mid: '#8fd0f5', low: '#cfeeff', sun: '#fff4c2', stars: 0 },
  noon:    { top: '#3f9ae4', mid: '#79c6f2', low: '#c6ecff', sun: '#fffbe0', stars: 0 },
  dusk:    { top: '#3b2f6e', mid: '#a2569b', low: '#f0975c', sun: '#ffd08a', stars: 0.25 },
  night:   { top: '#100f2c', mid: '#232253', low: '#3b3a76', sun: '#cfd6ff', stars: 1 },
  dawn:    { top: '#2f4f8f', mid: '#7f7ac0', low: '#ffc79a', sun: '#ffe6b0', stars: 0.15 },
};

class Build {
  constructor() {
    this.path = new Path(0);
    this.gaps = [];       // holes in the base ground
    this.plats = [];      // floating platforms and raised terrain
    this.props = [];      // everything drawn on top of the terrain
    this.spots = [];      // message-box triggers
    this.coins = [];
    this.chapters = [];
    this.clouds = [];
    this.far = [];        // parallax hills and mountains
  }

  get x() { return this.path.x; }
  get y() { return this.path.y; }

  /** Run along the current height. Above ground level that means a platform. */
  flat(len, kind = 'slab') {
    if (this.y < 0) this.plats.push({ x0: this.x, x1: this.x + len, top: this.y, kind });
    this.path.flat(len);
    return this;
  }

  /** Jump forward and land at the same height, ground continuing underneath. */
  hop(len, h = 60, kind = 'slab') {
    if (this.y < 0) this.plats.push({ x0: this.x, x1: this.x + len, top: this.y, kind });
    this.path.arc(len, 0, h);
    return this;
  }

  /** Jump a hole in the ground. */
  pit(len, h = 64) {
    this.gaps.push({ x0: this.x, x1: this.x + len });
    this.path.arc(len, 0, h);
    return this;
  }

  /** Jump up onto whatever the next flat() lays down. */
  climb(len, dy, h) { this.path.arc(len, dy, h == null ? dy + 34 : h); return this; }

  /** Step down. Short arc, small apex — gravity does the work. */
  drop(len, dy, h = 12) { this.path.arc(len, -dy, h); return this; }

  prop(t, x, y, data) { const p = { t, x, y, ...data }; this.props.push(p); return p; }
  spot(x, kind, data) { this.spots.push({ x, kind, ...data, seen: false }); }
  coin(x, y, label) { this.coins.push({ x, y, label, got: false }); }

  chapter(id, title, sub, sky) {
    if (this.chapters.length) this.chapters[this.chapters.length - 1].x1 = this.x;
    this.chapters.push({ id, title, sub, sky, x0: this.x, x1: this.x + 1, shown: false });
  }

  /** Scatter clouds and background hills across a stretch. */
  scenery(x0, x1, { hills = 0.004, bushes = 0.004, clouds = 0.005, dark = false, mountain = false } = {}) {
    let seed = ((Math.round(x0) + 1) * 2654435761) % 2147483647;
    if (seed <= 0) seed += 2147483646;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    for (let x = x0; x < x1; x += 40) {
      if (rnd() < hills * 40) this.far.push({ t: mountain ? 'mountain' : 'hill', x, w: 44 + Math.round(rnd() * 66), dark: dark || rnd() < 0.4 });
      if (rnd() < bushes * 40) this.props.push({ t: 'bush', x: x + Math.round(rnd() * 30), y: 0, w: 22 + Math.round(rnd() * 22) });
      if (rnd() < clouds * 40) this.clouds.push({ x, y: -72 - rnd() * 56, w: 30 + Math.round(rnd() * 44), depth: 0.35 + rnd() * 0.3 });
    }
  }
}

/* ───────────────────────────────────────────────────────── the level ──── */

export function buildLevel() {
  const b = new Build();

  /* ── 1 · the title screen you can walk out of ────────────────────────── */
  b.chapter('start', 'THE START', PROFILE.name, SKY.morning);
  b.prop('banner', 175, -120, {
    lines: [PROFILE.name, `${PROFILE.role.toUpperCase()} · ${PROFILE.org.toUpperCase()}`, `${PROFILE.city.toUpperCase()} · SCROLL TO PLAY`],
  });
  b.flat(300);
  b.prop('sign', 470, 0, { lines: ['SCROLL', 'DOWN'] });
  b.flat(160);
  // A first, gentle jump with three coins in it, to teach the mechanic.
  const t0 = b.x;
  b.hop(200, 64);
  for (let i = 0; i < 3; i++) {
    const u = 0.25 + i * 0.25;
    b.coin(t0 + 200 * u, -4 * 64 * u * (1 - u) - 12, i === 1 ? 'HELLO' : null);
  }
  b.flat(120);
  b.scenery(0, b.x, { clouds: 0.007 });

  /* ── 2 · who this is ─────────────────────────────────────────────────── */
  b.chapter('about', 'PLAYER 1', 'BART JANSEN', SKY.morning);
  const facts = [
    { glyph: '?', head: PROFILE.role.toUpperCase(), body: `AT ${PROFILE.org.toUpperCase()}. ${PROFILE.city.toUpperCase()}.` },
    { glyph: '?', head: 'MAIL', body: PROFILE.email.toUpperCase() },
    { glyph: '?', head: 'THE PAPER VERSION', body: 'A PDF CV IS PARKED AT THE END OF THIS LEVEL.' },
    { glyph: '?', head: 'THREE OTHER SITES', body: 'V1 2016 · V3 A 3D SANDBOX · V4 A CARTOON ISLAND. ALL STILL UP.' },
  ];
  b.flat(90);
  facts.forEach((f, i) => {
    const bx = b.x + 60;
    b.prop('qblock', bx, -74, { fact: f, hit: false });
    b.hop(190, 62);
    b.spot(bx, 'fact', { title: f.head, body: f.body });
    b.flat(40);
  });
  b.flat(40);
  b.prop('goomba', b.x + 74, 0, { x0: b.x + 30, x1: b.x + 120, dead: false });
  b.hop(180, 58);
  b.flat(80);
  b.prop('pipe', b.x + 40, 0, { w: 40, h: 54, piranha: true });
  b.hop(160, 84);
  b.flat(60);
  b.pit(120, 74);
  b.flat(120);
  b.scenery(b.chapters[1].x0, b.x, { hills: 0.005, bushes: 0.006, clouds: 0.007 });

  /* ── 3 · skills, strung along jump arcs like coins ───────────────────── */
  b.chapter('skills', 'COIN RUSH', `${SKILLS.length} THINGS I CAN DO`, SKY.noon);
  b.flat(60);
  const perArc = 4;
  for (let i = 0; i < SKILLS.length; i += perArc) {
    const group = SKILLS.slice(i, i + perArc);
    const span = 90 + group.length * 46;
    const apex = 62 + (i % 3) * 8;
    const x0 = b.x;
    if ((i / perArc) % 3 === 2) {
      // Every third arc goes over something worth clearing.
      b.prop('goomba', x0 + span * 0.5, 0, { x0: x0 + span * 0.25, x1: x0 + span * 0.78, dead: false });
    }
    b.hop(span, apex);
    group.forEach((name, j) => {
      const u = (j + 0.5) / group.length;
      const y = -4 * apex * u * (1 - u) - 13;
      b.coin(x0 + span * u, y, name);
    });
    b.flat(52);
  }
  b.prop('brickrow', b.x + 20, -74, { n: 4 });
  b.prop('qblock', b.x + 20 + 4 * TILE, -74, { fact: { head: '1-UP', body: `${SKILLS.length} SKILLS, ONE CAREER. KEEP SCROLLING.` }, hit: false, mushroom: true });
  b.prop('brickrow', b.x + 20 + 5 * TILE, -74, { n: 3 });
  b.hop(230, 66);
  b.flat(90);
  b.scenery(b.chapters[2].x0, b.x, { hills: 0.004, bushes: 0.007, clouds: 0.006 });

  /* ── 4 · the career staircase ────────────────────────────────────────── */
  b.chapter('career', 'THE CLIMB', `${JOBS.length} JOBS, OLDEST FIRST`, SKY.dusk);
  const climbFrom = b.x;
  const ladder = JOBS.slice().reverse();
  const rises = [18, 14, 22, 12, 20, 16, 24, 12, 18, 16, 22, 14];
  ladder.forEach((job, i) => {
    const rise = rises[i % rises.length];
    b.climb(120, rise, rise + 46);
    const px = b.x;
    b.flat(170, 'stone');
    b.prop('post', px + 26, b.y, { lines: [job.when.toUpperCase()], role: job.role.toUpperCase(), org: job.org.toUpperCase() });
    b.spot(px + 80, 'job', { title: job.role.toUpperCase(), org: job.org.toUpperCase(), when: job.when.toUpperCase(), body: job.desc.toUpperCase() });
  });
  const peak = b.y;
  b.prop('flagtop', b.x - 40, peak, {});
  // Back down to sea level in three long strides.
  b.drop(150, -Math.round(peak * 0.34), 34);
  b.flat(90, 'stone');
  b.drop(170, -Math.round(peak * 0.34), 30);
  b.flat(90, 'stone');
  b.drop(190, b.y * -1, 26);
  b.flat(140);
  b.scenery(climbFrom, b.x, { hills: 0.003, bushes: 0, clouds: 0.004, mountain: true, dark: true });

  /* ── 5 · projects, one warp pipe each ────────────────────────────────── */
  b.chapter('work', 'WARP ZONE', `${PROJECTS.length} THINGS I BUILT`, SKY.night);
  b.flat(70);
  // The screens hang at a fixed height so they always clear the status bar and
  // always clear the top of Bart's arc, whatever the pipe below them is doing.
  const SCREEN_Y = -136;
  PROJECTS.forEach((p, i) => {
    const tall = i % 5 === 4;
    const h = tall ? 46 : 38;
    const px = b.x + 76;
    b.prop('pipe', px, 0, { w: 40, h, piranha: tall });
    b.prop('screen', px + 20, SCREEN_Y, { project: p, index: i, pole: -SCREEN_Y - 58 - h });
    b.spot(px + 20, 'project', { title: p.title.toUpperCase(), org: p.blurb, when: `#${i + 1} OF ${PROJECTS.length}`, img: p.img });
    b.hop(180, h + 12);
    b.flat(24);
  });
  b.flat(90);
  b.scenery(b.chapters[4].x0, b.x, { hills: 0, bushes: 0, clouds: 0.003 });

  /* ── 6 · where it all started ────────────────────────────────────────── */
  b.chapter('school', 'THE ACADEMY', `${EDUCATION.length} STAMPS ON THE CARD`, SKY.dawn);
  b.flat(80);
  EDUCATION.forEach((e) => {
    const hx = b.x + 40;
    b.prop('school', hx, 0, { what: e.what.toUpperCase(), where: e.where.toUpperCase(), when: e.when.toUpperCase() });
    b.spot(hx + 50, 'school', { title: e.what.toUpperCase(), org: e.where.toUpperCase(), when: e.when.toUpperCase(), body: '' });
    b.flat(150);
    b.hop(150, 58);
  });
  b.flat(60);
  b.scenery(b.chapters[5].x0, b.x, { hills: 0.005, bushes: 0.008, clouds: 0.006 });

  /* ── 7 · flagpole ────────────────────────────────────────────────────── */
  b.chapter('end', 'COURSE CLEAR', 'THANKS FOR SCROLLING', SKY.morning);
  b.flat(120);
  // A staircase of blocks, because of course there is one.
  for (let i = 0; i < 5; i++) {
    b.prop('stair', b.x + 20 + i * TILE, -TILE * (i + 1), { n: i + 1 });
  }
  b.flat(140);
  const poleX = b.x + 90;
  b.prop('flag', poleX, 0, { h: 140 });
  b.spot(poleX, 'end', { title: 'COURSE CLEAR', body: '' });
  b.flat(200);
  b.prop('castle', b.x + 30, 0, { w: 130 });
  b.flat(320);
  b.scenery(b.chapters[6].x0, b.x, { hills: 0.006, bushes: 0.008, clouds: 0.007 });

  b.chapters[b.chapters.length - 1].x1 = b.x;
  b.path.seal();

  const length = b.x;
  b.plats.sort((p, q) => p.x0 - q.x0);
  b.props.sort((p, q) => p.x - q.x);
  b.spots.sort((p, q) => p.x - q.x);
  b.coins.sort((p, q) => p.x - q.x);

  return {
    length,
    path: b.path,
    gaps: b.gaps,
    plats: b.plats,
    props: b.props,
    spots: b.spots,
    coins: b.coins,
    chapters: b.chapters,
    clouds: b.clouds,
    far: b.far,
    counts: { projects: PROJECTS.length, jobs: JOBS.length, skills: SKILLS.length, schools: EDUCATION.length },
  };
}

/** Sky colour at a given x, lerped between chapter anchors. */
export function skyAt(chapters, x) {
  let i = 0;
  while (i < chapters.length - 1 && x >= chapters[i].x1) i++;
  const a = chapters[i];
  const bch = chapters[Math.min(i + 1, chapters.length - 1)];
  const span = Math.max(1, a.x1 - a.x0);
  // Only blend over the last third of a chapter, so each one has a settled look.
  const t = Math.min(1, Math.max(0, ((x - a.x0) / span - 0.66) / 0.34));
  return {
    top: mix(a.sky.top, bch.sky.top, t),
    mid: mix(a.sky.mid, bch.sky.mid, t),
    low: mix(a.sky.low, bch.sky.low, t),
    sun: mix(a.sky.sun, bch.sky.sun, t),
    stars: a.sky.stars + (bch.sky.stars - a.sky.stars) * t,
  };
}

function mix(a, c, t) {
  if (t <= 0) return a;
  if (t >= 1) return c;
  const pa = parseInt(a.slice(1), 16);
  const pc = parseInt(c.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pc >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pc >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pc & 255) - (pa & 255)) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
