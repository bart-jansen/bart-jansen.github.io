/**
 * The scrollbar is the controller.
 *
 * A tall spacer element gives the page something to scroll through; its height
 * is chosen so that one screenful of scrolling moves the camera about two
 * screen-widths along the level. The camera then eases toward that target, so
 * a flicked wheel reads as a run-up rather than a teleport.
 *
 * Keyboard and the auto-run button drive the same scrollbar, which keeps
 * exactly one source of truth for where you are.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Scroll {
  constructor(spacer, world) {
    this.spacer = spacer;
    this.world = world;
    this.camX = 0;
    this.auto = 0;
    this.keys = new Set();
    this.touchDrive = 0;
    this.userMoved = false;
    this.layout();

    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowright', 'arrowleft', 'arrowdown', 'arrowup', 'a', 'd', ' ', 'pagedown', 'pageup', 'home', 'end'].includes(k)) {
        if (k === 'home') { scrollTo({ top: 0, behavior: 'smooth' }); e.preventDefault(); return; }
        if (k === 'end') { scrollTo({ top: this.max(), behavior: 'smooth' }); e.preventDefault(); return; }
        this.keys.add(k);
        this.userMoved = true;
        e.preventDefault();
      }
      if (k === 'p') { this.auto = this.auto ? 0 : 1; if (this.onAuto) this.onAuto(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('wheel', () => { this.userMoved = true; }, { passive: true });
    addEventListener('touchstart', () => { this.userMoved = true; }, { passive: true });
  }

  max() { return Math.max(1, document.documentElement.scrollHeight - innerHeight); }

  layout() {
    const w = this.world;
    // Scroll pixels per world unit. One viewport height ≈ two screens of level.
    const k = clamp(innerHeight / Math.max(1, w.vw * 2), 0.5, 3.2);
    this.k = k;
    const need = Math.round(w.level.length * k) + innerHeight;
    this.spacer.style.height = `${need}px`;
  }

  /** Re-apply the current progress after a resize changed the page height. */
  reflow(progress) {
    this.layout();
    scrollTo(0, Math.round(progress * this.max()));
  }

  update(dt) {
    const w = this.world;
    const span = Math.max(1, w.level.length - w.vw);
    const speed = 1150 * dt;            // scroll px per second when driven

    let drive = 0;
    if (this.keys.has('arrowright') || this.keys.has('arrowdown') || this.keys.has('d') || this.keys.has(' ') || this.keys.has('pagedown')) drive += 1;
    if (this.keys.has('arrowleft') || this.keys.has('arrowup') || this.keys.has('a') || this.keys.has('pageup')) drive -= 1;
    drive += this.touchDrive;
    if (this.auto) drive += 0.62;

    if (drive) {
      const y = clamp(scrollY + drive * speed, 0, this.max());
      scrollTo(0, y);
      if (y >= this.max() - 1 && this.auto) { this.auto = 0; if (this.onAuto) this.onAuto(); }
    }

    const target = (scrollY / this.max()) * span;
    // Critically-ish damped follow, frame-rate independent.
    this.camX += (target - this.camX) * (1 - Math.pow(0.0009, dt));
    if (Math.abs(target - this.camX) < 0.05) this.camX = target;
    return clamp(this.camX, 0, span);
  }
}
