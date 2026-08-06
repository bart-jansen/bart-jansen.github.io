/**
 * The cartoon look: palette, banded toon materials and inverted-hull outlines.
 *
 * Everything in v4 is shaded with MeshToonMaterial against a tiny nearest-
 * filtered gradient ramp, which is what gives the hard light/shade terminator
 * instead of a smooth falloff. Outlines are a second pass of back-faces pushed
 * out along their normals — cheap, and it survives any geometry we throw at it.
 */

import * as THREE from '../../vendor/three/three.module.min.js';

/** Outline / shadow ink. Deliberately a desaturated navy, never pure black. */
export const INK = 0x2b2440;

export const C = {
  grass: 0x86cf63,
  grassDark: 0x63b04a,
  sand: 0xf2dda4,
  soil: 0xb07a4e,
  rock: 0x9aa4b8,
  rockDark: 0x7c869c,
  water: 0x49b8e6,
  foam: 0xd9f4ff,
  trunk: 0x9c6440,
  leaf: 0x5fbb63,
  leafAlt: 0x8ed36b,
  blossom: 0xff9ec4,

  skin: 0xf5c9a2,
  skinShade: 0xe8b389,
  hair: 0xa87c46,
  hairLight: 0xc99f5e,
  stubble: 0xdcae86,
  eyeWhite: 0xfdfdfd,
  iris: 0x4d9ed6,
  shirt: 0xfbfbf7,
  shirtShade: 0xe6e6de,
  jeans: 0x41608e,
  jeansDark: 0x33486b,
  shoe: 0x7b4a2e,
  shoeSole: 0xf3efe4,

  amber: 0xffc244,
  coral: 0xff7a6b,
  mint: 0x5fe0c0,
  violet: 0xa98cf0,
  sky: 0x7ec8f0,
  cream: 0xfff3d9,
  paper: 0xfffaf0,
  wood: 0xc99459,
  woodDark: 0xa5723f,
  steel: 0xb9c2d0,
};

/* ─────────────────────────────────────────────────────── gradient ramps ── */

const _ramps = new Map();

/**
 * A `steps`-band ramp used as MeshToonMaterial.gradientMap. Nearest filtering
 * is the whole trick: linear filtering would smooth the bands back out.
 */
export function ramp(steps = 3) {
  if (_ramps.has(steps)) return _ramps.get(steps);
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    // Bias the darkest band upward so shadowed sides stay colourful.
    const t = (i + 1) / steps;
    data[i] = Math.round(255 * (0.42 + 0.58 * t));
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _ramps.set(steps, tex);
  return tex;
}

/* ────────────────────────────────────────────────────────────── materials ── */

const _cache = new Map();

/**
 * Shared toon material. Materials are cached by their full option set so the
 * hundreds of props in the world collapse onto a handful of programs.
 */
export function toon(color, opts = {}) {
  const {
    steps = 3, emissive = 0x000000, emissiveIntensity = 1,
    transparent = false, opacity = 1, side = THREE.FrontSide,
    map = null, depthWrite = true,
  } = opts;

  const key = map ? null
    : `${color}|${steps}|${emissive}|${emissiveIntensity}|${transparent}|${opacity}|${side}|${depthWrite}`;
  if (key && _cache.has(key)) return _cache.get(key);

  const m = new THREE.MeshToonMaterial({
    color, map, gradientMap: ramp(steps), emissive, emissiveIntensity,
    transparent, opacity, side, depthWrite,
  });
  if (key) _cache.set(key, m);
  return m;
}

/** Unlit flat colour — for anything that should read as a sticker or a glow. */
export function flat(color, opts = {}) {
  const { transparent = false, opacity = 1, side = THREE.FrontSide, map = null, toneMapped = true } = opts;
  return new THREE.MeshBasicMaterial({ color, map, transparent, opacity, side, toneMapped });
}

/* ─────────────────────────────────────────────────────────────── outlines ── */

const _outlineMats = new Map();

function outlineMaterial(thickness, color) {
  const key = `${thickness}|${color}`;
  if (_outlineMats.has(key)) return _outlineMats.get(key);
  const m = new THREE.ShaderMaterial({
    uniforms: { uThickness: { value: thickness }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `
      uniform float uThickness;
      void main() {
        // Expand along the normal in view space so the outline keeps a roughly
        // constant screen weight whichever way the object is turned.
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * uThickness;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
    side: THREE.BackSide,
  });
  _outlineMats.set(key, m);
  return m;
}

/**
 * Attach an inverted-hull outline to a mesh. The shell is parented to the mesh
 * so it inherits every transform for free, including animation.
 */
export function outline(mesh, thickness = 0.035, color = INK) {
  const shell = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness, color));
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.renderOrder = -1;
  shell.userData.isOutline = true;
  mesh.add(shell);
  return mesh;
}

/** Outline every mesh under a group, skipping anything already outlined. */
export function outlineAll(root, thickness = 0.035, color = INK) {
  const targets = [];
  root.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline && !o.userData.noOutline) targets.push(o);
  });
  for (const m of targets) outline(m, thickness, color);
  return root;
}

/* ──────────────────────────────────────────────────────────────── helpers ── */

/** A soft blob shadow for things that shouldn't pay for a real shadow map. */
export function blobShadow(radius = 0.6, opacity = 0.28) {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.24)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity, depthWrite: false, toneMapped: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.userData.noOutline = true;
  return mesh;
}

export function setShadows(root, cast = true, receive = true) {
  root.traverse((o) => {
    if (o.isMesh && !o.userData.isOutline) { o.castShadow = cast; o.receiveShadow = receive; }
  });
  return root;
}
