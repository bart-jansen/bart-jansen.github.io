/**
 * Boot. Detects WebGL2, then either starts the island or leaves the static
 * fallback in place — the fallback is the real CV, so the page is never empty.
 */

import { App } from './app.js';

const canvas = document.querySelector('[data-canvas]');
const hudRoot = document.querySelector('[data-hud]');
const boot = document.querySelector('[data-boot]');
const fallback = document.querySelector('[data-fallback]');

function fail(reason) {
  document.documentElement.dataset.mode = 'fallback';
  if (boot) boot.hidden = true;
  if (fallback) fallback.hidden = false;
  const note = document.querySelector('[data-fallback-note]');
  if (note) note.textContent = reason;
}

function ok() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch { return false; }
}

if (!ok()) {
  fail('Your browser could not open a WebGL2 context, so here is the plain version.');
} else if (matchMedia('(prefers-reduced-motion: reduce)').matches
  && !new URLSearchParams(location.search).has('play')) {
  fail('You asked for reduced motion, so here is the plain version. Add ?play to the URL to run the island anyway.');
} else {
  try {
    const app = new App(canvas, hudRoot);
    window.__app = app;
    document.documentElement.dataset.mode = 'play';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (boot) { boot.classList.add('out'); setTimeout(() => { boot.hidden = true; }, 700); }
      app.hud.say('WASD to walk · Shift to run · Space to jump · E to read a sign', 7);
    }));
  } catch (err) {
    console.error(err);
    fail('The island failed to start, so here is the plain version.');
  }
}
