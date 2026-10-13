// Sprachausgabe (Text-to-Speech) über die Web Speech API / Systemstimme.
// Funktioniert offline, sobald auf dem Handy eine deutsche Stimme installiert ist
// (Android: Einstellungen > Sprachausgabe; Google-Stimmen lassen sich offline laden).

import { state } from './store.js';

const synth = window.speechSynthesis;
export const ttsSupported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

let lastCancel = 0;
let epoch = 0; // jede cancel()-Runde erhöht den Zähler -> laufende speak()-Aufrufe brechen ab

/** Verfügbare deutsche Stimmen (oft erst nach 'voiceschanged' gefüllt). */
export function germanVoices() {
  if (!ttsSupported) return [];
  const all = synth.getVoices().filter((v) => /^de/i.test(v.lang));
  const rank = (v) => (/de[-_]AT/i.test(v.lang) ? 0 : /de[-_]DE/i.test(v.lang) ? 1 : 2);
  return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function voicesReady() {
  return new Promise((resolve) => {
    if (!ttsSupported) return resolve([]);
    const v = germanVoices();
    if (v.length) return resolve(v);
    const done = () => resolve(germanVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

function currentVoice() {
  const voices = germanVoices();
  return voices.find((v) => v.voiceURI === state.settings.ttsVoice) || voices[0] || null;
}

/** Text in kurze Stücke teilen (lange Äußerungen brechen auf manchen Geräten ab). */
export function splitText(text, max = 200) {
  const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?:;])\s+/);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + ' ' + s).trim().length <= max) cur = (cur + ' ' + s).trim();
    else {
      if (cur) out.push(cur);
      if (s.length <= max) cur = s;
      else { // sehr langer Satz: an Kommas/Leerzeichen teilen
        const parts = s.match(new RegExp(`.{1,${max}}(?:\\s|$)`, 'g')) || [s];
        out.push(...parts.slice(0, -1).map((p) => p.trim())); cur = parts[parts.length - 1].trim();
      }
    }
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}

function speakChunk(text, rate) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = currentVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'de-DE';
    u.rate = rate;
    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; clearTimeout(guard); resolve(ok); } };
    // Sicherheitsnetz: manche Engines feuern 'end' nie (z. B. wenn die Stimme fehlt)
    const guard = setTimeout(() => { synth.cancel(); done(true); }, 4000 + (text.length * 130) / rate);
    u.onend = () => done(true);
    u.onerror = (e) => done(e.error === 'canceled' || e.error === 'interrupted' ? false : true);
    synth.speak(u);
  });
}

/**
 * Spricht den Text. Liefert true, wenn vollständig gesprochen, false bei Abbruch (cancel()).
 * Ohne Sprachausgabe liefert die Funktion sofort true, damit Abläufe weiterlaufen.
 */
export async function speak(text, { rate } = {}) {
  if (!ttsSupported || !text) return true;
  // Chrome verschluckt manchmal Äußerungen, die unmittelbar nach cancel() gestartet werden
  const wait = 180 - (Date.now() - lastCancel);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const my = epoch;
  const r = rate || state.settings.ttsRate || 1;
  for (const chunk of splitText(text)) {
    if (my !== epoch) return false;
    const ok = await speakChunk(chunk, r);
    if (!ok || my !== epoch) return false;
  }
  return true;
}

export function cancel() {
  epoch++;
  lastCancel = Date.now();
  if (ttsSupported) synth.cancel();
}
