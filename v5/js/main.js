/**
 * Boot.
 *
 * Decides whether to run the game at all, wires the four pieces together
 * (world, scroll, hud, audio) and drives the frame loop. If anything is
 * missing — no canvas, reduced motion asked for, an outright crash — the plain
 * HTML CV underneath is revealed instead and nothing is lost.
 */

import { World } from './world.js';
import { Scroll } from './scroll.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';

const $ = (sel) => document.querySelector(sel);

function plain(reason) {
  document.documentElement.dataset.mode = 'plain';
  const note = $('[data-fallback-note]');
  if (note) note.textContent = reason;
  const fb = $('[data-fallback]');
  if (fb) fb.hidden = false;
  const boot = $('[data-boot]');
  if (boot) boot.hidden = true;
  window.__v5 = { ready: true, plain: true, info: () => ({ plain: true, reason }) };
}

function start() {
  const canvas = $('[data-canvas]');
  if (!canvas || !canvas.getContext || !canvas.getContext('2d')) {
    plain('This browser has no 2D canvas, so here is the flat version.');
    return;
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    plain('You asked for reduced motion, so the side-scroller stayed in its box.');
    return;
  }

  const world = new World(canvas);
  const scroll = new Scroll($('[data-spacer]'), world);
  const hud = new Hud(world);
  const audio = new Audio();

  world.onChapter = (ch) => hud.showChapter(ch);
  world.onSpot = (s) => hud.showSpot(s);
  world.onSound = (k) => audio.play(k);

  /* ── chrome ─────────────────────────────────────────────────────────── */
  const boot = $('[data-boot]');
  const dismiss = () => { if (boot && !boot.hidden) { boot.hidden = true; document.documentElement.dataset.mode = 'play'; } };
  ['wheel', 'keydown', 'touchstart', 'pointerdown'].forEach((e) => addEventListener(e, dismiss, { passive: true, once: false }));
  const play = $('[data-play]');
  if (play) play.addEventListener('click', () => { dismiss(); scroll.auto = 1; if (scroll.onAuto) scroll.onAuto(); });

  const sound = $('[data-sound]');
  if (sound) {
    sound.addEventListener('click', () => {
      const on = audio.toggle();
      sound.dataset.on = on ? 'yes' : 'no';
      sound.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) audio.play('coin');
    });
  }
  const autoBtn = $('[data-auto]');
  const syncAuto = () => {
    if (!autoBtn) return;
    autoBtn.dataset.on = scroll.auto ? 'yes' : 'no';
    autoBtn.setAttribute('aria-pressed', scroll.auto ? 'true' : 'false');
  };
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      dismiss();
      scroll.auto = scroll.auto ? 0 : 1;
      syncAuto();
    });
  }
  scroll.onAuto = syncAuto;

  const cvBtn = $('[data-textcv]');
  const cvPanel = $('[data-fallback]');
  const cvClose = $('[data-textclose]');
  const showCv = (on) => {
    if (!cvPanel) return;
    cvPanel.hidden = !on;
    document.documentElement.dataset.mode = on ? 'text' : 'play';
    if (cvBtn) { cvBtn.dataset.on = on ? 'yes' : 'no'; cvBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    if (on) { dismiss(); cvPanel.scrollTop = 0; }
  };
  if (cvBtn) cvBtn.addEventListener('click', () => showCv(cvPanel.hidden));
  if (cvClose) cvClose.addEventListener('click', () => showCv(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') showCv(false); });

  const endPanel = $('[data-end]');
  let endShown = false;
  let endSound = false;

  addEventListener('resize', () => {
    const p = scroll.max() ? scrollY / scroll.max() : 0;
    world.resize();
    scroll.reflow(p);
  });

  /* ── loop ───────────────────────────────────────────────────────────── */
  let last = performance.now();
  let fps = 60;
  let frames = 0;
  let acc = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    acc += dt; frames++;
    if (acc > 0.5) { fps = frames / acc; frames = 0; acc = 0; }

    const camX = scroll.update(dt);
    world.update(dt, camX);
    hud.update(dt);
    world.draw();
    hud.draw(world.ctx);

    const done = world.progress > 0.975;
    if (done !== endShown) {
      endShown = done;
      if (endPanel) endPanel.hidden = !done;
      if (done && !endSound) { endSound = true; audio.play('clear'); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__v5 = {
    ready: true,
    world,
    scroll,
    hud,
    audio,
    seek(p) {
      scrollTo(0, Math.round(p * scroll.max()));
      scroll.camX = (scrollY / scroll.max()) * Math.max(1, world.level.length - world.vw);
    },
    info: () => ({
      fps: Math.round(fps),
      vw: world.vw,
      vh: world.vh,
      scale: +world.scale.toFixed(2),
      len: world.level.length,
      camX: Math.round(world.camX),
      bartY: world.bart ? Math.round(world.bart.y) : null,
      chapter: world.chapter && world.chapter.id,
      coins: world.coins,
      found: world.found,
      total: world.total,
      props: world.level.props.length,
      spots: world.level.spots.length,
      scrollH: document.documentElement.scrollHeight,
    }),
  };
}

try {
  start();
} catch (err) {
  console.error(err);
  plain('The side-scroller fell over, so here is the CV as plain text.');
}
