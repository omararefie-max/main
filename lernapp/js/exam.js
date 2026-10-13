// Modul 3: Simulation einer mündlichen Prüfung.
//   renderExamHome   – Einstellungen (Bereich, Anzahl, Dauer) + Verlauf
//   renderExamRun    – Prüfungsgespräch: Frage -> Antwort (Sprache oder Text) -> ggf. Nachfrage -> nächste Frage
//   renderExamResult – Prüfungsprotokoll mit Transkript, Bewertung pro Frage, Empfehlungen
//
// Bewertung: standardmäßig lokal über Schlüsselbegriffe (evaluate.js); optional KI (ai.js).

import { state, examList, filterScope, saveExam } from './store.js';
import { evaluateLocal, feedbackText } from './evaluate.js';
import { aiConfigured, evaluateWithAI } from './ai.js';
import { speak, cancel, ttsSupported } from './tts.js';
import { listenLong, sttSupported } from './stt.js';
import { keepAwake, beep } from './device.js';
import { h, mount, shuffle, fmtDur, fmtDate, grade, pickRandom, downloadText } from './util.js';
import { field, switchRow, scopePicker, emptyState, toast } from './ui.js';
import { icon } from './icons.js';

const ABORT = Symbol('abort');
const GENERIC_FOLLOWUP = 'Können Sie das bitte genauer erläutern?';
const THANKS = ['Danke.', 'Vielen Dank.', 'In Ordnung, danke.'];
const PASS_FOR_NO_FOLLOWUP = 70; // ab diesem Prozentwert wird nicht nachgefragt

/* ============================ Startseite ============================ */
export function renderExamHome(view, ctx) {
  const qs = examList();
  if (!qs.length) {
    mount(view, h('h1', null, 'Mündliche Prüfung'), emptyState(
      'Noch keine Prüfungsfragen. Importiere einen Prüfungsdatensatz (Fragen mit Musterantwort und Schlüsselbegriffen).',
      h('a', { class: 'btn primary', href: '#/content/import' }, 'Inhalte importieren')));
    return;
  }
  const S = state.settings;
  const picker = scopePicker(qs);
  const count = h('input', { type: 'number', min: 1, max: 100, value: S.examQuestions, inputMode: 'numeric' });
  const mins = h('input', { type: 'number', min: 1, max: 240, value: S.examMinutes, inputMode: 'numeric' });
  let followUps = true;
  const hist = state.examHistory.slice().reverse();

  mount(view,
    h('h1', null, 'Mündliche Prüfung'),
    !ttsSupported ? h('div', { class: 'banner info' }, 'Sprachausgabe nicht verfügbar – die Fragen erscheinen nur als Text.') : null,
    !sttSupported ? h('div', { class: 'banner info' }, 'Spracherkennung nicht verfügbar – du kannst deine Antworten tippen. (Für Sprache: Chrome auf Android.)') : null,
    h('div', { class: 'card' },
      picker.el,
      h('div', { class: 'grid2' }, field('Anzahl Fragen', count), field('Dauer (Minuten)', mins)),
      switchRow('Nachfragen stellen', true, (v) => { followUps = v; }, 'Bei fehlenden Punkten fragt der Prüfer nach.'),
      h('button', {
        class: 'btn primary', style: { marginTop: '.6rem' },
        onclick: () => ctx.go('/exam/run', { scope: picker.get(), questions: Math.max(1, +count.value || 8), minutes: Math.max(1, +mins.value || 15), followUps }),
      }, icon('play'), 'Prüfung beginnen')),
    hist.length ? [
      h('h2', null, 'Dein Verlauf'),
      h('div', { class: 'card' }, trend(state.examHistory.map((e) => e.percent)), h('div', { class: 'muted small' }, `${state.examHistory.length} Prüfung(en) · Ø ${Math.round(state.examHistory.reduce((a, e) => a + e.percent, 0) / state.examHistory.length)}%`)),
      hist.slice(0, 10).map((e) => h('a', { class: 'list-item', style: { textDecoration: 'none' }, href: `#/exam/result/${e.id}` },
        h('div', { class: 'row between' }, h('b', null, `${e.percent}% · Note ${e.grade}`), h('span', { class: 'muted small' }, fmtDate(e.ts))),
        h('div', { class: 'muted small' }, `${e.items.length} Fragen · ${fmtDur(e.seconds)} min`))),
    ] : null);
}

/** Kleine Verlaufskurve als SVG (Werte 0–100). */
function trend(values) {
  const el = h('div');
  if (values.length < 2) { el.append(h('div', { class: 'muted small' }, 'Ab der zweiten Prüfung siehst du hier deine Entwicklung.')); return el; }
  const W = 300, H = 70, pad = 6;
  const pts = values.map((v, i) => `${pad + (i * (W - 2 * pad)) / (values.length - 1)},${H - pad - (v / 100) * (H - 2 * pad)}`);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Verlauf der Prüfungsergebnisse">
    <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>
    ${pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3.5" fill="var(--accent)"/>`).join('')}</svg>`;
  return el;
}

/* ============================ Prüfungsgespräch ============================ */
export function renderExamRun(view, ctx) {
  const cfg = ctx.cfg;
  const S = state.settings;
  const questions = shuffle(filterScope(examList(), cfg.scope)).slice(0, cfg.questions);
  if (!questions.length) {
    mount(view, emptyState('Keine Prüfungsfragen im gewählten Bereich.', h('button', { class: 'btn', onclick: () => ctx.go('/exam') }, 'Zurück')));
    return;
  }

  const startedAt = Date.now();
  const endAt = startedAt + cfg.minutes * 60000;
  const items = [];
  let aborted = false, leaving = false, timeUp = false, listenerFailed = !sttSupported;
  const H = { mic: null, submit: null, skip: null, abort: null, repeat: null }; // aktuell aktive Aktionen

  /* ----- UI ----- */
  const counter = h('span', { class: 'muted' });
  const timerEl = h('span', { class: 'timer' });
  const bar = h('div', { style: { width: '0%' } });
  const pulse = h('span', { class: 'pulse' });
  const statusText = h('span', null, 'Starte …');
  const label = h('div', { class: 'muted small' });
  const qText = h('div', { class: 'question' });
  const errBox = h('div', { class: 'banner', hidden: true });
  const ta = h('textarea', { rows: 6, placeholder: sttSupported ? 'Deine Antwort erscheint hier, sobald du sprichst. Du kannst auch tippen oder korrigieren.' : 'Tippe deine Antwort …', 'aria-label': 'Deine Antwort' });
  const micBtn = h('button', { class: 'btn', onclick: () => H.mic?.() }, icon('exam'), 'Sprechen');
  const submitBtn = h('button', { class: 'btn primary', onclick: () => H.submit?.() }, icon('check'), 'Antwort abgeben');
  const repeatBtn = h('button', { class: 'btn ghost', onclick: () => H.repeat?.() }, icon('repeat'), 'Frage wiederholen');
  const skipBtn = h('button', { class: 'btn ghost', onclick: () => H.skip?.() }, 'Überspringen');
  const refreshButtons = () => {
    submitBtn.disabled = !H.submit; skipBtn.disabled = !H.skip; repeatBtn.disabled = !H.repeat;
    micBtn.disabled = !H.mic || !sttSupported || listenerFailed;
  };
  const setStatus = (kind, text) => { pulse.className = 'pulse ' + (kind || ''); statusText.textContent = text; };
  const setMicLabel = (on) => mount(micBtn, icon(on ? 'stop' : 'exam'), on ? 'Stopp' : 'Sprechen');

  mount(view,
    h('div', { class: 'session-head' },
      h('button', { class: 'btn ghost', onclick: () => { if (confirm('Prüfung beenden? Bisherige Antworten werden ausgewertet.')) H.abort?.(); } }, 'Beenden'),
      h('div', { class: 'grow' }, h('div', { class: 'progressbar' }, bar)), counter, timerEl),
    h('div', { class: 'status' }, pulse, statusText),
    errBox,
    h('div', { class: 'bubble examiner' }, label, qText),
    ta,
    h('div', { class: 'actionbar stack' },
      h('div', { class: 'grid2' }, micBtn, submitBtn),
      h('div', { class: 'grid2' }, repeatBtn, skipBtn)));
  refreshButtons();

  const tick = () => {
    const left = Math.round((endAt - Date.now()) / 1000);
    timerEl.textContent = fmtDur(left);
    timerEl.classList.toggle('low', left <= 60);
    if (left <= 0 && !timeUp) { timeUp = true; toast('Zeit abgelaufen – die aktuelle Frage wird noch beendet.', 4000); }
  };
  tick();
  const timerId = setInterval(tick, 1000);

  /* ----- Prüfer spricht ----- */
  async function say(text, kind = 'speak', status = 'Der Prüfer spricht …') {
    if (aborted) return false;
    setStatus(kind, status);
    const ok = await speak(text);
    return ok && !aborted;
  }

  /* ----- Antwort aufnehmen: liefert Text, '' (übersprungen) oder ABORT ----- */
  function capture(questionText) {
    return new Promise((resolve) => {
      ta.value = ''; ta.disabled = false;
      let listener = null, finished = false, base = '';
      const done = (val) => {
        if (finished) return; finished = true;
        listener?.abort(); listener = null; setMicLabel(false);
        H.mic = H.submit = H.skip = H.repeat = null; refreshButtons();
        resolve(val);
      };
      const startMic = () => {
        if (listener || listenerFailed) return;
        base = ta.value.trim() ? ta.value.trim() + ' ' : '';
        setStatus('listen', 'Ich höre zu – sprich deine Antwort'); setMicLabel(true); beep();
        listener = listenLong({
          silenceMs: (S.silenceSec || 0) * 1000,
          onUpdate: (t) => { ta.value = base + t; },
          onSilence: () => { if (ta.value.trim()) done(ta.value.trim()); else listener?.stop(); },
        });
        const mine = listener;
        mine.promise.then((r) => {
          if (finished || listener !== mine) return;
          listener = null; setMicLabel(false);
          if (r.error && r.error !== 'aborted') { errBox.hidden = false; errBox.textContent = r.message; if (r.fatal) { listenerFailed = true; refreshButtons(); } }
          setStatus('', 'Bereit – tippe auf „Antwort abgeben“, wenn du fertig bist');
        });
      };
      H.mic = () => (listener ? listener.stop() : startMic());
      H.submit = () => done(ta.value.trim());
      H.skip = () => done('');
      H.abort = () => done(ABORT);
      H.repeat = async () => { listener?.stop(); await say(questionText); if (!finished) { setStatus('', 'Bereit'); if (S.autoListen) startMic(); } };
      refreshButtons();
      if (S.autoListen && !listenerFailed) startMic(); else setStatus('', sttSupported && !listenerFailed ? 'Tippe auf „Sprechen“ oder schreibe deine Antwort' : 'Schreibe deine Antwort');
    });
  }

  async function evaluate(q, text) {
    if (aiConfigured()) {
      try { return await evaluateWithAI(q, text); }
      catch (e) { toast('KI-Bewertung fehlgeschlagen – lokale Bewertung wird verwendet.', 4000); console.warn(e); }
    }
    return evaluateLocal(text, q);
  }

  /* ----- Ablauf ----- */
  async function ask(q, qi) {
    counter.textContent = `${qi + 1} / ${questions.length}`;
    bar.style.width = `${(qi / questions.length) * 100}%`;
    label.textContent = `${q.deck} › ${q.topic}`;
    qText.textContent = q.question;
    errBox.hidden = true;

    await say(q.question);
    if (aborted) return ABORT;
    let transcript = await capture(q.question);
    if (transcript === ABORT) return ABORT;

    let ev = transcript ? await evaluate(q, transcript) : evaluateLocal('', q);
    const fups = [];
    const maxFollow = cfg.followUps ? Math.max(1, Math.min(2, q.followUps.length)) : 0;
    while (transcript && fups.length < maxFollow && ev.percent < PASS_FOR_NO_FOLLOWUP && !timeUp && !aborted) {
      const prompt = q.followUps[fups.length] || GENERIC_FOLLOWUP;
      label.textContent = 'Nachfrage';
      qText.textContent = prompt;
      await say(prompt);
      if (aborted) return ABORT;
      const more = await capture(prompt);
      if (more === ABORT) return ABORT;
      fups.push({ prompt, answer: more });
      if (!more) break;
      transcript = `${transcript} ${more}`.trim();
      ev = await evaluate(q, transcript);
    }
    items.push({
      id: q.id, deck: q.deck, topic: q.topic, question: q.question, modelAnswer: q.modelAnswer,
      transcript, followUps: fups, percent: ev.percent, engine: ev.engine,
      allPoints: q.keyPoints.map((k) => k.label),
      matched: ev.matched.map((m) => m.label), missing: ev.missing.map((m) => m.label),
      feedback: ev.feedback || feedbackText(ev),
    });
    return 'ok';
  }

  async function run() {
    await keepAwake(true);
    await say(`Guten Tag. Wir beginnen die mündliche Prüfung. Es sind ${questions.length} Fragen in ${cfg.minutes} Minuten vorgesehen.`);
    for (let qi = 0; qi < questions.length && !aborted; qi++) {
      if (Date.now() > endAt) { timeUp = true; }
      if (timeUp && qi > 0) break;
      const r = await ask(questions[qi], qi);
      if (r === ABORT) break;
      if (qi < questions.length - 1 && !timeUp) await say(pickRandom(THANKS) + ' Die nächste Frage.');
    }
    await finish();
  }

  async function finish() {
    clearInterval(timerId); keepAwake(false); cancel();
    if (!items.length) { ctx.go('/exam'); return; }
    const percent = Math.round(items.reduce((a, i) => a + i.percent, 0) / items.length);
    const rec = {
      id: Date.now(), ts: Date.now(), seconds: Math.round((Date.now() - startedAt) / 1000), percent, grade: grade(percent).n,
      planned: questions.length, minutes: cfg.minutes, items,
    };
    await saveExam(rec);
    if (leaving) return;
    if (!aborted) await say(`Die Prüfung ist beendet. Ihr Ergebnis: ${percent} Prozent.`, '', 'Prüfung beendet');
    if (!leaving) ctx.go(`/exam/result/${rec.id}`);
  }

  run().catch((e) => { console.error(e); errBox.hidden = false; errBox.textContent = 'Unerwarteter Fehler: ' + e.message; });

  return () => { leaving = true; aborted = true; clearInterval(timerId); cancel(); keepAwake(false); H.abort?.(); };
}

/* ============================ Protokoll ============================ */
export function renderExamResult(view, ctx) {
  const id = +ctx.params[0];
  const idx = state.examHistory.findIndex((e) => e.id === id);
  const e = state.examHistory[idx];
  if (!e) { ctx.go('/exam'); return; }
  const prev = idx > 0 ? state.examHistory[idx - 1] : null;
  const g = grade(e.percent);

  // Empfehlungen: Themen mit den meisten fehlenden Punkten zuerst
  const weak = e.items.filter((i) => i.missing.length).sort((a, b) => a.percent - b.percent);
  const recs = [];
  for (const i of weak.slice(0, 5)) recs.push(`${i.topic}: „${short(i.question)}“ – ergänze: ${i.missing.slice(0, 4).join(', ')}${i.missing.length > 4 ? ' …' : ''}.`);
  if (e.items.some((i) => !i.transcript)) recs.push('Bei übersprungenen Fragen: Musterantwort lesen und laut nachsprechen.');
  if (e.items.some((i) => i.transcript && i.transcript.split(/\s+/).length < 15)) recs.push('Einige Antworten waren sehr kurz – übe, in ganzen Sätzen und mit Fachbegriffen zu antworten.');
  if (!recs.length) recs.push('Sehr gut! Wiederhole die Fragen in einigen Tagen, damit das Wissen stabil bleibt.');

  const text = protocolText(e);
  mount(view,
    h('h1', null, 'Prüfungsprotokoll'),
    h('div', { class: 'card center' },
      h('div', { class: 'big-score' }, `${e.percent}%`),
      h('p', null, h('b', null, `Note ${g.n} – ${g.label}`)),
      h('p', { class: 'muted small' }, `${fmtDate(e.ts)} · ${e.items.length} von ${e.planned} Fragen · ${fmtDur(e.seconds)} min`),
      prev ? h('p', { class: 'small', style: { color: e.percent >= prev.percent ? 'var(--ok)' : 'var(--bad)' } },
        `${e.percent >= prev.percent ? '▲' : '▼'} ${Math.abs(e.percent - prev.percent)} Prozentpunkte gegenüber der letzten Prüfung`) : null),
    h('h2', null, 'Verbesserungsempfehlungen'),
    h('div', { class: 'card' }, h('ul', { style: { margin: 0, paddingLeft: '1.2rem' } }, recs.map((r) => h('li', { style: { margin: '.3rem 0' } }, r)))),
    h('h2', null, 'Bewertung pro Frage'),
    e.items.map((it, n) => h('details', { class: 'card', open: it.percent < PASS_FOR_NO_FOLLOWUP && n < 2 },
      h('summary', null, `${n + 1}. ${it.question}`, ' ', h('span', { class: 'chip ' + (it.percent >= 70 ? 'ok' : 'bad') }, `${it.percent}%`)),
      h('div', { style: { marginTop: '.6rem' } },
        h('p', { class: 'muted small' }, `${it.deck} › ${it.topic}${it.engine === 'ai' ? ' · KI-Bewertung' : ''}`),
        h('div', { class: 'bubble me' }, h('div', { class: 'muted small' }, 'Deine Antwort'), it.transcript || h('i', null, '(keine Antwort)')),
        it.followUps.map((f) => [h('div', { class: 'bubble examiner' }, h('div', { class: 'muted small' }, 'Nachfrage'), f.prompt), h('div', { class: 'bubble me' }, f.answer || h('i', null, '(keine Antwort)'))]),
        h('h3', null, 'Pflichtpunkte'),
        it.allPoints.map((p) => { const hit = it.matched.includes(p); return h('div', { class: 'kp ' + (hit ? 'hit' : 'miss') }, hit ? '✓' : '✗', p); }),
        h('p', { class: 'small' }, it.feedback),
        it.modelAnswer ? h('div', { class: 'bubble examiner' }, h('div', { class: 'muted small' }, 'Musterantwort'), it.modelAnswer) : null))),
    h('div', { class: 'stack', style: { marginTop: '1rem' } },
      h('button', { class: 'btn primary', onclick: () => ctx.go('/exam') }, 'Neue Prüfung / Verlauf'),
      h('button', { class: 'btn', onclick: () => downloadText(`pruefungsprotokoll-${new Date(e.ts).toISOString().slice(0, 10)}.txt`, text, 'text/plain') }, 'Protokoll als Textdatei sichern')));
}

const short = (s) => (s.length > 70 ? s.slice(0, 67) + '…' : s);

function protocolText(e) {
  const g = grade(e.percent);
  const lines = [`PRÜFUNGSPROTOKOLL – ${fmtDate(e.ts)}`, `Ergebnis: ${e.percent}% (Note ${g.n}, ${g.label}) · ${e.items.length}/${e.planned} Fragen · ${fmtDur(e.seconds)} min`, ''];
  e.items.forEach((it, n) => {
    lines.push(`${n + 1}. ${it.question}  [${it.percent}%]`, `   Deine Antwort: ${it.transcript || '(keine)'}`);
    it.followUps.forEach((f) => lines.push(`   Nachfrage: ${f.prompt}`, `   Antwort: ${f.answer || '(keine)'}`));
    lines.push(`   Genannt: ${it.matched.join(', ') || '–'}`, `   Fehlt: ${it.missing.join(', ') || '–'}`, `   Musterantwort: ${it.modelAnswer || '–'}`, '');
  });
  return lines.join('\n');
}
