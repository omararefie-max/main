/* Einstiegspunkt: Start, Hash-Router, Service Worker.
 *
 * Eine View ist ein Modul mit  export function render(root, ctx)  und optional einer Cleanup-Funktion als Rückgabewert.
 * ctx.rerender() zeichnet die aktuelle View neu (z. B. nach Filteränderung). */
import { $, toast } from './util.js';
import { loadAll } from './store.js';
import * as learn from './views/learn.js';
import * as audio from './views/audio.js';
import * as exam from './views/exam.js';
import * as stats from './views/stats.js';
import * as content from './views/content.js';
import * as settings from './views/settings.js';

export const VERSION = '1.0.0';

const routes = {
  learn:    { view: learn,    title: 'Karteikarten' },
  audio:    { view: audio,    title: 'Auditives Lernen' },
  exam:     { view: exam,     title: 'Mündliche Prüfung' },
  stats:    { view: stats,    title: 'Statistik' },
  content:  { view: content,  title: 'Inhalte' },
  settings: { view: settings, title: 'Einstellungen' }
};

let cleanup = null;
let current = null;

function currentName() {
  const n = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return routes[n] ? n : 'learn';
}

function draw(fresh) {
  const name = currentName();
  const r = routes[name];
  const root = $('#view');
  if (fresh) { cleanup?.(); cleanup = null; window.scrollTo(0, 0); }
  current = name;
  document.title = r.title + ' – Lernapp';
  $('#title').textContent = r.title;
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  const ctx = { rerender: () => draw(false), go: (n) => { location.hash = '#/' + n; } };
  try {
    const c = r.view.render(root, ctx);
    if (typeof c === 'function') cleanup = c;
  } catch (e) {
    console.error(e);
    root.replaceChildren(Object.assign(document.createElement('div'), { className: 'banner bad', textContent: 'Fehler beim Anzeigen: ' + e.message }));
  }
}

async function start() {
  try {
    await loadAll();
  } catch (e) {
    $('#view').textContent = 'Der lokale Speicher (IndexedDB) ist nicht verfügbar: ' + e.message + '. Im privaten Modus funktioniert die App nicht.';
    return;
  }
  // Daten vor dem Löschen durch den Browser schützen (Android: eher gewährt, wenn als App installiert)
  try { await navigator.storage?.persist?.(); } catch { /* egal */ }

  window.addEventListener('hashchange', () => draw(true));
  draw(true);

  if ('serviceWorker' in navigator) {
    try {
      const had = !!navigator.serviceWorker.controller;
      await navigator.serviceWorker.register('sw.js');
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) toast('Neue Version geladen – beim nächsten Start aktiv.'); });
    } catch (e) { console.warn('Service Worker:', e); }
  }
}

start();
