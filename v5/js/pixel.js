/**
 * A tiny pixel-art compiler.
 *
 * Sprites are written as arrays of strings, one character per pixel, and get
 * baked once into offscreen canvases at load. After that they are ordinary
 * drawImage calls, which is the fastest thing a 2D canvas can do.
 *
 * Rows do not have to be the same length — short rows are padded with
 * transparent pixels on the right — so the art can be written without counting
 * to fourteen on your fingers every single line.
 */

/** The whole game is painted out of these. Roughly NES, deliberately warm. */
export const PAL = {
  '.': null,               // transparent
  k: '#181425',            // outline / near-black
  K: '#000000',
  w: '#ffffff',            // shirt
  W: '#d8dee9',            // shirt shade
  s: '#ffcfa4',            // skin
  S: '#e0a274',            // skin shade
  z: '#c9835a',            // stubble
  h: '#a87c46',            // hair
  H: '#c99f5e',            // hair light
  j: '#7d5628',            // hair dark
  e: '#2e6fd0',            // eye blue
  b: '#33538f',            // denim
  B: '#22396b',            // denim dark
  n: '#8a5228',            // shoe
  N: '#5d3517',            // shoe dark
  r: '#e8503a',            // red
  R: '#a92f1c',            // red dark
  o: '#f08a2a',            // orange
  y: '#f7c948',            // yellow / coin
  Y: '#c4880f',            // gold shade
  q: '#fdf0a8',            // pale highlight
  g: '#5bbf3a',            // green
  G: '#2f7d20',            // green dark
  l: '#8ee06a',            // light green
  t: '#d07a30',            // brick
  T: '#8f4412',            // brick dark
  u: '#e9c98a',            // sand
  U: '#c2a066',            // sand dark
  m: '#9aa3b2',            // grey
  M: '#5c6470',            // grey dark
  c: '#f6fbff',            // cloud
  C: '#cfe6f5',            // cloud shade
  p: '#8b5fd6',            // purple
  a: '#35c7d6',            // aqua
  i: '#ff9ec7',            // pink
  d: '#6b4b2a',            // wood / dirt
  D: '#4a3119',            // wood dark
};

/** A canvas that never touches the DOM. */
export function surface(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx, w: c.width, h: c.height };
}

/**
 * Bake a string-grid into a canvas. `pal` may override or extend PAL, which is
 * how the skill coins get thirty-one different colours out of one piece of art.
 */
export function sprite(rows, pal) {
  const p = pal ? { ...PAL, ...pal } : PAL;
  const h = rows.length;
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const s = surface(w, h);
  const px = s.ctx.createImageData(w, h);
  const data = px.data;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const col = p[row[x]];
      if (!col) continue;
      const o = (y * w + x) * 4;
      data[o] = parseInt(col.slice(1, 3), 16);
      data[o + 1] = parseInt(col.slice(3, 5), 16);
      data[o + 2] = parseInt(col.slice(5, 7), 16);
      data[o + 3] = 255;
    }
  }
  s.ctx.putImageData(px, 0, 0);
  return s.canvas;
}

/** Mirror a baked sprite. Cheaper than authoring left-facing art. */
export function flip(src) {
  const s = surface(src.width, src.height);
  s.ctx.translate(src.width, 0);
  s.ctx.scale(-1, 1);
  s.ctx.drawImage(src, 0, 0);
  return s.canvas;
}

/** Recolour every opaque pixel of a sprite. Used for silhouettes and flashes. */
export function tint(src, colour) {
  const s = surface(src.width, src.height);
  s.ctx.drawImage(src, 0, 0);
  s.ctx.globalCompositeOperation = 'source-in';
  s.ctx.fillStyle = colour;
  s.ctx.fillRect(0, 0, s.w, s.h);
  return s.canvas;
}
