/**
 * DOM stage — binds the physics world to real DOM elements.
 *
 * Every body can own an element; the stage writes transforms once per frame so
 * the markup stays real text (selectable, searchable, screen-reader friendly)
 * while it tumbles. Walls are derived from the container's box, pointer input
 * drives a mouse joint, and simulation pauses whenever the stage scrolls out of
 * view.
 */

import { World, Runner, Body, boxShape, circleShape, MouseJoint, Vec2, v2, rand } from './physics.js';

const WALL_THICKNESS = 400;

export class Stage {
  /**
   * @param {HTMLElement} container  element whose padding box defines the world
   * @param {object} opts
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.width = 0;
    this.height = 0;
    this.walls = { floor: null, left: null, right: null, ceiling: null };
    this.hasCeiling = opts.ceiling !== false;
    this.floorInset = opts.floorInset ?? 0;
    this.drag = opts.drag !== false;
    this.autoPause = opts.autoPause !== false;
    this.onStep = opts.onStep || null;
    this.onDragStart = opts.onDragStart || null;
    this.onDragEnd = opts.onDragEnd || null;

    this.world = new World({
      gravityY: opts.gravity ?? 2200,
      iterations: opts.iterations ?? 8,
      positionIterations: opts.positionIterations ?? 3,
      onCollision: opts.onCollision || null,
    });

    this.baseGravity = new Vec2(0, opts.gravity ?? 2200);
    this.pointer = { x: -9999, y: -9999, inside: false, down: false };
    this.mouseJoint = null;
    this.dragBody = null;
    this.visible = false;
    this.destroyed = false;

    this.runner = new Runner(this.world, () => this.sync());

    this._onResize = this._onResize.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    this.measure();
    this._buildWalls();
    this._observe();
    if (this.drag) this._bindPointer();
  }

  /* ---------------------------------------------------------- geometry -- */

  measure() {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    return r;
  }

  _buildWalls() {
    const w = this.width, h = this.height - this.floorInset, t = WALL_THICKNESS;
    const mk = (x, y, hw, hh) => this.world.add(new Body({
      shape: boxShape(hw, hh), x, y, isStatic: true, friction: 0.5, restitution: 0,
    }));
    this.walls.floor = mk(w / 2, h + t / 2, w / 2 + t, t / 2);
    this.walls.left = mk(-t / 2, h / 2, t / 2, h / 2 + t);
    this.walls.right = mk(w + t / 2, h / 2, t / 2, h / 2 + t);
    if (this.hasCeiling) this.walls.ceiling = mk(w / 2, -t / 2, w / 2 + t, t / 2);
  }

  _repositionWalls() {
    const w = this.width, h = this.height - this.floorInset, t = WALL_THICKNESS;
    const set = (body, x, y, hw, hh) => {
      if (!body) return;
      body.shape = boxShape(hw, hh);
      body.position.set(x, y);
      body.updateAABB();
    };
    set(this.walls.floor, w / 2, h + t / 2, w / 2 + t, t / 2);
    set(this.walls.left, -t / 2, h / 2, t / 2, h / 2 + t);
    set(this.walls.right, w + t / 2, h / 2, t / 2, h / 2 + t);
    set(this.walls.ceiling, w / 2, -t / 2, w / 2 + t, t / 2);
  }

  _onResize() {
    const prevW = this.width, prevH = this.height;
    this.measure();
    if (Math.abs(prevW - this.width) < 1 && Math.abs(prevH - this.height) < 1) return;
    this._repositionWalls();
    this.alignLayers();
    const sx = this.width / prevW, sy = this.height / prevH;
    for (const b of this.world.bodies) {
      if (b.isStatic) continue;
      b.setPosition(b.position.x * sx, Math.min(b.position.y * sy, this.height - 10));
    }
    this.world.wakeAll();
    if (this.onResize) this.onResize();
  }

  /* ------------------------------------------------------------ bodies -- */

  /**
   * Turn a DOM element into a rigid body. The element is taken out of flow and
   * positioned absolutely; its measured rect becomes the collision box.
   */
  addElement(el, opts = {}) {
    const cr = this.container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = r.left - cr.left + r.width / 2;
    const y = r.top - cr.top + r.height / 2;

    const sw = Math.max(2, (r.width / 2) * (opts.shrink ?? 1));
    const sh = Math.max(2, (r.height / 2) * (opts.shrinkY ?? opts.shrink ?? 1));
    const shape = opts.round
      ? circleShape(Math.max(sw, sh))
      : boxShape(sw, sh);

    const body = new Body({
      shape,
      x: opts.x ?? x,
      y: opts.y ?? y,
      angle: opts.angle ?? 0,
      el,
      friction: opts.friction ?? 0.45,
      restitution: opts.restitution ?? 0.12,
      density: opts.density ?? 0.0012,
      linearDamping: opts.linearDamping ?? 0.01,
      angularDamping: opts.angularDamping ?? 0.06,
      gravityScale: opts.gravityScale ?? 1,
      data: opts.data ?? null,
      group: opts.group,
      mask: opts.mask,
    });
    body.halfW = r.width / 2;
    body.halfH = r.height / 2;
    body.home = v2(x, y);

    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.margin = '0';
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
    el.style.willChange = 'transform';
    el.dataset.physics = 'on';

    this.world.add(body);
    return body;
  }

  addBody(opts) { return this.world.add(new Body(opts)); }

  /* ------------------------------------------------------------ layers -- */

  /**
   * A layer is an absolutely positioned plane inside the container whose box is
   * pinned to the container's *border* box, so a body at (0,0) renders exactly
   * at the container's top-left corner regardless of padding or borders.
   */
  createLayer(className = 'stage-layer') {
    const el = document.createElement('div');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    this.container.appendChild(el);
    return this.adoptLayer(el);
  }

  adoptLayer(el) {
    (this._layers ||= []).push(el);
    this.alignLayers();
    return el;
  }

  alignLayers() {
    if (!this._layers) return;
    const cr = this.container.getBoundingClientRect();
    for (const layer of this._layers) {
      layer.style.transform = 'none';
      layer.style.width = cr.width + 'px';
      layer.style.height = cr.height + 'px';
      const lr = layer.getBoundingClientRect();
      const dx = cr.left - lr.left, dy = cr.top - lr.top;
      layer.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : 'none';
    }
  }

  remove(body) {
    this.world.remove(body);
    if (body.el && body.el.parentNode) body.el.remove();
  }

  /* ----------------------------------------------------------- anchors -- */

  /**
   * Spring a body towards a fixed world point. Used to hold hero letters in
   * their typographic slot while still letting them collide and be thrown.
   */
  anchor(body, target, opts = {}) {
    const joint = new MouseJoint(body, target, {
      localAnchor: v2(0, 0),
      targetAngle: opts.targetAngle ?? 0,
      angularFrequency: opts.angularFrequency ?? 2.2,
      angularDamping: opts.angularDamping ?? 0.2,
      frequency: opts.frequency ?? 2.6,
      damping: opts.damping ?? 0.42,
      maxForce: opts.maxForce ?? 90000 * Math.max(body.mass, 0.05),
    });
    joint.isAnchor = true;
    body.anchorJoint = joint;
    this.world.addJoint(joint);
    return joint;
  }

  releaseAnchors() {
    for (const b of this.world.bodies) {
      if (b.anchorJoint) { this.world.removeJoint(b.anchorJoint); b.anchorJoint = null; }
    }
    this.world.wakeAll();
  }

  /* ----------------------------------------------------------- pointer -- */

  _bindPointer() {
    this.container.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
  }

  toLocal(clientX, clientY) {
    const cr = this.container.getBoundingClientRect();
    return v2(clientX - cr.left, clientY - cr.top);
  }

  _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // Controls always win over the bodies drifting behind them.
    if (e.target instanceof Element &&
        e.target.closest('a, button, input, textarea, select, summary, [role="button"]')) return;
    const p = this.toLocal(e.clientX, e.clientY);
    const body = this.world.queryPoint(p);
    if (!body) return;
    e.preventDefault();
    this.dragBody = body;
    if (body.anchorJoint) {
      body.anchorSuspended = body.anchorJoint;
      this.world.removeJoint(body.anchorJoint);
      body.anchorJoint = null;
    }
    this.mouseJoint = new MouseJoint(body, p, { frequency: 9, damping: 0.9 });
    this.world.addJoint(this.mouseJoint);
    if (body.el) body.el.classList.add('is-held');
    document.documentElement.classList.add('is-grabbing');
    if (this.onDragStart) this.onDragStart(body);
  }

  _onPointerMove(e) {
    const p = this.toLocal(e.clientX, e.clientY);
    this.pointer.x = p.x; this.pointer.y = p.y;
    this.pointer.inside = p.x > -80 && p.y > -80 && p.x < this.width + 80 && p.y < this.height + 80;
    if (this.mouseJoint) {
      this.mouseJoint.target.set(p.x, p.y);
      this.mouseJoint.body.wake();
    }
  }

  _onPointerUp() {
    if (this.mouseJoint) {
      this.world.removeJoint(this.mouseJoint);
      this.mouseJoint = null;
    }
    if (this.dragBody) {
      const b = this.dragBody;
      if (b.el) b.el.classList.remove('is-held');
      if (b.anchorSuspended) {
        this.world.addJoint(b.anchorSuspended);
        b.anchorJoint = b.anchorSuspended;
        b.anchorSuspended = null;
      }
      if (this.onDragEnd) this.onDragEnd(b);
      this.dragBody = null;
    }
    document.documentElement.classList.remove('is-grabbing');
  }

  /* ------------------------------------------------------------ render -- */

  sync() {
    for (const b of this.world.bodies) {
      if (!b.el || b.isStatic) continue;
      if (b.sleeping && b._synced) continue;
      const x = b.position.x - (b.halfW ?? 0);
      const y = b.position.y - (b.halfH ?? 0);
      b.el.style.transform =
        `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${b.angle.toFixed(4)}rad)`;
      b._synced = b.sleeping;
    }
    if (this.onStep) this.onStep(this);
  }

  /* ----------------------------------------------------------- control -- */

  setGravity(x, y) {
    this.world.gravity.set(x, y);
    this.world.wakeAll();
  }

  /** Rotate gravity by a tilt angle in radians (device orientation / scroll). */
  tiltGravity(angle) {
    const g = this.baseGravity;
    const c = Math.cos(angle), s = Math.sin(angle);
    this.world.gravity.set(g.x * c - g.y * s, g.x * s + g.y * c);
  }

  shake(strength = 1) {
    for (const b of this.world.bodies) {
      if (b.isStatic) continue;
      b.applyImpulse(v2(rand(-1, 1), rand(-1.4, -0.3)).scale(strength * 700 * b.mass), null);
      b.angularVelocity += rand(-8, 8) * strength;
    }
  }

  _observe() {
    if (!('IntersectionObserver' in window) || !this.autoPause) {
      this.visible = true;
      return;
    }
    this.io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        this.visible = entry.isIntersecting;
        if (this.visible && this.started) this.runner.start();
        else this.runner.stop();
      }
    }, { rootMargin: '120px' });
    this.io.observe(this.container);
  }

  start() {
    this.started = true;
    if (this.visible || !this.io) this.runner.start();
    window.addEventListener('resize', this._onResize);
  }

  stop() {
    this.started = false;
    this.runner.stop();
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    if (this.io) this.io.disconnect();
    window.removeEventListener('resize', this._onResize);
    this.container.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
  }
}
