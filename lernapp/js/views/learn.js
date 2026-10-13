/* Modul 1: Karteikarten-Quiz (Multiple Choice) mit Spaced Repetition.
 * Modi: Alle (fällige zuerst) · schwache · neue · Prüfungsmodus mit Zeitlimit. Thema/Kapitel über die Filter. */
import { h, shuffle, toast, LETTERS, fmtDur, pct } from '../util.js';
import { S, recordReview, saveSettings } from '../store.js';
import { classify } from '../srs.js';
import { speak, cancelSpeech, ttsSupported, ttsErrorMessage } from '../speech.js';
import { filterControls, filterItems, stat, emptyHint } from './filters.js';

let filters = { subject: '', topic: '', chapter: '' };
let cfg = { mode: 'all', size: null, minutes: 20 };
let session = null;     // laufende Runde
let timerId = null;

const MODES = [
  ['all', 'Alle Karten', 'Fällige zuerst, dann neue'],
  ['weak', 'Nur schwache Karten', 'Zuletzt falsch oder niedrige Trefferquote'],
  ['new', 'Nur neue Karten', 'Noch nie beantwortet'],
  ['exam', 'Prüfungsmodus', 'Zufällige Karten mit Zeitlimit, Auswertung am Ende']
];

export function render(root, ctx) {
  if (session && !session.done && session.deadline && Date.now() > session.deadline) finish(true);
  if (session?.done) renderResult(root, ctx);
  else if (session) renderCard(root, ctx);
  else renderSetup(root, ctx);
  return () => { clearInterval(timerId); timerId = null; cancelSpeech(); };
}

/* ---------------- Start ---------------- */
function renderSetup(root, ctx) {
  const pool = filterItems(S.cards, filters);
  const cl = classify(pool, S.progress);
  cfg.size ??= S.settings.sessionSize;
  root.replaceChildren(
    h('h2', {}, 'Was möchtest du lernen?'),
    S.cards.length ? null : emptyHint('Karten'),
    filterControls(S.cards, filters, ctx.rerender),
    h('div', { class: 'stats-row' }, stat(cl.due.length, 'fällig'), stat(cl.neu.length, 'neu'), stat(cl.weak.length, 'schwach'), stat(pool.length, 'gesamt')),
    h('div', { class: 'seg' }, MODES.map(([k, t, d]) =>
      h('button', { 'aria-pressed': cfg.mode === k, onclick: () => { cfg.mode = k; ctx.rerender(); } }, t, h('small', {}, d)))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, 'Anzahl Karten', h('input', { type: 'number', min: 1, max: 500, value: cfg.size, oninput: (e) => { cfg.size = Math.max(1, parseInt(e.target.value, 10) || 1); } })),
      cfg.mode === 'exam' ? h('label', { class: 'field' }, 'Zeitlimit (Min.)', h('input', { type: 'number', min: 1, max: 300, value: cfg.minutes, oninput: (e) => { cfg.minutes = Math.max(1, parseInt(e.target.value, 10) || 1); } })) : null),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.settings.shuffle, onchange: (e) => saveSettings({ shuffle: e.target.checked }) }), 'Antworten mischen'),
    h('div', { class: 'sticky-actions' }, h('button', { class: 'btn primary', disabled: !pool.length, onclick: () => start(pool, ctx) }, 'Starten'))
  );
}

function buildQueue(pool, mode, size) {
  const cl = classify(pool, S.progress);
  let q;
  if (mode === 'weak') q = cl.weak;
  else if (mode === 'new') q = shuffle(cl.neu);
  else if (mode === 'exam') q = shuffle(pool);
  else q = [...cl.due, ...shuffle(cl.neu), ...cl.later];
  return q.slice(0, size);
}

function start(pool, ctx) {
  const queue = buildQueue(pool, cfg.mode, cfg.size);
  if (!queue.length) return toast('Für diese Auswahl gibt es keine passenden Karten.');
  saveSettings({ sessionSize: cfg.size });
  const exam = cfg.mode === 'exam';
  session = { mode: cfg.mode, exam, queue, idx: 0, results: [], requeued: new Set(), cur: null, done: false,
    startedAt: Date.now(), deadline: exam ? Date.now() + cfg.minutes * 60000 : null, total: queue.length };
  ctx.rerender();
}

/* ---------------- Karte ---------------- */
function makeCur(card) {
  const order = S.settings.shuffle ? shuffle([0, 1, 2, 3, 4]) : [0, 1, 2, 3, 4];
  return { card, order, sel: new Set(), answered: false, ok: null };
}

function renderCard(root, ctx) {
  const s = session;
  const cur = (s.cur ??= makeCur(s.queue[s.idx]));
  const c = cur.card;
  const multi = c.correct.length > 1;
  const showFb = cur.answered && !s.exam;

  const answers = cur.order.map((orig, pos) => {
    const isCorrect = c.correct.includes(orig), picked = cur.sel.has(orig);
    let cls = 'answer';
    if (showFb) cls += isCorrect ? (picked ? ' correct' : ' missed') : picked ? ' wrong' : '';
    else if (picked) cls += ' selected';
    return h('button', { class: cls, disabled: cur.answered, onclick: () => choose(orig, ctx), 'aria-pressed': picked },
      h('span', { class: 'letter' }, LETTERS[pos]), h('span', {}, c.answers[orig]));
  });

  const letters = cur.order.map((o, p) => (c.correct.includes(o) ? LETTERS[p] : null)).filter(Boolean).join(', ');
  const total = s.queue.length;

  root.replaceChildren(
    h('div', { class: 'q-head' },
      h('span', {}, `${Math.min(s.idx + 1, total)} / ${total}`),
      h('div', { class: 'bar' }, h('i', { style: `width:${pct(s.idx, total)}%` })),
      s.exam ? h('span', { id: 'timer', class: 'big-timer' }, '') : null,
      h('button', { class: 'btn ghost small inline', onclick: () => { if (confirm('Runde wirklich beenden?')) finish(false, ctx); } }, 'Beenden')),
    h('div', { class: 'chips' }, [c.subject, c.topic, c.chapter, c.difficulty ? 'Stufe ' + c.difficulty : ''].filter(Boolean).map((t) => h('span', { class: 'chip' }, t))),
    h('h2', { class: 'question' }, c.question),
    multi ? h('p', { class: 'muted small' }, 'Mehrere Antworten sind richtig – wähle alle zutreffenden aus.') : null,
    h('div', { class: 'answers' }, answers),
    showFb ? h('div', {},
      h('div', { class: 'banner ' + (cur.ok ? 'ok' : 'bad') }, h('b', {}, cur.ok ? '✓ Richtig!' : '✗ Leider falsch.'), ' Richtige Antwort: ' + letters),
      c.explanation ? h('div', { class: 'box' }, h('h3', {}, 'Erklärung'), h('div', { class: 'explain' }, c.explanation),
        ttsSupported ? h('button', { class: 'btn small ghost inline', style: 'margin-top:.6rem', onclick: () => readExplanation(c) }, '🔊 Vorlesen') : null) : null) : null,
    h('div', { class: 'sticky-actions' },
      cur.answered && !s.exam ? h('button', { class: 'btn primary', onclick: () => next(ctx) }, s.idx + 1 >= s.queue.length ? 'Ergebnis anzeigen' : 'Weiter')
        : multi && !cur.answered ? h('button', { class: 'btn primary', disabled: !cur.sel.size, onclick: () => submit(ctx) }, 'Antwort prüfen') : null)
  );

  if (s.exam) ensureTimer(ctx);
}

function choose(orig, ctx) {
  const cur = session.cur;
  if (cur.answered) return;
  if (cur.card.correct.length > 1) { cur.sel.has(orig) ? cur.sel.delete(orig) : cur.sel.add(orig); ctx.rerender(); }
  else { cur.sel = new Set([orig]); submit(ctx); }
}

async function submit(ctx) {
  const s = session, cur = s.cur, c = cur.card;
  cur.answered = true;
  cur.ok = cur.sel.size === c.correct.length && c.correct.every((i) => cur.sel.has(i));
  s.results.push({ card: c, ok: cur.ok, sel: [...cur.sel], order: cur.order });
  await recordReview(c, cur.ok);
  if (!cur.ok && !s.requeued.has(c.id) && !s.exam) {   // falsch → in ein paar Karten nochmal vorlegen
    s.requeued.add(c.id);
    s.queue.splice(Math.min(s.idx + 4, s.queue.length), 0, c);
  }
  if (s.exam) next(ctx); else ctx.rerender();
}

function next(ctx) {
  cancelSpeech();
  session.idx++; session.cur = null;
  if (session.idx >= session.queue.length) finish(false, ctx); else ctx.rerender();
}

function ensureTimer(ctx) {
  const tick = () => {
    const el = document.getElementById('timer');
    const left = Math.max(0, Math.round((session.deadline - Date.now()) / 1000));
    if (el) { el.textContent = fmtDur(left); el.style.color = left < 60 ? 'var(--bad)' : ''; }
    if (left <= 0) { toast('Zeit abgelaufen.'); finish(true, ctx); }
  };
  if (!timerId) timerId = setInterval(tick, 1000);
  tick();
}

function finish(timeout, ctx) {
  clearInterval(timerId); timerId = null; cancelSpeech();
  if (!session) return;
  session.done = true; session.timeout = !!timeout; session.endedAt = Date.now();
  ctx?.rerender();
}

async function readExplanation(c) {
  try { await speak(c.explanation, { rate: S.settings.ttsRate, voiceURI: S.settings.ttsVoice }); } catch (e) { toast(ttsErrorMessage(e), 5000); }
}

/* ---------------- Ergebnis ---------------- */
function renderResult(root, ctx) {
  const s = session;
  const ok = s.results.filter((r) => r.ok).length, n = s.results.length;
  const wrong = s.results.filter((r) => !r.ok);
  const unanswered = s.exam ? s.queue.length - n : 0;
  root.replaceChildren(
    h('div', { class: 'score-hero' }, h('div', { class: 'big' }, pct(ok, s.exam ? s.total : n) + ' %'),
      h('div', {}, `${ok} von ${s.exam ? s.total : n} richtig`), h('div', { class: 'muted small' }, 'Dauer ' + fmtDur((s.endedAt - s.startedAt) / 1000))),
    s.timeout ? h('div', { class: 'banner warn' }, `Zeit abgelaufen – ${unanswered} Karte(n) nicht beantwortet.`) : null,
    wrong.length ? h('h3', {}, 'Zum Wiederholen') : h('div', { class: 'banner ok' }, 'Alles richtig – stark!'),
    wrong.map((r) => {
      const c = r.card;
      const right = r.order.map((o, p) => (c.correct.includes(o) ? `${LETTERS[p]}: ${c.answers[o]}` : null)).filter(Boolean);
      return h('details', {}, h('summary', {}, h('span', { class: 'tag-bad' }, '✗'), c.question),
        h('p', {}, h('b', {}, 'Richtig: '), right.join(' · ')), c.explanation ? h('p', { class: 'explain muted' }, c.explanation) : null);
    }),
    h('div', { class: 'sticky-actions' }, h('button', { class: 'btn primary', onclick: () => { session = null; ctx.rerender(); } }, 'Neue Runde'))
  );
}
