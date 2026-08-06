/**
 * Fills the plain-HTML CV underneath the game from the same content module the
 * level is generated from, so the no-canvas version is never a stub. It runs on
 * every load and costs nothing visible once the level starts.
 */

import { PROJECTS, JOBS, SKILLS, EDUCATION } from '../../v3/js/game/content.js';

const q = (k) => document.querySelector(`[data-plain="${k}"]`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const projects = q('projects');
if (projects) {
  projects.innerHTML = PROJECTS.map((p) => `
    <li>
      <img src="${esc(p.img)}" alt="" loading="lazy" width="320" height="200">
      <strong>${esc(p.title)}</strong>
      <span>${esc(p.blurb)}</span>
    </li>`).join('');
}

const jobs = q('jobs');
if (jobs) {
  jobs.innerHTML = JOBS.map((j) => `
    <li>
      <b>${esc(j.role)}</b> — ${esc(j.org)}
      <i>${esc(j.when)}</i>
      <p>${esc(j.desc)}</p>
    </li>`).join('');
}

const skills = q('skills');
if (skills) skills.innerHTML = SKILLS.map((s) => `<span>${esc(s)}</span>`).join('');

const edu = q('education');
if (edu) {
  edu.innerHTML = EDUCATION.map((e) => `
    <li>
      <b>${esc(e.what)}</b> — ${esc(e.where)}
      <i>${esc(e.when)}</i>
    </li>`).join('');
}
