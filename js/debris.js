/**
 * Debris field — a viewport-level physics world for transient particles.
 *
 * Used when something leaves the page violently: portfolio cards thrown out by
 * a filter change, or the send button shattering. Bodies live in viewport
 * coordinates, collide with each other, and are culled once they fall out of
 * sight.
 */

import { World, Runner, Body, boxShape, circleShape, v2, rand } from './engine/physics.js';

export class DebrisField {
  constructor() {
    this.world = new World({ gravityY: 2600, iterations: 6, positionIterations: 2, enableSleep: false });
    this.layer = document.createElement('div');
    this.layer.className = 'debris-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.layer);
    this.active = 0;
    this.runner = new Runner(this.world, () => this._frame());
  }

  _wake() {
    if (!this.runner.running) this.runner.start();
  }

  _frame() {
    const h = window.innerHeight, w = window.innerWidth;
    for (let i = this.world.bodies.length - 1; i >= 0; i--) {
      const b = this.world.bodies[i];
      const el = b.el;
      if (!el) continue;
      b.life = (b.life ?? 0) + 1;
      const gone = b.position.y - b.halfH > h + 220 ||
                   b.position.x + b.halfW < -320 ||
                   b.position.x - b.halfW > w + 320 ||
                   b.life > 900;
      if (gone) {
        this.world.remove(b);
        el.remove();
        this.active--;
        continue;
      }
      const fade = b.fadeAt && b.life > b.fadeAt
        ? Math.max(0, 1 - (b.life - b.fadeAt) / 40)
        : 1;
      el.style.opacity = fade === 1 ? '' : fade.toFixed(3);
      el.style.transform =
        `translate3d(${(b.position.x - b.halfW).toFixed(2)}px, ${(b.position.y - b.halfH).toFixed(2)}px, 0) rotate(${b.angle.toFixed(4)}rad)`;
    }
    if (this.active <= 0) this.runner.stop();
  }

  /** Throw a detached element (already sized) from a viewport rect. */
  launch(el, rect, opts = {}) {
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
    this.layer.appendChild(el);

    const body = new Body({
      shape: opts.round
        ? circleShape(Math.max(rect.width, rect.height) / 2)
        : boxShape(rect.width / 2, rect.height / 2),
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      el,
      friction: 0.3,
      restitution: 0.35,
      density: opts.density ?? 0.0009,
      angularDamping: 0.02,
      linearDamping: 0.006,
    });
    body.halfW = rect.width / 2;
    body.halfH = rect.height / 2;
    body.fadeAt = opts.fadeAt ?? null;
    body.velocity.set(opts.vx ?? 0, opts.vy ?? 0);
    body.angularVelocity = opts.av ?? rand(-6, 6);

    this.world.add(body);
    this.active++;
    this._wake();
    return body;
  }

  /**
   * Break an element's box into a grid of shards that fly apart. The source
   * element keeps its place in the layout; only the shards are physical.
   */
  shatter(source, opts = {}) {
    const rect = source.getBoundingClientRect();
    const cols = opts.cols ?? 9;
    const rows = opts.rows ?? 3;
    const cw = rect.width / cols;
    const ch = rect.height / rows;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const styles = getComputedStyle(source);
    const bg = opts.color ?? styles.backgroundColor;
    const radius = styles.borderRadius;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const el = document.createElement('i');
        el.className = 'shard';
        el.style.background = bg;
        el.style.borderRadius = c === 0 || c === cols - 1 ? radius : '2px';
        const px = rect.left + c * cw;
        const py = rect.top + r * ch;
        const dx = px + cw / 2 - cx;
        const dy = py + ch / 2 - cy;
        const d = Math.hypot(dx, dy) || 1;
        this.launch(el, { left: px, top: py, width: cw, height: ch }, {
          vx: (dx / d) * rand(180, 620) + rand(-60, 60),
          vy: (dy / d) * rand(120, 380) - rand(240, 620),
          av: rand(-14, 14),
          density: 0.0006,
          fadeAt: opts.fadeAt ?? 70,
        });
      }
    }
  }

  /** Radial kick applied to everything currently in flight. */
  blast(x, y, strength = 1) {
    this.world.explode(v2(x, y), { radius: 600, strength: 1.2 * strength, upward: 0.4 });
  }
}

let shared = null;
export function debrisField() {
  if (!shared) shared = new DebrisField();
  return shared;
}
