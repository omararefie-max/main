// Modul 2: Auditives Lernen.
//   Freihändig  – App liest Frage + Antworten vor, du antwortest per Sprache ("B", "Antwort C" …),
//                 App sagt richtig/falsch, liest die Erklärung vor und geht automatisch weiter.
//   Vorlesen    – "Podcast": Frage, Denkpause, Lösung und Erklärung am Stück, ohne Eingabe.
//
// Steuerung der Abläufe: ein Runner-Objekt R mit Flags (paused / stopped / jump).
// Jede Sprech- oder Hör-Aktion kann jederzeit per interrupt() unterbrochen werden;
// danach prüft playCard() mit alive(), ob es weitergehen darf.

import { state, cardList, setSetting } from './store.js';
import { buildQueue, MODES, isCorrect, counts } from './quiz.js';
import { recordAnswer } from './srs.js';
import { speak, cancel, ttsSupported } from './tts.js';
import { listenShort, sttSupported } from './stt.js';
import { parseSpoken } from './answer-parser.js';
import { keepAwake, beep, startMediaSession, stopMediaSession, setPlaybackState } from './device.js';
import { h, mount, sleep } from './util.js';
import { seg, field, scopePicker, emptyState } from './ui.js';
import { icon } from './icons.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/* ============================ Startseite ============================ */
export function renderListen(view, ctx) {
  const cards = cardList();
  if (!cards.length) {
    mount(view, h('h1', null, 'Hören'), emptyState('Noch keine Karten. Importiere zuerst Inhalte.', h('a', { class: 'btn primary', href: '#/content/import' }, 'Inhalte importieren')));
    return;
  }
  const picker = scopePicker(cards);
  const modeSeg = seg([{ value: 'hands', label: 'Freihändig (per Sprache)' }, { value: 'podcast', label: 'Vorlesen (Podcast)' }], 'hands', (m) => { info.textContent = INFO[m]; });
  const INFO = {
    hands: 'Die App stellt die Frage, du antwortest laut mit „A“ bis „E“ (bei mehreren: „A und C“). Befehle: „wiederholen“, „weiter“, „stopp“.',
    podcast: 'Die App liest Frage, Antworten, nach einer Denkpause die Lösung und die Erklärung vor – ohne dass du etwas tun musst.',
  };
  const info = h('p', { class: 'muted small' }, INFO.hands);
  const srcSeg = seg(MODES.filter((m) => m.value !== 'exam'), 'srs');
  const size = h('input', { type: 'number', min: 1, max: 500, value: 15, inputMode: 'numeric' });
  const rateLabel = h('b', null, `${state.settings.ttsRate.toFixed(2)}×`);
  const rate = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: state.settings.ttsRate, oninput: () => { rateLabel.textContent = `${(+rate.value).toFixed(2)}×`; setSetting('ttsRate', +rate.value); } });

  mount(view,
    h('h1', null, 'Hören'),
    !ttsSupported ? h('div', { class: 'banner' }, 'Die Sprachausgabe ist in diesem Browser nicht verfügbar. Bitte Chrome auf Android verwenden.') : null,
    h('div', { class: 'card' },
      modeSeg.el, info,
      h('div', { class: 'muted small' }, 'Kartenquelle'), srcSeg.el,
      picker.el,
      field('Anzahl Karten', size),
      h('label', { class: 'field' }, h('span', null, 'Sprechgeschwindigkeit ', rateLabel), rate),
      h('button', {
        class: 'btn primary', disabled: !ttsSupported,
        onclick: () => ctx.go('/listen/run', { mode: modeSeg.get(), source: srcSeg.get(), scope: picker.get(), size: Math.max(1, +size.value || 15) }),
      }, icon('play'), 'Starten')),
    h('p', { class: 'muted small' }, 'Tipp: Kopfhörer verwenden, damit die Spracherkennung die Vorlesestimme nicht mithört. Bei gesperrtem Bildschirm stoppt Chrome die Spracherkennung meist – lass den Bildschirm angeschaltet (wird automatisch gehalten).'));
}

/* ============================ Lauf ============================ */
const letterText = (card, L) => `${L}: ${card.options[LETTERS.indexOf(L)]}`;
function solutionSpeech(card) {
  const parts = card.correct.map((L) => letterText(card, L));
  return card.correct.length === 1 ? `Richtig ist Antwort ${parts[0]}.` : `Richtig sind die Antworten ${parts.join('; ')}.`;
}

export function renderListenRun(view, ctx) {
  const cfg = ctx.cfg;
  const hands = cfg.mode === 'hands';
  const queue = buildQueue({ scope: cfg.scope, mode: cfg.source, size: cfg.size });
  if (!queue.length) {
    mount(view, emptyState('Keine passenden Karten für diese Auswahl.', h('button', { class: 'btn', onclick: () => ctx.go('/listen') }, 'Zurück')));
    return;
  }

  const R = { i: 0, paused: false, stopped: false, jump: null, listener: null };
  const log = []; // Freihändig: {card, ok}
  const alive = () => !R.stopped && R.jump === null && !R.paused;
  const interrupt = () => { cancel(); R.listener?.abort(); R.listener = null; };
  const jumpTo = (n) => { R.jump = n; R.paused = false; interrupt(); drawPause(); };

  /* ----- UI ----- */
  const counter = h('span', { class: 'muted' });
  const bar = h('div', { style: { width: '0%' } });
  const pulse = h('span', { class: 'pulse' });
  const statusText = h('span', null, 'Starte …');
  const heard = h('div', { class: 'muted', style: { minHeight: '1.5rem' } });
  const errBox = h('div', { hidden: true, class: 'banner' });
  const qEl = h('div', { class: 'question' });
  const optsEl = h('div', { class: 'opts' });
  const pauseBtn = h('button', { class: 'btn', onclick: () => (R.paused ? resume() : pause()) });
  const drawPause = () => mount(pauseBtn, icon(R.paused ? 'play' : 'pause'), R.paused ? 'Weiter' : 'Pause');
  const ctrl = h('div', { class: 'actionbar stack' },
    h('div', { class: 'grid2' },
      h('button', { class: 'btn', onclick: () => jumpTo(R.i - 1) }, icon('prev'), 'Zurück'),
      h('button', { class: 'btn', onclick: () => jumpTo(R.i + 1) }, icon('next'), 'Weiter')),
    h('div', { class: 'grid2' },
      h('button', { class: 'btn', onclick: () => jumpTo(R.i) }, icon('repeat'), 'Wiederholen'), pauseBtn));
  drawPause();

  const setStatus = (kind, text) => { pulse.className = 'pulse ' + (kind || ''); statusText.textContent = text; };
  mount(view,
    h('div', { class: 'session-head' },
      h('button', { class: 'btn ghost', onclick: () => { stopAll(); ctx.go('/listen'); } }, 'Beenden'),
      h('div', { class: 'grow' }, h('div', { class: 'progressbar' }, bar)), counter),
    h('div', { class: 'status' }, pulse, statusText),
    errBox, qEl, optsEl, heard, ctrl);

  function showCard(card) {
    counter.textContent = `${R.i + 1} / ${queue.length}`;
    bar.style.width = `${(R.i / queue.length) * 100}%`;
    qEl.textContent = card.question;
    heard.textContent = '';
    mount(optsEl, card.options.map((t, k) => h('div', { class: 'opt', 'data-l': LETTERS[k] }, h('span', { class: 'letter' }, LETTERS[k]), h('span', null, t))));
  }
  function markSolution(card, picked) {
    optsEl.querySelectorAll('.opt').forEach((el) => {
      const L = el.dataset.l;
      if (card.correct.includes(L)) el.classList.add('ok');
      else if (picked?.includes(L)) el.classList.add('bad');
    });
  }
  function showError(msg) { errBox.hidden = false; errBox.textContent = msg; }

  /* ----- Sprech-/Warte-Helfer ----- */
  async function say(text, label = 'Spricht …') { setStatus('speak', label); const ok = await speak(text); return ok && alive(); }
  async function waitAlive(ms) { const end = Date.now() + ms; while (Date.now() < end && alive()) await sleep(100); return alive(); }

  async function readQuestion(card) {
    const multi = card.correct.length > 1;
    if (!(await say(`Frage ${R.i + 1}. ${card.question}`))) return false;
    for (const L of LETTERS) if (!(await say(`Antwort ${letterText(card, L)}.`))) return false;
    if (hands && multi && !(await say('Es können mehrere Antworten richtig sein.'))) return false;
    return true;
  }

  async function readSolution(card, withExplanation = true) {
    if (!(await say(solutionSpeech(card)))) return false;
    if (withExplanation && card.explanation && !(await say(`Erklärung: ${card.explanation}`))) return false;
    return true;
  }

  /* ----- Karte abspielen ----- */
  async function playCard(card) {
    showCard(card);
    if (!(await readQuestion(card))) return 'int';

    if (!hands) { // Podcast
      setStatus('', 'Denkpause …');
      if (!(await waitAlive(state.settings.podcastPause * 1000))) return 'int';
      markSolution(card);
      if (!(await readSolution(card))) return 'int';
      return (await waitAlive(1200)) ? 'done' : 'int';
    }

    // Freihändig
    let attempts = 0;
    while (attempts < 2) {
      if (!alive()) return 'int';
      setStatus('listen', 'Ich höre zu – sag A bis E'); beep();
      const L = listenShort({ timeoutMs: 9000 }); R.listener = L;
      const r = await L.promise; R.listener = null;
      if (!alive()) return 'int';
      if (r.fatal) { showError(r.message); await say(r.message.split('.')[0] + '. Der Hörmodus wird beendet.'); R.stopped = true; return 'int'; }
      heard.textContent = r.alts[0] ? `Verstanden: „${r.alts[0]}“` : '';
      const p = parseSpoken(r.alts);
      if (!p) { attempts++; if (attempts < 2 && !(await say('Das habe ich nicht verstanden. Bitte sag A bis E.'))) return 'int'; continue; }
      if (p.type === 'cmd') {
        if (p.cmd === 'repeat') { if (!(await readQuestion(card))) return 'int'; continue; }
        if (p.cmd === 'next') { markSolution(card); return (await readSolution(card, false)) ? 'done' : 'int'; }
        if (p.cmd === 'stop') { R.stopped = true; interrupt(); return 'int'; }
      }
      // Antwort
      const ok = isCorrect(card, p.letters);
      log.push({ card, ok });
      await recordAnswer(card, ok, 0, { via: 'audio' });
      markSolution(card, p.letters);
      if (!(await say(ok ? 'Richtig.' : 'Leider falsch.'))) return 'int';
      if (!(await readSolution(card))) return 'int';
      return (await waitAlive(800)) ? 'done' : 'int';
    }
    // keine verständliche Antwort
    markSolution(card);
    if (!(await say('Keine Antwort erkannt.'))) return 'int';
    return (await readSolution(card)) ? 'done' : 'int';
  }

  /* ----- Schleife ----- */
  async function run() {
    await keepAwake(true);
    await startMediaSession('Lernkarten', { play: resume, pause, next: () => jumpTo(R.i + 1), prev: () => jumpTo(R.i - 1), stop: () => { stopAll(); ctx.go('/listen'); } });
    setPlaybackState('playing');
    while (!R.stopped) {
      if (R.jump !== null) { R.i = Math.max(0, Math.min(queue.length, R.jump)); R.jump = null; }
      if (R.i >= queue.length) break;
      while (R.paused && !R.stopped && R.jump === null) await sleep(150);
      if (R.stopped) break;
      if (R.jump !== null) continue;
      const res = await playCard(queue[R.i]);
      if (R.stopped) break;
      if (R.jump !== null) continue;
      if (res === 'done') R.i++;
    }
    if (R.stopped) { if (hands && log.length && !leaving) finish(true); return; }
    finish(false);
  }

  let leaving = false;
  function pause() { R.paused = true; interrupt(); setStatus('', 'Pausiert'); setPlaybackState('paused'); drawPause(); }
  function resume() { R.paused = false; setPlaybackState('playing'); drawPause(); }
  function stopAll() { leaving = true; R.stopped = true; interrupt(); keepAwake(false); stopMediaSession(); }

  async function finish(early) {
    keepAwake(false); stopMediaSession();
    const correct = log.filter((l) => l.ok).length;
    if (!early && ttsSupported) await speak(hands ? `Das war die letzte Karte. ${correct} von ${log.length} richtig.` : 'Das war die letzte Karte.');
    mount(view,
      h('h1', null, 'Fertig'),
      hands ? h('div', { class: 'card center' }, h('div', { class: 'big-score' }, log.length ? `${Math.round((correct / log.length) * 100)}%` : '–'), h('p', { class: 'muted' }, `${correct} von ${log.length} per Sprache richtig beantwortet`)) : h('p', null, `${queue.length} Karten vorgelesen.`),
      log.filter((l) => !l.ok).length ? [h('h2', null, 'Falsch beantwortet'), log.filter((l) => !l.ok).map((l) => h('div', { class: 'list-item' }, l.card.question))] : null,
      h('div', { class: 'stack', style: { marginTop: '1rem' } },
        h('button', { class: 'btn primary', onclick: () => ctx.go('/listen/run', cfg) }, 'Nochmal'),
        h('button', { class: 'btn', onclick: () => ctx.go('/listen') }, 'Fertig')));
  }

  run();
  return () => { leaving = true; R.stopped = true; interrupt(); keepAwake(false); stopMediaSession(); };
}
