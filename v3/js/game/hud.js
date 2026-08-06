/**
 * HUD — plain DOM on top of the canvas.
 *
 * Everything here is also the accessible version of the page: the project
 * list, the CV and the contact details exist as real markup whether or not
 * WebGL ever starts, so the site still works as a CV in a text browser.
 */

import { PROJECTS } from './content.js';

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {
      boot: root.querySelector('[data-boot]'),
      bootBar: root.querySelector('[data-boot-bar]'),
      bootMsg: root.querySelector('[data-boot-msg]'),
      start: root.querySelector('[data-start]'),
      hud: root.querySelector('[data-hud]'),
      found: root.querySelector('[data-found]'),
      total: root.querySelector('[data-total]'),
      meter: root.querySelector('[data-meter]'),
      speed: root.querySelector('[data-speed]'),
      fps: root.querySelector('[data-fps]'),
      bodies: root.querySelector('[data-bodies]'),
      toast: root.querySelector('[data-toast]'),
      card: root.querySelector('[data-card]'),
      cardImg: root.querySelector('[data-card-img]'),
      cardTitle: root.querySelector('[data-card-title]'),
      cardTags: root.querySelector('[data-card-tags]'),
      hint: root.querySelector('[data-hint]'),
      reticle: root.querySelector('[data-reticle]'),
      paused: root.querySelector('[data-paused]'),
      compass: root.querySelector('[data-compass]'),
    };
    this.el.total.textContent = String(PROJECTS.length);
    this._toastTimer = 0;
    this._cardTimer = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
  }

  progress(t, msg) {
    if (this.el.bootBar) this.el.bootBar.style.setProperty('--p', `${Math.round(t * 100)}%`);
    if (msg && this.el.bootMsg) this.el.bootMsg.textContent = msg;
  }

  ready() {
    this.el.boot.dataset.state = 'ready';
    this.el.start.hidden = false;
    this.el.start.focus({ preventScroll: true });
  }

  enterGame() {
    this.el.boot.hidden = true;
    this.el.hud.hidden = false;
  }

  setPaused(paused) {
    this.el.paused.hidden = !paused;
    this.el.reticle.hidden = paused;
  }

  toast(text, ms = 2200) {
    this.el.toast.textContent = text;
    this.el.toast.dataset.on = '1';
    this._toastTimer = ms / 1000;
  }

  showProject(project, index) {
    this.el.cardImg.src = project.img;
    this.el.cardImg.alt = project.title;
    this.el.cardTitle.textContent = project.title;
    this.el.cardTags.textContent = project.blurb;
    this.el.card.dataset.on = '1';
    this._cardTimer = 4.2;
  }

  setFound(n, total) {
    this.el.found.textContent = String(n);
    this.el.meter.style.setProperty('--p', `${(n / total) * 100}%`);
    if (n === total) this.el.meter.dataset.complete = '1';
  }

  setHint(text) {
    this.el.hint.textContent = text || '';
    this.el.hint.dataset.on = text ? '1' : '';
  }

  setReticle(state) {
    this.el.reticle.dataset.state = state;
  }

  /** Off-screen markers pointing at the landmarks you haven't visited. */
  updateCompass(items) {
    const el = this.el.compass;
    while (el.childElementCount < items.length) {
      const d = document.createElement('div');
      d.className = 'compass__pip';
      d.innerHTML = '<i></i><span></span>';
      el.appendChild(d);
    }
    for (let i = 0; i < el.childElementCount; i++) {
      const pip = el.children[i];
      const it = items[i];
      if (!it) { pip.hidden = true; continue; }
      pip.hidden = false;
      pip.style.transform = `translate(${it.x}px, ${it.y}px)`;
      pip.style.opacity = String(it.alpha);
      pip.dataset.edge = it.edge ? '1' : '';
      const label = pip.lastElementChild;
      if (label.textContent !== it.label) label.textContent = it.label;
    }
  }

  update(dt, stats) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.el.toast.dataset.on = '';
    }
    if (this._cardTimer > 0) {
      this._cardTimer -= dt;
      if (this._cardTimer <= 0) this.el.card.dataset.on = '';
    }
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.el.fps.textContent = String(Math.round(this._fpsFrames / this._fpsAcc));
      this._fpsAcc = 0; this._fpsFrames = 0;
      if (stats) {
        this.el.bodies.textContent = `${stats.awake}/${stats.bodies}`;
      }
    }
    if (stats) this.el.speed.textContent = stats.speed.toFixed(1);
  }
}
