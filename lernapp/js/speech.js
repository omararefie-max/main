/* Sprachausgabe (TTS), Spracherkennung (STT) und "Wach halten" für die Hörmodi.
 * Nutzt ausschließlich Browser-APIs (Web Speech API, Media Session, Wake Lock).
 *
 * Ehrliche Grenzen einer PWA (Details im README):
 *  - Chrome/Android: Spracherkennung läuft standardmäßig über Google-Server (nicht offline!).
 *    Neuere Chrome-Versionen können sie lokal ausführen (processLocally) – siehe Einstellungen.
 *  - Bei gesperrtem Bildschirm pausiert Android Webseiten häufig; Wake Lock + Medien-Sitzung helfen nur teilweise. */
import { sleep } from './util.js';

/* =====================  TEXT-TO-SPEECH  ===================== */
const synth = window.speechSynthesis;
export const ttsSupported = !!synth && 'SpeechSynthesisUtterance' in window;
let token = 0;

export const getVoices = () => (synth ? synth.getVoices().filter((v) => /^de/i.test(v.lang)) : []);
export const onVoices = (cb) => synth?.addEventListener('voiceschanged', cb);

function pickVoice(uri) {
  const vs = getVoices();
  return vs.find((v) => v.voiceURI === uri) || vs.find((v) => /de-AT/i.test(v.lang) && v.localService) ||
    vs.find((v) => /de-DE/i.test(v.lang) && v.localService) || vs[0] || null;
}

/** Text in Sätze/Häppchen teilen (verhindert Abbrüche bei langen Äußerungen). */
function chunk(text, max = 220) {
  const parts = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).trim().length > max && cur) { out.push(cur); cur = p; } else cur = (cur + ' ' + p).trim();
  }
  if (cur) out.push(cur);
  return out.flatMap((c) => (c.length > max * 1.5 ? c.split(/(?<=,)\s+/) : [c]));
}

export function cancelSpeech() { token++; synth?.cancel(); }

/** Liest Text vor. Resolve true = vollständig gesprochen, false = abgebrochen. Wirft bei echtem TTS-Fehler. */
export async function speak(text, { rate = 1, voiceURI = '' } = {}) {
  if (!ttsSupported) throw new Error('TTS_UNSUPPORTED');
  const my = ++token;
  synth.cancel();
  const voice = pickVoice(voiceURI);
  for (const part of chunk(text)) {
    if (my !== token) return false;
    await new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang || 'de-DE';
      if (voice) u.voice = voice;
      u.rate = rate;
      // Sicherheitsnetz: manche Android-Versionen feuern "end" nicht zuverlässig
      const guard = setTimeout(resolve, (part.length * 95) / rate + 6000);
      u.onend = () => { clearTimeout(guard); resolve(); };
      u.onerror = (e) => {
        clearTimeout(guard);
        if (e.error === 'canceled' || e.error === 'interrupted') resolve(); else reject(new Error('TTS_' + e.error));
      };
      synth.speak(u);
    });
  }
  return my === token;
}

export function ttsErrorMessage(e) {
  if (e?.message === 'TTS_UNSUPPORTED') return 'Sprachausgabe wird von diesem Browser nicht unterstützt. Nutze Chrome auf Android.';
  return 'Die Sprachausgabe ist nicht verfügbar. Prüfe in den Android-Einstellungen („Text-to-Speech“), ob eine deutsche Stimme installiert ist.';
}

/* =====================  SPEECH-TO-TEXT  ===================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const sttSupported = !!SR;

/** Status der lokalen (Offline-)Erkennung: 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown' | 'unsupported' */
export async function localRecognitionStatus(lang) {
  if (!SR) return 'unsupported';
  if (typeof SR.available !== 'function') return 'unknown';
  try { const r = await SR.available({ langs: [lang], processLocally: true }); return typeof r === 'string' ? r : r?.status || 'unknown'; }
  catch { return 'unknown'; }
}
export async function installLocalRecognition(lang) {
  if (typeof SR?.install !== 'function') throw new Error('Dieser Browser kann Sprachpakete nicht selbst installieren.');
  return SR.install({ langs: [lang], processLocally: true });
}

/**
 * Hört zu. Gibt { promise, stop } zurück; promise → { transcript, error }.
 * continuous=true: für lange Antworten (Prüfung) – endet nach `silenceMs` Stille oder bei stop().
 */
export function listen({ lang = 'de-AT', continuous = false, silenceMs = 4000, maxMs = 20000, localOnly = false, onInterim } = {}) {
  let finish = () => {};
  const promise = new Promise((resolve) => {
    if (!SR) return resolve({ transcript: '', error: 'unsupported' });
    let rec, done = false, acc = '', current = '', lastActivity = Date.now(), heard = false;
    const start = Date.now();
    const texts = () => (acc + ' ' + current).replace(/\s+/g, ' ').trim();

    finish = (error) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      try { rec.stop(); } catch { /* egal */ }
      resolve({ transcript: texts(), error: error || null });
    };

    const create = () => {
      rec = new SR();
      rec.lang = lang;
      rec.continuous = continuous;
      rec.interimResults = true;
      if (localOnly && 'processLocally' in rec) rec.processLocally = true;
      rec.onresult = (e) => {
        lastActivity = Date.now(); heard = true;
        // Android-Chrome liefert im continuous-Modus teils kumulative Ergebnisse → Duplikate entfernen
        const segs = [];
        for (let i = 0; i < e.results.length; i++) {
          const t = e.results[i][0].transcript.trim();
          if (segs.length && t.toLowerCase().startsWith(segs[segs.length - 1].toLowerCase())) segs[segs.length - 1] = t; else segs.push(t);
        }
        current = segs.join(' ');
        onInterim?.(texts());
      };
      rec.onerror = (e) => { if (e.error === 'no-speech' || e.error === 'aborted') return; finish(e.error); };
      rec.onend = () => {
        if (done) return;
        // Chrome beendet die Sitzung von selbst (z. B. nach Pausen) → in continuous-Modus neu starten, solange keine lange Stille
        if (continuous && Date.now() - lastActivity < silenceMs && Date.now() - start < maxMs) {
          acc = texts(); current = '';
          try { create(); rec.start(); } catch { finish(); }
        } else finish();
      };
    };
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - start > maxMs) finish();
      else if (continuous && heard && now - lastActivity > silenceMs) finish();
    }, 300);

    try { create(); rec.start(); } catch { finish('start-failed'); }
  });
  return { promise, stop: () => finish() };
}

export function sttErrorMessage(code) {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Mikrofon-Berechtigung fehlt. Tippe in Chrome auf das Schloss-Symbol bzw. öffne Android-Einstellungen → Apps → Chrome → Berechtigungen → Mikrofon und erlaube den Zugriff.';
    case 'audio-capture': return 'Es wurde kein Mikrofon gefunden oder es wird von einer anderen App benutzt.';
    case 'network': return 'Die Spracherkennung braucht hier eine Internetverbindung (Chrome nutzt dafür Google). Aktiviere in den Einstellungen die lokale Erkennung mit deutschem Sprachpaket oder nutze die Texteingabe.';
    case 'language-not-supported': return 'Die gewählte Sprache wird von der Spracherkennung nicht unterstützt. Wähle in den Einstellungen de-DE statt de-AT.';
    case 'unsupported': return 'Spracherkennung wird von diesem Browser nicht unterstützt. Nutze Chrome auf Android oder die Texteingabe.';
    default: return 'Die Spracherkennung ist fehlgeschlagen (' + code + '). Versuche es erneut oder nutze die Texteingabe.';
  }
}

/* ---------- Antwort per Sprache verstehen ("A", "Antwort C", "B und D", "wiederholen") ---------- */
const LETTER_WORDS = {
  a: 0, ah: 0, aa: 0, ae: 0,
  b: 1, be: 1, bee: 1, beh: 1, bei: 1, pe: 1,
  c: 2, ce: 2, ze: 2, zeh: 2, se: 2, tse: 2, ci: 2, see: 2,
  d: 3, de: 3, deh: 3, dee: 3, te: 3,
  e: 4, eh: 4, ee: 4, eeh: 4
};
const NUM_WORDS = { eins: 0, erste: 0, ersten: 0, zwei: 1, zweite: 1, zweiten: 1, drei: 2, dritte: 2, dritten: 2, vier: 3, vierte: 3, vierten: 3, fuenf: 4, fuenfte: 4, funf: 4, fünf: 4, fünfte: 4 };

export function parseAnswerSpeech(text) {
  const t = (text || '').toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(stopp|stop|ende|beenden|aufhoeren|aufhören|abbrechen)\b/.test(t)) return { command: 'stop', letters: [] };
  if (/\b(wiederhol\w*|nochmal|noch einmal|nochmals)\b/.test(t)) return { command: 'repeat', letters: [] };
  if (/\b(weiter|naechste\w*|nächste\w*|ueberspring\w*|überspring\w*|ich weiss nicht|ich weiß nicht|keine ahnung)\b/.test(t)) return { command: 'skip', letters: [] };
  const letters = new Set();
  for (const w of t.split(' ')) {
    if (w in LETTER_WORDS) letters.add(LETTER_WORDS[w]);
    else if (w in NUM_WORDS) letters.add(NUM_WORDS[w]);
  }
  return { command: null, letters: [...letters].sort() };
}

/* =====================  WACH HALTEN / MEDIEN-SITZUNG  ===================== */
let audioEl = null, wakeLock = null, visHandler = null;

function silentWavUrl() {
  const sr = 8000, n = sr;
  const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** Muss aus einem Klick heraus aufgerufen werden (Autoplay-Regeln). */
export async function startKeepAlive({ title = 'Lernapp', handlers = {} } = {}) {
  try {
    if (!audioEl) { audioEl = new Audio(silentWavUrl()); audioEl.loop = true; audioEl.volume = 0.01; }
    await audioEl.play();
  } catch { /* nicht kritisch */ }
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Lernapp' });
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack']) {
        navigator.mediaSession.setActionHandler(a, handlers[a] || null);
      }
    } catch { /* ältere Browser */ }
  }
  const lock = async () => { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* nicht kritisch */ } };
  await lock();
  visHandler = () => { if (document.visibilityState === 'visible') lock(); };
  document.addEventListener('visibilitychange', visHandler);
}

export function stopKeepAlive() {
  try { audioEl?.pause(); } catch { /* egal */ }
  try { wakeLock?.release(); } catch { /* egal */ }
  wakeLock = null;
  if (visHandler) document.removeEventListener('visibilitychange', visHandler);
  visHandler = null;
  if ('mediaSession' in navigator) {
    try { for (const a of ['play', 'pause', 'nexttrack', 'previoustrack']) navigator.mediaSession.setActionHandler(a, null); } catch { /* egal */ }
  }
}

export { sleep };
