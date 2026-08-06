/**
 * Every pixel in the level, either hand-drawn as a character grid or baked
 * procedurally at load. Nothing here is fetched; the only external images are
 * the project screenshots, which world.js loads on its own.
 *
 * Characters face right. Left-facing frames are mirrored at bake time.
 */

import { sprite, surface, flip, PAL } from './pixel.js';
import { text } from './font.js';

/* ─────────────────────────────────────────────────────────── the man ──── */

/**
 * Bart is 14×22: a ten-pixel head on a twelve-pixel body, which is the same
 * chibi proportion the island in v4 uses. Caramel hair swept back, stubble on
 * the jaw only, white shirt, navy jeans, brown shoes.
 */
const HEAD = [
  '.....hhhh.....',
  '...hhhhhhhh...',
  '..hhHHHHHhhh..',
  '..hjssssssjh..',
  '..hssssssssh..',
  '..hssksskssh..',
  '..hsssssSssh..',
  '..zzssNNNszz..',
  '..zzsssssszz..',
  '....zssssz....',
];

/** Same head, eyes shut. Blinking costs one extra bake and buys a lot. */
const HEAD_BLINK = HEAD.map((r, i) => (i === 5 ? '..hssssssssh..' : r));

const BODY = {
  idle: [
    '.....sSSs.....',
    '..wwwwwwwwww..',
    '..wWwwwwwwWw..',
    '..wwwwwwwwww..',
    '.swwwwwwwwwws.',
    '..swwwwwwwws..',
    '...bbbbbbbb...',
    '...bbbbbbbb...',
    '...bbb..bbb...',
    '...bBb..bBb...',
    '..nnnn..nnnn..',
    '..NNNN..NNNN..',
  ],
  run1: [
    '.....sSSs.....',
    '..wwwwwwwwww..',
    '..wWwwwwwwWw..',
    '..wwwwwwwwww..',
    '.swwwwwwwwwws.',
    '..swwwwwwwws..',
    '...bbbbbbbb...',
    '...bbbbbbbb...',
    '..bbb....bbb..',
    '.bbb......bbb.',
    '.nnn......nnn.',
    '.NNN......NNN.',
  ],
  run2: [
    '.....sSSs.....',
    '..wwwwwwwwww..',
    '..wWwwwwwwWw..',
    '..wwwwwwwwww..',
    '..swwwwwwwws..',
    '...wwwwwwwws..',
    '...bbbbbbbb...',
    '...bbbbbbbb...',
    '....bbbbbb....',
    '....bb.bbb....',
    '...nnn.nnnn...',
    '...NNN.NNNN...',
  ],
  run3: [
    '.....sSSs.....',
    '..wwwwwwwwww..',
    '..wWwwwwwwWw..',
    '..wwwwwwwwww..',
    '.s.wwwwwwww.s.',
    '..swwwwwwwws..',
    '...bbbbbbbb...',
    '...bbbbbbbb...',
    '...bbbbbbb....',
    '..bbb...bbbb..',
    '..nnn...nnnn..',
    '..NNN...NNNN..',
  ],
  jump: [
    '.s...sSSs...s.',
    '.swwwwwwwwwws.',
    '..wWwwwwwwWw..',
    '..wwwwwwwwww..',
    '..wwwwwwwwww..',
    '...wwwwwwww...',
    '...bbbbbbbb...',
    '...bbbbbbbb...',
    '..bbbb..bbb...',
    '..nnnn...bbb..',
    '..NNNN...nnnn.',
    '.........NNNN.',
  ],
  fall: [
    '.....sSSs.....',
    '..wwwwwwwwww..',
    'sswwwwwwwwwwss',
    '..wWwwwwwwWw..',
    '..wwwwwwwwww..',
    '...wwwwwwww...',
    '...bbbbbbbb...',
    '...bbbbbbbb...',
    '..bbb....bbb..',
    '..bbb.....bb..',
    '.nnnn.....nnn.',
    '.NNNN.....NNN.',
  ],
  win: [
    '.s...sSSs...s.',
    '.swwwwwwwwwws.',
    '..wwwwwwwwww..',
    '..wWwwwwwwWw..',
    '..wwwwwwwwww..',
    '...wwwwwwww...',
    '...bbbbbbbb...',
    '...bbbbbbbb...',
    '...bbb..bbb...',
    '...bBb..bBb...',
    '..nnnn..nnnn..',
    '..NNNN..NNNN..',
  ],
};

function bart(pose, head = HEAD) {
  return sprite([...head, ...BODY[pose]]);
}

export const BART_W = 14;
export const BART_H = 22;

export const bartFrames = {
  idle: bart('idle'),
  blink: bart('idle', HEAD_BLINK),
  run: [bart('run1'), bart('run2'), bart('run3'), bart('run2')],
  jump: bart('jump'),
  fall: bart('fall'),
  win: bart('win'),
};
export const bartLeft = {
  idle: flip(bartFrames.idle),
  blink: flip(bartFrames.blink),
  run: bartFrames.run.map(flip),
  jump: flip(bartFrames.jump),
  fall: flip(bartFrames.fall),
  win: flip(bartFrames.win),
};

/* ──────────────────────────────────────────────────────── the enemies ──── */

const GOOMBA = [
  '.....dddddd.....',
  '...dddddddddd...',
  '..dddddddddddd..',
  '..dddddddddddd..',
  '.dddwwddddwwddd.',
  '.dddwkddddkwddd.',
  '.dddwkddddkwddd.',
  '.dddwwddddwwddd.',
  '.dddddddddddddd.',
  '..ddkkkkkkkkdd..',
  '..DDDDDDDDDDDD..',
  '...DDDDDDDDDD...',
  '..uuu......uuu..',
  '.uuuu......uuuu.',
  '.UUUU......UUUU.',
  '.kkkk......kkkk.',
];

const GOOMBA_FLAT = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..dddddddddddd..',
  '.dddwkddddkwddd.',
  '.dddddddddddddd.',
  '..ddkkkkkkkkdd..',
  '..DDDDDDDDDDDD..',
  '.DDDDDDDDDDDDDD.',
  'uuu..........uuu',
  'uuu..........uuu',
  'UUU..........UUU',
  'kkk..........kkk',
];

export const goomba = [sprite(GOOMBA), flip(sprite(GOOMBA))];
export const goombaFlat = sprite(GOOMBA_FLAT);

/** Head only — the stem is drawn as a rectangle so pipes can be any height. */
const PIRANHA = [
  '....rrrrrrrr....',
  '..rrrrrrrrrrrr..',
  '.rrwwrrrrrrwwrr.',
  '.rrwwrrrrrrwwrr.',
  'rrrrrrrrrrrrrrrr',
  'rrwwrrrrrrrrwwrr',
  'rrwwrrrrrrrrwwrr',
  'rrrrrrrrrrrrrrrr',
  '.wwwwwwwwwwwwww.',
  '.wkwkwkwkwkwkww.',
  '..RRRRRRRRRRRR..',
  '...RRRRRRRRRR...',
  '.....gggggg.....',
];
export const piranha = sprite(PIRANHA);

/* ─────────────────────────────────────────────────────────── pick-ups ──── */

const COIN = [
  '...YYYYYY...',
  '..YyyyyyyyY.',
  '.YyyYYYYyyY.',
  'YyyYYqqYYyyY',
  'YyYYqqqqYYyY',
  'YyYYqqqqYYyY',
  'YyYYqqqqYYyY',
  'YyYYqqqqYYyY',
  'YyYYqqqqYYyY',
  'YyYYqqqqYYyY',
  'YyyYYqqYYyyY',
  '.YyyYYYYyyY.',
  '..YyyyyyyyY.',
  '...YYYYYY...',
];

/** The spin is the same art squashed horizontally — cheap and correct. */
function squash(src, factor) {
  const w = Math.max(2, Math.round(src.width * factor));
  const s = surface(src.width, src.height);
  s.ctx.imageSmoothingEnabled = false;
  s.ctx.drawImage(src, Math.round((src.width - w) / 2), 0, w, src.height);
  return s.canvas;
}

const COIN_FULL = sprite(COIN);
export const coinFrames = [COIN_FULL, squash(COIN_FULL, 0.62), squash(COIN_FULL, 0.22), squash(COIN_FULL, 0.62)];
export const COIN_W = COIN_FULL.width;
export const COIN_H = COIN_FULL.height;

const MUSHROOM = [
  '.....kkkkkk.....',
  '...kkrrrrrrkk...',
  '..krrwwwwwwrrk..',
  '.krwwwwwwwwwwrk.',
  '.krwwrrrrrrwwrk.',
  'krwwrrrrrrrrwwrk',
  'krwrrrrrrrrrrwrk',
  'krwwrrrrrrrrwwrk',
  '.krwwwwwwwwwwrk.',
  '.kkrrrrrrrrrrkk.',
  '..kssssssssssk..',
  '..ksskssssksskk.',
  '..ksskssssksskk.',
  '..kssssssssssk..',
  '...kssssssssk...',
  '....kkkkkkkk....',
];
export const mushroom = sprite(MUSHROOM);

/* ───────────────────────────────────────────────────────────── blocks ──── */

export const TILE = 16;

function block(fill, top, shade, glyph, glyphColour) {
  const s = surface(TILE, TILE);
  const c = s.ctx;
  c.fillStyle = PAL.k; c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = fill; c.fillRect(1, 1, TILE - 2, TILE - 2);
  c.fillStyle = top; c.fillRect(1, 1, TILE - 2, 2);
  c.fillStyle = shade; c.fillRect(1, TILE - 3, TILE - 2, 2);
  c.fillRect(TILE - 3, 1, 2, TILE - 2);
  // Corner rivets, the detail that makes a square read as a Mario block.
  c.fillStyle = PAL.k;
  for (const [x, y] of [[2, 2], [TILE - 4, 2], [2, TILE - 4], [TILE - 4, TILE - 4]]) c.fillRect(x, y, 2, 2);
  if (glyph) text(c, glyph, TILE / 2, 1, { scale: 2, colour: glyphColour, align: 'centre' });
  return s.canvas;
}

export const qBlock = [
  block(PAL.o, PAL.q, PAL.Y, '?', '#ffffff'),
  block('#f8a63c', PAL.q, PAL.Y, '?', '#ffffff'),
  block('#c96f16', PAL.o, '#8f4d08', '?', '#e8dcc0'),
];
export const usedBlock = block(PAL.d, '#8a6338', PAL.D, null);

export const brick = (() => {
  const s = surface(TILE, TILE);
  const c = s.ctx;
  c.fillStyle = PAL.T; c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = PAL.t;
  const rows = [[0, 0, 16, 3], [0, 4, 7, 3], [8, 4, 8, 3], [0, 8, 15, 3], [0, 12, 3, 3], [4, 12, 12, 3]];
  for (const [x, y, w, h] of rows) c.fillRect(x, y, w, h);
  c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(0, 0, TILE, 1);
  return s.canvas;
})();

/** A solid "hard" block for platforms — flatter, so it reads as scenery. */
export const slab = (() => {
  const s = surface(TILE, TILE);
  const c = s.ctx;
  c.fillStyle = '#9a6a3a'; c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#c08f56'; c.fillRect(0, 0, TILE, 4);
  c.fillStyle = '#6f4622'; c.fillRect(0, TILE - 3, TILE, 3);
  c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(0, 0, 2, TILE); c.fillRect(TILE - 2, 0, 2, TILE);
  return s.canvas;
})();

/* ─────────────────────────────────────────── ground, drawn as tiles ──── */

export const groundTop = (() => {
  const s = surface(TILE, TILE);
  const c = s.ctx;
  c.fillStyle = '#c9793a'; c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = PAL.g; c.fillRect(0, 0, TILE, 5);
  c.fillStyle = PAL.l; c.fillRect(0, 0, TILE, 2);
  c.fillStyle = '#a85f27';
  c.fillRect(2, 8, 3, 3); c.fillRect(9, 7, 4, 3); c.fillRect(5, 12, 4, 2);
  c.fillStyle = PAL.G; c.fillRect(0, 5, TILE, 1);
  return s.canvas;
})();

export const groundFill = (() => {
  const s = surface(TILE, TILE);
  const c = s.ctx;
  c.fillStyle = '#a85f27'; c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#8d4c1c';
  c.fillRect(3, 3, 4, 3); c.fillRect(10, 6, 3, 3); c.fillRect(1, 10, 5, 2); c.fillRect(9, 12, 4, 2);
  c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, 0, TILE, 1);
  return s.canvas;
})();

/** Underground palette for the career mines. */
export const stoneTop = (() => {
  const s = surface(TILE, TILE);
  const c = s.ctx;
  c.fillStyle = '#4a5a72'; c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#68809f'; c.fillRect(0, 0, TILE, 4);
  c.fillStyle = '#8fa8c6'; c.fillRect(0, 0, TILE, 1);
  c.fillStyle = '#3b485c'; c.fillRect(2, 7, 4, 3); c.fillRect(10, 10, 4, 3);
  return s.canvas;
})();

export const stoneFill = (() => {
  const s = surface(TILE, TILE);
  const c = s.ctx;
  c.fillStyle = '#3b485c'; c.fillRect(0, 0, TILE, TILE);
  c.fillStyle = '#333f50'; c.fillRect(2, 2, 5, 4); c.fillRect(9, 8, 5, 4);
  return s.canvas;
})();

/* ───────────────────────────────────── scenery drawn at any size ──── */

/** A chunky pixel disc, built out of rows. Used for the sun and the moon. */
export function disc(c, x, y, r, colour) {
  c.fillStyle = colour;
  const step = Math.max(1, Math.round(r / 6));
  for (let dy = -r; dy <= r; dy += step) {
    const dx = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
    c.fillRect(Math.round(x - dx), Math.round(y + dy), dx * 2, step);
  }
}

/**
 * The rounded hill from World 1-1: horizontal bars following a quarter circle,
 * with the two dark nicks near the base that make it read as a hill and not a
 * green blob.
 */
export function drawHill(c, x, y, w, dark) {
  const h = Math.round(w * 0.52);
  const body = dark ? '#3f9a26' : PAL.g;
  const shade = dark ? '#276616' : PAL.G;
  const bar = 4;
  c.fillStyle = body;
  for (let i = 0; i * bar < h; i++) {
    const t = (i * bar) / h;
    const rw = Math.max(4, Math.round(w * Math.sqrt(Math.max(0, 1 - t * t))));
    c.fillRect(Math.round(x - rw / 2), y - (i + 1) * bar, rw, bar + 1);
  }
  c.fillStyle = shade;
  for (const [ox, oy] of [[-0.19, 0.16], [0.11, 0.1]]) {
    const bx = Math.round(x + w * ox);
    const by = y - Math.round(h * oy) - 6;
    c.fillRect(bx, by, 3, 4);
    c.fillRect(bx - 3, by + 4, 9, 3);
  }
  c.fillStyle = dark ? '#5fc23e' : PAL.l;
  c.fillRect(Math.round(x - w * 0.14), y - h + 1, Math.round(w * 0.2), 2);
}

export function drawBush(c, x, y, w) {
  // Darker than the grass on top of the ground, or the two read as one mass.
  const h = Math.round(w * 0.44);
  const x0 = Math.round(x - w / 2);
  c.fillStyle = PAL.G;
  c.fillRect(x0, y - h, w, h);
  c.fillRect(x0 + 3, y - h - 4, w - 6, 5);
  c.fillRect(Math.round(x - w / 6), y - h - 8, Math.round(w / 3), 6);
  c.fillStyle = PAL.g;
  c.fillRect(x0 + 3, y - h - 4, w - 6, 2);
  c.fillRect(Math.round(x - w / 6), y - h - 8, Math.round(w / 3), 2);
  c.fillStyle = '#1f5c12';
  c.fillRect(x0, y - 3, w, 3);
}

export function drawCloud(c, x, y, w) {
  const h = Math.round(w * 0.34);
  c.fillStyle = PAL.c;
  c.fillRect(Math.round(x - w / 2), y - h, w, h);
  c.fillRect(Math.round(x - w / 2) + 4, y - h - 5, w - 8, 6);
  c.fillRect(Math.round(x - w / 5), y - h - 10, Math.round(w * 0.4), 6);
  c.fillStyle = PAL.C;
  c.fillRect(Math.round(x - w / 2), y - 3, w, 3);
}

/** A green warp pipe. Returns nothing; the collision box lives in the level. */
export function drawPipe(c, x, top, w, h) {
  const lipW = w + 8;
  const lipH = 14;
  c.fillStyle = PAL.G;
  c.fillRect(x, top + lipH, w, h - lipH);
  c.fillStyle = PAL.g;
  c.fillRect(x + 2, top + lipH, Math.round(w * 0.42), h - lipH);
  c.fillStyle = PAL.l;
  c.fillRect(x + 4, top + lipH, 4, h - lipH);
  c.fillStyle = PAL.k;
  c.fillRect(x, top + lipH, 2, h - lipH);
  c.fillRect(x + w - 2, top + lipH, 2, h - lipH);

  c.fillStyle = PAL.G;
  c.fillRect(x - 4, top, lipW, lipH);
  c.fillStyle = PAL.g;
  c.fillRect(x - 2, top + 2, Math.round(lipW * 0.42), lipH - 4);
  c.fillStyle = PAL.l;
  c.fillRect(x, top + 2, 4, lipH - 4);
  c.fillStyle = PAL.k;
  c.fillRect(x - 4, top, lipW, 2);
  c.fillRect(x - 4, top + lipH - 2, lipW, 2);
  c.fillRect(x - 4, top, 2, lipH);
  c.fillRect(x + w + 2, top, 2, lipH);
  c.fillStyle = '#0d2a0d';
  c.fillRect(x + 2, top + 2, w - 4, 4);
}

/** The castle at the end of every world. */
export function drawCastle(c, x, baseY, w) {
  const h = Math.round(w * 0.95);
  const brickA = '#c8703a';
  const brickB = '#8f4718';
  const top = baseY - h;
  c.fillStyle = brickB;
  c.fillRect(x, top + Math.round(h * 0.28), w, h - Math.round(h * 0.28));
  c.fillStyle = brickA;
  for (let yy = top + Math.round(h * 0.28); yy < baseY; yy += 8) {
    for (let xx = x + ((yy / 8) % 2 ? 0 : 6); xx < x + w - 4; xx += 12) c.fillRect(xx, yy + 1, 10, 6);
  }
  // battlements
  const cw = Math.round(w / 9);
  c.fillStyle = brickB;
  for (let i = 0; i < 9; i += 2) c.fillRect(x + i * cw, top + Math.round(h * 0.18), cw, Math.round(h * 0.12));
  // towers
  const tw = Math.round(w * 0.18);
  for (const tx of [x, x + w - tw]) {
    c.fillStyle = brickB;
    c.fillRect(tx, top, tw, h);
    c.fillStyle = brickA;
    for (let yy = top + 6; yy < baseY; yy += 8) c.fillRect(tx + 2, yy, tw - 4, 5);
    c.fillStyle = brickB;
    for (let i = 0; i < 3; i += 2) c.fillRect(tx + i * Math.round(tw / 3), top - 6, Math.round(tw / 3), 8);
  }
  // door
  const dw = Math.round(w * 0.2);
  const dh = Math.round(h * 0.3);
  c.fillStyle = PAL.k;
  c.fillRect(x + Math.round((w - dw) / 2), baseY - dh, dw, dh);
  c.fillStyle = '#2a2033';
  c.fillRect(x + Math.round((w - dw) / 2) + 2, baseY - dh + 4, dw - 4, dh - 4);
  // windows
  c.fillStyle = PAL.k;
  c.fillRect(x + Math.round(w * 0.3), top + Math.round(h * 0.42), 6, 8);
  c.fillRect(x + Math.round(w * 0.62), top + Math.round(h * 0.42), 6, 8);
}
