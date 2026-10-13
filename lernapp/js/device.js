// Geräte-Funktionen für Hörmodus und Prüfung:
//  - Bildschirm anlassen (Wake Lock)
//  - Signalton vor dem Zuhören
//  - "Keep-alive"-Audio + Media Session, damit Android die Wiedergabe als Medien-
//    Sitzung behandelt (Sperrbildschirm-Steuerung, weniger Abbrüche im Hintergrund).
//
// Grenzen einer PWA: Wird der Bildschirm gesperrt, stoppt Chrome auf vielen Geräten die
// Sprachausgabe und IMMER die Spracherkennung. Verlässlich funktioniert der Hörmodus
// "Wiederholen" daher am besten mit angelassenem (gedimmtem) Bildschirm. Für echten
// Hintergrundbetrieb siehe README (Capacitor-App).

import { state } from './store.js';

let wakeLock = null;
let wakeWanted = false;

async function acquire() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (wakeWanted && document.visibilityState === 'visible') acquire(); });

export async function keepAwake(on) {
  wakeWanted = on && state.settings.wakeLock;
  if (wakeWanted) await acquire();
  else { try { await wakeLock?.release(); } catch {} wakeLock = null; }
}

/* ---------- Signalton ---------- */
let ctx;
export function beep(freq = 880, ms = 120) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + ms / 1000);
  } catch { /* Ton ist nur ein Komfort */ }
}

/* ---------- Keep-alive Audio + Media Session ---------- */
let audioEl = null;

function silentWavUrl() {
  // 1 s Stille, 8 kHz, 8 Bit mono – wird im Browser erzeugt, keine Datei nötig
  const n = 8000, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true);
  v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** Muss aus einem Klick heraus aufgerufen werden (Autoplay-Regeln). handlers: {play,pause,next,prev,stop} */
export async function startMediaSession(title, handlers = {}) {
  try {
    if (!audioEl) { audioEl = new Audio(silentWavUrl()); audioEl.loop = true; audioEl.volume = 0.01; }
    await audioEl.play();
  } catch { /* nicht kritisch */ }
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Lernapp', album: 'Hörmodus' });
      for (const [action, fn] of [['play', handlers.play], ['pause', handlers.pause], ['nexttrack', handlers.next], ['previoustrack', handlers.prev], ['stop', handlers.stop]]) {
        if (fn) navigator.mediaSession.setActionHandler(action, fn);
      }
    } catch { /* manche Browser kennen nicht alle Aktionen */ }
  }
}

export function setPlaybackState(s) {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s; // 'playing' | 'paused' | 'none'
}

export function stopMediaSession() {
  try { audioEl?.pause(); } catch {}
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch {}
  }
}
