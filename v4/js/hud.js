/**
 * The HUD. Plain DOM on top of the canvas — it stays crisp, it is selectable,
 * it works with a screen reader, and it costs the renderer nothing.
 */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export class Hud {
  constructor(root, total) {
    this.root = root;
    this.total = total;
    this.found = new Set();
    this.current = null;
    this.onAction = null;

    this.prompt = el('div', 'prompt', '<kbd>E</kbd><span></span>');
    this.prompt.hidden = true;
    root.appendChild(this.prompt);
    this.promptText = this.prompt.querySelector('span');
    this.prompt.addEventListener('click', () => { if (this.onAction) this.onAction(); });

    this.card = el('aside', 'card');
    this.card.hidden = true;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'false');
    root.appendChild(this.card);

    this.counter = el('div', 'counter', `<b>0</b> / ${total} found`);
    root.appendChild(this.counter);

    this.toast = el('div', 'toast');
    this.toast.hidden = true;
    root.appendChild(this.toast);

    this._toastTimer = 0;
  }

  /* ─────────────────────────────────────────────────────────────── prompt ── */

  setNear(spot) {
    if (spot === this.current) return;
    this.current = spot;
    if (!spot) { this.prompt.hidden = true; return; }
    this.prompt.hidden = false;
    this.promptText.textContent = spot.data.title;
  }

  /* ───────────────────────────────────────────────────────────────── card ── */

  open(spot) {
    const d = spot.data;
    const accent = d.accent || '#ffc244';
    this.card.style.setProperty('--accent', accent);
    this.card.innerHTML = '';

    const head = el('header');
    if (d.tag) head.appendChild(el('span', 'tag', escapeHtml(d.tag)));
    head.appendChild(el('h2', null, escapeHtml(d.title)));
    this.card.appendChild(head);

    if (d.img) {
      const fig = el('figure');
      const img = new Image();
      img.src = d.img;
      img.alt = d.title;
      img.loading = 'lazy';
      fig.appendChild(img);
      this.card.appendChild(fig);
    }
    if (d.body) this.card.appendChild(el('p', null, escapeHtml(d.body)));

    if (d.links) {
      const nav = el('nav');
      for (const l of d.links) {
        const a = el('a', null, escapeHtml(l.label));
        a.href = l.href;
        if (!l.href.startsWith('mailto:')) a.rel = 'noopener';
        nav.appendChild(a);
      }
      this.card.appendChild(nav);
    }

    const close = el('button', 'close', '✕');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    this.card.appendChild(close);

    this.card.hidden = false;
    this.card.classList.remove('in');
    void this.card.offsetWidth;
    this.card.classList.add('in');

    if (!this.found.has(spot.id)) {
      this.found.add(spot.id);
      this.counter.querySelector('b').textContent = String(this.found.size);
      this.counter.classList.remove('pop');
      void this.counter.offsetWidth;
      this.counter.classList.add('pop');
      if (this.found.size === this.total) this.say('Every last one. Thanks for wandering.', 6);
    }
  }

  close() {
    this.card.hidden = true;
  }

  get isOpen() { return !this.card.hidden; }

  /* ──────────────────────────────────────────────────────────────── toast ── */

  say(text, seconds = 3.5) {
    this.toast.textContent = text;
    this.toast.hidden = false;
    this.toast.classList.remove('in');
    void this.toast.offsetWidth;
    this.toast.classList.add('in');
    this._toastTimer = seconds;
  }

  update(dt) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.toast.hidden = true;
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
