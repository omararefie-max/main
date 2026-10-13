// power.js – Bildschirm wach halten und Medien-Steuerung (Sperrbildschirm), soweit der Browser es erlaubt.
//
// Ehrlich zur Technik: Browser pausieren Sprachausgabe/-erkennung oft, sobald der Bildschirm gesperrt wird.
//  * Wake Lock hält den Bildschirm an -> zuverlässigster Weg für den Hands-free-Modus (Spracherkennung
//    funktioniert nur bei sichtbarer Seite).
//  * Ein stummes, endlos laufendes <audio> + MediaSession lässt Android/Chrome die Seite als "Medienwiedergabe"
//    behandeln (Steuerung im Sperrbildschirm, Seite bleibt eher aktiv). Auf iOS ist das nicht zuverlässig.

let wakeLock = null;
let silent = null;

/** Erzeugt 1 s Stille als WAV-Data-URI (kein Extra-Datei-Download nötig). */
function silentWavURI() {
  const rate = 8000, n = rate; const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf); const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  let bin = ''; new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
  return 'data:audio/wav;base64,' + btoa(bin);
}

async function acquire() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
}
const onVis = () => { if (document.visibilityState === 'visible' && wakeLock !== null) acquire(); };

/** Muss aus einem Klick heraus gestartet werden (Autoplay-Regeln).
 *  handlers: {play, pause, next, prev} für Sperrbildschirm-Tasten. */
export async function startKeepAlive({ title = 'Prüfungstrainer', handlers = {}, screen = true, media = true } = {}) {
  if (screen) { await acquire(); document.addEventListener('visibilitychange', onVis); }
  if (media) {
    try {
      silent = silent || Object.assign(new Audio(silentWavURI()), { loop: true, volume: 0.01 });
      await silent.play();
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Prüfungstrainer' });
        for (const [k, a] of [['play', handlers.play], ['pause', handlers.pause], ['nexttrack', handlers.next], ['previoustrack', handlers.prev]]) {
          try { navigator.mediaSession.setActionHandler(k, a || null); } catch { /* nicht unterstützt */ }
        }
      }
    } catch { /* Autoplay verweigert – kein Drama */ }
  }
}

export function setMediaTitle(title) {
  try { if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Prüfungstrainer' }); } catch { /* egal */ }
}

export async function stopKeepAlive() {
  document.removeEventListener('visibilitychange', onVis);
  try { await wakeLock?.release(); } catch { /* egal */ }
  wakeLock = null;
  if (silent) { silent.pause(); }
  try {
    if ('mediaSession' in navigator) for (const k of ['play', 'pause', 'nexttrack', 'previoustrack']) navigator.mediaSession.setActionHandler(k, null);
  } catch { /* egal */ }
}
