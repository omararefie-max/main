/* Einstellungen: Darstellung, Sprachausgabe, Spracherkennung, Datenschutz/Speicher. */
import { h, toast } from '../util.js';
import { S, saveSettings, wipeAll } from '../store.js';
import { getVoices, onVoices, speak, ttsSupported, sttSupported, localRecognitionStatus, installLocalRecognition } from '../speech.js';

let voicesBound = false;

export function render(root, ctx) {
  if (!voicesBound) { onVoices(() => { if (location.hash === '#/settings') ctx.rerender(); }); voicesBound = true; }
  const st = S.settings;
  const voices = getVoices();
  const localStatus = h('p', { class: 'muted small' }, sttSupported ? 'Status der lokalen Erkennung wird geprüft …' : 'Dieser Browser unterstützt keine Spracherkennung.');
  if (sttSupported) localRecognitionStatus(st.recLang).then((s) => {
    localStatus.textContent = ({
      available: '✓ Deutsches Sprachpaket ist installiert – Erkennung kann komplett offline laufen.',
      downloadable: 'Sprachpaket verfügbar, aber noch nicht installiert (Button unten).',
      downloading: 'Sprachpaket wird gerade geladen …',
      unavailable: 'Lokale Erkennung ist auf diesem Gerät nicht verfügbar – Chrome nutzt dann Google-Server.',
      unknown: 'Dieser Browser verrät nicht, ob lokale Erkennung möglich ist. Teste sie im Hörmodus.'
    })[s] || 'Status: ' + s;
  });

  const set = (patch) => saveSettings(patch);
  const row = (label, el) => h('label', { class: 'field' }, label, el);

  root.replaceChildren(
    h('h2', {}, 'Darstellung'),
    h('div', { class: 'box' },
      row(`Schriftgröße: ${st.fontSize}`, h('input', { type: 'range', min: 14, max: 26, step: 1, value: st.fontSize, oninput: (e) => { set({ fontSize: +e.target.value }); e.target.parentElement.firstChild.textContent = `Schriftgröße: ${e.target.value}`; } })),
      row('Farbschema', h('select', { onchange: (e) => set({ theme: e.target.value }) }, [['dark', 'Dunkel'], ['light', 'Hell'], ['auto', 'Automatisch (System)']].map(([v, t]) => h('option', { value: v, selected: st.theme === v }, t))))),

    h('h2', {}, 'Sprachausgabe'),
    h('div', { class: 'box' },
      !ttsSupported ? h('div', { class: 'banner bad' }, 'Sprachausgabe wird von diesem Browser nicht unterstützt.') : null,
      !voices.length && ttsSupported ? h('p', { class: 'muted small' }, 'Keine deutsche Stimme gefunden. Installiere sie unter Android → Einstellungen → Text-to-Speech (Google-Sprachdienste → Deutsch).') : null,
      row('Stimme', h('select', { onchange: (e) => set({ ttsVoice: e.target.value }) },
        h('option', { value: '' }, 'Automatisch (Deutsch)'), voices.map((v) => h('option', { value: v.voiceURI, selected: st.ttsVoice === v.voiceURI }, `${v.name} (${v.lang}${v.localService ? ', offline' : ', online'})`)))),
      row(`Geschwindigkeit: ${st.ttsRate.toFixed(1)}×`, h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.1, value: st.ttsRate, oninput: (e) => { set({ ttsRate: +e.target.value }); e.target.parentElement.firstChild.textContent = `Geschwindigkeit: ${(+e.target.value).toFixed(1)}×`; } })),
      h('button', { class: 'btn ghost', disabled: !ttsSupported, onclick: () => speak('Guten Tag. Dies ist ein Test der Sprachausgabe.', { rate: st.ttsRate, voiceURI: st.ttsVoice }).catch((e) => toast('Sprachausgabe nicht verfügbar.', 4000)) }, '🔊 Stimme testen')),

    h('h2', {}, 'Spracherkennung'),
    h('div', { class: 'box' },
      row('Sprache', h('select', { onchange: (e) => { set({ recLang: e.target.value }); ctx.rerender(); } }, [['de-AT', 'Deutsch (Österreich)'], ['de-DE', 'Deutsch (Deutschland)']].map(([v, t]) => h('option', { value: v, selected: st.recLang === v }, t)))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.recLocalOnly, onchange: (e) => set({ recLocalOnly: e.target.checked }) }), 'Nur lokale Erkennung (kein Audio an Server)'),
      h('p', { class: 'muted small' }, 'Ohne diese Option sendet Chrome die Sprachaufnahme zur Erkennung an Google. Mit der Option funktioniert die Spracherkennung nur, wenn das deutsche Sprachpaket auf dem Gerät installiert ist.'),
      localStatus,
      h('button', { class: 'btn ghost', disabled: !sttSupported, onclick: async () => { try { await installLocalRecognition(st.recLang); toast('Sprachpaket wird installiert …'); } catch (e) { toast(e.message, 5000); } } }, 'Sprachpaket installieren')),

    h('h2', {}, 'Hören & Prüfung'),
    h('div', { class: 'box' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.keepAlive, onchange: (e) => set({ keepAlive: e.target.checked }) }), 'Bildschirm wach halten + Medien-Sitzung (hilft bei gesperrtem Gerät)'),
      row(`Denkpause im Hörmodus: ${st.thinkPause} s`, h('input', { type: 'range', min: 1, max: 15, step: 1, value: st.thinkPause, oninput: (e) => { set({ thinkPause: +e.target.value }); e.target.parentElement.firstChild.textContent = `Denkpause im Hörmodus: ${e.target.value} s`; } }))),

    h('details', {}, h('summary', {}, 'Erweitert: KI-Bewertung (optional, AUS)'),
      h('p', { class: 'muted small' }, 'Leer lassen für rein lokale Bewertung. Wenn du eine Adresse einträgst, werden Fragen und Transkripte dorthin gesendet. Zusätzlich muss die Content-Security-Policy in index.html angepasst werden (siehe README).'),
      h('input', { type: 'text', placeholder: 'https://… (leer = aus)', value: st.aiEndpoint, onchange: (e) => set({ aiEndpoint: e.target.value.trim() }) })),

    h('h2', { style: 'margin-top:1.2rem' }, 'Daten & Speicher'),
    h('div', { class: 'box stack' },
      h('p', { class: 'muted small' }, 'Alle Daten liegen ausschließlich in diesem Browser (IndexedDB). Sichere sie regelmäßig über Inhalte → Backup.'),
      h('button', { class: 'btn ghost', onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Dauerhafter Speicher gewährt.' : 'Der Browser hat dauerhaften Speicher (noch) nicht gewährt – installiere die App auf dem Homescreen.', 5000); } }, 'Dauerhaften Speicher anfordern'),
      h('button', { class: 'btn danger', onclick: async () => { if (confirm('ALLE Karten, Fortschritte und Prüfungen unwiderruflich löschen?') && confirm('Wirklich sicher? Dies kann nicht rückgängig gemacht werden.')) { await wipeAll(); toast('Alle Daten gelöscht.'); ctx.rerender(); } } }, 'Alle Daten löschen')),
    h('p', { class: 'muted small' }, 'Lernapp 1.0.0 · läuft komplett lokal, ohne Konto und ohne Server.')
  );
}
