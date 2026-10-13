/* Modul 2: Auditives Lernen.
 *  • Freihändig: App liest Frage + Antworten vor, du antwortest per Sprache ("B", "Antwort C", "A und D"),
 *    App sagt richtig/falsch, liest die Erklärung vor, danach automatisch die nächste Karte.
 *    Sprachbefehle: "wiederholen", "weiter", "stopp".
 *  • Hörmodus (Wiederholen): Frage → Denkpause → Lösung + Erklärung, am Stück wie ein Podcast. */
import { h, shuffle, toast, LETTERS, sleep, pct } from '../util.js';
import { S, recordReview, saveSettings } from '../store.js';
import { classify } from '../srs.js';
import {
  speak, cancelSpeech, ttsSupported, ttsErrorMessage, getVoices, listen, sttSupported, sttErrorMessage,
  parseAnswerSpeech, startKeepAlive, stopKeepAlive
} from '../speech.js';
import { filterControls, filterItems, stat, emptyHint } from './filters.js';

let filters = { subject: '', topic: '', chapter: '' };
let cfg = { kind: 'hands', source: 'due', count: 15 };
let run = null;

export function render(root, ctx) {
  if (run) renderRun(root, ctx); else renderSetup(root, ctx);
  return () => { if (run) abort(); };
}

/* ---------------- Start ---------------- */
function renderSetup(root, ctx) {
  const pool = filterItems(S.cards, filters);
  const cl = classify(pool, S.progress);
  const st = S.settings;
  const noVoice = ttsSupported && !getVoices().length;
  root.replaceChildren(
    h('h2', {}, 'Auditives Lernen'),
    S.cards.length ? null : emptyHint('Karten'),
    !ttsSupported ? h('div', { class: 'banner bad' }, 'Sprachausgabe wird von diesem Browser nicht unterstützt (nutze Chrome auf Android).') : null,
    noVoice ? h('div', { class: 'banner warn' }, 'Keine deutsche Stimme gefunden – es wird die Standardstimme genutzt. Installiere ggf. „Deutsch“ in den Android-Einstellungen für Text-to-Speech.') : null,
    h('div', { class: 'seg' },
      [['hands', '🗣 Freihändig', 'Du antwortest per Sprache (A–E)'], ['podcast', '🎧 Hörmodus „Wiederholen“', 'Karten mit Lösung und Erklärung am Stück']].map(([k, t, d]) =>
        h('button', { 'aria-pressed': cfg.kind === k, onclick: () => { cfg.kind = k; ctx.rerender(); } }, t, h('small', {}, d)))),
    cfg.kind === 'hands' && !sttSupported ? h('div', { class: 'banner warn' }, 'Spracherkennung wird hier nicht unterstützt – Freihändig-Modus nicht möglich. Der Hörmodus funktioniert trotzdem.') : null,
    filterControls(S.cards, filters, ctx.rerender),
    h('div', { class: 'stats-row' }, stat(cl.due.length, 'fällig'), stat(cl.neu.length, 'neu'), stat(cl.weak.length, 'schwach'), stat(pool.length, 'gesamt')),
    h('label', { class: 'field' }, 'Welche Karten?', h('select', { onchange: (e) => { cfg.source = e.target.value; } },
      [['due', 'Fällige, dann neue'], ['weak', 'Schwache Karten'], ['new', 'Neue Karten'], ['all', 'Alle (zufällig)']].map(([v, t]) => h('option', { value: v, selected: cfg.source === v }, t)))),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, 'Anzahl', h('input', { type: 'number', min: 1, max: 500, value: cfg.count, oninput: (e) => { cfg.count = Math.max(1, +e.target.value || 1); } })),
      cfg.kind === 'podcast' ? h('label', { class: 'field' }, 'Denkpause (s)', h('input', { type: 'number', min: 0, max: 30, value: st.thinkPause, onchange: (e) => saveSettings({ thinkPause: Math.max(0, +e.target.value || 0) }) })) : null),
    h('label', { class: 'field' }, `Sprechtempo: ${st.ttsRate.toFixed(1)}×`, h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.1, value: st.ttsRate, oninput: (e) => { saveSettings({ ttsRate: +e.target.value }); e.target.parentElement.firstChild.textContent = `Sprechtempo: ${(+e.target.value).toFixed(1)}×`; } })),
    h('p', { class: 'muted small' }, 'Tipp: Bildschirm bei Spaziergängen nur dimmen, nicht sperren – Android pausiert Web-Apps bei gesperrtem Gerät oft (siehe README).'),
    h('div', { class: 'sticky-actions' }, h('button', { class: 'btn primary', disabled: !pool.length || !ttsSupported || (cfg.kind === 'hands' && !sttSupported), onclick: () => start(pool, ctx) }, 'Starten'))
  );
}

function pickQueue(pool) {
  const cl = classify(pool, S.progress);
  const q = cfg.source === 'weak' ? cl.weak : cfg.source === 'new' ? shuffle(cl.neu) : cfg.source === 'all' ? shuffle(pool) : [...cl.due, ...shuffle(cl.neu), ...cl.later];
  return q.slice(0, cfg.count);
}

async function start(pool, ctx) {
  const queue = pickQueue(pool);
  if (!queue.length) return toast('Keine passenden Karten.');
  const R = { kind: cfg.kind, queue, i: 0, stop: false, paused: false, cmd: null, jump: null, listener: null, wake: null, resume: null,
    ok: 0, wrong: 0, skipped: 0, ui: {}, finished: false, ctx };
  run = R;
  if (S.settings.keepAlive) {   // muss im Klick-Handler passieren
    startKeepAlive({ title: cfg.kind === 'hands' ? 'Freihändig lernen' : 'Hörmodus', handlers: {
      play: () => setPaused(R, false), pause: () => setPaused(R, true), nexttrack: () => jump(R, +1), previoustrack: () => jump(R, -1)
    } });
  }
  ctx.rerender();
  (R.kind === 'hands' ? handsFree(R) : podcast(R)).catch((e) => { console.error(e); fatal(R, e.message); });
}

/* ---------------- Laufende Sitzung: UI ---------------- */
function renderRun(root, ctx) {
  const R = run;
  const ui = R.ui = {
    status: h('div', { class: 'status-pill' }, 'Starte …'),
    count: h('span', {}, ''), score: h('span', { class: 'muted' }, ''), q: h('h2', { class: 'question' }), answers: h('div', { class: 'answers' }),
    heard: h('div', { class: 'transcript', hidden: R.kind !== 'hands' }, 'Hier erscheint, was ich verstehe …'),
    expl: h('div', { class: 'box explain', hidden: true }), error: h('div', { class: 'banner bad', hidden: true }),
    pause: h('button', { class: 'btn', onclick: () => setPaused(R, !R.paused) }, '⏸ Pause')
  };
  root.replaceChildren(
    h('div', { class: 'q-head' }, ui.count, ui.score, h('span', {})),
    ui.status, ui.error, ui.q, ui.answers, ui.heard, ui.expl,
    h('div', { class: 'sticky-actions stack' },
      h('div', { class: 'row' },
        R.kind === 'hands'
          ? [h('button', { class: 'btn', onclick: () => command(R, 'repeat') }, '↻ Wiederholen'), h('button', { class: 'btn', onclick: () => command(R, 'skip') }, '⏭ Weiter')]
          : [h('button', { class: 'btn', onclick: () => jump(R, -1) }, '⏮ Zurück'), h('button', { class: 'btn', onclick: () => jump(R, +1) }, '⏭ Vor')]),
      h('div', { class: 'row' }, ui.pause, h('button', { class: 'btn danger', onclick: () => { abort(); ctx.rerender(); } }, '■ Beenden')))
  );
  if (R.current) showCard(R, R.current.card, R.current.order, R.current.reveal);
}

function showCard(R, card, order, reveal = false) {
  R.current = { card, order, reveal };
  const ui = R.ui;
  if (!ui.q?.isConnected) return;
  ui.count.textContent = `Karte ${R.i + 1} / ${R.queue.length}`;
  ui.score.textContent = R.kind === 'hands' ? `✓ ${R.ok}  ✗ ${R.wrong}` : '';
  ui.q.textContent = card.question;
  ui.answers.replaceChildren(...order.map((o, pos) => h('div', { class: 'answer' + (reveal ? (card.correct.includes(o) ? ' correct' : '') : ''), style: 'cursor:default' },
    h('span', { class: 'letter' }, LETTERS[pos]), h('span', {}, card.answers[o]))));
  ui.expl.hidden = !(reveal && card.explanation);
  ui.expl.textContent = reveal ? card.explanation || '' : '';
}

const setStatus = (R, text, cls = '') => { if (R.ui.status?.isConnected) { R.ui.status.textContent = text; R.ui.status.className = 'status-pill ' + cls; } };

function fatal(R, msg) {
  R.stop = true; cancelSpeech(); R.listener?.stop();
  if (R.ui.error?.isConnected) { R.ui.error.hidden = false; R.ui.error.textContent = msg; }
  setStatus(R, 'Angehalten');
  toast(msg, 6000);
  stopKeepAlive();
}

/* ---------------- Steuerung ---------------- */
function interrupt(R) { cancelSpeech(); R.listener?.stop(); R.wake?.(); }
function command(R, c) { R.cmd = c; interrupt(R); }
function jump(R, d) { R.jump = d; interrupt(R); }
function setPaused(R, p) {
  R.paused = p;
  if (R.ui.pause?.isConnected) R.ui.pause.textContent = p ? '▶ Fortsetzen' : '⏸ Pause';
  if (p) { setStatus(R, 'Pausiert'); interrupt(R); } else R.resume?.();
}
const waitResume = (R) => new Promise((res) => { R.resume = () => { R.resume = null; res(); }; });
const sleepR = (R, ms) => new Promise((res) => { const t = setTimeout(res, ms); R.wake = () => { clearTimeout(t); R.wake = null; res(); }; });

function abort() {
  const R = run; if (!R) return;
  R.stop = true; interrupt(R); R.resume?.(); stopKeepAlive(); run = null;
}

async function say(R, text) {
  try { return await speak(text, { rate: S.settings.ttsRate, voiceURI: S.settings.ttsVoice }); }
  catch (e) { fatal(R, ttsErrorMessage(e)); return false; }
}

const makeOrder = () => (S.settings.shuffle ? shuffle([0, 1, 2, 3, 4]) : [0, 1, 2, 3, 4]);
const letterList = (card, order) => order.map((o, p) => (card.correct.includes(o) ? p : -1)).filter((p) => p >= 0);

function cardSpeech(card, order) {
  return [`Frage. ${card.question}`, card.correct.length > 1 ? 'Mehrere Antworten können richtig sein.' : '',
    ...order.map((o, p) => `Antwort ${LETTERS[p]}: ${card.answers[o]}.`)].filter(Boolean).join(' ');
}
function solutionSpeech(card, order) {
  const ps = letterList(card, order);
  const parts = ps.map((p) => `Antwort ${LETTERS[p]}: ${card.answers[order[p]]}`);
  const list = parts.length > 1 ? parts.slice(0, -1).join('; ') + ' und ' + parts[parts.length - 1] : parts[0];
  return `Richtig ${ps.length > 1 ? 'sind' : 'ist'} ${list}.`;
}

/* ---------------- Freihändig ---------------- */
async function handsFree(R) {
  while (R.i < R.queue.length && !R.stop) {
    const card = R.queue[R.i], order = makeOrder();
    R.cmd = null;
    showCard(R, card, order);
    R.ui.heard.textContent = 'Hier erscheint, was ich verstehe …';
    let heard = null, spoke = false, attempts = 0, noAnswer = false;

    while (!R.stop && R.cmd !== 'skip' && !heard) {
      if (R.paused) { await waitResume(R); continue; }
      if (!spoke || R.cmd === 'repeat') {
        R.cmd = null; setStatus(R, 'Ich lese vor …', 'speak');
        if (!(await say(R, cardSpeech(card, order)))) continue;
        spoke = true;
      }
      if (R.stop || R.cmd === 'skip') break;
      setStatus(R, '🎤 Ich höre zu – nenne A bis E', 'listen');
      const l = listen({ lang: S.settings.recLang, continuous: false, maxMs: 12000, localOnly: S.settings.recLocalOnly });
      R.listener = l;
      const r = await l.promise;
      R.listener = null;
      if (R.stop) break;
      if (R.cmd || R.paused) continue;                         // per Button unterbrochen
      if (r.error) return fatal(R, sttErrorMessage(r.error));
      R.ui.heard.textContent = r.transcript ? `Verstanden: „${r.transcript}“` : 'Nichts gehört.';
      const p = parseAnswerSpeech(r.transcript);
      if (p.command === 'stop') { R.stop = true; break; }
      if (p.command === 'repeat') { R.cmd = 'repeat'; continue; }
      if (p.command === 'skip') { R.cmd = 'skip'; break; }
      if (p.letters.length) { heard = p.letters; break; }
      if (++attempts >= 3) { noAnswer = true; break; }
      setStatus(R, 'Ich lese vor …', 'speak');
      await say(R, r.transcript ? 'Das habe ich nicht verstanden. Bitte nenne einen Buchstaben von A bis E.' : 'Ich habe nichts gehört. Bitte nenne einen Buchstaben von A bis E.');
    }
    if (R.stop) break;

    if (heard) {
      const picked = new Set(heard.map((p) => order[p]));
      const ok = picked.size === card.correct.length && card.correct.every((i) => picked.has(i));
      await recordReview(card, ok);
      ok ? R.ok++ : R.wrong++;
      showCard(R, card, order, true);
      setStatus(R, ok ? '✓ Richtig' : '✗ Falsch', 'speak');
      if (!(await say(R, ok ? 'Richtig.' : `Falsch. ${solutionSpeech(card, order)}`))) { if (R.stop) break; }
      if (card.explanation && !R.stop && !R.cmd) await say(R, 'Erklärung. ' + card.explanation);
      if (!R.stop) await sleepR(R, 1200);
    } else if (noAnswer) {
      R.skipped++;
      showCard(R, card, order, true);
      await say(R, 'Keine Antwort erkannt. ' + solutionSpeech(card, order));
    } else R.skipped++;

    if (R.paused) await waitResume(R);
    R.i++;
  }
  if (!R.stop) summary(R);
}

/* ---------------- Hörmodus (Podcast) ---------------- */
async function podcast(R) {
  const pause = Math.max(0, S.settings.thinkPause) * 1000;
  while (R.i < R.queue.length && !R.stop) {
    const card = R.queue[R.i], order = makeOrder();
    R.jump = null;
    const busy = () => R.stop || R.paused || R.jump !== null;
    const step = async () => {
      showCard(R, card, order);
      setStatus(R, 'Frage', 'speak');
      if (!(await say(R, cardSpeech(card, order))) || busy()) return false;
      setStatus(R, 'Denkpause …');
      await sleepR(R, pause);
      if (busy()) return false;
      showCard(R, card, order, true);
      setStatus(R, 'Lösung', 'speak');
      if (!(await say(R, solutionSpeech(card, order) + (card.explanation ? ' Erklärung. ' + card.explanation : ''))) || busy()) return false;
      await sleepR(R, 1800);
      return !busy();
    };
    const done = await step();
    if (R.stop) break;
    if (R.paused) { await waitResume(R); continue; }       // an derselben Karte weitermachen
    if (R.jump !== null) { R.i = Math.max(0, Math.min(R.queue.length - 1, R.i + R.jump)); continue; }
    if (done) R.i++;
  }
  if (!R.stop) summary(R);
}

function summary(R) {
  stopKeepAlive();
  const n = R.ok + R.wrong;
  const msg = R.kind === 'hands' ? `Fertig. ${R.ok} von ${n} richtig${R.skipped ? `, ${R.skipped} übersprungen` : ''}.` : 'Fertig. Alle Karten wurden vorgelesen.';
  setStatus(R, '✓ Fertig');
  R.ui.q.textContent = msg;
  R.ui.answers.replaceChildren();
  R.ui.expl.hidden = true;
  R.ui.heard.hidden = true;
  if (R.kind === 'hands' && n) R.ui.answers.append(h('div', { class: 'score-hero' }, h('div', { class: 'big' }, pct(R.ok, n) + ' %')));
  say(R, msg);
}
