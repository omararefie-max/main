/* Gemeinsame Fach/Thema/Kapitel-Filter für Quiz, Hören und Prüfung. */
import { h } from '../util.js';

export const filterItems = (items, f) =>
  items.filter((c) => (!f.subject || c.subject === f.subject) && (!f.topic || c.topic === f.topic) && (!f.chapter || c.chapter === f.chapter));

export function filterControls(items, f, onChange) {
  const opts = (key, pred) => [...new Set(items.filter(pred).map((c) => c[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const sel = (label, key, values) =>
    h('label', { class: 'field' }, label,
      h('select', {
        onchange: (e) => {
          f[key] = e.target.value;
          if (key === 'subject') { f.topic = ''; f.chapter = ''; }
          if (key === 'topic') f.chapter = '';
          onChange();
        }
      }, h('option', { value: '' }, 'Alle'), values.map((v) => h('option', { value: v, selected: f[key] === v }, v))));
  return h('div', { class: 'filters' },
    sel('Fach', 'subject', opts('subject', () => true)),
    sel('Thema', 'topic', opts('topic', (c) => !f.subject || c.subject === f.subject)),
    sel('Kapitel', 'chapter', opts('chapter', (c) => (!f.subject || c.subject === f.subject) && (!f.topic || c.topic === f.topic))));
}

export const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n), h('span', {}, label));

export const emptyHint = (what = 'Karten') =>
  h('div', { class: 'banner warn' }, `Noch keine ${what} vorhanden. Gehe zu „Inhalte“ → „Beispieldaten laden“ oder importiere deine eigenen Dateien.`);
