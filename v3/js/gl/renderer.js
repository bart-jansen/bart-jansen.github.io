/**
 * The renderer.
 *
 * Forward rendering, one instanced draw call per geometry:
 *   sky → shadow map → opaque → resolve MSAA → bright pass → blur → composite
 *
 * The shadow map covers the whole arena with a single fixed ortho frustum.
 * That costs a little resolution compared to fitting it to the view each
 * frame, but it never shimmers when the camera moves, which matters much more
 * when you spend the whole game rolling around.
 */

import { Mat4, Vec3, v3, mat4 } from '../math.js';
import {
  createContext, Program, RenderTarget, ShadowTarget,
  createTextureArray, uploadLayer, generateArrayMips,
  createFullscreenTriangle, FULLSCREEN_VS,
} from './core.js';
import {
  MAIN_VS, MAIN_FS, SHADOW_VS, SHADOW_FS, SKY_FS,
  BRIGHT_FS, BLUR_FS, COMPOSITE_FS,
  PARTICLE_VS, PARTICLE_FS, LINE_VS, LINE_FS,
} from './shaders.js';
import { Mesh } from './geometry.js';

const MAX_PARTICLES = 2048;
const MAX_LINE_VERTS = 4096;

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = createContext(canvas);
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    // Rendering to a float target needs an extension even in WebGL2. Without
    // it we fall back to RGBA8, which costs the >1.0 headroom the bloom
    // threshold likes but keeps the game running on weaker drivers.
    this.hdr = !!gl.getExtension('EXT_color_buffer_float');

    this.dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 2);
    this.shadowSize = opts.shadowSize ?? 2048;
    this.msaa = opts.msaa ?? 4;
    this.width = 1; this.height = 1;

    this.programs = {
      main: new Program(gl, MAIN_VS, MAIN_FS, 'main'),
      shadow: new Program(gl, SHADOW_VS, SHADOW_FS, 'shadow'),
      sky: new Program(gl, FULLSCREEN_VS, SKY_FS, 'sky'),
      bright: new Program(gl, FULLSCREEN_VS, BRIGHT_FS, 'bright'),
      blur: new Program(gl, FULLSCREEN_VS, BLUR_FS, 'blur'),
      composite: new Program(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite'),
      particle: new Program(gl, PARTICLE_VS, PARTICLE_FS, 'particle'),
      line: new Program(gl, LINE_VS, LINE_FS, 'line'),
    };

    this.fsTri = createFullscreenTriangle(gl);
    this.meshes = new Map();

    // Camera + light state.
    this.view = mat4();
    this.proj = mat4();
    this.viewProj = mat4();
    this.invViewProj = mat4();
    this.lightViewProj = mat4();
    this.cameraPos = new Vec3(0, 5, 12);
    this.lightDir = v3(0.42, 0.76, 0.5).normalize();

    this.palette = {
      lightColor: v3(1.0, 0.93, 0.79),
      skyTop: v3(0.07, 0.09, 0.21),
      skyHorizon: v3(0.30, 0.22, 0.36),
      ground: v3(0.15, 0.14, 0.19),
      fog: v3(0.17, 0.16, 0.25),
      fogDensity: 0.0085,
    };

    this.bloomStrength = 0.62;
    this.bloomThreshold = 0.82;
    this.vignette = 0.42;
    this.aberration = 0.012;
    this.grain = 0.016;
    this.flash = 0;
    this.flashColor = v3(1, 0.85, 0.5);
    this.highlight = new Vec3(0, -999, 0);
    this.highlightRadius = 0;
    this.time = 0;

    this.shadow = new ShadowTarget(gl, this.shadowSize);
    this._initParticles();
    this._initLines();
    this._initTextures();

    this.stats = { drawCalls: 0, instances: 0, triangles: 0 };
    this.resize();
  }

  /* ────────────────────────────────────────────────────────── setup ── */

  _initTextures() {
    const gl = this.gl;
    this.photos = createTextureArray(gl, 512, 512, 24);
    this.labels = createTextureArray(gl, 512, 128, 96, { mipmap: true });
    this.photoCount = 0;
    this.labelCount = 0;
    this.labelIndex = new Map();
  }

  /** @returns {number} the array layer the image landed on. */
  addPhoto(image) {
    if (this.photoCount >= this.photos.layers) return 0;
    const layer = this.photoCount++;
    uploadLayer(this.gl, this.photos, layer, image);
    return layer;
  }

  addLabel(key, canvas) {
    if (this.labelIndex.has(key)) return this.labelIndex.get(key);
    if (this.labelCount >= this.labels.layers) return 0;
    const layer = this.labelCount++;
    uploadLayer(this.gl, this.labels, layer, canvas);
    this.labelIndex.set(key, layer);
    return layer;
  }

  finalizeTextures() {
    generateArrayMips(this.gl, this.photos);
    generateArrayMips(this.gl, this.labels);
  }

  registerMesh(key, meshData, capacity = 64) {
    const m = new Mesh(this.gl, meshData, capacity);
    this.meshes.set(key, m);
    return m;
  }

  mesh(key) { return this.meshes.get(key); }

  _initParticles() {
    const gl = this.gl;
    this.particleData = new Float32Array(MAX_PARTICLES * 8);
    this.particleCount = 0;

    this.particleVao = gl.createVertexArray();
    gl.bindVertexArray(this.particleVao);

    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.particleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  _initLines() {
    const gl = this.gl;
    this.lineData = new Float32Array(MAX_LINE_VERTS * 7);
    this.lineCount = 0;
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    this.lineBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.lineData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
  }

  resize() {
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;

    const maxSamples = gl.getParameter(gl.MAX_SAMPLES);
    const samples = Math.min(this.msaa, maxSamples);

    if (this.sceneMS) this.sceneMS.dispose();
    if (this.sceneRT) this.sceneRT.dispose();
    if (this.bloomA) this.bloomA.dispose();
    if (this.bloomB) this.bloomB.dispose();

    // RGBA16F keeps highlights above 1.0 alive for the bloom threshold.
    const hdr = this.hdr ? gl.RGBA16F : gl.RGBA8;
    this.sceneMS = samples > 1
      ? new RenderTarget(gl, w, h, { samples, format: hdr })
      : null;
    this.sceneRT = new RenderTarget(gl, w, h, { format: hdr, depth: !this.sceneMS });
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    this.bloomA = new RenderTarget(gl, bw, bh, { format: hdr, depth: false });
    this.bloomB = new RenderTarget(gl, bw, bh, { format: hdr, depth: false });
  }

  /* ────────────────────────────────────────────────────────── frame ── */

  beginFrame(dt) {
    this.time += dt;
    this.resize();
    for (const m of this.meshes.values()) m.begin();
    this.particleCount = 0;
    this.lineCount = 0;
    this.stats.instances = 0;
  }

  setCamera(eye, target, up, fovY, near = 0.15, far = 400) {
    this.cameraPos.copy(eye);
    this.view.lookAt(eye, target, up);
    this.proj.perspective(fovY, this.width / this.height, near, far);
    this.viewProj.setMul(this.proj, this.view);
    this.invViewProj.copy(this.viewProj).invert();

    // Camera basis, for billboarding particles.
    const e = this.view.e;
    this.camRight = (this.camRight || new Vec3()).set(e[0], e[4], e[8]);
    this.camUp = (this.camUp || new Vec3()).set(e[1], e[5], e[9]);
  }

  /** Fixed ortho frustum around the whole arena — stable, no shimmer. */
  setLightFrustum(center, extent, depth = 160) {
    const eye = center.clone().addScaled(this.lightDir, depth * 0.45);
    const lightView = _tmpMat.lookAt(eye, center, UP);
    const lightProj = _tmpMat2.ortho(-extent, extent, -extent, extent, 0.5, depth);
    this.lightViewProj.setMul(lightProj, lightView);
  }

  submit(key, pos, quat, sx, sy, sz, color, emissive = 0, texLayer = -1, texKind = 0, gloss = 0.25) {
    const m = this.meshes.get(key);
    if (!m) return;
    m.add(pos, quat, sx, sy, sz, color[0], color[1], color[2], color[3] ?? 1,
      emissive, texLayer, texKind, gloss);
    this.stats.instances++;
  }

  particle(x, y, z, size, r, g, b, a) {
    if (this.particleCount >= MAX_PARTICLES) return;
    const o = this.particleCount * 8;
    const d = this.particleData;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
    this.particleCount++;
  }

  line(a, b, r, g, bl, alpha) {
    if (this.lineCount + 2 > MAX_LINE_VERTS) return;
    const d = this.lineData;
    let o = this.lineCount * 7;
    d[o] = a.x; d[o + 1] = a.y; d[o + 2] = a.z;
    d[o + 3] = r; d[o + 4] = g; d[o + 5] = bl; d[o + 6] = alpha;
    o += 7;
    d[o] = b.x; d[o + 1] = b.y; d[o + 2] = b.z;
    d[o + 3] = r; d[o + 4] = g; d[o + 5] = bl; d[o + 6] = alpha;
    this.lineCount += 2;
  }

  render() {
    const gl = this.gl;
    const P = this.programs;
    this.stats.drawCalls = 0;

    /* ── shadow pass */
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);          // front-face culling hides peter-panning
    this.shadow.bind();
    gl.clear(gl.DEPTH_BUFFER_BIT);
    P.shadow.use().mat4('uLightViewProj', this.lightViewProj);
    for (const m of this.meshes.values()) this.stats.drawCalls += m.draw();

    /* ── main pass */
    gl.cullFace(gl.BACK);
    const target = this.sceneMS || this.sceneRT;
    target.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky first, with depth writes off so geometry always wins.
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    P.sky.use()
      .mat4('uInvViewProj', this.invViewProj)
      .vec3('uCameraPos', this.cameraPos)
      .vec3('uLightDir', this.lightDir)
      .vec3('uSkyTop', this.palette.skyTop)
      .vec3('uSkyHorizon', this.palette.skyHorizon)
      .vec3('uGroundColor', this.palette.ground)
      .float('uTime', this.time);
    gl.bindVertexArray(this.fsTri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    const p = P.main.use();
    p.mat4('uViewProj', this.viewProj)
      .mat4('uLightViewProj', this.lightViewProj)
      .vec3('uCameraPos', this.cameraPos)
      .vec3('uLightDir', this.lightDir)
      .vec3('uLightColor', this.palette.lightColor)
      .vec3('uSkyColor', this.palette.skyTop)
      .vec3('uGroundColor', this.palette.ground)
      .vec3('uFogColor', this.palette.fog)
      .float('uFogDensity', this.palette.fogDensity)
      .float('uTime', this.time)
      .vec2('uShadowTexel', 1 / this.shadowSize, 1 / this.shadowSize)
      .vec3('uHighlight', this.highlight)
      .float('uHighlightRadius', this.highlightRadius)
      .int('uShadowMap', 0).int('uPhotos', 1).int('uLabels', 2);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.photos.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.labels.tex);

    for (const m of this.meshes.values()) this.stats.drawCalls += m.draw();

    /* ── additive overlays */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    if (this.lineCount > 0) {
      P.line.use().mat4('uViewProj', this.viewProj);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineData, 0, this.lineCount * 7);
      gl.drawArrays(gl.LINES, 0, this.lineCount);
      this.stats.drawCalls++;
    }

    if (this.particleCount > 0) {
      P.particle.use()
        .mat4('uViewProj', this.viewProj)
        .vec3('uRight', this.camRight)
        .vec3('uUp', this.camUp);
      gl.bindVertexArray(this.particleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData, 0, this.particleCount * 8);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.particleCount);
      this.stats.drawCalls++;
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);

    /* ── resolve MSAA */
    if (this.sceneMS) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneMS.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneRT.fbo);
      // A multisample resolve blit must use NEAREST — the sizes match anyway.
      gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height,
        gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* ── bloom */
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.fsTri);

    this.bloomA.bind();
    P.bright.use().float('uThreshold', this.bloomThreshold).int('uScene', 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const bw = this.bloomA.width, bh = this.bloomA.height;
    for (let pass = 0; pass < 2; pass++) {
      const radius = 1 + pass * 1.6;
      this.bloomB.bind();
      P.blur.use().int('uSource', 0).vec2('uDirection', radius / bw, 0);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomA.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      this.bloomA.bind();
      P.blur.use().int('uSource', 0).vec2('uDirection', 0, radius / bh);
      gl.bindTexture(gl.TEXTURE_2D, this.bloomB.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* ── composite to the default framebuffer */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    P.composite.use()
      .int('uScene', 0).int('uBloom', 1)
      .float('uBloomStrength', this.bloomStrength)
      .float('uTime', this.time)
      .float('uVignette', this.vignette)
      .float('uAberration', this.aberration)
      .float('uGrain', this.grain)
      .float('uFlash', this.flash)
      .vec3('uFlashColor', this.flashColor);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.stats.drawCalls += 6;
  }

  /** Project a world point to CSS pixel coordinates, or null if behind. */
  project(world, out = { x: 0, y: 0, visible: false, depth: 0 }) {
    const e = this.viewProj.e;
    const x = world.x, y = world.y, z = world.z;
    const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0.0001) { out.visible = false; return out; }
    out.x = (cx / cw * 0.5 + 0.5) * this.canvas.clientWidth;
    out.y = (0.5 - cy / cw * 0.5) * this.canvas.clientHeight;
    out.depth = cw;
    out.visible = true;
    return out;
  }
}

const UP = v3(0, 1, 0);
const _tmpMat = new Mat4();
const _tmpMat2 = new Mat4();
