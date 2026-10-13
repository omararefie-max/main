// views/oral.js – Modul 3: Simulation einer mündlichen Prüfung.
//
// Ablauf pro Frage:  Prüfer stellt Frage (Sprache + Text) -> du antwortest frei (Spracherkennung oder Tippen)
//   -> lokale Bewertung über Schlüsselbegriffe -> bei Lücken (< 60 %) bis zu N Nachfragen -> nächste Frage.
// Am Ende: Protokoll mit Transkript, Bewertung je Frage, Empfehlungen; Verlauf wird gespeichert.
// Die Bewertung läuft über grader.js (lokal; optional KI-Schnittstelle).

import { h, clear, fmtTime, fmtDate, shuffle, download, pct, toast } from '../util.js';
import { state, addOralRun, getOralRuns, inScope } from '../store.js';
import { scopeSelect, emptyState } from '../ui.js';
import { gradeLocal, gradeAnswer, gradeFromPercent, needsFollowUp, feedbackText } from '../grader.js';
import { speak, cancelTTS, listenLong, sttSupported, ttsSupported, describeSttError } from '../speech.js';
import { startKeepAlive, stopKeepAlive } from '../power.js';

let scope = '';
const GENERIC_FOLLOWUPS = ['Können Sie das bitte genauer erläutern?', 'Gibt es dazu noch weitere wichtige Aspekte?', 'Fällt Ihnen dazu noch etwas ein?'];

export function render(root) {
  let abortRun = null;
  menu();
  return async () => { if (abortRun) abortRun(); cancelTTS(); await stopKeepAlive(); };

  /* ------------------------------------------------------------ Menü */
  async function menu() {
    clear(root);
    if (!state.oral.length) { root.append(emptyState('oral', menu)); return; }
    const pool = state.oral.filter((q) => inScope(q, scope));
    const s = state.settings;
    const nQ = h('input', { type: 'number', min: 1, max: Math.max(1, pool.length), value: Math.min(s.oralQuestions, Math.max(1, pool.length)) });
    const mins = h('input', { type: 'number', min: 1, max: 120, value: s.oralMinutes });
    const fu = h('input', { type: 'number', min: 0, max: 3, value: s.followups });
    root.append(
      scopeSelect(scope, (v) => { scope = v; menu(); }, 'Thema / Bereich'),
      h('p', { class: 'muted small' }, `${pool.length} Prüfungsfragen im Bereich`),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Fragen', nQ), h('label', { class: 'field' }, 'Minuten', mins)),
      h('label', { class: 'field' }, 'Max. Nachfragen pro Frage', fu),
      !sttSupported() ? h('div', { class: 'banner info' }, 'Spracherkennung ist hier nicht verfügbar – du kannst deine Antworten tippen.') : null,
      h('button', { class: 'btn primary', disabled: !pool.length, onclick: () => start(pool, { n: Math.max(1, Number(nQ.value) || 1), minutes: Math.max(1, Number(mins.value) || 15), followups: Math.max(0, Number(fu.value) || 0) }) },
        '🎤 Prüfung starten', h('span', { class: 'sub' }, 'Der Prüfer stellt die Fragen laut – du antwortest frei')));

    const runs = (await getOralRuns()).sort((a, b) => b.date - a.date);
    if (runs.length) {
      root.append(h('h3', {}, 'Verlauf'), trend(runs),
        ...runs.slice(0, 15).map((r) => h('button', { class: 'list-item', onclick: () => showRun(r) },
          `${r.percent} % · Note ${r.note} (${r.noteText})`, h('small', {}, `${fmtDate(r.date)} · ${r.items.length} ${r.items.length === 1 ? 'Frage' : 'Fragen'} · ${fmtTime(r.seconds)} min`))));
    }
  }

  /** Entwicklung der Prozentwerte als Liniendiagramm. */
  function trend(runs) {
    if (runs.length < 2) return h('span', {});
    const pts = runs.slice(0, 20).reverse(); const W = 300, H = 90;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H + 14}`); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Entwicklung der Prüfungsergebnisse');
    const x = (i) => 10 + (i / (pts.length - 1)) * (W - 20), y = (p) => H - (p / 100) * H;
    const line = document.createElementNS(ns, 'polyline'); line.setAttribute('points', pts.map((r, i) => `${x(i)},${y(r.percent)}`).join(' '));
    line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'var(--accent)'); line.setAttribute('stroke-width', '2.5'); svg.append(line);
    pts.forEach((r, i) => { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', x(i)); c.setAttribute('cy', y(r.percent)); c.setAttribute('r', 3.5); c.setAttribute('fill', 'var(--accent)'); svg.append(c); });
    const t = document.createElementNS(ns, 'text'); t.setAttribute('x', 10); t.setAttribute('y', H + 12); t.textContent = '0–100 %, älteste → neueste'; svg.append(t);
    return h('div', { class: 'card' }, svg);
  }

  /* ----------------------------------------------------- Prüfungslauf */
  async function start(pool, cfg) {
    const questions = shuffle(pool).slice(0, Math.min(cfg.n, pool.length));
    const s = state.settings;
    let aborted = false, textMode = !sttSupported(), listenHandle = null, busy = true;
    let current = { done() {}, repeat() {}, skip() {} };
    const t0 = Date.now(), deadline = t0 + cfg.minutes * 60000;
    const items = [];

    // Mikrofon früh prüfen (aus dem Klick heraus); bei Problemen auf Tippen umschalten
    const notice = h('div', {});
    if (!textMode) {
      try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); }
      catch (e) { textMode = true; notice.append(h('div', { class: 'banner' }, describeSttError('not-allowed') + ' Du kannst die Prüfung per Tippen fortsetzen.')); }
    }
    startKeepAlive({ screen: s.wakeLock, media: false });

    // --- UI
    const head = h('span', {}), timeEl = h('span', {}), qEl = h('div', { class: 'q-text' });
    const statusTxt = h('span', {}), pulse = h('i', { class: 'pulse off' });
    const live = h('div', { class: 'transcript' }, '');
    const ta = h('textarea', { placeholder: 'Antwort hier tippen …', 'aria-label': 'Antwort', style: { display: 'none', minHeight: '9rem' } });
    const doneBtn = h('button', { class: 'btn primary', onclick: () => current.done() }, '✔ Antwort beenden');
    const repeatBtn = h('button', { class: 'btn', onclick: () => current.repeat() }, '🔁 Frage wiederholen');
    const skipBtn = h('button', { class: 'btn', onclick: () => current.skip() }, '⏭ Überspringen');
    const stopBtn = h('button', { class: 'btn danger small', onclick: () => { if (confirm('Prüfung abbrechen? Bisherige Antworten werden trotzdem ausgewertet.')) endNow(); } }, '⏹ Prüfung beenden');
    const modeBtn = h('button', { class: 'btn small', onclick: () => { textMode = !textMode; toast(textMode ? 'Tippen aktiv (ab der nächsten Antwort)' : 'Sprechen aktiv (ab der nächsten Antwort)'); modeBtn.textContent = textMode ? '🎤 Lieber sprechen' : '⌨ Lieber tippen'; } }, textMode ? '🎤 Lieber sprechen' : '⌨ Lieber tippen');
    const setBusy = (b) => { busy = b; [doneBtn, repeatBtn, skipBtn].forEach((x) => { x.disabled = b; }); };
    clear(root);
    root.append(notice,
      h('div', { class: 'q-head' }, head, timeEl),
      h('div', { class: 'card' }, h('b', { class: 'muted small' }, 'Prüfer'), qEl),
      h('div', { class: 'status', 'aria-live': 'polite' }, pulse, statusTxt), h('div', { style: { height: '.6rem' } }),
      live, ta,
      h('div', { class: 'dock static', style: { marginTop: '.8rem' } }, doneBtn, h('div', { class: 'grid2' }, repeatBtn, skipBtn), h('div', { class: 'grid2' }, stopBtn, sttSupported() ? modeBtn : null)));
    const status = (t, kind = 'off') => { statusTxt.textContent = t; pulse.className = 'pulse ' + kind; };
    const timer = setInterval(() => { const left = Math.round((deadline - Date.now()) / 1000); timeEl.textContent = left > 0 ? '⏱ ' + fmtTime(left) : '⏱ Zeit abgelaufen'; }, 1000);
    timeEl.textContent = '⏱ ' + fmtTime(cfg.minutes * 60);

    const endNow = () => { aborted = true; cancelTTS(); listenHandle && listenHandle.abort(); current.skip(); };
    abortRun = () => { aborted = true; clearInterval(timer); cancelTTS(); listenHandle && listenHandle.abort(); current.skip(); };

    const say = async (t) => { if (aborted) return; setBusy(true); status('Der Prüfer spricht …', ''); if (ttsSupported()) await speak(t, { rate: s.ttsRate, voiceURI: s.ttsVoice, lang: s.ttsLang }); };

    /** Sammelt EINE Antwort (Sprache oder Text). Rückgabe {text, action:'done'|'repeat'|'skip'} */
    function collect() {
      return new Promise((resolve) => {
        let finished = false;
        const finish = (text, action = 'done') => {
          if (finished) return; finished = true;
          listenHandle = null; ta.style.display = 'none'; live.style.display = ''; resolve({ text: (text || '').trim(), action });
        };
        setBusy(false); ta.value = ''; live.textContent = ''; live.classList.remove('has');
        current = { done: () => finish(ta.value || live.textContent), repeat: () => { listenHandle && listenHandle.abort(); finish('', 'repeat'); }, skip: () => { listenHandle && listenHandle.abort(); finish('', 'skip'); } };
        const typeInstead = () => {
          live.style.display = 'none'; ta.style.display = 'block'; status('Bitte Antwort tippen und „Antwort beenden“ drücken', ''); ta.focus();
          current.done = () => finish(ta.value);
        };
        if (aborted) return finish('', 'skip');
        if (textMode) return typeInstead();
        status('Ich höre zu – sprich frei. Pause von 3–4 s oder „Antwort beenden“ schließt ab.', 'rec');
        current.done = () => listenHandle && listenHandle.stop();
        listenHandle = listenLong({ lang: s.sttLang, silenceMs: 3500, onText: (t) => { live.textContent = t; live.classList.add('has'); } });
        listenHandle.then((r) => {
          if (finished) return;
          if (r.error) { textMode = true; notice.replaceChildren(h('div', { class: 'banner' }, describeSttError(r.error))); typeInstead(); }
          else finish(r.text);
        });
      });
    }

    /** Frage stellen und Antwort einsammeln (inkl. "Frage wiederholen"). */
    async function ask(text, prefix = '') {
      while (!aborted) {
        qEl.textContent = text;
        await say(prefix + text); prefix = '';   // Einleitung ("Danke. Nächste Frage:") nur beim ersten Mal sprechen
        if (aborted) return null;
        const r = await collect();
        if (r.action === 'repeat') continue;
        return r.action === 'skip' ? '' : r.text;
      }
      return null;
    }

    // --- Hauptschleife
    for (let n = 0; n < questions.length && !aborted; n++) {
      if (n > 0 && Date.now() > deadline) { await say('Die Zeit ist leider um. Wir beenden die Prüfung hier.'); break; }
      const q = questions[n];
      head.textContent = `Frage ${n + 1} / ${questions.length}`;
      const item = { id: q.id, frage: q.frage, thema: [q.fach, q.thema].filter(Boolean).join(' › '), muster: q.musterantwort, keys: q.schluesselbegriffe.map((k) => k.begriff), answers: [] };
      const intro = n === 0 ? 'Guten Tag. Wir beginnen jetzt mit der mündlichen Prüfung. Erste Frage: ' : n === questions.length - 1 ? 'Danke. Letzte Frage: ' : 'Danke. Nächste Frage: ';
      const first = await ask(q.frage, intro);
      if (first === null) { if (item.answers.length) items.push(item); break; }
      item.answers.push({ role: 'Antwort', text: first });
      let combined = first, res = gradeLocal(q, combined), fu = 0;
      while (!aborted && fu < cfg.followups && first && needsFollowUp(res) && Date.now() < deadline) {
        const prompt = q.nachfragen?.[fu] || GENERIC_FOLLOWUPS[fu % GENERIC_FOLLOWUPS.length];
        const more = await ask(prompt);
        if (more === null) break;
        item.answers.push({ role: 'Nachfrage', prompt, text: more });
        combined += ' ' + more; res = gradeLocal(q, combined); fu++;
        if (!more) break;
      }
      items.push(item);
    }

    clearInterval(timer); abortRun = null; listenHandle = null;
    await stopKeepAlive();
    setBusy(true); status('Auswertung …', '');
    const seconds = Math.round((Date.now() - t0) / 1000);
    const qById = new Map(questions.map((q) => [q.id, q]));
    for (const it of items) {
      const q = qById.get(it.id);
      const text = it.answers.map((a) => a.text).join(' ');
      const r = await gradeAnswer(q, text, state.settings);
      Object.assign(it, { score: r.score, covered: r.covered, missing: r.missing, feedback: r.feedback || feedbackText(r.score, r.missing), mode: r.mode });
    }
    if (!items.length) { toast('Keine Antworten – Prüfung nicht gespeichert.'); return menu(); }
    const percent = Math.round(items.reduce((a, b) => a + b.score, 0) / items.length);
    const g = gradeFromPercent(percent);
    const run = { date: Date.now(), scope, seconds, percent, note: g.note, noteText: g.text, items };
    await addOralRun(run);
    if (ttsSupported() && !aborted) speak(`Die Prüfung ist beendet. Ergebnis: ${percent} Prozent, Note ${g.note}, ${g.text}.`, { rate: s.ttsRate, voiceURI: s.ttsVoice, lang: s.ttsLang });
    showRun(run);
  }

  /* --------------------------------------------------------- Protokoll */
  function showRun(run) {
    cancelTTS(); clear(root);
    const weak = run.items.slice().sort((a, b) => a.score - b.score).filter((i) => i.score < 75);
    const col = (p) => (p >= 75 ? 'var(--ok)' : p >= 50 ? 'var(--warn)' : 'var(--bad)');
    root.append(
      h('div', { class: 'card center' },
        h('div', { class: 'score', style: { color: col(run.percent) } }, run.percent + ' %'),
        h('p', {}, h('b', {}, `Note ${run.note} – ${run.noteText}`)),
        h('p', { class: 'muted small' }, `${fmtDate(run.date)} · ${run.items.length} ${run.items.length === 1 ? 'Frage' : 'Fragen'} · ${fmtTime(run.seconds)} min`)),
      h('h3', {}, 'Verbesserungsempfehlungen'),
      weak.length ? h('div', { class: 'card' }, ...weak.map((i) => h('p', {}, h('b', {}, `${i.thema} (${i.score} %): `), i.missing.length ? 'Wiederhole ' + i.missing.slice(0, 6).join(', ') + '.' : 'Antworte ausführlicher und strukturierter.')))
        : h('div', { class: 'card' }, 'Sehr stark – alle Antworten ≥ 75 %. Weiter so!'),
      h('h3', {}, 'Protokoll'),
      ...run.items.map((i, k) => h('details', { class: 'card' },
        h('summary', {}, h('span', { style: { color: col(i.score), marginRight: '.5rem', whiteSpace: 'nowrap' } }, i.score + ' %'), `Frage ${k + 1}: ${i.frage.slice(0, 70)}${i.frage.length > 70 ? '…' : ''}`),
        h('p', {}, h('b', {}, i.frage)),
        ...i.answers.map((a) => h('div', { style: { margin: '.5rem 0' } }, h('div', { class: 'muted small' }, a.role + (a.prompt ? ` auf „${a.prompt}“` : '')), h('div', { class: 'transcript has' }, a.text || '(keine Antwort)'))),
        h('div', {}, ...i.covered.map((c) => h('span', { class: 'chip ok' }, '✓ ' + c)), ...i.missing.map((c) => h('span', { class: 'chip bad' }, '✗ ' + c))),
        h('p', {}, i.feedback), i.mode === 'ai' ? h('p', { class: 'muted small' }, 'Bewertet mit KI-Schnittstelle') : null,
        i.muster ? h('details', {}, h('summary', {}, 'Musterantwort'), h('p', { class: 'small' }, i.muster)) : null)),
      h('div', { class: 'btn-stack' },
        h('button', { class: 'btn', onclick: () => download(`pruefungsprotokoll-${new Date(run.date).toISOString().slice(0, 10)}.md`, protocol(run), 'text/markdown') }, 'Protokoll exportieren'),
        h('button', { class: 'btn primary', onclick: menu }, 'Zurück')));
  }

  function protocol(run) {
    const L = [`# Prüfungsprotokoll ${fmtDate(run.date)}`, '', `Ergebnis: ${run.percent} % – Note ${run.note} (${run.noteText}), Dauer ${fmtTime(run.seconds)} min`, ''];
    run.items.forEach((i, k) => {
      L.push(`## Frage ${k + 1} (${i.score} %) – ${i.thema}`, '', i.frage, '');
      i.answers.forEach((a) => L.push(`**${a.role}${a.prompt ? ' auf „' + a.prompt + '“' : ''}:** ${a.text || '(keine Antwort)'}`, ''));
      L.push(`Genannt: ${i.covered.join(', ') || '–'}`, `Fehlt: ${i.missing.join(', ') || '–'}`, '', i.feedback, '');
    });
    return L.join('\n');
  }
}
