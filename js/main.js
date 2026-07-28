/**
 * bart.je — 2026
 *
 * Orchestration only. Everything below is optional decoration: the page is a
 * complete, readable document without a single line of this file running.
 */

import { initMetrics, initReveals, initTheme, initClock, initCounters, initDock, initCursor, initCells, initForm } from './ui.js';
import { initHero } from './hero.js';
import { initSkills } from './skills.js';
import { initRope } from './rope.js';
import { initPortfolio } from './portfolio.js';

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const ctx = { reduced: motionQuery.matches };

const boot = async () => {
  document.documentElement.classList.add('js');

  let rope = null;
  initMetrics();
  initTheme(() => rope?.refreshTokens?.());
  initClock();
  initReveals(ctx);
  initCounters(ctx);
  initDock();
  initCells();
  initCursor(ctx);
  initForm(ctx);
  initPortfolio(document.getElementById('portfolio'), ctx);

  if (ctx.reduced) {
    document.documentElement.classList.add('no-physics');
    const hint = document.querySelector('.hero__hint');
    if (hint) hint.innerHTML = '<span aria-hidden="true">\u2193</span> scroll';
    console.info('bart.je \u00b7 reduced motion \u2014 physics disabled');
    return;
  }

  rope = initRope(document.querySelector('[data-pendulum]'), ctx);

  // Physics stages are heavier; let the first paint land first.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
  idle(() => {
    initHero(document.querySelector('[data-stage="hero"]'), ctx).catch(reportFailure);
    initSkills(document.querySelector('[data-stage="skills"]'), ctx).catch(reportFailure);
  });

  console.info(
    '%c bart.je %c hand-rolled rigid-body engine · no dependencies · js/engine/physics.js ',
    'background:#f4c024;color:#12141a;font-weight:700;border-radius:3px 0 0 3px;padding:2px 6px',
    'background:#12141a;color:#f4c024;border-radius:0 3px 3px 0;padding:2px 6px',
  );
};

function reportFailure(err) {
  console.warn('bart.je · physics module failed, falling back to static layout', err);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
