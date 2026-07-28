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

## Archive

- `v1/` — the 2016 site (jQuery, Isotope, fancybox)
- `v2/` — an unfinished Famo.us experiment
