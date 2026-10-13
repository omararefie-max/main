// views/listen.js – Modul 2: Auditives Lernen
//   * Hands-free: App liest Frage + Antworten vor, du antwortest per Sprache ("Antwort C"), App bewertet,
//     liest die Erklärung vor und geht automatisch zur nächsten Karte.
//   * Podcast ("Wiederholen"): Karten mit Lösung und Erklärung am Stück vorlesen, ohne Eingabe.
//
// Steuerung: ein "Lauf" ist eine async-Schleife. Pause/Weiter/Beenden setzen Flags und brechen die
// Sprachausgabe/-erkennung ab; die Schleife erkennt das über interrupted() und startet die Karte neu.

import { h, clear, sleep, toast, pct } from '../util.js';
import { state, recordAnswer, inScope } from '../store.js';
import { buildQueue, counts } from '../srs.js';
import { present, isCorrect, correctLetters } from '../cards.js';
import { scopeSelect, emptyState } from '../ui.js';
import { speak, cancelTTS, pauseFor, listenOnce, ttsSupported, sttSupported, describeSttError } from '../speech.js';
import { parseAlternatives } from '../voice.js';
import { startKeepAlive, stopKeepAlive, setMediaTitle } from '../power.js';

let scope = '', source = 'faellig';

export function render(root) {
  let run = null; // aktiver Lauf
  menu();
  return async () => { if (run) run.end(true); cancelTTS(); await stopKeepAlive(); };

  /* ------------------------------------------------------------ Menü */
  function menu() {
    clear(root);
    if (!state.cards.length) { root.append(emptyState('cards', menu)); return; }
    const pool = state.cards.filter((c) => inScope(c, scope));
    const c = counts(pool, state.progress);
    root.append(
      !ttsSupported() ? h('div', { class: 'banner' }, 'Die Sprachausgabe ist in diesem Browser nicht verfügbar. Probiere Chrome (Android) oder Safari (iPhone) und prüfe, ob eine deutsche Systemstimme installiert ist.') : null,
      scopeSelect(scope, (v) => { scope = v; menu(); }, 'Thema / Bereich'),
      h('label', { class: 'field' }, 'Welche Karten?', h('select', { onchange: (e) => { source = e.target.value; } },
        ...[['faellig', `Fällige + neue (${c.due + c.fresh})`], ['alle', `Alle (${pool.length})`], ['schwach', `Schwache (${c.weak})`], ['neu', `Nur neue (${c.fresh})`]]
          .map(([v, l]) => h('option', { value: v, selected: source === v }, l)))),
      h('div', { class: 'btn-stack' },
        h('button', { class: 'btn primary', disabled: !ttsSupported() || !sttSupported(), onclick: () => begin('hands') },
          '🎧 Hands-free lernen', h('span', { class: 'sub' }, 'Du antwortest per Sprache: „Antwort C“')),
        h('button', { class: 'btn', disabled: !ttsSupported(), onclick: () => begin('podcast') },
          '▶ Hörmodus „Wiederholen“', h('span', { class: 'sub' }, 'Frage, Lösung und Erklärung am Stück – wie ein Podcast'))),
      !sttSupported() ? h('div', { class: 'banner info', style: { marginTop: '1rem' } }, 'Hands-free braucht Spracherkennung, die dieser Browser nicht bietet. Der Hörmodus funktioniert trotzdem.') : null,
      h('div', { class: 'card small muted', style: { marginTop: '1rem' } },
        h('b', {}, 'Tipps'),
        h('p', {}, 'Sag A bis E (auch „Antwort C“ oder bei Mehrfachauswahl „A und D“). Weitere Befehle: „wiederholen“, „weiter“, „stopp“.'),
        h('p', {}, 'Der Bildschirm bleibt an, damit die Spracherkennung läuft. Der Hörmodus kann auf Android oft auch bei gesperrtem Bildschirm weiterlaufen – das hängt vom Gerät ab.')));
  }

  async function begin(mode) {
    const pool = state.cards.filter((c) => inScope(c, scope));
    const queue = buildQueue(pool, state.progress, source, mode === 'podcast' ? Math.max(state.settings.sessionSize, 10) : state.settings.sessionSize);
    if (!queue.length) return toast('Keine passenden Karten gefunden.');
    if (mode === 'hands') {
      // Mikrofon-Berechtigung früh und mit verständlicher Meldung abfragen (aus dem Klick heraus)
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: true });
        st.getTracks().forEach((t) => t.stop());
      } catch (e) {
        root.prepend(h('div', { class: 'banner' }, describeSttError(e.name === 'NotFoundError' ? 'audio-capture' : 'not-allowed')));
        return;
      }
    }
    run = makeRun(mode, queue);
    run.start();
  }

  /* ------------------------------------------------------------ Lauf */
  function makeRun(mode, queue) {
    const s = state.settings;
    const sp = () => ({ rate: state.settings.ttsRate, voiceURI: state.settings.ttsVoice, lang: state.settings.ttsLang });
    let idx = 0, paused = false, aborted = false, skip = false, back = false, loop = false;
    let listener = null;
    let right = 0, done = 0, wrongList = [];

    // --- UI
    const qEl = h('div', { class: 'q-text' }), optsEl = h('div', { class: 'opts' }), statusTxt = h('span', {}), pulse = h('i', { class: 'pulse' });
    const headEl = h('span', {}), themeEl = h('span', {}), interim = h('div', { class: 'transcript' }, '');
    const errBox = h('div', {});
    const pauseBtn = h('button', { class: 'btn', onclick: () => togglePause() }, '⏸ Pause');
    const ui = h('div', {},
      errBox,
      h('div', { class: 'q-head' }, headEl, themeEl),
      h('div', { class: 'bar', style: { marginBottom: '.8rem' } }, h('i', { id: 'prog', style: { width: '0%' } })),
      qEl, optsEl,
      h('div', { class: 'status', style: { margin: '1rem 0 .6rem' }, 'aria-live': 'polite' }, pulse, statusTxt),
      mode === 'hands' ? interim : null,
      h('div', { class: 'grid2', style: { marginTop: '.8rem' } },
        pauseBtn,
        h('button', { class: 'btn', onclick: () => { skip = true; interrupt(); } }, mode === 'podcast' ? '⏭ Nächste' : '⏭ Überspringen')),
      h('div', { class: 'grid2', style: { marginTop: '.6rem' } },
        mode === 'podcast' ? h('button', { class: 'btn', onclick: () => { back = true; interrupt(); } }, '⏮ Zurück') : h('button', { class: 'btn', onclick: () => { restartCard = true; interrupt(); } }, '🔁 Wiederholen'),
        h('button', { class: 'btn danger', onclick: () => end(false) }, '⏹ Beenden')),
      mode === 'podcast' ? h('div', { class: 'card', style: { marginTop: '.8rem' } },
        h('label', { class: 'switch' }, h('span', {}, 'Endlos wiederholen'), h('input', { type: 'checkbox', onchange: (e) => { loop = e.target.checked; } })),
        h('label', { class: 'field' }, 'Tempo', h('input', { type: 'range', min: 0.6, max: 1.8, step: 0.1, value: s.ttsRate, onchange: (e) => { state.settings.ttsRate = Number(e.target.value); } }))) : null);
    let restartCard = false;

    const setStatus = (t, kind = '') => { statusTxt.textContent = t; pulse.className = 'pulse ' + kind; };
    const interrupted = () => aborted || paused || skip || back || restartCard;
    function interrupt() { cancelTTS(); listener && listener.abort(); }
    function togglePause() {
      paused = !paused; pauseBtn.textContent = paused ? '▶ Weiter' : '⏸ Pause';
      if (paused) { interrupt(); setStatus('Pausiert', 'off'); }
    }
    async function waitResume() { while (paused && !aborted) await sleep(200); }
    const say = async (t) => { if (interrupted()) return false; const ok = await speak(t, sp()); return ok && !interrupted(); };
    const wait = async (sec) => { if (interrupted()) return false; const ok = await pauseFor(sec * 1000); return ok && !interrupted(); };

    function showCard(view, n) {
      headEl.textContent = `Karte ${n + 1} / ${queue.length}`; themeEl.textContent = view.card.thema;
      document.getElementById('prog').style.width = pct(n, queue.length) + '%';
      qEl.textContent = view.card.frage; clear(optsEl);
      for (const o of view.opts) optsEl.append(h('div', { class: 'opt', dataset: { l: o.letter } }, h('span', { class: 'l' }, o.letter), h('span', {}, o.text)));
      interim.textContent = ''; interim.classList.remove('has');
      setMediaTitle(`Karte ${n + 1}: ${view.card.frage.slice(0, 60)}`);
    }
    const mark = (view, picked) => {
      for (const o of view.opts) {
        const el = optsEl.querySelector(`[data-l="${o.letter}"]`); if (!el) continue;
        if (o.correct && picked.includes(o.letter)) el.classList.add('right');
        else if (o.correct) el.classList.add('missed');
        else if (picked.includes(o.letter)) el.classList.add('wrong');
      }
    };
    const readQuestionText = (view, n) => `Frage ${n + 1}. ${view.card.frage}. ` +
      (view.multi ? 'Mehrere Antworten können richtig sein. ' : '') + view.opts.map((o) => `${o.letter}: ${o.text}.`).join(' ');
    const solutionText = (view) => 'Richtig ' + (view.multi ? 'sind ' : 'ist ') + correctLetters(view).map((l) => `${l}: ${view.opts.find((o) => o.letter === l).text}`).join('; und ') + '.';

    /* ---- eine Karte im Hands-free-Modus. Rückgabe: 'ok' | 'interrupted' | 'fatal' */
    async function handsCard(view, n) {
      showCard(view, n);
      setStatus('Lese vor …');
      if (!(await say(readQuestionText(view, n)))) return 'interrupted';
      let cmd = null, tries = 0;
      while (tries < 3) {
        setStatus('Ich höre zu … sag A bis E', 'rec');
        listener = listenOnce({ lang: s.sttLang, timeoutMs: s.listenTimeout * 1000, onInterim: (t) => { interim.textContent = t; interim.classList.add('has'); } });
        const r = await listener; listener = null;
        if (interrupted()) return 'interrupted';
        if (r.error) {
          errBox.replaceChildren(h('div', { class: 'banner' }, describeSttError(r.error)));
          return 'fatal';
        }
        cmd = parseAlternatives(r.alts, view.multi);
        if (cmd?.type === 'answer' || cmd?.type === 'skip') break;
        if (cmd?.type === 'stop') { end(false); return 'interrupted'; }
        if (cmd?.type === 'repeat') { setStatus('Lese erneut vor …'); if (!(await say(readQuestionText(view, n)))) return 'interrupted'; continue; }
        tries++;
        if (tries < 3 && !(await say(r.alts.length ? 'Das habe ich nicht verstanden. Bitte sage A bis E.' : 'Ich habe nichts gehört. Bitte sage A bis E.'))) return 'interrupted';
      }
      setStatus('Auswertung …');
      if (cmd?.type === 'answer') {
        const ok = isCorrect(view, cmd.letters);
        await recordAnswer(view.card.id, ok); done++; if (ok) right++; else wrongList.push(view.card);
        mark(view, cmd.letters);
        if (!(await say(ok ? 'Richtig.' : `Leider falsch. Du hast ${cmd.letters.join(' und ')} gesagt. ${solutionText(view)}`))) return 'interrupted';
      } else {
        mark(view, []);
        if (!(await say(cmd?.type === 'skip' ? solutionText(view) : 'Ich habe keine Antwort verstanden. ' + solutionText(view)))) return 'interrupted';
      }
      if (s.speakExplanation && view.card.erklaerung) { if (!(await say('Erklärung: ' + view.card.erklaerung))) return 'interrupted'; }
      if (!(await wait(s.autoNextDelay))) return 'interrupted';
      return 'ok';
    }

    /* ---- eine Karte im Podcast-Modus */
    async function podcastCard(view, n) {
      showCard(view, n);
      setStatus('Lese vor …');
      if (!(await say(readQuestionText(view, n)))) return 'interrupted';
      setStatus('Zeit zum Nachdenken …', 'off');
      if (!(await wait(s.thinkPause))) return 'interrupted';
      mark(view, []); setStatus('Lösung …');
      if (!(await say(solutionText(view)))) return 'interrupted';
      if (view.card.erklaerung && !(await say('Erklärung: ' + view.card.erklaerung))) return 'interrupted';
      if (!(await wait(1.2))) return 'interrupted';
      return 'ok';
    }

    async function loopAll() {
      while (!aborted) {
        if (idx >= queue.length) { if (mode === 'podcast' && loop) { idx = 0; } else break; }
        const view = present(queue[idx], state.settings.shuffle);
        skip = back = restartCard = false;
        const r = await (mode === 'hands' ? handsCard(view, idx) : podcastCard(view, idx));
        if (aborted) return;
        if (r === 'fatal') { setStatus('Spracherkennung nicht verfügbar', 'off'); await stopKeepAlive(); return; }
        if (r === 'interrupted') {
          if (paused) { await waitResume(); if (aborted) return; continue; }      // gleiche Karte nochmal
          if (restartCard) continue;
          if (back) { idx = Math.max(0, idx - 1); continue; }
          if (skip) { idx++; continue; }
          continue;
        }
        idx++;
      }
      if (!aborted) await finish();
    }

    async function finish() {
      await stopKeepAlive();
      const msg = mode === 'hands' ? `Fertig. ${right} von ${done} richtig.` : 'Fertig. Das waren alle Karten.';
      clear(root);
      root.append(h('div', { class: 'card center' }, h('div', { class: 'score' }, mode === 'hands' ? pct(right, done) + ' %' : '✓'), h('p', {}, msg)),
        h('div', { class: 'btn-stack' }, h('button', { class: 'btn primary', onclick: menu }, 'Fertig')));
      speak(msg, sp());
    }

    async function end(silent) {
      aborted = true; interrupt(); await stopKeepAlive();
      run = null;
      if (!silent) { cancelTTS(); menu(); }
    }

    return {
      end,
      async start() {
        clear(root); root.append(ui);
        await startKeepAlive({ title: 'Prüfungstrainer', screen: s.wakeLock, handlers: { play: () => paused && togglePause(), pause: () => !paused && togglePause(), next: () => { skip = true; interrupt(); }, prev: () => { back = true; interrupt(); } } });
        loopAll();
      },
    };
  }
}
