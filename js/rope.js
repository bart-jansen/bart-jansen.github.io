/**
 * Timeline rope — the vertical hairline next to the work history is a plucked
 * string. A tiny Verlet solver (pinned at both ends) reacts to scroll velocity
 * and to the pointer, and the job markers ride along it.
 */

const GUTTER_PAD = 70;   // extra canvas width so the string can swing out

class Verlet {
  constructor(x, y0, y1, segments) {
    this.points = [];
    this.rest = (y1 - y0) / segments;
    this.x0 = x;
    for (let i = 0; i <= segments; i++) {
      const y = y0 + i * this.rest;
      this.points.push({ x, y, px: x, py: y, pinned: i === 0 || i === segments });
    }
  }

  step(dt, ax, stiffness, damping) {
    for (const p of this.points) {
      if (p.pinned) { p.x = this.x0; continue; }
      const vx = (p.x - p.px) * damping;
      const vy = (p.y - p.py) * damping;
      p.px = p.x; p.py = p.y;
      const fx = ax + (this.x0 - p.x) * stiffness;
      p.x += vx + fx * dt * dt;
      p.y += vy;                       // vertical motion is fully constrained
    }
    for (let k = 0; k < 14; k++) this._constrain();
  }

  _constrain() {
    const pts = this.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const diff = (d - this.rest) / d * 0.5;
      const ox = dx * diff, oy = dy * diff;
      if (!a.pinned) { a.x += ox; a.y += oy; }
      if (!b.pinned) { b.x -= ox; b.y -= oy; }
    }
    const first = pts[0], last = pts[pts.length - 1];
    first.x = this.x0; last.x = this.x0;
  }

  push(y, radius, force) {
    for (const p of this.points) {
      if (p.pinned) continue;
      const d = Math.abs(p.y - y);
      if (d > radius) continue;
      p.x += force * (1 - d / radius) ** 2;
    }
  }

  /** Horizontal offset of the string at a given y. */
  xAt(y) {
    const pts = this.points;
    const t = (y - pts[0].y) / this.rest;
    const i = Math.max(0, Math.min(pts.length - 2, Math.floor(t)));
    const f = Math.max(0, Math.min(1, t - i));
    return pts[i].x + (pts[i + 1].x - pts[i].x) * f;
  }
}

export function initRope(timeline, { reduced }) {
  const canvas = timeline?.querySelector('[data-rope]');
  if (!canvas || reduced) return null;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  timeline.classList.add('is-roped');
  canvas.style.insetInlineStart = -GUTTER_PAD + 'px';
  canvas.style.inlineSize = `calc(clamp(1.5rem, 5vw, 4.5rem) + ${GUTTER_PAD * 2}px)`;

  const jobs = [...timeline.querySelectorAll('.job')];
  let rope = null, dpr = 1, w = 0, h = 0, anchorX = 0;
  let markers = [];
  let hovered = -1;

  const build = () => {
    const rect = canvas.getBoundingClientRect();
    const tRect = timeline.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    anchorX = GUTTER_PAD + 0.5;
    const segments = Math.max(24, Math.min(110, Math.round(h / 24)));
    rope = new Verlet(anchorX, 6, h - 6, segments);
    markers = jobs.map((job) => {
      const r = job.getBoundingClientRect();
      const dot = parseFloat(getComputedStyle(job, '::before').insetBlockStart) || 34;
      return { y: r.top - tRect.top + dot + 4.5, job };
    });
  };

  build();

  /* --------------------------------------------------------- forces -- */

  let scrollVel = 0, lastScroll = window.scrollY;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    scrollVel = Math.max(-2600, Math.min(2600, (lastScroll - y) * 26));
    lastScroll = y;
  }, { passive: true });

  const pointer = { y: -9999, active: false, dir: 1 };
  window.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const near = e.clientX > r.left - 40 && e.clientX < r.right + 40;
    pointer.active = near && e.clientY > r.top && e.clientY < r.bottom;
    pointer.y = e.clientY - r.top;
    pointer.dir = e.clientX < r.left + anchorX ? -1 : 1;
  }, { passive: true });

  jobs.forEach((job, i) => {
    job.addEventListener('pointerenter', () => {
      hovered = i;
      if (rope && markers[i]) rope.push(markers[i].y, 130, 9);
    });
    job.addEventListener('pointerleave', () => { if (hovered === i) hovered = -1; });
  });

  /* ----------------------------------------------------------- draw -- */

  const style = getComputedStyle(document.documentElement);
  let accent = style.getPropertyValue('--accent').trim() || '#f4c024';
  let line = style.getPropertyValue('--line').trim() || 'rgba(255,255,255,.14)';
  let bg = style.getPropertyValue('--bg-3').trim() || '#181a22';

  const refreshTokens = () => {
    const s = getComputedStyle(document.documentElement);
    accent = s.getPropertyValue('--accent').trim() || accent;
    line = s.getPropertyValue('--line').trim() || line;
    bg = s.getPropertyValue('--bg-3').trim() || bg;
  };

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    const pts = rope.points;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.08, line);
    grad.addColorStop(0.92, line);
    grad.addColorStop(1, 'transparent');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // The string lights up in proportion to how far it has been pulled.
    let swing = 0;
    for (const p of pts) swing = Math.max(swing, Math.abs(p.x - anchorX));
    if (swing > 1.5) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, swing / 34);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }

    markers.forEach((m, i) => {
      const x = rope.xAt(m.y);
      const on = i === hovered;
      ctx.beginPath();
      ctx.arc(x, m.y, on ? 6.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? accent : bg;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = on ? accent : line;
      ctx.stroke();
      if (on) {
        ctx.beginPath();
        ctx.arc(x, m.y, 13, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.25;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    });
  };

  /* ----------------------------------------------------------- loop -- */

  let running = false, raf = 0, last = 0;
  const frame = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.033, (now - last) / 1000) || 0.016;
    last = now;
    rope.step(dt, scrollVel, 46, 0.965);
    scrollVel *= 0.82;
    if (pointer.active) rope.push(pointer.y, 90, pointer.dir * 1.6);
    draw();
  };

  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !running) {
      running = true; last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!e.isIntersecting && running) {
      running = false; cancelAnimationFrame(raf);
    }
  }, { rootMargin: '160px' });
  io.observe(timeline);

  let t;
  const relayout = () => { clearTimeout(t); t = setTimeout(() => { build(); refreshTokens(); }, 150); };
  window.addEventListener('resize', relayout);
  if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(timeline);

  return { pluck: (y, f) => rope.push(y, 140, f), refreshTokens };
}
