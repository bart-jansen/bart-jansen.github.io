# bart-jansen.github.io

Personal site at [bart.je](https://bart.je).

## Gravity Well (2026)

The current site is a rigid-body simulation. Every draggable thing on the page —
the letters of the name, the debris in the hero, the skill chips — is a real DOM
element driven by a **2D physics engine written from scratch** for this site.
No Matter.js, no Famo.us, no framework, no build step, zero dependencies.

```
js/engine/physics.js   Vec2 math, circle + convex polygon bodies, spatial-hash
                       broadphase, SAT narrowphase with reference/incident face
                       clipping, sequential-impulse solver with warm starting,
                       split-impulse position correction, deferred restitution,
                       Coulomb friction, distance/mouse joints, island sleeping,
                       fixed-timestep runner
js/engine/stage.js     binds a physics world to a container's DOM elements
js/hero.js             the name, held in its typographic slot by soft springs
js/skills.js           a box of loose parts
js/rope.js             Verlet string down the employment timeline
js/portfolio.js        filter changes throw the rejected cards off-screen
js/debris.js           viewport-level particle world (ejecta, shards)
js/ui.js               reveals, theme, dock, cursor, counters, form
js/main.js             orchestration
css/site.css           design system (OKLCH, cascade layers, logical properties)
```

The page is a complete, readable document with JavaScript disabled, and
`prefers-reduced-motion: reduce` turns the simulation off entirely.

## Sunday Island (`v4/`)

The same CV again, this time as a bright cartoon game. You run a small
procedurally-modelled version of me around a round toon-shaded island: nineteen
framed screenshots in the **work** gallery, twelve signposts along the **career**
promenade, thirty-one labelled skittles racked up in the **skills** garden, five
little schoolhouses on a mound, and a yard full of crates, barrels, dominoes and
beach balls that exist purely to be charged into.

This is the one build in the repo that uses a library: **three.js does the
rendering**. The simulation does not change — it imports the exact same
rigid-body engine from `v3/js/physics/`, so v4 is a clean swap of the
presentation layer and a decent proof that the engine was worth writing. three
is vendored into `v4/vendor/three/`, so there is still **no build step and no
CDN**; the page is ES modules served straight off disk.

Nothing is modelled in a DCC tool. The character is assembled from rounded boxes,
spheres and capsules in `v4/js/char/bart.js` — a skull ellipsoid with every
facial feature placed analytically on its surface, a swept-back hair shell, and a
rig of plain `Group`s so animation is nothing but rotations (distance-driven
walk cycle, squash-and-stretch on landing, quiff lag, timed blinks, and eyes that
track whatever you are standing next to).

```
v4/vendor/three/            three.js r185, vendored (MIT, LICENSE included)
v4/js/gfx/toon.js           palette, banded gradient ramps, inverted-hull outlines
v4/js/gfx/shapes.js         the primitive kit: trees, rocks, grass, clouds, signs
v4/js/gfx/sky.js            sky dome shader, light rig, drifting clouds
v4/js/char/bart.js          the character: geometry, rig and animation
v4/js/world/island.js       terrain, sea, paths, boulder guardrail, scenery
v4/js/world/zones.js        the four zones and the playground, built from the CV
v4/js/player.js             sphere-body controller and spring camera
v4/js/hud.js                prompts, cards, discovery counter
v4/js/app.js                scene assembly, fixed-step loop, prop syncing
v4/js/fallback.js           fills the plain-HTML version from the same data
```

Toon shading is `MeshToonMaterial` with a nearest-filtered `DataTexture` ramp;
outlines are inverted hulls expanded along the view-space normal so they keep a
roughly constant screen weight. The player is a hidden sphere body with its spin
zeroed every step and its facing driven by yaw, which gets gravity, slopes and
collisions for free without any capsule-uprighting hacks. Only bodies tagged
`terrain` push the camera in, so signposts never shove the view into your back.

**Controls** — WASD or arrows to walk, Shift to run, Space to jump, E to read a
sign, R to go home, drag to orbit, scroll to zoom. On touch there is a stick and
a jump button.

Without WebGL2, without JavaScript, or with `prefers-reduced-motion` set, the
page degrades to a plain HTML version of the full CV built from the same content
module (add `?play` to override the reduced-motion opt-out).

## THE YARD (`v3/`)

The same CV, playable. A third-person physics sandbox where the portfolio *is*
the level: your name is spelled out in loose voxels against the back wall, the
19 projects stand as screenshot-textured monoliths in an arc, the employment
history is a Jenga tower of labelled concrete slabs, and the skills sit in a pit
you can plough through. Roll into a monolith to open it.

Same rules as the rest of the site — **no engine, no framework, no build step,
zero dependencies.** Both the 3D rigid-body solver and the renderer are written
from scratch here.

```
v3/js/math.js               Vec3 / Quat / Mat3 / Mat4, seeded PRNG, easings
v3/js/physics/shapes.js     spheres and convex hulls (quickhull, face adjacency,
                            inertia tensors, box/prism/wedge/rock generators)
v3/js/physics/collide.js    sphere-sphere, sphere-hull and hull-hull SAT with
                            Gauss-map edge tests, face clipping, 4-point
                            persistent manifolds and warm-start matching
v3/js/physics/body.js       rigid bodies: static / dynamic / kinematic
v3/js/physics/constraints.js point, distance, hinge and grab constraints
v3/js/physics/world.js      sweep-and-prune broadphase, sequential-impulse
                            solver with warm starting, split-impulse position
                            correction, impact-only restitution, Coulomb and
                            rolling friction, union-find island sleeping,
                            raycasts, sphere queries, explosions, fixed-step runner
v3/js/gl/core.js            WebGL2 wrappers: programs, VAOs, FBOs, texture arrays
v3/js/gl/geometry.js        hull -> mesh, planar UVs, icospheres, ground plane
v3/js/gl/shaders.js         GLSL: instanced forward pass, shadow depth, sky,
                            particles, lines, bloom, ACES post
v3/js/gl/renderer.js        instanced forward renderer, cascaded-free single
                            shadow map with hardware PCF, HDR framebuffer,
                            bloom, chromatic aberration, vignette, grain
v3/js/gl/text.js            canvas label rasteriser + a 5x7 bitmap font used to
                            voxelise the nameplate
v3/js/game/content.js       the CV, extracted from index.html
v3/js/game/arena.js         builds the yard out of the CV
v3/js/game/player.js        torque-driven marble, orbit camera, telekinesis
v3/js/game/audio.js         WebAudio synthesis — impacts, chimes, rolling rumble
v3/js/game/hud.js           DOM overlay
v3/js/game/game.js          loop, input, discovery, effects
```

Without WebGL2 or JavaScript the page degrades to a plain list of the projects
and a link back to the main site.

## Archive

- `v1/` — the 2016 site (jQuery, Isotope, fancybox)
- `v2/` — an unfinished Famo.us experiment
