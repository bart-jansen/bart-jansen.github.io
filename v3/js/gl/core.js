/**
 * Thin WebGL2 helpers — programs, buffers, VAOs, textures, framebuffers.
 *
 * Deliberately not an abstraction layer: it removes the boilerplate and the
 * footguns (forgetting to check link status, mismatched texture units) and
 * nothing else. The renderer still speaks GL directly.
 */

export function createContext(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,          // we run our own MSAA framebuffer
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    desynchronized: true,
    ...opts,
  });
  if (!gl) return null;
  return gl;
}

export function compile(gl, type, source, name = 'shader') {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`${name} failed to compile:\n${log}\n${numberLines(source)}`);
  }
  return sh;
}

function numberLines(src) {
  return src.split('\n').map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join('\n');
}

export class Program {
  constructor(gl, vsSource, fsSource, name = 'program') {
    this.gl = gl;
    this.name = name;
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource, `${name}.vert`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource, `${name}.frag`);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(`${name} failed to link:\n${log}`);
    }
    this.handle = p;

    this.uniforms = new Map();
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const base = info.name.replace(/\[0\]$/, '');
      this.uniforms.set(base, gl.getUniformLocation(p, info.name));
    }
    this.attribs = new Map();
    const an = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < an; i++) {
      const info = gl.getActiveAttrib(p, i);
      this.attribs.set(info.name, gl.getAttribLocation(p, info.name));
    }
  }

  use() { this.gl.useProgram(this.handle); return this; }
  loc(n) { return this.uniforms.get(n) ?? null; }

  mat4(n, m) { const l = this.loc(n); if (l) this.gl.uniformMatrix4fv(l, false, m.e ?? m); return this; }
  mat3(n, m) { const l = this.loc(n); if (l) this.gl.uniformMatrix3fv(l, false, m); return this; }
  vec4(n, x, y, z, w) { const l = this.loc(n); if (l) this.gl.uniform4f(l, x, y, z, w); return this; }
  vec3(n, x, y, z) {
    const l = this.loc(n);
    if (l) {
      if (typeof x === 'object') this.gl.uniform3f(l, x.x, x.y, x.z);
      else this.gl.uniform3f(l, x, y, z);
    }
    return this;
  }
  vec2(n, x, y) { const l = this.loc(n); if (l) this.gl.uniform2f(l, x, y); return this; }
  float(n, v) { const l = this.loc(n); if (l) this.gl.uniform1f(l, v); return this; }
  int(n, v) { const l = this.loc(n); if (l) this.gl.uniform1i(l, v); return this; }
}

/* ─────────────────────────────────────────────────────────── textures ── */

export function createTexture(gl, opts = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const {
    width = 1, height = 1, internalFormat = gl.RGBA8, format = gl.RGBA,
    type = gl.UNSIGNED_BYTE, data = null,
    min = gl.LINEAR, mag = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE,
  } = opts;
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/**
 * A 2D texture array. One draw call can then cover every project monolith or
 * every label without a single texture rebind.
 */
export function createTextureArray(gl, width, height, layers, opts = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  const levels = opts.mipmap === false ? 1 : Math.floor(Math.log2(Math.max(width, height))) + 1;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, opts.internalFormat ?? gl.RGBA8, width, height, layers);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER,
    levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return { tex, width, height, layers, levels };
}

let _fitCanvas = null;

/**
 * A texture array layer has fixed dimensions, so anything that isn't already
 * exactly that size gets centre-cropped ("cover") into a scratch canvas first.
 */
function fitToLayer(source, w, h) {
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  if (sw === w && sh === h) return source;
  if (!_fitCanvas) _fitCanvas = document.createElement('canvas');
  _fitCanvas.width = w; _fitCanvas.height = h;
  const ctx = _fitCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!sw || !sh) return _fitCanvas;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(source, (w - dw) * 0.5, (h - dh) * 0.5, dw, dh);
  return _fitCanvas;
}

export function uploadLayer(gl, arrayTex, layer, source) {
  const src = fitToLayer(source, arrayTex.width, arrayTex.height);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrayTex.tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer,
    arrayTex.width, arrayTex.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
}

export function generateArrayMips(gl, arrayTex) {
  if (arrayTex.levels <= 1) return;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrayTex.tex);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
}

/* ────────────────────────────────────────────────────── framebuffers ── */

/** Colour + depth render target. `samples > 0` gives a multisampled one. */
export class RenderTarget {
  constructor(gl, width, height, opts = {}) {
    this.gl = gl;
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    this.samples = opts.samples ?? 0;
    this.format = opts.format ?? gl.RGBA8;
    this.depth = opts.depth !== false;
    this._create();
  }

  _create() {
    const gl = this.gl;
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    if (this.samples > 0) {
      this.colorBuf = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorBuf);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, this.format, this.width, this.height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorBuf);
    } else {
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, this.format, this.width, this.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    }

    if (this.depth) {
      this.depthBuf = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuf);
      if (this.samples > 0) {
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, this.width, this.height);
      } else {
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.width, this.height);
      }
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuf);
    }

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
    }
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    return this;
  }

  resize(w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    if (w === this.width && h === this.height) return this;
    this.dispose();
    this.width = w; this.height = h;
    this._create();
    return this;
  }

  dispose() {
    const gl = this.gl;
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.colorBuf) gl.deleteRenderbuffer(this.colorBuf);
    if (this.depthBuf) gl.deleteRenderbuffer(this.depthBuf);
    this.fbo = this.texture = this.colorBuf = this.depthBuf = null;
  }
}

/** Depth-only target for the shadow map. */
export class ShadowTarget {
  constructor(gl, size) {
    this.gl = gl;
    this.size = size;
    this.fbo = gl.createFramebuffer();
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Hardware comparison sampling gives free 2×2 PCF on every tap.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.texture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`shadow framebuffer incomplete: 0x${status.toString(16)}`);
    }
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.size, this.size);
    return this;
  }
}

/* ──────────────────────────────────────────────────────── fullscreen ── */

/**
 * A single oversized triangle covering the viewport. Cheaper than a quad and,
 * unlike a quad, has no diagonal seam for the derivative-based effects.
 */
export function createFullscreenTriangle(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export const FULLSCREEN_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;
