/**
 * GLSL sources.
 *
 * One forward-lit instanced program does all opaque geometry. Instances carry
 * a quaternion rather than a matrix — 10 floats instead of 16, and rotating a
 * vector by a quat is cheaper than a mat3 multiply anyway.
 */

/* ═══════════════════════════════════════════════════════════ common ══ */

const QUAT_ROTATE = `
vec3 qrot(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}`;

/* ══════════════════════════════════════════════════════════ geometry ══ */

export const MAIN_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aTag;

layout(location = 4) in vec3 iPos;
layout(location = 5) in vec4 iQuat;
layout(location = 6) in vec3 iScale;
layout(location = 7) in vec4 iColor;
layout(location = 8) in vec4 iParams;   // emissive, texLayer, texKind, gloss

uniform mat4 uViewProj;
uniform mat4 uLightViewProj;
uniform vec3 uCameraPos;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out vec4 vColor;
out vec4 vParams;
out vec4 vLightSpace;
out float vTag;
${QUAT_ROTATE}

void main() {
  vec3 scaled = aPos * iScale;
  vec3 world = qrot(iQuat, scaled) + iPos;

  // Non-uniform scale needs the inverse-transpose; doing it per-axis on the
  // normal is equivalent for an axis-aligned scale and costs three divides.
  vec3 n = aNormal / max(iScale, vec3(1e-4));
  vNormal = normalize(qrot(iQuat, n));

  vWorld = world;
  vUv = aUv;
  vColor = iColor;
  vParams = iParams;
  vTag = aTag;
  vLightSpace = uLightViewProj * vec4(world, 1.0);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

export const MAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
precision highp sampler2DArray;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec4 vColor;
in vec4 vParams;
in vec4 vLightSpace;
in float vTag;

uniform vec3 uCameraPos;
uniform vec3 uLightDir;        // points *toward* the light
uniform vec3 uLightColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform vec2 uShadowTexel;
uniform sampler2DShadow uShadowMap;
uniform sampler2DArray uPhotos;
uniform sampler2DArray uLabels;
uniform vec3 uHighlight;       // world position of the current focus pulse
uniform float uHighlightRadius;

out vec4 fragColor;

float shadowFactor(vec3 n) {
  vec3 proj = vLightSpace.xyz / vLightSpace.w;
  proj = proj * 0.5 + 0.5;
  if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) return 1.0;

  // Slope-scaled bias: surfaces nearly edge-on to the light need much more.
  float ndl = max(dot(n, uLightDir), 0.0);
  float bias = mix(0.0035, 0.0006, ndl);

  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 off = vec2(float(x), float(y)) * uShadowTexel;
      sum += texture(uShadowMap, vec3(proj.xy + off, proj.z - bias));
    }
  }
  return sum / 9.0;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(uCameraPos - vWorld);
  vec3 albedo = vColor.rgb;

  // Texture lookup — only on faces the mesh tagged for it.
  float layer = vParams.y;
  if (layer >= 0.0 && vTag > 0.5) {
    vec4 tex = vParams.z < 0.5
      ? texture(uPhotos, vec3(vUv, layer))
      : texture(uLabels, vec3(vUv, layer));
    albedo = mix(albedo, tex.rgb, vParams.z < 0.5 ? 1.0 : tex.a);
  }

  float gloss = vParams.w;
  float ndl = max(dot(n, uLightDir), 0.0);
  float shadow = shadowFactor(n);

  // Hemisphere ambient — sky above, bounced ground colour below.
  vec3 ambient = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);

  vec3 h = normalize(uLightDir + viewDir);
  float spec = pow(max(dot(n, h), 0.0), mix(8.0, 220.0, gloss)) * gloss;

  // Rim term reads as a soft edge light; it's what stops untextured solids
  // from reading as flat silhouettes against the fog.
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0) * 0.6;

  vec3 color = albedo * (ambient * 1.25 + uLightColor * ndl * shadow * 1.55);
  color += uLightColor * spec * shadow;
  color += uSkyColor * rim * 0.55;
  color += albedo * vParams.x;

  // Proximity pulse on whatever the player is aiming at.
  float d = distance(vWorld, uHighlight);
  if (uHighlightRadius > 0.0) {
    float pulse = 1.0 - smoothstep(0.0, uHighlightRadius, d);
    color += albedo * pulse * (0.35 + 0.25 * sin(uTime * 7.0));
  }

  float dist = length(uCameraPos - vWorld);
  float heightFalloff = exp(-max(vWorld.y, 0.0) * 0.035);
  float fog = 1.0 - exp(-dist * uFogDensity * heightFalloff);
  color = mix(color, uFogColor, clamp(fog, 0.0, 0.92));

  fragColor = vec4(color, 1.0);
}`;

/* ════════════════════════════════════════════════════════════ shadow ══ */

export const SHADOW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 4) in vec3 iPos;
layout(location = 5) in vec4 iQuat;
layout(location = 6) in vec3 iScale;
uniform mat4 uLightViewProj;
${QUAT_ROTATE}
void main() {
  gl_Position = uLightViewProj * vec4(qrot(iQuat, aPos * iScale) + iPos, 1.0);
}`;

export const SHADOW_FS = `#version 300 es
precision highp float;
void main() {}`;

/* ═══════════════════════════════════════════════════════════════ sky ══ */

export const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uCameraPos;
uniform vec3 uLightDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uGroundColor;
uniform float uTime;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 near = uInvViewProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec4 far  = uInvViewProj * vec4(vUv * 2.0 - 1.0,  1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - near.xyz / near.w);

  float h = dir.y;
  vec3 sky = mix(uSkyHorizon, uSkyTop, smoothstep(-0.05, 0.65, h));
  sky = mix(uGroundColor * 0.55, sky, smoothstep(-0.25, 0.02, h));

  // Sun, plus a wide warm bloom around it.
  float sun = max(dot(dir, uLightDir), 0.0);
  sky += vec3(1.0, 0.86, 0.62) * pow(sun, 900.0) * 3.0;
  sky += vec3(1.0, 0.72, 0.42) * pow(sun, 12.0) * 0.16;

  // A sparse starfield above the horizon, twinkling slowly. The stars get a
  // soft round falloff rather than filling a whole cell — a one-pixel dot
  // turns into an RGB smear once chromatic aberration gets hold of it.
  if (h > 0.08) {
    vec2 g = dir.xz / max(abs(dir.y), 0.15) * 70.0;
    vec2 cell = floor(g);
    float s = hash(cell);
    if (s > 0.986) {
      vec2 jitter = (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
      float d = 1.0 - smoothstep(0.0, 0.34, length(fract(g) - 0.5 - jitter));
      float tw = 0.55 + 0.45 * sin(uTime * 1.6 + s * 60.0);
      sky += vec3(0.78, 0.84, 1.0) * d * d * (s - 0.986) * 42.0 * tw * smoothstep(0.08, 0.45, h);
    }
  }

  fragColor = vec4(sky, 1.0);
}`;

/* ══════════════════════════════════════════════════════════════ post ══ */

export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  fragColor = vec4(c * k, 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uDirection;   // texel-sized step
out vec4 fragColor;
void main() {
  // 9-tap gaussian folded into 5 bilinear fetches.
  vec3 sum = texture(uSource, vUv).rgb * 0.2270270270;
  vec2 o1 = uDirection * 1.3846153846;
  vec2 o2 = uDirection * 3.2307692308;
  sum += (texture(uSource, vUv + o1).rgb + texture(uSource, vUv - o1).rgb) * 0.3162162162;
  sum += (texture(uSource, vUv + o2).rgb + texture(uSource, vUv - o2).rgb) * 0.0702702703;
  fragColor = vec4(sum, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uTime;
uniform float uVignette;
uniform float uAberration;
uniform float uGrain;
uniform float uFlash;
uniform vec3 uFlashColor;
out vec4 fragColor;

// Narkowicz's ACES approximation — cheap, and keeps the amber highlights from
// clipping to white the moment the bloom lands on them.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 fromCenter = uv - 0.5;
  float r2 = dot(fromCenter, fromCenter);

  // Chromatic aberration grows toward the edges of the frame.
  float ab = uAberration * r2;
  vec3 scene;
  scene.r = texture(uScene, uv - fromCenter * ab).r;
  scene.g = texture(uScene, uv).g;
  scene.b = texture(uScene, uv + fromCenter * ab).b;

  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 color = scene + bloom * uBloomStrength;

  color += uFlashColor * uFlash;
  color = aces(color * 1.05);

  float vig = 1.0 - uVignette * smoothstep(0.15, 0.85, r2 * 2.0);
  color *= vig;

  float grain = fract(sin(dot(uv * vec2(1.0, 1.3) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  color += (grain - 0.5) * uGrain;

  fragColor = vec4(color, 1.0);
}`;

/* ═════════════════════════════════════════════════════════ particles ══ */

export const PARTICLE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 iPosSize;    // xyz world, w size
layout(location = 2) in vec4 iColor;      // rgb + alpha
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vLocal;
out vec4 vColor;
void main() {
  vLocal = aCorner;
  vColor = iColor;
  vec3 world = iPosSize.xyz + (uRight * aCorner.x + uUp * aCorner.y) * iPosSize.w;
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

export const PARTICLE_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vColor;
out vec4 fragColor;
void main() {
  float d = dot(vLocal, vLocal);
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - d) * vColor.a;
  fragColor = vec4(vColor.rgb * a, a);
}`;

/* ═══════════════════════════════════════════════════════════ trails ══ */

export const LINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
uniform mat4 uViewProj;
out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const LINE_FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor.rgb * vColor.a, vColor.a); }`;
