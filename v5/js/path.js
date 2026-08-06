/**
 * Bart's y is a pure function of his x.
 *
 * The whole level is scrubbed by the scrollbar, so the character cannot be
 * simulated — scroll up two screens and back down and he has to land in
 * exactly the same place. So the path is authored as a chain of flats and
 * parabolic arcs and evaluated analytically. Every jump is a real ballistic
 * curve; it just happens to be indexed by distance instead of time.
 */

/** Flat run. */
const FLAT = 0;
/** Ballistic arc: apex `h` above the straight line from (x0,y0) to (x1,y1). */
const ARC = 1;

export class Path {
  constructor(y = 0) {
    this.segs = [];
    this.x = 0;
    this.y = y;
  }

  flat(len) {
    if (len > 0) this.segs.push({ k: FLAT, x0: this.x, x1: this.x + len, y0: this.y, y1: this.y, h: 0 });
    this.x += len;
    return this;
  }

  /** Arc `len` forward, ending `dy` higher (dy > 0 means up). */
  arc(len, dy = 0, h = 48) {
    const y1 = this.y - dy;
    this.segs.push({ k: ARC, x0: this.x, x1: this.x + len, y0: this.y, y1, h });
    this.x += len;
    this.y = y1;
    return this;
  }

  get end() { return this.x; }

  /** Sort once, then every lookup is a binary search. */
  seal() {
    this.segs.sort((a, b) => a.x0 - b.x0);
    this._xs = this.segs.map((s) => s.x0);
    return this;
  }

  _find(x) {
    const xs = this._xs;
    let lo = 0;
    let hi = xs.length - 1;
    if (x <= xs[0]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Returns { y, air, rise } where `rise` is the vertical velocity in world
   * units per horizontal unit — negative while climbing, since y grows down.
   */
  at(x) {
    if (!this.segs.length) return { y: 0, air: false, rise: 0 };
    const s = this.segs[this._find(x)];
    const span = s.x1 - s.x0;
    const u = span > 0 ? Math.min(1, Math.max(0, (x - s.x0) / span)) : 0;
    if (s.k === FLAT) return { y: s.y0, air: false, rise: 0 };
    const base = s.y0 + (s.y1 - s.y0) * u;
    const y = base - 4 * s.h * u * (1 - u);
    const rise = ((s.y1 - s.y0) - 4 * s.h * (1 - 2 * u)) / (span || 1);
    return { y, air: true, rise };
  }

  y_(x) { return this.at(x).y; }
}
