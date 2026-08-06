/**
 * Text as textures.
 *
 * Everything readable in the arena — skill cubes, monolith plaques, the
 * nameplate — is a 2D canvas rasterised once at load and uploaded into a
 * texture array layer. No font atlas, no SDF: the labels are short, the
 * geometry is chunky, and mipmapped 512×128 canvases look sharp enough at the
 * distances you actually read them from.
 */

const LABEL_W = 512;
const LABEL_H = 128;

let scratch = null;
function ctx2d() {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = LABEL_W;
    scratch.height = LABEL_H;
  }
  return scratch.getContext('2d', { willReadFrequently: false });
}

/**
 * Render a label onto the shared scratch canvas and return it, ready to be
 * uploaded. The caller must upload before calling again.
 */
export function drawLabel(text, opts = {}) {
  const c = ctx2d();
  const {
    bg = 'rgba(0,0,0,0)',
    fg = '#f6f2e8',
    accent = null,
    font = '700 62px "Bricolage Grotesque", "Inter", system-ui, sans-serif',
    small = false,
    align = 'center',
    padding = 26,
  } = opts;

  c.clearRect(0, 0, LABEL_W, LABEL_H);
  if (bg !== 'rgba(0,0,0,0)') {
    c.fillStyle = bg;
    c.fillRect(0, 0, LABEL_W, LABEL_H);
  }

  if (accent) {
    c.fillStyle = accent;
    c.fillRect(0, LABEL_H - 10, LABEL_W, 10);
  }

  c.fillStyle = fg;
  c.textBaseline = 'middle';
  c.textAlign = align;
  c.font = small ? font.replace(/\d+px/, '40px') : font;

  // Shrink to fit rather than clipping — some skill names are long.
  let size = small ? 40 : 62;
  const maxW = LABEL_W - padding * 2;
  while (size > 14 && c.measureText(text).width > maxW) {
    size -= 3;
    c.font = font.replace(/\d+px/, `${size}px`);
  }

  const x = align === 'center' ? LABEL_W / 2 : align === 'right' ? LABEL_W - padding : padding;
  c.fillText(text, x, LABEL_H / 2 + (accent ? -5 : 0));
  return scratch;
}

/** Two-line variant for the monolith plaques: title over tag line. */
export function drawPlaque(title, subtitle, opts = {}) {
  const c = ctx2d();
  const {
    bg = 'rgba(8,9,14,0.92)', fg = '#f6f2e8', sub = '#c9a227', accent = '#f4c024',
  } = opts;

  c.clearRect(0, 0, LABEL_W, LABEL_H);
  c.fillStyle = bg;
  c.fillRect(0, 0, LABEL_W, LABEL_H);
  c.fillStyle = accent;
  c.fillRect(0, 0, 8, LABEL_H);

  c.textBaseline = 'middle';
  c.textAlign = 'left';

  let size = 54;
  c.font = `700 ${size}px "Bricolage Grotesque", "Inter", system-ui, sans-serif`;
  while (size > 18 && c.measureText(title).width > LABEL_W - 60) {
    size -= 3;
    c.font = `700 ${size}px "Bricolage Grotesque", "Inter", system-ui, sans-serif`;
  }
  c.fillStyle = fg;
  c.fillText(title, 30, 46);

  c.font = '500 30px "Inter", system-ui, sans-serif';
  c.fillStyle = sub;
  c.fillText(subtitle, 30, 94);
  return scratch;
}

/**
 * A 5×7 bitmap font, used to build the nameplate out of physical cubes.
 * Tracing real glyph outlines would give prettier letters, but you can't
 * knock a bezier over — a grid of unit cubes is the whole point.
 */
export const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/**
 * Turn a string into grid coordinates for the nameplate builder.
 * @returns {{cells: Array<{col:number,row:number}>, width:number, height:number}}
 */
export function textToGrid(text, spacing = 1) {
  const cells = [];
  let col = 0;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] === '1') cells.push({ col: col + c, row: g.length - 1 - r });
      }
    }
    col += 5 + spacing;
  }
  return { cells, width: Math.max(0, col - spacing), height: 7 };
}
