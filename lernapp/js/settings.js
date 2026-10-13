// Einstellungen: Darstellung, Quiz, Sprache, KI-Schnittstelle, Daten.
import { state, setSetting, wipeAll } from './store.js';
import { h, mount } from './util.js';
import { field, seg, switchRow, toast } from './ui.js';
import { ttsSupported, voicesReady, speak, cancel } from './tts.js';
import { sttSupported, testMic } from './stt.js';

export async function renderSettings(body, ctx) {
  const S = state.settings;
  const voices = await voicesReady();
  const set = (k) => (v) => setSetting(k, v);

  const fontLabel = h('b', null, `${Math.round(S.fontScale * 100)} %`);
  const font = h('input', { type: 'range', min: 0.9, max: 1.4, step: 0.05, value: S.fontScale, oninput: () => { fontLabel.textContent = `${Math.round(font.value * 100)} %`; setSetting('fontScale', +font.value); } });
  const rateLabel = h('b', null, `${S.ttsRate.toFixed(2)}×`);
  const rate = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: S.ttsRate, oninput: () => { rateLabel.textContent = `${(+rate.value).toFixed(2)}×`; setSetting('ttsRate', +rate.value); } });
  const voiceSel = h('select', { onchange: () => setSetting('ttsVoice', voiceSel.value) },
    h('option', { value: '' }, 'Automatisch (de-AT, dann de-DE)'),
    voices.map((v) => h('option', { value: v.voiceURI, selected: S.ttsVoice === v.voiceURI }, `${v.name} (${v.lang})${v.localService ? '' : ' · online'}`)));
  const micOut = h('p', { class: 'muted small' });

  const num = (key, min, max) => h('input', { type: 'number', min, max, value: S[key], inputMode: 'numeric', onchange: (e) => setSetting(key, Math.max(min, Math.min(max, +e.target.value || min))) });

  // Speicher-Info
  const storageInfo = h('p', { class: 'muted small' }, 'Speicher wird geprüft …');
  (async () => {
    try {
      const persisted = await navigator.storage?.persisted?.();
      const est = await navigator.storage?.estimate?.();
      storageInfo.textContent = `Dauerhafter Speicher: ${persisted ? 'ja' : 'nicht garantiert'}${est ? ` · belegt ${(est.usage / 1048576).toFixed(1)} MB` : ''}`;
    } catch { storageInfo.textContent = ''; }
  })();

  const installBtn = h('button', { class: 'btn', hidden: !window.__installPrompt, onclick: async () => { const p = window.__installPrompt; if (!p) return; p.prompt(); await p.userChoice; window.__installPrompt = null; installBtn.hidden = true; } }, 'App auf dem Homescreen installieren');

  const version = h('span', { class: 'muted small' }, '');
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.version) version.textContent = `Version ${e.data.version}`; });
  navigator.serviceWorker?.controller?.postMessage('version');

  mount(body,
    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Darstellung'),
      field('Design', seg([{ value: 'dark', label: 'Dunkel' }, { value: 'light', label: 'Hell' }, { value: 'auto', label: 'System' }], S.theme, set('theme')).el),
      h('label', { class: 'field' }, h('span', null, 'Schriftgröße ', fontLabel), font)),

    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Quiz'),
      switchRow('Antworten mischen', S.shuffleAnswers, set('shuffleAnswers'), 'Erklärungen sollten dann nicht auf Buchstaben verweisen.'),
      field('Karten pro Sitzung', num('sessionSize', 1, 500)),
      field('Max. neue Karten pro Sitzung', num('maxNew', 0, 200))),

    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Sprachausgabe'),
      !ttsSupported ? h('div', { class: 'banner' }, 'Sprachausgabe ist in diesem Browser nicht verfügbar.') : null,
      ttsSupported && !voices.length ? h('div', { class: 'banner' }, 'Keine deutsche Stimme gefunden. Installiere eine in den Android-Einstellungen unter „Text-to-Speech“.') : null,
      field('Stimme', voiceSel),
      h('label', { class: 'field' }, h('span', null, 'Geschwindigkeit ', rateLabel), rate),
      h('button', { class: 'btn', onclick: () => { cancel(); speak('Hallo! Das ist die ausgewählte Stimme für deine Lernkarten.'); } }, 'Stimme testen'),
      field('Denkpause im Hörmodus (Sekunden)', num('podcastPause', 0, 30))),

    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Spracherkennung'),
      !sttSupported ? h('div', { class: 'banner' }, 'Spracherkennung ist in diesem Browser nicht verfügbar. Nutze Chrome auf Android. Der Hörmodus „Vorlesen“ funktioniert trotzdem.') : null,
      field('Sprache', seg([{ value: 'de-AT', label: 'Deutsch (AT)' }, { value: 'de-DE', label: 'Deutsch (DE)' }], S.sttLang, set('sttLang')).el),
      switchRow('Nur lokale Erkennung', S.sttLocal, set('sttLocal'), 'Versucht On-Device-Erkennung (kein Audio an Google). Braucht ein installiertes Sprachpaket und neues Chrome; sonst Fehlermeldung.'),
      switchRow('Mikrofon nach der Frage automatisch öffnen', S.autoListen, set('autoListen')),
      field('Antwort bei Stille automatisch abgeben (Sekunden, 0 = aus)', num('silenceSec', 0, 30)),
      h('button', { class: 'btn', onclick: async () => { micOut.textContent = 'Bitte etwas sagen …'; const r = await testMic(); micOut.textContent = r.ok ? `Erkannt: „${r.text || '–'}“` : r.message; } }, 'Mikrofon testen'),
      micOut,
      switchRow('Bildschirm im Hörmodus/Prüfung anlassen', S.wakeLock, set('wakeLock'))),

    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Mündliche Prüfung'),
      field('Standard: Anzahl Fragen', num('examQuestions', 1, 100)),
      field('Standard: Dauer (Minuten)', num('examMinutes', 1, 240))),

    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'KI-Bewertung (optional)'),
      h('p', { class: 'muted small' }, 'Standardmäßig bewertet die App rein lokal über Schlüsselbegriffe. Wenn du hier einen eigenen Endpunkt einträgst (z. B. einen KI-Server in deinem WLAN), werden die Antworttexte der Prüfung an genau diese Adresse gesendet. Sonst nichts, nirgends.'),
      switchRow('KI-Bewertung aktivieren', S.aiEnabled, set('aiEnabled')),
      field('Endpunkt-URL', h('input', { type: 'text', value: S.aiUrl, placeholder: 'https://…', onchange: (e) => setSetting('aiUrl', e.target.value.trim()) })),
      field('API-Schlüssel (optional)', h('input', { type: 'text', value: S.aiKey, autocomplete: 'off', onchange: (e) => setSetting('aiKey', e.target.value.trim()) })),
      field('Modellname (optional)', h('input', { type: 'text', value: S.aiModel, onchange: (e) => setSetting('aiModel', e.target.value.trim()) }))),

    h('div', { class: 'card' },
      h('h3', { style: { marginTop: 0 } }, 'Daten & App'),
      storageInfo, installBtn,
      h('div', { class: 'row between' }, version,
        h('button', { class: 'btn small ghost', onclick: async () => { const r = await navigator.serviceWorker?.getRegistration(); await r?.update(); toast('Nach Updates gesucht'); } }, 'Nach Updates suchen')),
      h('button', { class: 'btn danger', style: { marginTop: '.8rem' }, onclick: async () => {
        if (!confirm('ALLE Karten, Fragen, Lernfortschritt und Verläufe unwiderruflich löschen?')) return;
        if (!confirm('Wirklich sicher? Mach vorher ein Backup (Inhalte > Import/Export).')) return;
        await wipeAll(); toast('Alle Daten gelöscht');
      } }, 'Alle Daten löschen')));
}
