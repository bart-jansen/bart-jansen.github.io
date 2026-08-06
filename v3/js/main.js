/**
 * Entry point. Decides whether this browser can run the sandbox, builds the
 * text fallback either way, and boots the game if it can.
 */

import { PROJECTS } from './game/content.js';

const canvas = document.getElementById('stage');
const ui = document.querySelector('[data-ui]');

buildFallbackList();

if (!supportsWebGL2()) {
  document.documentElement.setAttribute('data-fallback', '');
} else {
  boot();
}

async function boot() {
  const msg = document.querySelector('[data-boot-msg]');
  try {
    const { Game } = await import('./game/game.js');
    const game = new Game(canvas, ui);
    game.renderer.resize();
    await game.load();
    window.__game = game;   // handy in the console, and used by the test harness
  } catch (err) {
    console.error(err);
    if (msg) {
      msg.textContent = 'This browser could not start the sandbox — showing the text version.';
    }
    document.documentElement.setAttribute('data-fallback', '');
  }
}

function supportsWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function buildFallbackList() {
  const grid = document.querySelector('[data-project-grid]');
  if (!grid || grid.childElementCount) return;
  const frag = document.createDocumentFragment();
  for (const p of PROJECTS) {
    const li = document.createElement('li');
    li.className = 'fallback__item';
    const img = document.createElement('img');
    img.src = p.img; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    const b = document.createElement('b');
    b.textContent = p.title;
    const span = document.createElement('span');
    span.textContent = p.blurb;
    li.append(img, b, span);
    frag.appendChild(li);
  }
  grid.appendChild(frag);
}
