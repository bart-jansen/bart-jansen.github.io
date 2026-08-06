/**
 * Sky, sun and the lighting rig.
 *
 * A big inward-facing sphere with a two-stop vertical gradient, plus a soft
 * sun disc. No HDRIs, no image files — the whole atmosphere is four uniforms.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { cloud } from './shapes.js';

export const SKY = {
  top: new THREE.Color(0x4fa8e8),
  horizon: new THREE.Color(0xd6f0ff),
  sun: new THREE.Color(0xfff3c4),
  sunDir: new THREE.Vector3(0.55, 0.62, 0.36).normalize(),
};

export function createSky(radius = 480) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: SKY.top },
      uHorizon: { value: SKY.horizon },
      uSun: { value: SKY.sun },
      uSunDir: { value: SKY.sunDir },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uTop, uHorizon, uSun, uSunDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = smoothstep(-0.06, 0.55, d.y);
        vec3 col = mix(uHorizon, uTop, h);
        // Warm the sky where the sun is, and give it a soft disc.
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col = mix(col, uSun, pow(sd, 6.0) * 0.45);
        col += uSun * smoothstep(0.995, 0.999, sd) * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
  mesh.frustumCulled = false;
  mesh.userData.noOutline = true;
  return mesh;
}

/**
 * Key light + hemisphere fill. The shadow frustum is fixed around the island
 * so shadows never shimmer as the camera moves.
 */
export function createLights(extent = 46) {
  const g = new THREE.Group();

  const sun = new THREE.DirectionalLight(0xfff6e0, 2.5);
  sun.position.copy(SKY.sunDir).multiplyScalar(60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.035;
  g.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xbfe4ff, 0x6a9a52, 1.35);
  g.add(hemi);

  // A cool rim from the opposite side keeps shadowed faces from going flat.
  const rim = new THREE.DirectionalLight(0xbcd8ff, 0.55);
  rim.position.set(-40, 22, -34);
  g.add(rim);

  g.sun = sun;
  g.hemi = hemi;
  return g;
}

/** A drifting ring of clouds well outside the play area. */
export function createClouds(rng, count = 16, radius = 120) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.4;
    const r = radius * (0.7 + rng() * 0.6);
    const c = cloud(rng, 2.2 + rng() * 2.6);
    c.position.set(Math.cos(a) * r, 26 + rng() * 26, Math.sin(a) * r);
    c.userData.drift = 0.004 + rng() * 0.008;
    c.userData.angle = a;
    c.userData.radius = r;
    g.add(c);
  }
  g.userData.update = (dt) => {
    for (const c of g.children) {
      c.userData.angle += c.userData.drift * dt;
      c.position.x = Math.cos(c.userData.angle) * c.userData.radius;
      c.position.z = Math.sin(c.userData.angle) * c.userData.radius;
    }
  };
  return g;
}
