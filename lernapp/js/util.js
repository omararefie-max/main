/* Kleine Hilfsfunktionen ohne Abhängigkeiten. */

export const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/** DOM-Helfer: h('div', {class:'x', onclick:fn}, 'Text', childEl, ...) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'selected'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Stabiler Kurz-Hash (für automatisch erzeugte IDs aus dem Fragetext). */
export function hash(str) {
  let a = 5381, b = 52711;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = ((a << 5) + a) ^ c;
    b = ((b << 5) + b) ^ c;
  }
  return ((a >>> 0).toString(36) + (b >>> 0).toString(36));
}

export const dayKey = (ts) => new Date(ts).toLocaleDateString('sv-SE'); // YYYY-MM-DD (lokal)
export const fmtDate = (ts) => new Date(ts).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

let toastTimer;
export function toast(msg, ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file, 'utf-8');
  });
}
