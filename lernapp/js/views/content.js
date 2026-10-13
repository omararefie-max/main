/* Inhalte: Import (JSON/CSV), Export/Backup, Editor, Verwaltung.
 * Re-Import überschreibt Karten mit gleicher ID, ergänzt neue – der Lernfortschritt hängt an der ID und bleibt erhalten. */
import { h, toast, download, readFileText, LETTERS } from '../util.js';
import { S, upsertCards, upsertOral, removeCard, removeOral, exportBackup, exportContent, restoreBackup } from '../store.js';
import { parseContent, normalizeCard, normalizeOral, keyPointsToText } from '../importer.js';

let kind = 'cards';       // Verwaltung: 'cards' | 'oral'
let query = '';
let shown = 40;
let importOut = null;     // letzte Import-Meldung

export function render(root, ctx) {
  const input = h('textarea', { placeholder: 'JSON oder CSV hier einfügen …', rows: 5 });
  const file = h('input', { type: 'file', accept: '.json,.csv,.txt,application/json,text/csv,text/plain', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await doImport(await readFileText(f), ctx); } catch (err) { toast('Datei konnte nicht gelesen werden: ' + err.message, 5000); }
    e.target.value = '';
  } });
  const restoreFile = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await doImport(await readFileText(f), ctx, true); } catch (err) { toast('Fehler: ' + err.message, 5000); }
    e.target.value = '';
  } });

  root.replaceChildren(
    h('h2', {}, 'Inhalte importieren'),
    h('div', { class: 'box stack' },
      h('p', { class: 'muted small' }, `Aktuell: ${S.cards.length} Karten · ${S.oral.length} Prüfungsfragen`),
      file, h('button', { class: 'btn primary', onclick: () => file.click() }, '📂 Datei auswählen (JSON / CSV)'),
      input, h('button', { class: 'btn', onclick: () => doImport(input.value, ctx).then(() => { input.value = ''; }) }, 'Aus eingefügtem Text importieren'),
      h('button', { class: 'btn ghost', onclick: loadExample(ctx) }, 'Beispieldaten laden (Medizin/Pflege)'),
      importOut),
    h('h3', {}, 'Formate & Vorlagen'),
    h('div', { class: 'box stack' },
      h('p', { class: 'muted small' }, 'Diese Dateien zeigen das Datenformat – auch geeignet, um eine KI Inhalte passend aufbereiten zu lassen (siehe „KI-Prompt“).'),
      link('data/beispiel-inhalte.json', 'Beispiel (JSON)'), link('data/schema.json', 'JSON-Schema'),
      link('data/vorlage-quiz.csv', 'CSV-Vorlage Quiz'), link('data/vorlage-pruefung.csv', 'CSV-Vorlage Prüfung'), link('data/ki-prompt.txt', 'KI-Prompt (Text)')),
    h('h3', {}, 'Backup'),
    h('div', { class: 'box stack' },
      h('button', { class: 'btn', onclick: () => { download(`lernapp-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportBackup())); toast('Backup gespeichert (Downloads).'); } }, '💾 Alles sichern (Inhalte + Fortschritt)'),
      h('button', { class: 'btn ghost', onclick: () => { download(`lernapp-inhalte-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportContent(), null, 2)); } }, 'Nur Inhalte exportieren'),
      restoreFile, h('button', { class: 'btn ghost', onclick: () => restoreFile.click() }, 'Backup wiederherstellen …')),
    h('h3', {}, 'Verwalten & bearbeiten'),
    manage(ctx)
  );
}

const link = (href, label) => h('a', { class: 'btn ghost', href, download: href.split('/').pop() }, '⬇ ' + label);

function loadExample(ctx) {
  return async () => {
    try { await doImport(await (await fetch('data/beispiel-inhalte.json')).text(), ctx); }
    catch (e) { toast('Beispieldaten nicht ladbar: ' + e.message, 5000); }
  };
}

async function doImport(text, ctx, onlyBackup = false) {
  const res = parseContent(text);
  if (res.backup) {
    if (!confirm('Dies ist ein vollständiges Backup. Wiederherstellen ERSETZT alle aktuellen Inhalte und den Lernfortschritt. Fortfahren?')) return;
    await restoreBackup(res.backup);
    importOut = h('div', { class: 'banner ok' }, `Backup wiederhergestellt: ${S.cards.length} Karten, ${S.oral.length} Prüfungsfragen.`);
    return ctx.rerender();
  }
  if (onlyBackup) { toast('Das ist kein Backup (Format lernapp-backup/1).', 5000); return; }
  const a = await upsertCards(res.cards), b = await upsertOral(res.oral);
  const ok = a.added + a.updated + b.added + b.updated > 0;
  importOut = h('div', { class: 'banner ' + (res.errors.length ? (ok ? 'warn' : 'bad') : 'ok') },
    h('div', {}, h('b', {}, ok ? 'Import abgeschlossen. ' : 'Nichts importiert. '),
      `Karten: ${a.added} neu, ${a.updated} aktualisiert · Prüfungsfragen: ${b.added} neu, ${b.updated} aktualisiert`),
    res.errors.length ? h('details', { open: !ok }, h('summary', {}, `${res.errors.length} Problem(e)`), h('pre', { class: 'out' }, res.errors.slice(0, 50).join('\n'))) : null);
  ctx.rerender();
}

/* ---------------- Verwaltung ---------------- */
function manage(ctx) {
  const items = kind === 'cards' ? S.cards : S.oral;
  const q = query.trim().toLowerCase();
  const hit = q ? items.filter((c) => [c.question, c.subject, c.topic, c.chapter, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(q)) : items;
  const sorted = [...hit].sort((a, b) => (a.subject + a.topic + a.chapter).localeCompare(b.subject + b.topic + b.chapter, 'de'));
  const box = h('div', {});
  box.append(
    h('div', { class: 'row' },
      h('button', { class: 'btn small ' + (kind === 'cards' ? 'primary' : 'ghost'), onclick: () => { kind = 'cards'; shown = 40; ctx.rerender(); } }, `Karten (${S.cards.length})`),
      h('button', { class: 'btn small ' + (kind === 'oral' ? 'primary' : 'ghost'), onclick: () => { kind = 'oral'; shown = 40; ctx.rerender(); } }, `Prüfungsfragen (${S.oral.length})`)),
    h('div', { style: 'height:.6rem' }),
    h('input', { type: 'search', placeholder: 'Suchen (Frage, Thema, Tag) …', value: query, oninput: (e) => { query = e.target.value; shown = 40; ctx.rerender(); const el = document.querySelector('input[type=search]'); el?.focus(); el?.setSelectionRange(query.length, query.length); } }),
    h('div', { style: 'height:.6rem' }),
    h('button', { class: 'btn', onclick: () => openEditor(null, ctx) }, kind === 'cards' ? '＋ Neue Karte' : '＋ Neue Prüfungsfrage'),
    h('div', { style: 'height:.8rem' }),
    sorted.slice(0, shown).map((c) => h('button', { class: 'list-item', onclick: () => openEditor(c, ctx) }, c.question.length > 110 ? c.question.slice(0, 110) + '…' : c.question,
      h('small', {}, [c.subject, c.topic, c.chapter].filter(Boolean).join(' › ') || 'Ohne Thema'))),
    sorted.length > shown ? h('button', { class: 'btn ghost', onclick: () => { shown += 60; ctx.rerender(); } }, `Mehr anzeigen (${sorted.length - shown} weitere)`) : null,
    !sorted.length ? h('p', { class: 'muted' }, 'Keine Einträge.') : null
  );
  return box;
}

/* ---------------- Editor ---------------- */
function openEditor(item, ctx) {
  const isCard = kind === 'cards';
  const it = item || (isCard ? { answers: ['', '', '', '', ''], correct: [], tags: [] } : { keyPoints: [], followUps: [], tags: [] });
  const dlg = h('dialog', { class: 'sheet' });
  const f = {};
  const field = (label, key, tag = 'input', val = it[key] ?? '') => (f[key] = h(tag, tag === 'textarea' ? { value: val } : { type: 'text', value: val }), h('label', { class: 'field' }, label, f[key]));

  const form = h('div', {},
    h('h2', {}, item ? 'Bearbeiten' : 'Neu anlegen'),
    h('div', { class: 'filters' }, field('Fach', 'subject'), field('Thema', 'topic'), field('Kapitel', 'chapter')),
    field(isCard ? 'Frage' : 'Fragetext', 'question', 'textarea'));

  if (isCard) {
    f.answers = [];
    f.correct = [];
    form.append(h('p', { class: 'muted small' }, 'Antworten A–E (Haken = richtig; mehrere Haken = Mehrfachauswahl):'));
    for (let i = 0; i < 5; i++) {
      f.answers[i] = h('input', { type: 'text', value: it.answers[i] || '' });
      f.correct[i] = h('input', { type: 'checkbox', checked: it.correct.includes(i) });
      form.append(h('div', { class: 'ans-edit' }, h('b', {}, LETTERS[i]), f.answers[i], f.correct[i]));
    }
    form.append(field('Erklärung zur richtigen Lösung', 'explanation', 'textarea'),
      h('label', { class: 'field' }, 'Schwierigkeit', (f.difficulty = h('select', {}, [['0', '–'], ['1', 'leicht'], ['2', 'mittel'], ['3', 'schwer']].map(([v, t]) => h('option', { value: v, selected: String(it.difficulty || 0) === v }, t))))));
  } else {
    form.append(field('Musterantwort', 'modelAnswer', 'textarea'),
      h('label', { class: 'field' }, 'Pflichtpunkte – eine Zeile je Punkt:  Text :: Begriff | Begriff | … :: Mindestanzahl (optional)',
        (f.keyPoints = h('textarea', { rows: 6, value: keyPointsToText(it.keyPoints) }))),
      h('label', { class: 'field' }, 'Nachfragen (eine pro Zeile, optional)', (f.followUps = h('textarea', { value: (it.followUps || []).join('\n') }))));
  }
  form.append(field('Tags (Komma-getrennt)', 'tags', 'input', (it.tags || []).join(', ')));

  const err = h('div', { class: 'banner bad', hidden: true });
  const save = async () => {
    try {
      const raw = { id: it.id, subject: f.subject.value, topic: f.topic.value, chapter: f.chapter.value, question: f.question.value, tags: f.tags.value };
      if (isCard) {
        Object.assign(raw, { answers: f.answers.map((x) => x.value), correct: f.correct.map((c, i) => (c.checked ? LETTERS[i] : null)).filter(Boolean), explanation: f.explanation.value, difficulty: f.difficulty.value });
        await upsertCards([normalizeCard(raw)]);
      } else {
        Object.assign(raw, { modelAnswer: f.modelAnswer.value, keyPoints: f.keyPoints.value, followUps: f.followUps.value.split('\n') });
        await upsertOral([normalizeOral(raw)]);
      }
      dlg.close(); toast('Gespeichert.'); ctx.rerender();
    } catch (e) { err.hidden = false; err.textContent = e.message; err.scrollIntoView({ block: 'center' }); }
  };
  form.append(err,
    h('div', { class: 'row', style: 'margin-top:1rem' },
      h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: save }, 'Speichern')),
    item ? h('button', { class: 'btn danger', style: 'margin-top:.8rem', onclick: async () => {
      if (!confirm('Wirklich löschen?' + (isCard ? ' Der Lernfortschritt dieser Karte geht verloren.' : ''))) return;
      await (isCard ? removeCard(it.id) : removeOral(it.id)); dlg.close(); toast('Gelöscht.'); ctx.rerender();
    } }, 'Löschen') : null);

  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
