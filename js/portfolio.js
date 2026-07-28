/**
 * Portfolio filter — instead of fading out, rejected cards are ripped from the
 * grid and thrown across the viewport as real bodies. Survivors drop back in.
 */

import { debrisField } from './debris.js';
import { rand } from './engine/physics.js';

export function initPortfolio(section, { reduced }) {
  const filters = section?.querySelector('[data-filters]');
  const grid = section?.querySelector('[data-grid]');
  if (!filters || !grid) return null;

  const cards = [...grid.querySelectorAll('.work')];
  const buttons = [...filters.querySelectorAll('[data-filter]')];
  let current = 'all';
  let busy = false;

  const matches = (card, tag) =>
    tag === 'all' || (card.dataset.tags || '').split(/\s+/).includes(tag);

  const announce = () => {
    const shown = cards.filter((c) => !c.hidden).length;
    filters.setAttribute('aria-label', `Filter projects — ${shown} shown`);
  };

  const applyStatic = (tag) => {
    for (const card of cards) {
      const keep = matches(card, tag);
      card.hidden = !keep;
      card.classList.toggle('is-out', !keep);
    }
    announce();
  };

  const applyPhysical = (tag) => {
    const field = debrisField();
    const gridRect = grid.getBoundingClientRect();
    const cx = gridRect.left + gridRect.width / 2;
    const cy = gridRect.top + gridRect.height / 2;

    const leaving = cards.filter((c) => !c.hidden && !matches(c, tag));
    const entering = cards.filter((c) => c.hidden && matches(c, tag));

    for (const card of leaving) {
      const r = card.getBoundingClientRect();
      const visible = r.bottom > -200 && r.top < window.innerHeight + 200;
      if (visible) {
        const clone = card.cloneNode(true);
        clone.className = 'ejecta';
        clone.removeAttribute('data-reveal');
        const dx = r.left + r.width / 2 - cx;
        const dy = r.top + r.height / 2 - cy;
        const d = Math.hypot(dx, dy) || 1;
        field.launch(clone, r, {
          vx: (dx / d) * rand(420, 900) + rand(-120, 120),
          vy: (dy / d) * rand(180, 420) - rand(420, 780),
          av: rand(-9, 9),
          density: 0.0007,
        });
      }
      card.hidden = true;
      card.classList.add('is-out');
    }

    entering.forEach((card, i) => {
      card.hidden = false;
      card.classList.remove('is-out');
      card.style.animation = 'none';
      // force a reflow so the animation restarts every time
      void card.offsetWidth;
      card.style.animation = `dropIn 0.75s var(--ease-spring) ${i * 45}ms both`;
      card.addEventListener('animationend', () => { card.style.animation = ''; }, { once: true });
    });

    announce();
  };

  const setFilter = (tag) => {
    if (busy || tag === current) return;
    busy = true;
    current = tag;
    for (const b of buttons) {
      const on = b.dataset.filter === tag;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    if (reduced) applyStatic(tag); else applyPhysical(tag);
    setTimeout(() => { busy = false; }, 160);
  };

  for (const b of buttons) {
    b.setAttribute('aria-pressed', String(b.dataset.filter === 'all'));
    b.addEventListener('click', () => setFilter(b.dataset.filter));
  }

  return { setFilter };
}
