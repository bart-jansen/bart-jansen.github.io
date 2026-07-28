/**
 * Page furniture: reveals, theme, clock, counters, dock, cursor, form.
 * Everything here degrades to "already fine" when JS or motion is off.
 */

import { debrisField } from './debris.js';

/* ----------------------------------------------------------- reveals -- */

export function initReveals({ reduced }) {
  const items = [...document.querySelectorAll('[data-reveal]')];
  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries, obs) => {
    let n = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.style.setProperty('--delay', n++ * 70 + 'ms');
      e.target.classList.add('is-in');
      obs.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  items.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------ metrics -- */

/** The sticky bar's height feeds the hero's 100svh calculation. */
export function initMetrics() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const set = () => {
    document.documentElement.style.setProperty('--topbar-h', bar.offsetHeight + 'px');
  };
  set();
  if ('ResizeObserver' in window) new ResizeObserver(set).observe(bar);
  else window.addEventListener('resize', set);
}

/* ------------------------------------------------------------- theme -- */

export function initTheme(onChange) {
  const root = document.documentElement;
  const label = document.querySelector('[data-theme-label]');
  const btn = document.querySelector('[data-theme-toggle]');
  const stored = localStorage.getItem('bj-theme');

  const apply = (theme) => {
    root.dataset.theme = theme;
    if (label) label.textContent = theme === 'light' ? 'Light' : 'Dark';
    btn?.setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`);
    onChange?.(theme);
  };

  apply(stored || 'dark');

  btn?.addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('bj-theme', next);
    const swap = () => apply(next);
    if (document.startViewTransition) document.startViewTransition(swap);
    else swap();
  });
}

/* ------------------------------------------------------------- clock -- */

export function initClock() {
  const el = document.querySelector('[data-clock]');
  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
  if (!el) return;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam',
  });
  const tick = () => { el.textContent = fmt.format(new Date()); };
  tick();
  setInterval(tick, 20000);
}

/* ---------------------------------------------------------- counters -- */

export function initCounters({ reduced }) {
  const stats = [...document.querySelectorAll('[data-count]')];
  if (!stats.length) return;

  const run = (el) => {
    const target = Number(el.dataset.count) || 0;
    const suffix = el.dataset.suffix || '';
    if (reduced) { el.textContent = target + suffix; return; }
    const dur = 1400;
    const t0 = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = Math.round(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  if (!('IntersectionObserver' in window)) { stats.forEach(run); return; }
  const io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      run(e.target);
      obs.unobserve(e.target);
    }
  }, { threshold: 0.5 });
  stats.forEach((el) => io.observe(el));
}

/* -------------------------------------------------------------- dock -- */

export function initDock() {
  const dock = document.querySelector('.dock');
  if (!dock) return;
  const links = [...dock.querySelectorAll('[data-dock]')];
  const pill = dock.querySelector('.dock__pill');
  const sections = links
    .map((a) => ({ a, el: document.getElementById(a.dataset.dock) }))
    .filter((s) => s.el);

  let activeId = null;

  const movePill = (a) => {
    if (!pill) return;
    const dr = dock.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    pill.style.width = r.width + 'px';
    pill.style.transform = `translateX(${r.left - dr.left + dock.scrollLeft}px)`;
    pill.style.opacity = '1';
  };

  const setActive = (id) => {
    if (id === activeId) return;
    activeId = id;
    for (const { a } of sections) {
      const on = a.dataset.dock === id;
      a.classList.toggle('is-current', on);
      if (on) { a.setAttribute('aria-current', 'true'); movePill(a); }
      else a.removeAttribute('aria-current');
    }
  };

  const pick = () => {
    const mid = window.innerHeight * 0.42;
    let best = sections[0], bestD = Infinity;
    for (const s of sections) {
      const r = s.el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const d = Math.abs(r.top - mid);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) setActive(best.a.dataset.dock);
  };

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; pick(); });
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    const a = sections.find((s) => s.a.dataset.dock === activeId)?.a;
    if (a) movePill(a);
  });
  dock.addEventListener('scroll', () => {
    const a = sections.find((s) => s.a.dataset.dock === activeId)?.a;
    if (a) movePill(a);
  }, { passive: true });

  requestAnimationFrame(pick);
}

/* ------------------------------------------------------------ cursor -- */

export function initCursor({ reduced }) {
  const cursor = document.querySelector('.cursor');
  if (!cursor || reduced) return;
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const ring = cursor.querySelector('i');
  const dot = cursor.querySelector('b');
  const target = { x: innerWidth / 2, y: innerHeight / 2 };
  const slow = { x: target.x, y: target.y, vx: 0, vy: 0 };
  const fast = { x: target.x, y: target.y };
  let scale = 1, scaleTarget = 1;
  let seen = false;

  window.addEventListener('pointermove', (e) => {
    target.x = e.clientX; target.y = e.clientY;
    if (!seen) { seen = true; slow.x = fast.x = target.x; slow.y = fast.y = target.y; }
    const hot = e.target instanceof Element &&
      e.target.closest('a, button, .work, .chip, .letter, .pebble, input, textarea');
    scaleTarget = hot ? 1.85 : 1;
  }, { passive: true });

  document.addEventListener('pointerdown', () => { scaleTarget = 0.7; });
  document.addEventListener('pointerup', () => { scaleTarget = 1; });

  // Critically damped spring for the ring, plain lerp for the dot.
  const K = 210, D = 26;
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    slow.vx += (-K * (slow.x - target.x) - D * slow.vx) * dt;
    slow.vy += (-K * (slow.y - target.y) - D * slow.vy) * dt;
    slow.x += slow.vx * dt;
    slow.y += slow.vy * dt;
    fast.x += (target.x - fast.x) * 0.55;
    fast.y += (target.y - fast.y) * 0.55;
    scale += (scaleTarget - scale) * 0.16;

    const speed = Math.min(1, Math.hypot(slow.vx, slow.vy) / 1400);
    ring.style.transform =
      `translate3d(${slow.x.toFixed(1)}px, ${slow.y.toFixed(1)}px, 0) scale(${(scale * (1 + speed * 0.35)).toFixed(3)}, ${(scale * (1 - speed * 0.22)).toFixed(3)})`;
    dot.style.transform = `translate3d(${fast.x.toFixed(1)}px, ${fast.y.toFixed(1)}px, 0)`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------- cell lights -- */

export function initCells() {
  for (const cell of document.querySelectorAll('.cell')) {
    cell.addEventListener('pointermove', (e) => {
      const r = cell.getBoundingClientRect();
      cell.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      cell.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  }
}

/* --------------------------------------------------------------- form -- */

export function initForm({ reduced }) {
  const form = document.querySelector('[data-shatter-form]');
  if (!form) return;
  const btn = form.querySelector('[data-shatter]');
  const note = form.querySelector('[data-form-note]');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const subject = encodeURIComponent(`bart.je — ${data.get('name') || 'hello'}`);
    const body = encodeURIComponent(`${data.get('message') || ''}\n\n— ${data.get('name') || ''} (${data.get('email') || ''})`);

    if (btn && !reduced) {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      debrisField().shatter(btn, { cols: 11, rows: 4, color: accent || undefined });
      btn.style.visibility = 'hidden';
      setTimeout(() => { btn.style.visibility = ''; }, 2600);
    }

    if (note) note.textContent = 'Opening your mail client…';
    setTimeout(() => {
      window.location.href = `mailto:b@rtjansen.nl?subject=${subject}&body=${body}`;
      if (note) note.textContent = "If nothing opened, mail me directly at b@rtjansen.nl.";
    }, reduced ? 0 : 520);
  });
}
