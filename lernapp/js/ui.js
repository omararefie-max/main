// Wiederverwendbare UI-Bausteine.
import { h, mount } from './util.js';
import { buildTree } from './store.js';

export { toast } from './util.js';

/** Segmentierte Auswahl. options: [{value,label}] */
export function seg(options, value, onChange) {
  let cur = value;
  const el = h('div', { class: 'seg', role: 'radiogroup' });
  const draw = () => mount(el, options.map((o) =>
    h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(o.value === cur),
      onclick: () => { cur = o.value; draw(); onChange?.(cur); },
    }, o.label)));
  draw();
  return { el, get: () => cur, set: (v) => { cur = v; draw(); } };
}

/** Beschriftetes Feld. */
export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('div', { class: 'muted small' }, hint) : null);
}

/** Schalter-Zeile (Checkbox). */
export function switchRow(label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', checked: !!checked, onchange: () => onChange(input.checked) });
  return h('label', { class: 'switch' }, h('span', null, label, hint ? h('div', { class: 'muted small' }, hint) : null), input);
}

/** Auswahl Fach -> Thema -> Kapitel auf Basis der vorhandenen Einträge. */
export function scopePicker(items, init = {}) {
  const tree = buildTree(items);
  const scope = { deck: init.deck || '', topic: init.topic || '', chapter: init.chapter || '' };
  const wrap = h('div');
  const mk = (label, opts, key, allLabel) => {
    const sel = h('select', {
      onchange: () => {
        scope[key] = sel.value;
        if (key === 'deck') { scope.topic = ''; scope.chapter = ''; }
        if (key === 'topic') scope.chapter = '';
        draw();
      },
    }, h('option', { value: '' }, allLabel), opts.map((o) => h('option', { value: o, selected: scope[key] === o }, o)));
    return field(label, sel);
  };
  const draw = () => {
    const decks = [...tree.keys()].sort((a, b) => a.localeCompare(b, 'de'));
    const topics = scope.deck ? [...(tree.get(scope.deck)?.keys() || [])].sort((a, b) => a.localeCompare(b, 'de')) : [];
    const chapters = scope.deck && scope.topic ? [...(tree.get(scope.deck)?.get(scope.topic) || [])].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })) : [];
    mount(wrap,
      mk('Fach', decks, 'deck', 'Alle Fächer'),
      scope.deck ? mk('Thema', topics, 'topic', 'Alle Themen') : null,
      chapters.length ? mk('Kapitel', chapters, 'chapter', 'Alle Kapitel') : null);
  };
  draw();
  return { el: wrap, get: () => ({ ...scope }) };
}

/** Vollbild-Dialog von unten. Liefert close(). */
export function openSheet(title, ...body) {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'btn small ghost', onclick: close }, 'Schließen')),
      body));
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return close;
}

export function emptyState(text, ...actions) {
  return h('div', { class: 'empty' }, h('p', null, text), h('div', { class: 'stack' }, actions));
}
