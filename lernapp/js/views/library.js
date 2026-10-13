// views/library.js – Inhalte verwalten: Übersicht/Suche, Import (JSON/CSV), Export/Backup, Editor.

import { h, clear, toast, download, debounce, uid, dayKey } from '../util.js';
import { state, diffImport, applyImport, saveCard, saveOral, deleteCard, deleteOral, buildBackup, wipeAll, resetProgress, inScope } from '../store.js';
import { parseContent, normalizeCard, normalizeOral, cardsToCSV, oralToCSV } from '../importer.js';
import { scopeSelect, loadExamples } from '../ui.js';
import { LETTERS } from '../cards.js';

let tab = 'inhalt';
let kind = 'cards';   // 'cards' | 'oral'
let scope = '';
let query = '';
const PAGE = 50;
const field = (label, el) => h('label', { class: 'field' }, label, el);
const txt = (v, ph = '', list = '') => h('input', { type: 'text', value: v || '', placeholder: ph, list: list || null });

export function render(root) {
  show();
  return;

  function show() {
    clear(root);
    const seg = h('div', { class: 'seg' },
      ...[['inhalt', 'Inhalte'], ['import', 'Import'], ['backup', 'Export']].map(([k, l]) =>
        h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; show(); } }, l)));
    root.append(seg);
    ({ inhalt: listView, import: importView, backup: exportView })[tab]();
  }

  /* ------------------------------------------------------- Übersicht */
  function listView() {
    const list = h('div', {});
    let shown = PAGE;
    const draw = () => {
      clear(list);
      const q = query.trim().toLowerCase();
      const src = (kind === 'cards' ? state.cards : state.oral).filter((x) => inScope(x, scope) &&
        (!q || (x.frage + ' ' + x.thema + ' ' + x.kapitel + ' ' + (x.tags || []).join(' ')).toLowerCase().includes(q)));
      const sorted = src.slice().sort((a, b) => (a.fach + a.thema + a.kapitel).localeCompare(b.fach + b.thema + b.kapitel, 'de'));
      list.append(h('p', { class: 'muted small' }, `${sorted.length} Einträge`));
      for (const x of sorted.slice(0, shown)) {
        const p = kind === 'cards' ? state.progress.get(x.id) : null;
        list.append(h('button', { class: 'list-item', onclick: () => (kind === 'cards' ? editCard(x) : editOral(x)) },
          x.frage.length > 110 ? x.frage.slice(0, 110) + '…' : x.frage,
          h('small', {}, [x.fach, x.thema, x.kapitel].filter(Boolean).join(' › ') + (p ? ` · ${p.seen}× gelernt` : kind === 'cards' ? ' · neu' : ''))));
      }
      if (sorted.length > shown) list.append(h('button', { class: 'btn', onclick: () => { shown += PAGE; draw(); } }, 'Mehr anzeigen'));
      if (!sorted.length) list.append(h('div', { class: 'empty' }, 'Nichts gefunden. Importiere Inhalte oder lege eine Karte an.'));
    };
    root.append(
      h('div', { class: 'seg' },
        h('button', { class: kind === 'cards' ? 'on' : '', onclick: () => { kind = 'cards'; show(); } }, `Quizkarten (${state.cards.length})`),
        h('button', { class: kind === 'oral' ? 'on' : '', onclick: () => { kind = 'oral'; show(); } }, `Prüfungsfragen (${state.oral.length})`)),
      scopeSelect(scope, (v) => { scope = v; draw(); }, 'Bereich'),
      h('input', { type: 'search', placeholder: 'Suchen …', value: query, 'aria-label': 'Suchen', oninput: debounce((e) => { query = e.target.value; shown = PAGE; draw(); }, 200) }),
      h('div', { style: { height: '.8rem' } }),
      h('button', { class: 'btn primary', onclick: () => (kind === 'cards' ? editCard(null) : editOral(null)) }, kind === 'cards' ? '+ Neue Quizkarte' : '+ Neue Prüfungsfrage'),
      h('div', { style: { height: '.8rem' } }), list);
    draw();
  }

  /* ----------------------------------------------------------- Import */
  function importView() {
    const ta = h('textarea', { placeholder: 'JSON oder CSV hier einfügen …', 'aria-label': 'Inhalt einfügen', style: { minHeight: '9rem' } });
    const file = h('input', { type: 'file', accept: '.json,.csv,.txt,application/json,text/csv', multiple: true, onchange: async () => {
      const texts = await Promise.all([...file.files].map((f) => f.text()));
      ta.value = texts.join('\n'); if (texts.length > 1) toast('Mehrere Dateien: bitte einzeln importieren, wenn sie unterschiedliche Formate haben.');
      preview();
    } });
    const out = h('div', {});
    let parsed = null;

    function preview() {
      clear(out); parsed = null;
      if (!ta.value.trim()) return;
      parsed = parseContent(ta.value);
      const d = diffImport(parsed);
      const nothing = !parsed.cards.length && !parsed.oral.length && !parsed.progress.length;
      out.append(h('div', { class: 'card' },
        h('b', {}, 'Vorschau'),
        h('p', {}, `Quizkarten: ${d.cardsNew} neu, ${d.cardsUpd} werden aktualisiert`),
        h('p', {}, `Prüfungsfragen: ${d.oralNew} neu, ${d.oralUpd} werden aktualisiert`),
        parsed.backup ? h('p', {}, `Backup enthält Lernfortschritt: ${parsed.progress.length} Einträge, wird übernommen.`) : null,
        h('p', { class: 'muted small' }, 'Vorhandener Lernfortschritt bleibt erhalten (Zuordnung über die ID).')),
        parsed.errors.length ? h('div', { class: 'banner' }, h('b', {}, `${parsed.errors.length} Problem(e):`),
          ...parsed.errors.slice(0, 12).map((e) => h('div', { class: 'small' }, '• ' + e)),
          parsed.errors.length > 12 ? h('div', { class: 'small' }, `… und ${parsed.errors.length - 12} weitere`) : null) : null,
        h('button', { class: 'btn primary', disabled: nothing, onclick: async () => {
          const st = await applyImport(parsed);
          toast(`Importiert: ${st.cardsNew + st.oralNew} neu, ${st.cardsUpd + st.oralUpd} aktualisiert`);
          ta.value = ''; clear(out);
        } }, 'Jetzt importieren'));
    }

    root.append(
      h('p', { class: 'muted' }, 'Datei wählen oder Text einfügen (JSON oder CSV). Gleiche IDs aktualisieren vorhandene Einträge, neue werden ergänzt.'),
      h('label', { class: 'field' }, 'Datei auswählen', file), ta,
      h('div', { style: { height: '.6rem' } }),
      h('button', { class: 'btn', onclick: preview }, 'Prüfen / Vorschau'),
      out,
      h('h3', {}, 'Formate'),
      h('p', { class: 'small muted' }, 'Das genaue Datenformat (JSON-Schema, CSV-Spalten, Beispiele und ein KI-Prompt) steht im Ordner „docs“ der App-Dateien.'),
      h('button', { class: 'btn small', onclick: async () => { await loadExamples(); show(); } }, 'Beispieldaten (Medizin) laden'));
  }

  /* ----------------------------------------------------------- Export */
  function exportView() {
    const stamp = dayKey();
    root.append(
      h('h2', {}, 'Export & Backup'),
      h('p', { class: 'muted' }, 'Alles bleibt auf deinem Gerät. Mache regelmäßig ein Backup – besonders bei iPhone/Safari, wo der Browser Daten bei langer Nichtnutzung löschen kann.'),
      h('div', { class: 'btn-stack' },
        h('button', { class: 'btn primary', onclick: async () => { download(`pruefungstrainer-backup-${stamp}.json`, JSON.stringify(await buildBackup(true), null, 1)); toast('Backup erstellt'); } }, 'Komplett-Backup (Inhalte + Fortschritt)'),
        h('button', { class: 'btn', onclick: async () => download(`inhalte-${stamp}.json`, JSON.stringify(await buildBackup(false), null, 1)) }, 'Nur Inhalte (JSON)'),
        h('button', { class: 'btn', disabled: !state.cards.length, onclick: () => download(`quizkarten-${stamp}.csv`, cardsToCSV(state.cards), 'text/csv') }, 'Quizkarten als CSV'),
        h('button', { class: 'btn', disabled: !state.oral.length, onclick: () => download(`pruefungsfragen-${stamp}.csv`, oralToCSV(state.oral), 'text/csv') }, 'Prüfungsfragen als CSV')),
      h('p', { class: 'small muted' }, 'Wiederherstellen: Backup-Datei unter „Import“ auswählen.'),
      h('h3', {}, 'Zurücksetzen'),
      h('div', { class: 'btn-stack' },
        h('button', { class: 'btn danger', onclick: async () => { if (confirm('Lernfortschritt, Statistik und Serie wirklich zurücksetzen? Die Karten bleiben.')) { await resetProgress(); toast('Fortschritt zurückgesetzt'); } } }, 'Lernfortschritt zurücksetzen'),
        h('button', { class: 'btn danger', onclick: async () => { if (confirm('ALLE Karten, Fragen und den Fortschritt löschen? Das lässt sich nicht rückgängig machen.')) { await wipeAll(); toast('Alles gelöscht'); show(); } } }, 'Alle Daten löschen')));
  }

  /* ---------------------------------------------------------- Editor */
  function datalists() {
    const f = [...new Set([...state.cards, ...state.oral].map((x) => x.fach))];
    const t = [...new Set([...state.cards, ...state.oral].map((x) => x.thema))];
    return [h('datalist', { id: 'dl-fach' }, f.map((x) => h('option', { value: x }))), h('datalist', { id: 'dl-thema' }, t.map((x) => h('option', { value: x })))];
  }

  function editCard(c) {
    clear(root);
    const isNew = !c; c = c || { fach: '', thema: '', kapitel: '', frage: '', antworten: ['', '', '', '', ''], richtig: [], erklaerung: '', schwierigkeit: 0, tags: [] };
    const fach = txt(c.fach, 'z. B. Innere Medizin', 'dl-fach'), thema = txt(c.thema, 'z. B. Kardiologie', 'dl-thema'), kap = txt(c.kapitel);
    const frage = h('textarea', { value: c.frage }), erkl = h('textarea', { value: c.erklaerung });
    const ans = c.antworten.map((a) => h('input', { type: 'text', value: a }));
    const chk = c.antworten.map((_, i) => h('input', { type: 'checkbox', checked: c.richtig.includes(i), 'aria-label': `Antwort ${LETTERS[i]} ist richtig` }));
    const diff = h('select', {}, ...[['0', 'nicht angegeben'], ['1', 'leicht'], ['2', 'mittel'], ['3', 'schwer']].map(([v, l]) => h('option', { value: v, selected: String(c.schwierigkeit || 0) === v }, l)));
    const tags = txt((c.tags || []).join(', '), 'kommagetrennt');
    const err = h('div', {});
    root.append(h('h2', {}, isNew ? 'Neue Quizkarte' : 'Quizkarte bearbeiten'), ...datalists(),
      field('Fach', fach), field('Thema', thema), field('Kapitel (optional)', kap), field('Frage', frage),
      h('p', { class: 'muted small' }, 'Antworten – Häkchen = richtig (eines oder mehrere):'),
      ...ans.map((a, i) => h('div', { class: 'row', style: { marginBottom: '.5rem' } }, h('b', {}, LETTERS[i]), h('div', { class: 'grow' }, a), chk[i])),
      field('Erklärung', erkl), field('Schwierigkeit', diff), field('Tags', tags), err,
      h('div', { class: 'btn-stack' },
        h('button', { class: 'btn primary', onclick: async () => {
          const r = normalizeCard({
            id: isNew ? 'k_' + uid() : c.id, fach: fach.value, thema: thema.value, kapitel: kap.value, frage: frage.value,
            antworten: ans.map((a) => a.value), richtig: chk.map((x, i) => (x.checked ? LETTERS[i] : null)).filter(Boolean),
            erklaerung: erkl.value, schwierigkeit: diff.value, tags: tags.value.split(',').map((x) => x.trim()).filter(Boolean),
          });
          if (r.error) { clear(err); err.append(h('div', { class: 'banner' }, r.error)); return; }
          await saveCard(r.card); toast('Gespeichert'); show();
        } }, 'Speichern'),
        !isNew ? h('button', { class: 'btn danger', onclick: async () => { if (confirm('Diese Karte löschen?')) { await deleteCard(c.id); toast('Gelöscht'); show(); } } }, 'Löschen') : null,
        h('button', { class: 'btn', onclick: show }, 'Abbrechen')));
  }

  function editOral(q) {
    clear(root);
    const isNew = !q; q = q || { fach: '', thema: '', kapitel: '', frage: '', musterantwort: '', schluesselbegriffe: [], nachfragen: [] };
    const fach = txt(q.fach, '', 'dl-fach'), thema = txt(q.thema, '', 'dl-thema'), kap = txt(q.kapitel);
    const frage = h('textarea', { value: q.frage }), muster = h('textarea', { value: q.musterantwort, style: { minHeight: '10rem' } });
    const keys = h('textarea', { value: q.schluesselbegriffe.map((k) => [k.begriff, ...k.synonyme].join('/')).join('\n'), placeholder: 'Pro Zeile ein Pflichtpunkt.\nSynonyme mit / trennen:\nHerzinfarkt/Myokardinfarkt' });
    const nach = h('textarea', { value: (q.nachfragen || []).join('\n'), placeholder: 'Pro Zeile eine Nachfrage (optional)' });
    const err = h('div', {});
    root.append(h('h2', {}, isNew ? 'Neue Prüfungsfrage' : 'Prüfungsfrage bearbeiten'), ...datalists(),
      field('Fach', fach), field('Thema', thema), field('Kapitel (optional)', kap), field('Fragetext', frage),
      field('Musterantwort', muster), field('Schlüsselbegriffe / Pflichtpunkte (eine pro Zeile, Synonyme mit /)', keys), field('Nachfragen', nach), err,
      h('div', { class: 'btn-stack' },
        h('button', { class: 'btn primary', onclick: async () => {
          const r = normalizeOral({
            id: isNew ? 'm_' + uid() : q.id, fach: fach.value, thema: thema.value, kapitel: kap.value, frage: frage.value, musterantwort: muster.value,
            schluesselbegriffe: keys.value.split('\n').map((x) => x.trim()).filter(Boolean), nachfragen: nach.value.split('\n').map((x) => x.trim()).filter(Boolean),
          });
          if (r.error) { clear(err); err.append(h('div', { class: 'banner' }, r.error)); return; }
          await saveOral(r.oral); toast('Gespeichert'); show();
        } }, 'Speichern'),
        !isNew ? h('button', { class: 'btn danger', onclick: async () => { if (confirm('Diese Frage löschen?')) { await deleteOral(q.id); toast('Gelöscht'); show(); } } }, 'Löschen') : null,
        h('button', { class: 'btn', onclick: show }, 'Abbrechen')));
  }
}
