// Inhalte verwalten: Karten-Editor, Prüfungsfragen-Editor, Import/Export, Einstellungen.
import { state, cardList, examList, putCards, putExamQs, removeCards, removeExamQs, exportBackup, exportContent, restoreBackup } from './store.js';
import { parseContent, applyImport, normalizeCard, normalizeExamQ } from './importer.js';
import { h, mount, debounce, downloadText, readFileText, dayKey, toast as _t } from './util.js';
import { field, openSheet, toast, emptyState } from './ui.js';

const TABS = [
  { id: 'cards', label: 'Karten' },
  { id: 'exam', label: 'Prüfungsfragen' },
  { id: 'import', label: 'Import/Export' },
  { id: 'settings', label: 'Einstellungen' },
];
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

export function renderContent(view, ctx) {
  const tab = ctx.params[0] || 'cards';
  const body = h('div');
  mount(view,
    h('h1', null, 'Inhalte'),
    h('div', { class: 'tabs', role: 'tablist' },
      TABS.map((t) => h('button', { role: 'tab', 'aria-selected': String(t.id === tab), onclick: () => ctx.go('/content/' + t.id) }, t.label))),
    body);
  if (tab === 'cards') return renderList(body, 'cards');
  if (tab === 'exam') return renderList(body, 'exam');
  if (tab === 'import') return renderImport(body, ctx);
  if (tab === 'settings') return import('./settings.js').then((m) => m.renderSettings(body, ctx));
}

/* ======================= Listen + Editor ======================= */
function renderList(body, kind) {
  const isCards = kind === 'cards';
  const PAGE = 50;
  let limit = PAGE, filter = '';
  const list = h('div');
  const info = h('p', { class: 'muted small' });
  const search = h('input', { type: 'search', placeholder: 'Suchen (Frage, Fach, Thema, ID, Tag)…', oninput: debounce(() => { filter = search.value.trim().toLowerCase(); limit = PAGE; draw(); }, 150) });

  const draw = () => {
    const all = isCards ? cardList() : examList();
    const hit = filter ? all.filter((x) => (x.question + ' ' + x.deck + ' ' + x.topic + ' ' + x.chapter + ' ' + x.id + ' ' + (x.tags || []).join(' ')).toLowerCase().includes(filter)) : all;
    info.textContent = `${hit.length} von ${all.length} ${isCards ? 'Karten' : 'Prüfungsfragen'}`;
    const sorted = hit.slice().sort((a, b) => (a.deck + a.topic + a.chapter).localeCompare(b.deck + b.topic + b.chapter, 'de', { numeric: true }));
    mount(list,
      sorted.slice(0, limit).map((x) => h('button', { class: 'list-item', onclick: () => edit(x) },
        h('div', { class: 't' }, x.question),
        h('div', { class: 'muted small' }, `${x.deck} › ${x.topic}${x.chapter ? ' › ' + x.chapter : ''}`))),
      sorted.length > limit ? h('button', { class: 'btn ghost', onclick: () => { limit += PAGE; draw(); } }, `Mehr anzeigen (${sorted.length - limit})`) : null,
      !all.length ? emptyState(isCards ? 'Noch keine Karten.' : 'Noch keine Prüfungsfragen.') : null);
  };
  const edit = (x) => (isCards ? openCardEditor(x, draw) : openExamEditor(x, draw));

  mount(body,
    h('button', { class: 'btn primary', style: { marginBottom: '.8rem' }, onclick: () => edit(null) }, isCards ? 'Neue Karte' : 'Neue Prüfungsfrage'),
    h('label', { class: 'field' }, search), info, list);
  draw();
}

const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const datalist = (id, values) => h('datalist', { id }, [...new Set(values)].sort().map((v) => h('option', { value: v })));

function openCardEditor(card, onDone) {
  const c = card || { id: '', deck: '', topic: '', chapter: '', question: '', options: ['', '', '', '', ''], correct: [], explanation: '', difficulty: 0, tags: [] };
  const all = cardList();
  const f = {
    deck: h('input', { type: 'text', value: c.deck, list: 'dl-deck', placeholder: 'Allgemein' }),
    topic: h('input', { type: 'text', value: c.topic, list: 'dl-topic', placeholder: 'Allgemein' }),
    chapter: h('input', { type: 'text', value: c.chapter, placeholder: 'optional' }),
    question: h('textarea', { value: c.question }),
    explanation: h('textarea', { value: c.explanation }),
    difficulty: h('select', null, [['0', '–'], ['1', 'leicht'], ['2', 'mittel'], ['3', 'schwer']].map(([v, l]) => h('option', { value: v, selected: String(c.difficulty) === v }, l))),
    tags: h('input', { type: 'text', value: (c.tags || []).join(', '), placeholder: 'Komma-getrennt' }),
  };
  const opts = LETTERS.map((L, i) => ({
    chk: h('input', { type: 'checkbox', checked: c.correct.includes(L), 'aria-label': `${L} ist richtig` }),
    txt: h('input', { type: 'text', value: c.options[i], placeholder: `Antwort ${L}` }),
  }));
  const err = h('div', { class: 'banner', hidden: true });

  const save = async () => {
    const raw = {
      id: c.id || newId('c_'), deck: f.deck.value, topic: f.topic.value, chapter: f.chapter.value, question: f.question.value,
      options: opts.map((o) => o.txt.value), correct: opts.map((o, i) => (o.chk.checked ? LETTERS[i] : null)).filter(Boolean),
      explanation: f.explanation.value, difficulty: f.difficulty.value, tags: f.tags.value.split(','),
    };
    const r = normalizeCard(raw);
    if (r.errors.length) { err.hidden = false; err.textContent = r.errors.join(' · '); return; }
    await putCards([r.data]); toast('Gespeichert'); close(); onDone?.();
  };
  const remove = async () => {
    if (!confirm('Karte und ihren Lernfortschritt löschen?')) return;
    await removeCards([c.id]); toast('Gelöscht'); close(); onDone?.();
  };
  const close = openSheet(card ? 'Karte bearbeiten' : 'Neue Karte',
    datalist('dl-deck', all.map((x) => x.deck)), datalist('dl-topic', all.map((x) => x.topic)),
    err,
    field('Fach', f.deck), field('Thema', f.topic), field('Kapitel', f.chapter),
    field('Frage', f.question),
    h('p', { class: 'muted small' }, 'Antworten – Haken setzen bei allen richtigen:'),
    opts.map((o) => h('div', { class: 'row', style: { marginBottom: '.5rem' } }, o.chk, h('div', { class: 'grow' }, o.txt))),
    field('Erklärung', f.explanation), field('Schwierigkeit', f.difficulty), field('Tags', f.tags),
    card ? h('p', { class: 'muted small' }, `ID: ${c.id}`) : null,
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary', onclick: save }, 'Speichern'),
      card ? h('button', { class: 'btn danger', onclick: remove }, 'Löschen') : null));
}

const kpToText = (kp) => (kp.keywords.length === 1 && kp.keywords[0] === kp.label ? kp.label : `${kp.label} = ${kp.keywords.join(' / ')}`);

function openExamEditor(q, onDone) {
  const c = q || { id: '', deck: '', topic: '', chapter: '', question: '', modelAnswer: '', keyPoints: [], followUps: [] };
  const all = examList();
  const f = {
    deck: h('input', { type: 'text', value: c.deck, list: 'dl-deck2', placeholder: 'Allgemein' }),
    topic: h('input', { type: 'text', value: c.topic, list: 'dl-topic2', placeholder: 'Allgemein' }),
    chapter: h('input', { type: 'text', value: c.chapter }),
    question: h('textarea', { value: c.question }),
    modelAnswer: h('textarea', { value: c.modelAnswer, rows: 6 }),
    keyPoints: h('textarea', { value: c.keyPoints.map(kpToText).join('\n'), rows: 6, placeholder: 'Eine Zeile pro Pflichtpunkt:\nVier Hohlräume = Vorhof / Kammer / Ventrikel\nSinusknoten' }),
    followUps: h('textarea', { value: c.followUps.join('\n'), placeholder: 'Eine Nachfrage pro Zeile (optional)' }),
  };
  const err = h('div', { class: 'banner', hidden: true });
  const save = async () => {
    const r = normalizeExamQ({
      id: c.id || newId('q_'), deck: f.deck.value, topic: f.topic.value, chapter: f.chapter.value, question: f.question.value,
      modelAnswer: f.modelAnswer.value, keyPoints: f.keyPoints.value.split('\n'), followUps: f.followUps.value.split('\n'),
    });
    if (r.errors.length) { err.hidden = false; err.textContent = r.errors.join(' · '); return; }
    await putExamQs([r.data]); toast('Gespeichert'); close(); onDone?.();
  };
  const remove = async () => {
    if (!confirm('Prüfungsfrage löschen?')) return;
    await removeExamQs([c.id]); toast('Gelöscht'); close(); onDone?.();
  };
  const close = openSheet(q ? 'Prüfungsfrage bearbeiten' : 'Neue Prüfungsfrage',
    datalist('dl-deck2', all.map((x) => x.deck)), datalist('dl-topic2', all.map((x) => x.topic)),
    err,
    field('Fach', f.deck), field('Thema', f.topic), field('Kapitel', f.chapter),
    field('Frage', f.question), field('Musterantwort', f.modelAnswer),
    field('Pflichtpunkte / Schlüsselbegriffe', f.keyPoints, 'Eine Zeile pro Punkt. Synonyme mit " / " trennen. Optional "Bezeichnung = Begriff1 / Begriff2".'),
    field('Nachfragen', f.followUps),
    q ? h('p', { class: 'muted small' }, `ID: ${c.id}`) : null,
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary', onclick: save }, 'Speichern'),
      q ? h('button', { class: 'btn danger', onclick: remove }, 'Löschen') : null));
}

/* ======================= Import / Export ======================= */
function renderImport(body, ctx) {
  const text = h('textarea', { rows: 8, placeholder: 'JSON oder CSV hier einfügen …' });
  const file = h('input', { type: 'file', accept: '.json,.csv,.txt,application/json,text/csv,text/plain', onchange: async () => { if (file.files[0]) { text.value = await readFileText(file.files[0]); check(); } } });
  const result = h('div');
  let parsed = null;

  function check() {
    parsed = parseContent(text.value);
    const p = parsed;
    if (p.backup) {
      mount(result, h('div', { class: 'card' }, h('b', null, 'Backup erkannt'),
        h('p', null, `${p.backup.cards?.length || 0} Karten, ${p.backup.examQuestions?.length || 0} Prüfungsfragen, ${p.backup.progress?.length || 0} Fortschrittseinträge.`),
        h('button', { class: 'btn primary', onclick: async () => { if (!confirm('Backup einspielen? Vorhandene Einträge mit gleicher ID werden überschrieben.')) return; await restoreBackup(p.backup); toast('Backup eingespielt'); mount(result); text.value = ''; } }, 'Backup wiederherstellen')));
      return;
    }
    mount(result,
      h('div', { class: 'card' },
        h('b', null, `${p.cards.length} Karten und ${p.exams.length} Prüfungsfragen gültig`),
        p.errors.length ? h('div', { class: 'banner', style: { marginTop: '.6rem' } },
          h('b', null, `${p.errors.length} Hinweis(e):`), h('ul', { style: { margin: '.3rem 0 0', paddingLeft: '1.2rem' } }, p.errors.slice(0, 15).map((e) => h('li', null, e))),
          p.errors.length > 15 ? h('div', { class: 'small' }, `… und ${p.errors.length - 15} weitere`) : null) : null,
        (p.cards.length || p.exams.length) ? h('button', { class: 'btn primary', style: { marginTop: '.8rem' }, onclick: doImport }, 'Jetzt importieren') : null));
  }
  async function doImport() {
    const s = await applyImport(parsed);
    mount(result, h('div', { class: 'card' }, h('b', null, 'Import abgeschlossen'),
      h('p', null, `Karten: ${s.cardsAdded} neu, ${s.cardsUpdated} aktualisiert, ${s.cardsSame} unverändert.`),
      h('p', null, `Prüfungsfragen: ${s.examsAdded} neu, ${s.examsUpdated} aktualisiert, ${s.examsSame} unverändert.`),
      h('p', { class: 'muted small' }, 'Lernfortschritt bleibt erhalten.')));
    text.value = ''; file.value = '';
  }

  const loadSample = async () => {
    try { text.value = await (await fetch('examples/beispiel-komplett.json')).text(); check(); }
    catch { toast('Beispieldaten nicht verfügbar'); }
  };
  const copyPrompt = async () => {
    try {
      const t = await (await fetch('examples/ki-prompt.txt')).text();
      await navigator.clipboard.writeText(t); toast('KI-Prompt kopiert');
    } catch { toast('Kopieren nicht möglich – Datei examples/ki-prompt.txt öffnen'); }
  };
  const stamp = dayKey();

  mount(body,
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Import (JSON oder CSV)'),
      field('Datei auswählen', file), text,
      h('div', { class: 'grid2', style: { marginTop: '.6rem' } },
        h('button', { class: 'btn', onclick: check }, 'Prüfen'),
        h('button', { class: 'btn ghost', onclick: loadSample }, 'Beispieldaten')),
      h('p', { class: 'muted small' }, 'Gleiche IDs aktualisieren vorhandene Einträge, neue werden ergänzt. Dein Lernfortschritt bleibt dabei erhalten.'),
      result),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Inhalte mit KI aufbereiten'),
      h('p', { class: 'muted' }, 'Kopiere den Prompt, gib ihn zusammen mit deinem Lernstoff einer KI deiner Wahl und füge das Ergebnis oben ein.'),
      h('button', { class: 'btn', onclick: copyPrompt }, 'KI-Prompt kopieren'),
      h('div', { class: 'row wrap', style: { marginTop: '.6rem' } },
        h('a', { class: 'btn small ghost', href: 'examples/beispiel-komplett.json', download: 'beispiel-komplett.json' }, 'Beispiel JSON'),
        h('a', { class: 'btn small ghost', href: 'examples/beispiel-quiz.csv', download: 'beispiel-quiz.csv' }, 'Beispiel CSV Quiz'),
        h('a', { class: 'btn small ghost', href: 'examples/beispiel-pruefung.csv', download: 'beispiel-pruefung.csv' }, 'Beispiel CSV Prüfung'))),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Export / Backup'),
      h('p', { class: 'muted' }, 'Alles bleibt lokal: Die Datei landet in deinen Downloads.'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => downloadText(`lernapp-backup-${stamp}.json`, JSON.stringify(exportBackup())) }, 'Backup (Inhalte + Lernfortschritt)'),
        h('button', { class: 'btn', onclick: () => downloadText(`lernapp-inhalte-${stamp}.json`, JSON.stringify(exportContent(), null, 2)) }, 'Nur Inhalte (ohne Fortschritt)'))));
}
