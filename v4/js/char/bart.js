/**
 * Cartoon Bart.
 *
 * Modelled procedurally from `img/photo.jpg`: the swept-back caramel quiff with
 * a side part, blue eyes, light stubble along the jaw, a white shirt worn open
 * at the collar with the sleeves rolled to the elbow, navy jeans and brown
 * shoes. Chibi proportions — the head is about 40% of his height, which is what
 * sells the toy look.
 *
 * The rig is a plain hierarchy of Groups. Everything the animation touches is
 * a named joint, so `pose()` below is just a list of rotations.
 */

import * as THREE from '../../vendor/three/three.module.min.js';
import { box, sphere, sphereGeo, capsule, cyl, cone, torus, at, group } from '../gfx/shapes.js';
import { toon, flat, outlineAll, outline, C, INK } from '../gfx/toon.js';

const _look = new THREE.Vector3();

export const BART_HEIGHT = 2.0;
export const BART_RADIUS = 0.45;

export class Bart {
  constructor() {
    this.root = new THREE.Group();
    this.t = 0;
    this.walkPhase = 0;
    this.blinkTimer = 2 + Math.random() * 3;
    this.blink = 0;
    this.squash = 1;
    this.lean = 0;
    this.headLook = new THREE.Vector2();

    this.build();
    outlineAll(this.root, 0.022);
    this.root.traverse((o) => {
      if (o.isMesh && !o.userData.isOutline) { o.castShadow = true; o.receiveShadow = false; }
    });
  }

  build() {
    // `body` carries squash-and-stretch so the root stays a clean transform
    // that the physics can drive without fighting the animation.
    this.body = new THREE.Group();
    this.root.add(this.body);

    this.buildLegs();
    this.buildTorso();
    this.buildHead();
  }

  /* ───────────────────────────────────────────────────────────── legs ── */

  buildLegs() {
    this.hips = at(new THREE.Group(), 0, 0.62, 0);
    this.body.add(this.hips);

    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = at(new THREE.Group(), side * 0.15, 0, 0);
      // Thigh hangs from the hip pivot.
      hip.add(at(capsule(0.135, 0.2, C.jeans), 0, -0.16, 0));

      const knee = at(new THREE.Group(), 0, -0.3, 0);
      knee.add(at(capsule(0.12, 0.14, C.jeansDark), 0, -0.1, 0));

      const foot = at(new THREE.Group(), 0, -0.2, 0);
      const shoe = at(box(0.22, 0.13, 0.34, C.shoe, { radius: 0.055 }), 0, -0.05, 0.05);
      const sole = at(box(0.23, 0.05, 0.35, C.shoeSole, { radius: 0.022 }), 0, -0.105, 0.05);
      foot.add(shoe, sole);

      knee.add(foot);
      hip.add(knee);
      this.hips.add(hip);
      this.legs.push({ hip, knee, foot, side });
    }
  }

  /* ──────────────────────────────────────────────────────────── torso ── */

  buildTorso() {
    this.torso = at(new THREE.Group(), 0, 0.62, 0);
    this.body.add(this.torso);

    // Shirt: a rounded slab, slightly tapered by scaling the lower half in.
    const shirt = at(box(0.56, 0.56, 0.34, C.shirt, { radius: 0.13 }), 0, 0.28, 0);
    this.torso.add(shirt);

    // A soft shadow panel down the side so the white doesn't read as a blob.
    const flank = at(box(0.1, 0.5, 0.3, C.shirtShade, { radius: 0.06 }), -0.25, 0.28, 0);
    flank.userData.noOutline = true;
    this.torso.add(flank);

    // Open collar: two angled flaps with a wedge of skin between them.
    const chest = at(sphere(0.13, C.skinShade, { seg: 12 }), 0, 0.5, 0.13);
    chest.scale.set(1, 1.25, 0.45);
    chest.userData.noOutline = true;
    this.torso.add(chest);

    for (const side of [-1, 1]) {
      const flap = at(box(0.2, 0.2, 0.08, C.shirt, { radius: 0.035 }),
        side * 0.13, 0.5, 0.15, 0.22, 0, side * 0.55);
      this.torso.add(flap);
    }
    // Placket + a couple of buttons, so the shirt reads as a shirt.
    this.torso.add(at(box(0.07, 0.4, 0.03, C.shirtShade, { radius: 0.014 }), 0, 0.22, 0.172));
    for (let i = 0; i < 2; i++) {
      const b = at(cyl(0.022, 0.022, 0.02, C.shirtShade, { seg: 8 }), 0, 0.3 - i * 0.16, 0.19, Math.PI / 2);
      b.userData.noOutline = true;
      this.torso.add(b);
    }

    // Arms: shirt to the elbow, bare forearm — sleeves rolled up.
    this.arms = [];
    for (const side of [-1, 1]) {
      const shoulder = at(new THREE.Group(), side * 0.33, 0.48, 0);
      shoulder.add(at(capsule(0.105, 0.14, C.shirt), 0, -0.12, 0));

      const elbow = at(new THREE.Group(), 0, -0.24, 0);
      elbow.add(at(capsule(0.085, 0.13, C.skin), 0, -0.1, 0));

      const hand = at(sphere(0.105, C.skin, { seg: 12 }), 0, -0.22, 0);
      hand.scale.set(1, 1.1, 0.8);
      elbow.add(hand);

      shoulder.add(elbow);
      this.torso.add(shoulder);
      this.arms.push({ shoulder, elbow, hand, side });
    }
  }

  /* ───────────────────────────────────────────────────────────── head ── */

  buildHead() {
    this.neck = at(new THREE.Group(), 0, 0.56, 0);
    this.torso.add(this.neck);
    this.neck.add(at(cyl(0.105, 0.125, 0.13, C.skinShade, { seg: 10 }), 0, 0.04, 0));

    this.head = at(new THREE.Group(), 0, 0.42, 0);
    this.neck.add(this.head);

    // Skull is an ellipsoid: R wide, R*SY tall, R*SZ deep. Every feature below
    // is placed against these numbers so the face stays on the surface.
    const R = 0.375, SY = 1.06, SZ = 0.95;
    this.headR = R;

    const skull = sphere(R, C.skin, { seg: 26 });
    skull.scale.set(1, SY, SZ);
    this.head.add(skull);

    for (const side of [-1, 1]) {
      const ear = at(sphere(0.078, C.skinShade, { seg: 10 }), side * 0.355, -0.035, -0.025);
      ear.scale.set(0.5, 1.15, 0.85);
      this.head.add(ear);
    }

    this.buildStubble(R, SY, SZ);
    this.buildHair(R, SY, SZ);
    this.buildFace(R, SY, SZ);
  }

  /**
   * A few days unshaven, not a beard: a thin shell over the jaw and chin only,
   * plus a faint shadow above the lip.
   */
  buildStubble(R, SY, SZ) {
    const mat = toon(C.stubble, { steps: 3 });

    // theta is measured from the top of the sphere, so the jaw starts a little
    // past the equator and runs to the chin.
    const jaw = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.012, 30, 18, Math.PI / 2 - 1.02, 2.04, 1.98, 0.86), mat);
    jaw.scale.set(1, SY, SZ);
    jaw.userData.noOutline = true;
    this.head.add(jaw);

    const lip = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.014, 22, 12, Math.PI / 2 - 0.36, 0.72, 1.90, 0.17), mat);
    lip.scale.set(1, SY, SZ);
    lip.userData.noOutline = true;
    this.head.add(lip);
  }

  /**
   * Caramel blonde, parted on his right, swept up and back with real volume on
   * top. The cap is tilted backwards so it uncovers the forehead at the front
   * and drops down over the nape at the back — that tilt is most of the look.
   */
  buildHair(R, SY, SZ) {
    const hairMat = toon(C.hair, { steps: 3 });
    const hair = new THREE.Group();
    this.head.add(hair);
    this.hair = hair;

    // Everything on top lives in a shell that is stretched upward and pushed
    // back, then tipped back a little. That silhouette *is* the quiff: it
    // uncovers the forehead at the front and piles volume over the crown.
    const shell = at(new THREE.Group(), 0, 0.02, -0.035, -0.22);
    hair.add(shell);
    this.quiff = shell;

    const SCY = SY * 1.18, SCZ = SZ * 1.10;
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.05, 30, 22, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
    cap.scale.set(1.03, SCY, SCZ);
    shell.add(cap);

    // Radii of the cap surface, used to lay the strands flat onto it.
    const Ry = R * 1.05 * SCY, Rz = R * 1.05 * SCZ;

    // The pompadour. A second dome in the same tone, overlapping the cap and
    // pushed up and forward, so the two read as one silhouette with a swell at
    // the front instead of as blocks stacked on a head.
    const pomp = new THREE.Mesh(sphereGeo(0.24, 22), hairMat);
    at(pomp, -0.02, 0.30, 0.235, 0, 0, 0.06);
    pomp.scale.set(1.06, 0.84, 0.96);
    shell.add(pomp);

    // Nape and sides, a band that stops just above the ears. Three's sphere
    // starts phi at -X and sweeps toward +Z, so the back of the head is 1.5pi.
    const nape = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.035, 28, 20, Math.PI * 1.06, Math.PI * 0.88, Math.PI * 0.2, Math.PI * 0.4),
      hairMat);
    nape.scale.set(1.02, SY * 1.02, SZ * 1.04);
    nape.userData.noOutline = true;
    hair.add(nape);

    for (const side of [-1, 1]) {
      const sb = at(box(0.06, 0.15, 0.12, C.hair, { radius: 0.025 }), side * 0.325, -0.02, 0.0);
      sb.userData.noOutline = true;
      hair.add(sb);
    }
  }

  /* ────────────────────────────────────────────────────────────── face ── */

  buildFace(R, SY, SZ) {
    /** Depth of the skull surface at a given (x, y) on the face. */
    const surfZ = (x, y) => {
      const k = 1 - (x / R) ** 2 - (y / (R * SY)) ** 2;
      return k > 0 ? R * SZ * Math.sqrt(k) : 0;
    };

    this.eyes = [];
    const eyeX = 0.148, eyeY = -0.01;
    const eyeZ = surfZ(eyeX, eyeY) - 0.035;

    for (const side of [-1, 1]) {
      const eye = at(new THREE.Group(), side * eyeX, eyeY, eyeZ);

      const white = new THREE.Mesh(sphereGeo(0.092, 16), toon(C.eyeWhite, { steps: 2 }));
      white.scale.set(1, 1.1, 0.62);
      white.userData.noOutline = true;
      eye.add(white);

      const iris = at(new THREE.Mesh(sphereGeo(0.054, 14), flat(C.iris)), 0, 0, 0.05);
      iris.scale.set(1, 1, 0.5);
      iris.userData.noOutline = true;
      eye.add(iris);

      const pupil = at(new THREE.Mesh(sphereGeo(0.026, 12), flat(0x1c2233)), 0, 0, 0.072);
      pupil.scale.set(1, 1, 0.5);
      pupil.userData.noOutline = true;
      eye.add(pupil);

      const glint = at(new THREE.Mesh(sphereGeo(0.018, 8), flat(0xffffff)), 0.026, 0.03, 0.082);
      glint.scale.set(1, 1, 0.4);
      glint.userData.noOutline = true;
      eye.add(glint);

      this.head.add(eye);
      this.eyes.push({ eye, iris, pupil, glint });

      const browY = 0.088;
      const brow = at(box(0.175, 0.042, 0.055, C.hair, { radius: 0.018 }),
        side * 0.152, browY, surfZ(0.152, browY) - 0.012, 0, 0, side * -0.15);
      brow.userData.noOutline = true;
      this.head.add(brow);
      this.brows = this.brows || [];
      this.brows.push(brow);
    }

    const noseY = -0.105;
    const nose = at(sphere(0.066, C.skinShade, { seg: 12 }), 0, noseY, surfZ(0, noseY) - 0.018);
    nose.scale.set(0.82, 1.0, 1.2);
    nose.userData.noOutline = true;
    this.head.add(nose);

    // The smile: an arc with teeth tucked behind it.
    const mouthY = -0.205;
    this.mouth = at(new THREE.Group(), 0, mouthY, surfZ(0, mouthY) - 0.03);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.019, 8, 22, Math.PI * 0.9), flat(0x8e4a3d));
    at(arc, 0, 0.042, 0, 0, 0, Math.PI + Math.PI * 0.05);
    arc.userData.noOutline = true;
    this.mouth.add(arc);

    const teeth = at(box(0.125, 0.042, 0.03, 0xfffdf7, { radius: 0.01 }), 0, 0.006, -0.008);
    teeth.userData.noOutline = true;
    this.mouth.add(teeth);
    this.head.add(this.mouth);

    for (const side of [-1, 1]) {
      const cheekY = -0.075;
      const cheek = at(new THREE.Mesh(sphereGeo(0.07, 10),
        flat(0xf49b8a, { transparent: true, opacity: 0.4 })),
        side * 0.215, cheekY, surfZ(0.215, cheekY) - 0.01);
      cheek.scale.set(1.15, 0.6, 0.22);
      cheek.userData.noOutline = true;
      cheek.material.depthWrite = false;
      this.head.add(cheek);
    }
  }

  /* ───────────────────────────────────────────────────────── animation ── */

  /**
   * @param {number} dt        seconds
   * @param {object} s         { speed, maxSpeed, grounded, airVel, moving }
   */
  update(dt, s) {
    this.t += dt;
    const t = this.t;
    const speed01 = Math.min(s.speed / (s.maxSpeed || 6), 1);

    // Walk cycle advances with distance travelled, not with time, so the feet
    // don't skate when he speeds up.
    this.walkPhase += s.speed * dt * 3.1;
    const p = this.walkPhase;
    const amp = 0.42 + speed01 * 0.5;

    for (const leg of this.legs) {
      const ph = p + (leg.side > 0 ? 0 : Math.PI);
      if (s.grounded) {
        leg.hip.rotation.x = Math.sin(ph) * amp * speed01;
        leg.knee.rotation.x = Math.max(0, -Math.sin(ph - 0.7)) * 1.15 * speed01;
        leg.foot.rotation.x = Math.max(0, Math.sin(ph + 0.4)) * 0.35 * speed01;
      } else {
        // Airborne: tuck the trailing leg, reach with the other.
        const tuck = s.airVel > 0 ? 0.9 : 0.35;
        leg.hip.rotation.x = lerp(leg.hip.rotation.x, leg.side > 0 ? -tuck : tuck * 0.4, 1 - Math.exp(-11 * dt));
        leg.knee.rotation.x = lerp(leg.knee.rotation.x, 0.9, 1 - Math.exp(-11 * dt));
        leg.foot.rotation.x = lerp(leg.foot.rotation.x, 0.2, 1 - Math.exp(-11 * dt));
      }
    }

    for (const arm of this.arms) {
      const ph = p + (arm.side > 0 ? Math.PI : 0);
      if (s.grounded) {
        const idle = Math.sin(t * 1.6 + arm.side) * 0.05;
        arm.shoulder.rotation.x = Math.sin(ph) * amp * 0.85 * speed01 + idle;
        arm.shoulder.rotation.z = arm.side * (0.13 + speed01 * 0.12);
        arm.elbow.rotation.x = -(0.18 + Math.max(0, Math.sin(ph)) * 0.5 * speed01);
      } else {
        arm.shoulder.rotation.x = lerp(arm.shoulder.rotation.x, -2.1, 1 - Math.exp(-9 * dt));
        arm.shoulder.rotation.z = lerp(arm.shoulder.rotation.z, arm.side * 0.45, 1 - Math.exp(-9 * dt));
        arm.elbow.rotation.x = lerp(arm.elbow.rotation.x, -0.35, 1 - Math.exp(-9 * dt));
      }
    }

    // Bob, breathe, lean.
    const bob = s.grounded ? Math.abs(Math.sin(p)) * 0.055 * speed01 : 0;
    const breathe = Math.sin(t * 2.1) * 0.012 * (1 - speed01);
    this.body.position.y = bob + breathe;
    this.body.rotation.x = lerp(this.body.rotation.x, speed01 * 0.16, 1 - Math.exp(-8 * dt));
    this.body.rotation.z = lerp(this.body.rotation.z, -this.lean, 1 - Math.exp(-7 * dt));

    // Squash and stretch, driven by the controller on land / launch.
    this.squash = lerp(this.squash, 1, 1 - Math.exp(-9 * dt));
    this.body.scale.set(1 / Math.sqrt(this.squash), this.squash, 1 / Math.sqrt(this.squash));

    // Head: counter-sway plus a little look-around.
    this.head.rotation.y = lerp(this.head.rotation.y, this.headLook.x, 1 - Math.exp(-6 * dt));
    this.head.rotation.x = lerp(this.head.rotation.x,
      this.headLook.y - speed01 * 0.1 + Math.sin(t * 1.3) * 0.02, 1 - Math.exp(-6 * dt));
    this.head.rotation.z = Math.sin(p) * 0.045 * speed01;

    // The quiff has a bit of give — it lags behind the head.
    this.quiff.rotation.x = Math.sin(p * 1.02) * 0.07 * speed01 + (s.grounded ? 0 : -0.16);

    this.updateBlink(dt);
  }

  updateBlink(dt) {
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blink = 1; this.blinkTimer = 2.2 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 7.5);
    // Triangle profile: shut fast, open fast. Squashing the whole eye reads as
    // a blink far better than sliding a lid over a sphere.
    const shut = this.blink > 0.5 ? (1 - this.blink) * 2 : this.blink * 2;
    for (const e of this.eyes) e.eye.scale.y = 1 - shut * 0.94;
  }

  /** Point the eyes (and a little of the head) at a world position. */
  lookAt(target) {
    if (!target) {
      this.headLook.set(0, 0);
      for (const e of this.eyes) {
        e.iris.position.x = e.pupil.position.x = 0;
        e.glint.position.x = 0.028;
      }
      return;
    }
    const local = this.head.worldToLocal(_look.set(target.x, target.y, target.z));
    const yaw = Math.atan2(local.x, Math.max(0.3, local.z));
    const pitch = -Math.atan2(local.y, Math.max(0.3, local.z));
    this.headLook.set(clamp(yaw, -0.6, 0.6), clamp(pitch, -0.3, 0.3));
    for (const e of this.eyes) {
      e.iris.position.x = e.pupil.position.x = clamp(local.x * 0.012, -0.03, 0.03);
      e.glint.position.x = 0.028 + clamp(local.x * 0.012, -0.03, 0.03);
    }
  }

  /** Called on landing / jumping to kick the squash-stretch. */
  impact(amount) { this.squash = clamp(1 - amount, 0.6, 1.5); }
  stretch(amount) { this.squash = clamp(1 + amount, 0.6, 1.5); }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
