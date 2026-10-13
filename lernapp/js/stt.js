// Spracherkennung (Speech-to-Text) über die Web Speech API.
//
// WICHTIG (Datenschutz/Offline): In Chrome für Android läuft die Erkennung normalerweise
// über Google-Server (Internet nötig, Audio verlässt das Gerät). Neuere Chrome-Versionen
// können mit `processLocally` eine On-Device-Erkennung nutzen, falls das deutsche
// Sprachpaket installiert ist. Die App versucht das, wenn die Einstellung
// "Nur lokale Erkennung" aktiv ist, und meldet verständlich, falls es nicht geht.

import { state } from './store.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;

const MESSAGES = {
  'not-allowed': 'Mikrofon-Berechtigung fehlt. Erlaube den Mikrofonzugriff in den Browser-/Website-Einstellungen und starte neu.',
  'service-not-allowed': 'Spracherkennung ist auf diesem Gerät nicht erlaubt (Browser- oder Systemeinstellungen prüfen).',
  'audio-capture': 'Kein Mikrofon gefunden oder es wird von einer anderen App benutzt.',
  network: 'Die Spracherkennung braucht hier eine Internetverbindung (oder ein offline geladenes Sprachpaket).',
  'language-not-supported': 'Die gewählte Sprache wird von der Spracherkennung nicht unterstützt.',
  'no-speech': 'Es wurde nichts gesprochen.',
  aborted: '',
};
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported']);

export const errorMessage = (code) => MESSAGES[code] ?? `Spracherkennung-Fehler (${code}).`;
export const isFatal = (code) => FATAL.has(code);

function makeRec(continuous) {
  const r = new SR();
  r.lang = state.settings.sttLang || 'de-AT';
  r.continuous = continuous;
  r.interimResults = true;
  r.maxAlternatives = 5;
  if (state.settings.sttLocal && 'processLocally' in r) r.processLocally = true;
  return r;
}

/**
 * Kurze Antwort (z. B. "Antwort B"). Liefert {alts:[…], error, message, fatal}.
 * abort() bricht ab.
 */
export function listenShort({ timeoutMs = 9000 } = {}) {
  let rec, timer, abortFn;
  const promise = new Promise((resolve) => {
    if (!sttSupported) return resolve({ alts: [], error: 'unsupported', message: 'Spracherkennung wird von diesem Browser nicht unterstützt (Chrome auf Android verwenden).', fatal: true });
    let alts = [], error = null, done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ alts, error, message: error ? errorMessage(error) : '', fatal: error ? isFatal(error) : false });
    };
    try { rec = makeRec(false); } catch (e) { error = 'service-not-allowed'; return finish(); }
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      if (res.isFinal) alts = Array.from(res).map((a) => a.transcript);
    };
    rec.onerror = (e) => { error = e.error; };
    rec.onend = finish;
    abortFn = () => { error = error || 'aborted'; try { rec.abort(); } catch {} finish(); };
    timer = setTimeout(() => { try { rec.stop(); } catch {} }, timeoutMs);
    try { rec.start(); } catch (e) { error = 'service-not-allowed'; finish(); }
  });
  return { promise, abort: () => abortFn?.() };
}

/**
 * Freie, längere Antwort (mündliche Prüfung). Sammelt Text, startet bei Chrome-Timeouts
 * automatisch neu und endet bei stop()/abort() oder nach `silenceMs` Stille (onSilence).
 * onUpdate(text) wird bei jedem Zwischenergebnis mit dem gesamten Text aufgerufen.
 */
export function listenLong({ silenceMs = 0, onUpdate, onSilence } = {}) {
  let rec, committed = '', session = '', stopped = false, silenceTimer, noSpeech = 0, error = null, resolveFn;
  const join = (a, b) => [a, b].filter(Boolean).join(' ').trim();
  const full = () => join(committed, session);
  const promise = new Promise((resolve) => { resolveFn = resolve; });
  const end = () => {
    if (stopped === 'done') return; stopped = 'done'; clearTimeout(silenceTimer);
    resolveFn({ text: full(), error, message: error && error !== 'aborted' ? errorMessage(error) : '', fatal: error ? isFatal(error) : false });
  };
  const armSilence = () => {
    clearTimeout(silenceTimer);
    if (silenceMs > 0) silenceTimer = setTimeout(() => (onSilence ? onSilence() : stop()), silenceMs);
  };
  function startRec() {
    if (!sttSupported) { error = 'unsupported'; return end(); }
    try { rec = makeRec(true); } catch { error = 'service-not-allowed'; return end(); }
    rec.onresult = (e) => {
      noSpeech = 0;
      session = Array.from(e.results).map((r) => r[0].transcript.trim()).join(' ').trim();
      onUpdate?.(full());
      armSilence();
    };
    rec.onerror = (e) => { error = e.error; };
    rec.onend = () => {
      committed = full(); session = '';
      if (stopped) return end();
      if (error && (isFatal(error) || error === 'aborted')) return end();
      if (error === 'no-speech') { noSpeech++; error = null; if (noSpeech >= 3) { error = committed ? null : 'no-speech'; return end(); } }
      error = null;
      setTimeout(() => { if (!stopped) { try { startRec(); } catch { end(); } } }, 200);
    };
    try { rec.start(); } catch { error = 'service-not-allowed'; end(); }
  }
  function stop() { if (stopped) return; stopped = true; clearTimeout(silenceTimer); try { rec?.stop(); } catch { end(); } setTimeout(end, 1500); }
  function abort() { error = error || 'aborted'; stopped = true; clearTimeout(silenceTimer); try { rec?.abort(); } catch {} end(); }
  startRec();
  return { promise, stop, abort, text: full };
}

/** Kurzer Mikrofon-Test für die Einstellungen. */
export async function testMic() {
  const r = await listenShort({ timeoutMs: 6000 }).promise;
  return r.error && r.error !== 'no-speech' ? { ok: false, message: r.message } : { ok: true, text: r.alts[0] || '' };
}
