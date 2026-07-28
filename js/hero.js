/**
 * Hero — the name is made of rigid bodies held in their typographic slot by
 * soft springs. Cut the springs and it collapses into a pile.
 */

import { Stage } from './engine/stage.js';
import { circleShape, boxShape, v2, rand } from './engine/physics.js';

const PALETTE = ['--amber', '--cyan', '--violet', '--lime'];

const GROUP_LETTER = 2;
const ALL = 0xffffffff;

const TYPE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
  'fontVariationSettings', 'fontFeatureSettings', 'letterSpacing',
  'wordSpacing', 'lineHeight', 'textTransform',
];

/** The letters leave their heading, so the typography has to travel with them. */
function copyTypography(from, to) {
  const cs = getComputedStyle(from);
  for (const prop of TYPE_PROPS) to.style[prop] = cs[prop];
}

export async function initHero(root, { reduced }) {
  const typeset = root.querySelector('[data-letters]');
  if (!typeset || reduced) return null;

  const text = typeset.textContent;

  // 1 · split into per-character spans while still in normal flow
  typeset.textContent = '';
  const letters = [];
  for (const ch of text) {
    const span = document.createElement('span');
    span.className = ch === ' ' ? 'letter letter--space' : 'letter';
    span.textContent = ch === ' ' ? '\u00a0' : ch;
    typeset.appendChild(span);
    if (ch !== ' ') letters.push(span);
  }

  try { await document.fonts.ready; } catch { /* older browsers */ }
  await new Promise((r) => requestAnimationFrame(r));

  const stage = new Stage(root, {
    gravity: 2400,
    ceiling: false,
    iterations: 9,
    positionIterations: 3,
    floorInset: 76,   // keep the pile clear of the floating dock
  });
  const layer = stage.createLayer();

  // 2 · record every letter's typographic slot, then lift them out of flow
  const homes = new Map();
  const cr0 = root.getBoundingClientRect();
  for (const el of letters) {
    const r = el.getBoundingClientRect();
    homes.set(el, v2(r.left - cr0.left + r.width / 2, r.top - cr0.top + r.height / 2));
  }
  typeset.style.setProperty('--typeset-h', typeset.getBoundingClientRect().height + 'px');
  copyTypography(typeset, layer);
  typeset.classList.add('is-live');

  const letterBodies = [];
  for (const el of letters) {
    const home = homes.get(el);
    layer.appendChild(el);
    const body = stage.addElement(el, {
      x: home.x,
      y: home.y - rand(140, 420),   // fly in from above
      angle: rand(-0.5, 0.5),
      friction: 0.5,
      restitution: 0.08,
      density: 0.0016,
      angularDamping: 0.12,
      shrink: 0.9,
      shrinkY: 0.82,
      group: GROUP_LETTER,
      // Kerned glyph boxes overlap, so anchored letters ignore each other.
      mask: ALL & ~GROUP_LETTER,
    });
    body.home = home;
    body.isLetter = true;
    stage.anchor(body, home);
    letterBodies.push(body);
  }

  // 3 · loose debris that piles up in the bottom of the hero
  const pebbles = [];
  const count = window.innerWidth < 700 ? 16 : 34;
  for (let i = 0; i < count; i++) {
    const square = i % 5 === 0;
    const size = square ? rand(10, 22) : rand(7, 20);
    const el = document.createElement('div');
    el.className = square ? 'pebble pebble--sq' : 'pebble';
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    const tone = PALETTE[i % PALETTE.length];
    el.style.background = i % 3 === 0
      ? `var(${tone})`
      : `color-mix(in oklch, var(${tone}) 30%, transparent)`;
    el.style.border = `1px solid color-mix(in oklch, var(${tone}) 70%, transparent)`;
    layer.appendChild(el);

    const body = stage.addBody({
      shape: square ? boxShape(size / 2, size / 2) : circleShape(size / 2),
      x: rand(size, stage.width - size),
      y: rand(-900, -60),
      angle: rand(0, 6.28),
      el,
      friction: 0.35,
      restitution: 0.3,
      density: 0.0011,
      angularDamping: 0.04,
    });
    body.halfW = size / 2;
    body.halfH = size / 2;
    body.isPebble = true;
    pebbles.push(body);
  }

  // 4 · the cursor pushes debris around, but never the letters
  const REPEL_RADIUS = 140;
  const REPEL_FORCE = 190000;
  stage.onStep = () => {
    if (!stage.pointer.inside) return;
    const p = stage.pointer;
    for (const b of pebbles) {
      const dx = b.position.x - p.x, dy = b.position.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > REPEL_RADIUS * REPEL_RADIUS || d2 < 1) continue;
      const d = Math.sqrt(d2);
      const falloff = (1 - d / REPEL_RADIUS) ** 2;
      b.applyForce(v2((dx / d) * REPEL_FORCE * falloff * b.mass,
                      (dy / d) * REPEL_FORCE * falloff * b.mass));
    }
  };

  stage.start();

  /* ------------------------------------------------------- controls -- */

  let anchored = true;
  let zeroG = false;

  const setAnchored = (on) => {
    anchored = on;
    if (on) {
      for (const b of letterBodies) {
        b.collisionMask = ALL & ~GROUP_LETTER;
        b.restitution = 0.08;
        b.friction = 0.5;
        if (!b.anchorJoint) stage.anchor(b, b.home);
        b.angularVelocity += rand(-1, 1);
      }
    } else {
      for (const b of letterBodies) {
        b.collisionMask = ALL;
        if (b.anchorJoint) { stage.world.removeJoint(b.anchorJoint); b.anchorJoint = null; }
        b.angularVelocity += rand(-11, 11);
        b.restitution = 0.24;
        b.friction = 0.32;
        b.applyImpulse(v2(rand(-320, 320), rand(-460, -80)).scale(b.mass), null);
      }
    }
    stage.world.wakeAll();
  };

  root.querySelector('[data-hero="drop"]')?.addEventListener('click', () => setAnchored(false));
  root.querySelector('[data-hero="rebuild"]')?.addEventListener('click', () => {
    if (!anchored) setAnchored(true);
    else stage.shake(0.5);
  });

  const zeroBtn = root.querySelector('[data-hero="zerog"]');
  zeroBtn?.addEventListener('click', () => {
    zeroG = !zeroG;
    zeroBtn.setAttribute('aria-pressed', String(zeroG));
    stage.baseGravity.set(0, zeroG ? 0 : 2400);
    stage.setGravity(0, zeroG ? 0 : 2400);
    for (const b of pebbles) {
      b.linearDamping = zeroG ? 0.0015 : 0.004;
      if (zeroG) b.applyImpulse(v2(rand(-90, 90), rand(-90, 90)).scale(b.mass), null);
    }
  });

  /* -------------------------------------------------------- readout -- */

  const out = {
    bodies: root.querySelector('[data-readout-bodies]'),
    contacts: root.querySelector('[data-readout-contacts]'),
    gravity: root.querySelector('[data-readout-gravity]'),
  };
  if (out.bodies) {
    setInterval(() => {
      if (!stage.visible) return;
      const dyn = stage.world.bodies.filter((b) => !b.isStatic).length;
      out.bodies.textContent = String(dyn);
      out.contacts.textContent = String(stage.world.manifolds.size);
      out.gravity.textContent = (stage.world.gravity.len() / 2400 * 9.81).toFixed(1);
    }, 220);
  }

  /* --------------------------------------------- tilt / scroll sway -- */

  let tilt = 0;
  const applyTilt = () => {
    if (zeroG) return;
    stage.tiltGravity(tilt);
  };

  if (window.DeviceOrientationEvent && 'ontouchstart' in window) {
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null) return;
      tilt = Math.max(-0.55, Math.min(0.55, (e.gamma / 90) * 1.1));
      applyTilt();
    }, { passive: true });
  } else {
    let lastY = window.scrollY, vel = 0;
    const onScroll = () => {
      const y = window.scrollY;
      vel = Math.max(-1, Math.min(1, (y - lastY) / 90));
      lastY = y;
      tilt = -vel * 0.22;
      applyTilt();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    setInterval(() => {
      if (Math.abs(tilt) < 0.001) return;
      tilt *= 0.86;
      applyTilt();
    }, 100);
  }

  /* --------------------------------------------------------- resize -- */

  // Re-measure the typographic slots after a reflow so the letters know where
  // "home" is on the new layout.
  const relayout = () => {
    typeset.classList.remove('is-live');
    const probes = letters.map((el) => {
      const clone = el.cloneNode(true);
      clone.removeAttribute('style');
      delete clone.dataset.physics;
      clone.classList.remove('is-held');
      typeset.appendChild(clone);
      return clone;
    });
    const cr = root.getBoundingClientRect();
    const h = typeset.getBoundingClientRect().height;
    probes.forEach((clone, i) => {
      const r = clone.getBoundingClientRect();
      homes.set(letters[i], v2(r.left - cr.left + r.width / 2, r.top - cr.top + r.height / 2));
      clone.remove();
    });
    typeset.style.setProperty('--typeset-h', h + 'px');
    copyTypography(typeset, layer);
    typeset.classList.add('is-live');
    for (const b of letterBodies) {
      const home = homes.get(b.el);
      if (!home) continue;
      b.home = home;
      if (b.anchorJoint) b.anchorJoint.target.set(home.x, home.y);
    }
  };

  stage.onResize = relayout;

  return { stage, letterBodies, pebbles, setAnchored };
}
