/**
 * Skills — a box of loose parts. Each chip is a rigid body you can drag,
 * stack and tip over.
 */

import { Stage } from './engine/stage.js';
import { v2, rand } from './engine/physics.js';

export async function initSkills(box, { reduced }) {
  const wrap = box?.querySelector('[data-chips]');
  if (!wrap || reduced) return null;

  const chips = [...wrap.querySelectorAll('.chip')];
  if (!chips.length) return null;

  try { await document.fonts.ready; } catch { /* older browsers */ }
  await new Promise((r) => requestAnimationFrame(r));

  const stage = new Stage(box, {
    gravity: 2000,
    ceiling: false,
    iterations: 9,
    positionIterations: 4,
  });

  // Capture the flow layout before switching the container to absolute mode.
  const boxLeft = box.getBoundingClientRect().left;
  const rects = chips.map((el) => el.getBoundingClientRect());
  wrap.classList.add('is-live');
  stage.adoptLayer(wrap);

  const bodies = chips.map((el, i) => {
    const r = rects[i];
    const half = r.width / 2;
    const body = stage.addElement(el, {
      x: Math.max(half + 6, Math.min(stage.width - half - 6, r.left - boxLeft + half)),
      y: -60 - i * 26,
      angle: rand(-0.35, 0.35),
      friction: 0.55,
      restitution: 0.08,
      density: 0.0014,
      angularDamping: 0.1,
    });
    return body;
  });

  stage.start();

  box.querySelector('[data-shake]')?.addEventListener('click', () => {
    stage.shake(1.15);
  });

  // A quick nudge whenever the section scrolls back into view keeps it alive.
  let lastNudge = 0;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const now = performance.now();
      if (now - lastNudge < 4000) continue;
      lastNudge = now;
      for (const b of bodies) {
        b.applyImpulse(v2(rand(-40, 40), rand(-120, -30)).scale(b.mass), null);
      }
    }
  }, { threshold: 0.35 });
  io.observe(box);

  return { stage, bodies };
}
