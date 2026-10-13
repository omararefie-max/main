/* Modul 3: Simulation einer mündlichen Prüfung.
 * Ablauf: Einstiegsfrage (Sprache + Text) → Antwort per Stimme (oder Text) → lokale Bewertung über Schlüsselbegriffe
 *         → bei Lücken EINE Nachfrage → nächste Frage … → Prüfungsprotokoll (wird gespeichert, Verlauf in „Statistik“). */
import { h, toast, shuffle, fmtDate, fmtDur, pct } from '../util.js';
import { S, saveSession, saveSettings } from '../store.js';
import {
  speak, cancelSpeech, ttsSupported, ttsErrorMessage, listen, sttSupported, sttErrorMessage, startKeepAlive, stopKeepAlive
} from '../speech.js';
import { evaluate, gradeFor, feedbackFor, GENERIC_FOLLOWUP } from '../score.js';
import { aiEvaluate } from '../ai-hook.js';
import { filterControls, filterItems, emptyHint } from './filters.js';

let filters = { subject: '', topic: '', chapter: '' };
let run = null;
let last = null;       // zuletzt beendete Prüfung (Protokoll-Ansicht)

export function render(root, ctx) {
  if (run) renderRun(root, ctx);
  else if (last) renderProtocolScreen(root, ctx);
  else renderSetup(root, ctx);
  return () => { if (run) abort(); };
}

/* ---------------- Start ---------------- */
function renderSetup(root, ctx) {
  const pool = filterItems(S.oral, filters);
  const st = S.settings;
  const cfg = { n: Math.min(st.examQuestions, Math.max(1, pool.length)), min: st.examMinutes, mode: sttSupported ? st.examInput : 'text' };
  root.replaceChildren(
    h('h2', {}, 'Mündliche Prüfung'),
    S.oral.length ? null : emptyHint('Prüfungsfragen'),
    !sttSupported ? h('div', { class: 'banner warn' }, 'Spracherkennung wird von diesem Browser nicht unterstützt – du kannst deine Antworten tippen.') : null,
    h('p', { class: 'muted' }, 'Die App stellt Fragen, hört deine freie Antwort und vergleicht sie mit den hinterlegten Pflichtpunkten.'),
    filterControls(S.oral, filters, ctx.rerender),
    h('p', { class: 'muted small' }, `${pool.length} Prüfungsfragen in dieser Auswahl`),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, 'Anzahl Fragen', h('input', { type: 'number', min: 1, max: 100, value: cfg.n, oninput: (e) => { cfg.n = Math.max(1, +e.target.value || 1); } })),
      h('label', { class: 'field' }, 'Dauer (Min.)', h('input', { type: 'number', min: 1, max: 180, value: cfg.min, oninput: (e) => { cfg.min = Math.max(1, +e.target.value || 1); } }))),
    h('label', { class: 'field' }, 'Antwort-Eingabe', h('select', { onchange: (e) => { cfg.mode = e.target.value; } },
      [['voice', 'Per Sprache'], ['text', 'Per Tastatur']].map(([v, t]) => h('option', { value: v, selected: cfg.mode === v, disabled: v === 'voice' && !sttSupported }, t)))),
    h('div', { class: 'sticky-actions' }, h('button', { class: 'btn primary', disabled: !pool.length, onclick: () => start(pool, cfg, ctx) }, 'Prüfung beginnen')),
    S.sessions.length ? h('p', { class: 'muted small' }, 'Frühere Prüfungen findest du unter „Statistik“.') : null
  );
}

function start(pool, cfg, ctx) {
  saveSettings({ examQuestions: cfg.n, examMinutes: cfg.min, examInput: cfg.mode });
  const R = {
    queue: shuffle(pool).slice(0, cfg.n), i: 0, items: [], start: Date.now(), deadline: Date.now() + cfg.min * 60000,
    mode: cfg.mode, speak: ttsSupported, stop: false, listener: null, textResolve: null, skip: false, ui: {}, endedByTime: false, minutes: cfg.min
  };
  run = R; last = null;
  if (S.settings.keepAlive) startKeepAlive({ title: 'Mündliche Prüfung' });
  ctx.rerender();
  execute(R, ctx).catch((e) => { console.error(e); toast('Fehler: ' + e.message, 6000); abort(); ctx.rerender(); });
}

/* ---------------- Laufende Prüfung ---------------- */
function renderRun(root, ctx) {
  const R = run;
  const ui = R.ui = {
    count: h('span', {}), timer: h('span', { class: 'big-timer' }),
    status: h('div', { class: 'status-pill' }, 'Die Prüfung beginnt …'),
    q: h('h2', { class: 'question' }), transcript: h('div', { class: 'transcript' }, ''),
    textarea: h('textarea', { placeholder: 'Deine Antwort …', rows: 6, hidden: R.mode !== 'text' }),
    error: h('div', { class: 'banner bad', hidden: true }),
    finish: h('button', { class: 'btn primary', onclick: () => finishAnswer(R, false) }, 'Antwort beenden')
  };
  ui.transcript.hidden = R.mode === 'text';
  root.replaceChildren(
    h('div', { class: 'q-head' }, ui.count, h('span', {}, '⏱ ', ui.timer)),
    ui.status, ui.error, ui.q, ui.transcript, ui.textarea,
    h('div', { class: 'sticky-actions stack' }, ui.finish,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => finishAnswer(R, true) }, 'Überspringen'),
        h('button', { class: 'btn danger', onclick: () => { if (confirm('Prüfung abbrechen? Bisherige Antworten gehen verloren.')) { abort(); last = null; ctx.rerender(); } } }, 'Abbrechen')))
  );
  tick(R); R.tick ||= setInterval(() => tick(R), 1000);
  if (R.prompt) ui.q.textContent = R.prompt;
}

function tick(R) {
  const left = Math.max(0, Math.round((R.deadline - Date.now()) / 1000));
  if (R.ui.timer?.isConnected) { R.ui.timer.textContent = fmtDur(left); R.ui.timer.style.color = left < 60 ? 'var(--bad)' : ''; }
}

const setStatus = (R, t, cls = '') => { if (R.ui.status?.isConnected) { R.ui.status.textContent = t; R.ui.status.className = 'status-pill ' + cls; } };

function abort() {
  const R = run; if (!R) return;
  R.stop = true; clearInterval(R.tick); cancelSpeech(); R.listener?.stop(); R.textResolve?.(null); stopKeepAlive(); run = null;
}

/** „Antwort beenden“ / „Überspringen“ */
function finishAnswer(R, skip) {
  R.skip = skip;
  if (skip) cancelSpeech();
  if (R.listener) R.listener.stop();
  if (R.textResolve) R.textResolve(skip ? '' : R.ui.textarea.value);
}

async function execute(R, ctx) {
  /* Frage stellen und Antwort aufnehmen. Gibt Text zurück oder null bei Abbruch. */
  const capture = async (prompt) => {
    const ui = R.ui;
    R.prompt = prompt; R.skip = false;
    ui.q.textContent = prompt; ui.transcript.textContent = ''; ui.textarea.value = '';
    if (R.speak) {
      setStatus(R, 'Der Prüfer spricht …', 'speak');
      try { await speak(prompt, { rate: S.settings.ttsRate, voiceURI: S.settings.ttsVoice }); }
      catch (e) { R.speak = false; toast(ttsErrorMessage(e), 5000); }
    }
    if (R.stop) return null;
    if (R.skip) return '';                           // während der Fragestellung übersprungen
    if (R.mode === 'voice') {
      setStatus(R, '🎤 Bitte antworten – danach unten auf den Button tippen', 'listen');
      ui.transcript.hidden = false; ui.textarea.hidden = true;
      const l = listen({ lang: S.settings.recLang, continuous: true, silenceMs: 5000, maxMs: 180000, localOnly: S.settings.recLocalOnly,
        onInterim: (t) => { if (ui.transcript.isConnected) ui.transcript.textContent = t; } });
      R.listener = l;
      const r = await l.promise;
      R.listener = null;
      if (R.stop) return null;
      if (r.error && !r.transcript) {                 // Fehler (z. B. Mikrofon-Berechtigung) → automatisch auf Tastatur umschalten
        ui.error.hidden = false; ui.error.textContent = sttErrorMessage(r.error) + ' Du kannst weiter per Tastatur antworten.';
        R.mode = 'text';
      } else return R.skip ? '' : r.transcript;
    }
    ui.transcript.hidden = true; ui.textarea.hidden = false;
    setStatus(R, '⌨ Bitte antworten und danach auf den Button tippen');
    return await new Promise((res) => { R.textResolve = (t) => { R.textResolve = null; res(t); }; });
  };

  for (R.i = 0; R.i < R.queue.length; R.i++) {
    if (R.stop) return;
    if (Date.now() > R.deadline) { R.endedByTime = true; break; }
    const q = R.queue[R.i];
    R.ui.count.textContent = `Frage ${R.i + 1} / ${R.queue.length}`;
    const item = { qid: q.id, question: q.question, modelAnswer: q.modelAnswer, subject: q.subject, topic: q.topic, answers: [] };

    let text = await capture(q.question);
    if (text === null) return;
    const skipped = R.skip;
    item.answers.push({ prompt: q.question, text });
    let ev = await evalAnswer(q, text);

    if (!skipped && ev.percent < 80 && Date.now() < R.deadline) {          // Nachfrage bei fehlenden Punkten
      const fu = q.followUps?.length ? q.followUps[Math.floor(Math.random() * q.followUps.length)] : GENERIC_FOLLOWUP;
      const t2 = await capture(fu);
      if (t2 === null) return;
      item.answers.push({ prompt: fu, text: t2 });
      text = [text, t2].filter(Boolean).join(' ');
      ev = await evalAnswer(q, text);
    }
    Object.assign(item, { points: ev.points.map(({ text, hit, hits }) => ({ text, hit, hits })), percent: ev.percent, feedback: ev.feedback || '', transcript: text, skipped });
    R.items.push(item);

    if (R.speak && !R.stop && R.i < R.queue.length - 1) {
      setStatus(R, 'Der Prüfer spricht …', 'speak');
      try { await speak('Danke. Nächste Frage.', { rate: S.settings.ttsRate, voiceURI: S.settings.ttsVoice }); } catch { /* egal */ }
    }
  }
  await conclude(R, ctx);
}

async function evalAnswer(q, text) {
  const local = evaluate(q, text);
  if (!S.settings.aiEndpoint) return local;
  try {
    const ai = await aiEvaluate(q, text, S.settings);
    if (!ai) return local;
    if (Array.isArray(ai.covered)) local.points.forEach((p, i) => { if (typeof ai.covered[i] === 'boolean') p.hit = ai.covered[i]; });
    if (typeof ai.percent === 'number') { local.percent = Math.max(0, Math.min(100, Math.round(ai.percent))); }
    else local.percent = Math.round((local.points.filter((p) => p.hit).length / Math.max(1, local.points.length)) * 100);
    local.feedback = ai.feedback || '';
    return local;
  } catch (e) { toast('KI-Bewertung fehlgeschlagen – lokale Bewertung wird genutzt.', 4000); return local; }
}

async function conclude(R, ctx) {
  clearInterval(R.tick); cancelSpeech(); stopKeepAlive();
  const n = R.items.length;
  const percent = n ? Math.round(R.items.reduce((a, i) => a + i.percent, 0) / n) : 0;
  const session = {
    ts: R.start, durationSec: Math.round((Date.now() - R.start) / 1000), subject: filters.subject, topic: filters.topic,
    items: R.items, planned: R.queue.length, endedByTime: R.endedByTime, percent, grade: gradeFor(percent), feedback: feedbackFor(percent)
  };
  if (n) await saveSession(session);
  run = null; last = session;
  ctx.rerender();
  if (ttsSupported && n) { try { await speak(`Die Prüfung ist beendet. Ergebnis: ${percent} Prozent, Note ${session.grade.note}.`, { rate: S.settings.ttsRate, voiceURI: S.settings.ttsVoice }); } catch { /* egal */ } }
}

/* ---------------- Protokoll ---------------- */
function renderProtocolScreen(root, ctx) {
  root.replaceChildren(
    last.items.length ? protocolView(last) : h('div', { class: 'banner warn' }, 'Es wurde keine Frage beantwortet.'),
    h('div', { class: 'sticky-actions' }, h('button', { class: 'btn primary', onclick: () => { last = null; ctx.rerender(); } }, 'Neue Prüfung')));
}

/** Prüfungsprotokoll: Transkript, Bewertung pro Frage, Verbesserungsempfehlungen. (Auch von der Statistik genutzt.) */
export function protocolView(s) {
  const weak = s.items.filter((i) => i.percent < 80);
  return h('div', {},
    h('div', { class: 'score-hero' }, h('div', { class: 'big' }, s.percent + ' %'), h('div', {}, h('b', {}, `Note ${s.grade.note} – ${s.grade.label}`)),
      h('p', { class: 'muted' }, s.feedback), h('div', { class: 'muted small' }, `${fmtDate(s.ts)} · ${fmtDur(s.durationSec)} Min. · ${s.items.length} von ${s.planned} Fragen`)),
    s.endedByTime ? h('div', { class: 'banner warn' }, 'Die Zeit war abgelaufen – verbleibende Fragen wurden nicht gestellt.') : null,
    h('h3', {}, 'Bewertung pro Frage'),
    s.items.map((i) => h('details', {},
      h('summary', {}, h('span', { class: i.percent >= 80 ? 'tag-ok' : 'tag-bad' }, i.percent + ' %'), i.question),
      h('ul', { class: 'points' }, i.points.map((p) => h('li', { class: p.hit ? '' : 'miss' }, p.text))),
      i.feedback ? h('p', { class: 'muted' }, i.feedback) : null,
      h('h3', {}, 'Transkript'),
      i.answers.map((a) => h('p', {}, h('span', { class: 'muted small' }, a.prompt === i.question ? 'Antwort: ' : `Auf „${a.prompt}“: `), a.text || h('i', { class: 'muted' }, '(keine Antwort)'))),
      i.modelAnswer ? h('details', {}, h('summary', {}, 'Musterantwort'), h('p', { class: 'explain' }, i.modelAnswer)) : null)),
    h('h3', { style: 'margin-top:1.2rem' }, 'Verbesserungsempfehlungen'),
    weak.length
      ? h('ul', {}, weak.map((i) => h('li', {}, h('b', {}, (i.topic || i.question.slice(0, 50)) + ': '),
        i.points.some((p) => !p.hit) ? 'Wiederhole – ' + i.points.filter((p) => !p.hit).map((p) => p.text).join('; ') : 'Antworte ausführlicher und nutze die Fachbegriffe.')))
      : h('p', { class: 'muted' }, 'Keine – alle Antworten waren stark. Erhöhe als Nächstes die Schwierigkeit oder die Fragenzahl.'),
    h('p', { class: 'muted small' }, 'Hinweis: Die Bewertung vergleicht Schlüsselbegriffe lokal und kann Synonyme oder Erkennungsfehler übersehen. Prüfe fehlende Punkte kritisch.'));
}
