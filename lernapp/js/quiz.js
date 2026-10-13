// Modul 1: Karteikarten-Quiz (Multiple Choice, 5 Antworten A–E).
//   renderLearn  – Startseite: Übersicht + Lernmodus wählen
//   renderQuiz   – laufende Sitzung (inkl. Prüfungsmodus mit Zeitlimit)
//   buildQueue   – Kartenauswahl nach Modus (wird auch vom Hörmodus genutzt)

import { state, cardList, filterScope, setSetting, saveSession } from './store.js';
import { recordAnswer, isDue, isNew, isWeak } from './srs.js';
import { h, mount, shuffle, fmtDur, grade, dayKey } from './util.js';
import { seg, scopePicker, field, emptyState, toast } from './ui.js';
import { icon } from './icons.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

export const MODES = [
  { value: 'srs', label: 'Fällige + neue' },
  { value: 'all', label: 'Alle Karten' },
  { value: 'weak', label: 'Schwache' },
  { value: 'new', label: 'Neue' },
  { value: 'exam', label: 'Prüfung' },
];

/** Antwort korrekt? (Mengenvergleich der Buchstaben) */
export function isCorrect(card, selected) {
  const a = [...selected].sort().join(''), b = [...card.correct].sort().join('');
  return a === b;
}

/** Wählt Karten nach Modus und Bereich aus und sortiert sie sinnvoll. */
export function buildQueue({ scope = {}, mode = 'srs', size = 20 }) {
  const cards = filterScope(cardList(), scope);
  const now = Date.now();
  const prog = (c) => state.progress.get(c.id);
  const byDue = (a, b) => prog(a).due - prog(b).due;
  const due = cards.filter((c) => isDue(prog(c), now)).sort(byDue);
  const fresh = () => shuffle(cards.filter((c) => isNew(prog(c))));
  let q;
  switch (mode) {
    case 'srs': q = [...due, ...fresh().slice(0, state.settings.maxNew)]; break;
    case 'all': {
      const rest = cards.filter((c) => !isNew(prog(c)) && !isDue(prog(c), now)).sort(byDue);
      q = [...due, ...fresh(), ...rest]; break;
    }
    case 'weak': {
      const score = (c) => { const p = prog(c); return p.wrong / p.seen + (p.lapses > 0 ? 0.2 : 0); };
      q = cards.filter((c) => isWeak(prog(c))).sort((a, b) => score(b) - score(a)); break;
    }
    case 'new': q = fresh(); break;
    default: q = shuffle(cards); // 'exam'
  }
  return q.slice(0, size);
}

/** Anzahl fälliger / neuer Karten für die Startseite. */
export function counts(scope = {}) {
  const cards = filterScope(cardList(), scope);
  const now = Date.now();
  let due = 0, fresh = 0, weak = 0;
  for (const c of cards) {
    const p = state.progress.get(c.id);
    if (isNew(p)) fresh++; else { if (isDue(p, now)) due++; if (isWeak(p)) weak++; }
  }
  return { total: cards.length, due, fresh, weak };
}

export function streak() {
  const days = new Set(state.reviews.map((r) => dayKey(r.ts)));
  state.examHistory.forEach((e) => days.add(dayKey(e.ts)));
  let n = 0, t = Date.now();
  if (!days.has(dayKey(t))) t -= 86400000; // heute noch nicht gelernt: Serie läuft bis gestern weiter
  while (days.has(dayKey(t))) { n++; t -= 86400000; }
  return n;
}

/* ============================ Startseite ============================ */
export function renderLearn(view, ctx) {
  const all = cardList();
  if (!all.length) {
    mount(view, h('h1', null, 'Lernen'), emptyState(
      'Noch keine Karten vorhanden. Spiele Inhalte ein oder lade die Beispieldaten, um die App auszuprobieren.',
      h('a', { class: 'btn primary', href: '#/content/import' }, 'Inhalte importieren'),
      h('a', { class: 'btn', href: '#/content/cards' }, 'Karte manuell anlegen')));
    return;
  }
  const c = counts();
  const sizeInput = h('input', { type: 'number', min: 1, max: 500, value: state.settings.sessionSize, inputMode: 'numeric' });
  const minInput = h('input', { type: 'number', min: 1, max: 240, value: 20, inputMode: 'numeric' });
  const picker = scopePicker(all);
  const modeSeg = seg(MODES, 'srs', (m) => { minRow.hidden = m !== 'exam'; hint.textContent = HINTS[m]; });
  const HINTS = {
    srs: 'Fällige Karten zuerst, dazu einige neue (empfohlen für den Alltag).',
    all: 'Alle Karten im Bereich, fällige und neue zuerst.',
    weak: 'Karten, die du oft falsch hattest.',
    new: 'Nur Karten, die du noch nie beantwortet hast.',
    exam: 'Zufällige Karten, kein Feedback bis zum Ende, mit Zeitlimit und Auswertung.',
  };
  const hint = h('p', { class: 'muted small' }, HINTS.srs);
  const minRow = field('Zeitlimit (Minuten)', minInput);
  minRow.hidden = true;

  const start = (cfg) => {
    const size = Math.max(1, Math.min(500, +sizeInput.value || 20));
    if (!cfg.skipSize) setSetting('sessionSize', size);
    ctx.go('/quiz', { size, minutes: +minInput.value || 20, ...cfg });
  };

  mount(view,
    h('h1', null, 'Lernen'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card stat' }, h('b', null, `${streak()}`), h('span', null, 'Tage in Folge')),
      h('div', { class: 'card stat' }, h('b', null, `${c.due}`), h('span', null, 'fällig'))),
    h('div', { class: 'grid2' },
      h('div', { class: 'card stat' }, h('b', null, `${c.fresh}`), h('span', null, 'neu')),
      h('div', { class: 'card stat' }, h('b', null, `${c.total}`), h('span', null, 'Karten gesamt'))),
    h('button', {
      class: 'btn primary', style: { marginBottom: '1rem' },
      onclick: () => start({ mode: c.due + c.fresh > 0 ? 'srs' : 'all', scope: {} }),
    }, icon('play'), c.due + c.fresh > 0 ? 'Jetzt lernen' : 'Alles nochmal durchgehen'),
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Eigene Sitzung'),
      picker.el,
      modeSeg.el, hint,
      field('Anzahl Karten', sizeInput),
      minRow,
      h('button', { class: 'btn', onclick: () => start({ mode: modeSeg.get(), scope: picker.get() }) }, 'Starten')));
}

/* ============================ Sitzung ============================ */
export function renderQuiz(view, ctx) {
  const cfg = ctx.cfg;
  const isExam = cfg.mode === 'exam';
  const queue = buildQueue(cfg);
  if (!queue.length) {
    mount(view, emptyState(cfg.mode === 'weak' ? 'Keine schwachen Karten – sehr gut!' : cfg.mode === 'new' ? 'Keine neuen Karten mehr.' : 'Keine passenden Karten gefunden.',
      h('button', { class: 'btn', onclick: () => ctx.go('/learn') }, 'Zurück')));
    return;
  }

  const results = [];            // {card, ok, selected}
  const requeued = new Set();
  let i = 0, startedAt = Date.now(), cardStart = 0, timerId = null, finished = false;
  const endAt = isExam ? Date.now() + cfg.minutes * 60000 : 0;

  const timerEl = h('span', { class: 'timer' });
  const bar = h('div', { style: { width: '0%' } });
  const counter = h('span', { class: 'muted' });
  const head = h('div', { class: 'session-head' },
    h('button', { class: 'btn ghost', onclick: () => { if (confirm('Sitzung beenden?')) finish(true); } }, 'Beenden'),
    h('div', { class: 'grow' }, h('div', { class: 'progressbar' }, bar)),
    counter, isExam ? timerEl : null);
  const body = h('div');
  mount(view, head, body);

  if (isExam) {
    const tick = () => {
      const left = Math.round((endAt - Date.now()) / 1000);
      timerEl.textContent = fmtDur(left);
      timerEl.classList.toggle('low', left <= 60);
      if (left <= 0) { toast('Zeit abgelaufen'); finish(false); }
    };
    tick(); timerId = setInterval(tick, 1000);
  }

  function show() {
    if (finished) return;
    if (i >= queue.length) return finish(false);
    const card = queue[i];
    counter.textContent = `${Math.min(i + 1, queue.length)} / ${queue.length}`;
    bar.style.width = `${(i / queue.length) * 100}%`;
    cardStart = Date.now();

    // Reihenfolge der Antworten (optional gemischt); Anzeige-Buchstaben folgen der Position
    const order = state.settings.shuffleAnswers ? shuffle([0, 1, 2, 3, 4]) : [0, 1, 2, 3, 4];
    const multi = card.correct.length > 1;
    const selected = new Set();   // Original-Buchstaben
    let answered = false;

    const optEls = order.map((orig, pos) => {
      const L = LETTERS[orig];
      const el = h('button', { class: 'opt', type: 'button', 'data-orig': L, onclick: () => pick(L, el) },
        h('span', { class: 'letter' }, LETTERS[pos]), h('span', null, card.options[orig]));
      return el;
    });
    const action = h('div', { class: 'actionbar' });
    const feedbackBox = h('div');
    const checkBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => (isExam ? next() : check()) }, isExam ? 'Weiter' : 'Prüfen');

    function pick(L, el) {
      if (answered) return;
      if (multi || isExam) {
        if (selected.has(L)) { selected.delete(L); el.classList.remove('sel'); }
        else {
          if (!multi) { selected.clear(); optEls.forEach((o) => o.classList.remove('sel')); }
          selected.add(L); el.classList.add('sel');
        }
        checkBtn.disabled = selected.size === 0;
      } else { selected.add(L); check(); }
    }

    async function check() {
      if (answered || !selected.size) return;
      answered = true;
      const ok = isCorrect(card, selected);
      results.push({ card, ok, selected: [...selected] });
      const p = recordAnswer(card, ok, Date.now() - cardStart);
      // Falsch beantwortet: nach ein paar Karten noch einmal vorlegen
      if (!ok && !requeued.has(card.id)) { requeued.add(card.id); queue.splice(Math.min(i + 4, queue.length), 0, card); }
      optEls.forEach((el) => {
        const L = el.dataset.orig; el.disabled = true; el.classList.remove('sel');
        if (card.correct.includes(L)) el.classList.add(selected.has(L) ? 'ok' : 'missed');
        else if (selected.has(L)) el.classList.add('bad');
      });
      const correctLetters = order.map((o, pos) => (card.correct.includes(LETTERS[o]) ? LETTERS[pos] : null)).filter(Boolean);
      mount(feedbackBox,
        h('div', { class: 'feedback ' + (ok ? 'ok' : 'bad') },
          ok ? 'Richtig ✓' : `Nicht ganz – richtig: ${correctLetters.join(', ')}`),
        card.explanation ? h('div', { class: 'explain' }, card.explanation) : null);
      mount(action, h('button', { class: 'btn primary', onclick: next }, i + 1 >= queue.length ? 'Auswertung' : 'Weiter'));
      action.querySelector('button').focus();
      await p;
    }

    async function next() {
      if (isExam && !answered) {
        // Prüfungsmodus: erst jetzt werten, ohne Feedback
        if (selected.size) {
          answered = true;
          const ok = isCorrect(card, selected);
          results.push({ card, ok, selected: [...selected] });
          await recordAnswer(card, ok, Date.now() - cardStart);
        }
      }
      i++; show();
    }

    mount(action, checkBtn);
    if (isExam) {
      // im Prüfungsmodus auch Überspringen erlauben
      mount(action, h('div', { class: 'grid2' },
        h('button', { class: 'btn ghost', onclick: () => { i++; show(); } }, 'Überspringen'), checkBtn));
    } else if (!multi) mount(action);

    mount(body,
      h('div', { class: 'row wrap' }, h('span', { class: 'chip' }, `${card.deck} › ${card.topic}`), card.chapter ? h('span', { class: 'chip' }, card.chapter) : null),
      h('div', { class: 'question' }, card.question),
      multi ? h('p', { class: 'muted small' }, 'Mehrere Antworten sind richtig – wähle alle zutreffenden.') : null,
      h('div', { class: 'opts' }, optEls),
      feedbackBox, action);
  }

  async function finish(early) {
    if (finished) return;
    finished = true; clearInterval(timerId);
    if (early && !results.length) return ctx.go('/learn');
    const unique = new Map();
    // pro Karte zählt das erste Ergebnis (Wiederholungen nach Fehlern nicht doppelt werten)
    for (const r of results) if (!unique.has(r.card.id)) unique.set(r.card.id, r);
    const list = [...unique.values()];
    const correct = list.filter((r) => r.ok).length;
    const total = isExam ? queue.length : list.length;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const secs = (Date.now() - startedAt) / 1000;
    await saveSession({ ts: Date.now(), mode: cfg.mode, total, correct, percent: pct, seconds: Math.round(secs), scope: cfg.scope });

    const wrong = list.filter((r) => !r.ok);
    const g = grade(pct);
    mount(view,
      h('h1', null, isExam ? 'Auswertung Prüfungsmodus' : 'Sitzung beendet'),
      h('div', { class: 'card center' },
        h('div', { class: 'big-score' }, `${pct}%`),
        h('p', { class: 'muted' }, `${correct} von ${total} richtig · ${fmtDur(secs)} min`),
        isExam ? h('p', null, h('b', null, `Note ${g.n} – ${g.label}`)) : null),
      wrong.length ? h('h2', null, `Zum Wiederholen (${wrong.length})`) : h('p', { class: 'center' }, 'Alles richtig – stark!'),
      wrong.map((r) => h('details', { class: 'card' },
        h('summary', null, r.card.question),
        h('div', { class: 'stack', style: { marginTop: '.6rem' } },
          r.card.correct.map((L) => h('div', { class: 'kp hit' }, h('b', null, L), r.card.options[LETTERS.indexOf(L)])),
          r.card.explanation ? h('div', { class: 'explain' }, r.card.explanation) : null))),
      h('div', { class: 'stack', style: { marginTop: '1rem' } },
        wrong.length ? h('button', { class: 'btn primary', onclick: () => ctx.go('/quiz', { mode: 'weak', scope: cfg.scope, size: 20 }) }, 'Schwache Karten üben') : null,
        h('button', { class: 'btn', onclick: () => ctx.go('/learn') }, 'Fertig')));
  }

  show();
  return () => { finished = true; clearInterval(timerId); };
}
