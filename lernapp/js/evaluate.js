// Lokale Bewertung mündlicher Antworten über Schlüsselbegriffe (kein Netzwerk).
//
// Jeder Pflichtpunkt (keyPoint) hat eine Bezeichnung und eine Liste von Synonymen/Begriffen.
// Ein Punkt gilt als genannt, wenn mindestens EIN Begriff im Transkript vorkommt
// (bei mehrteiligen Begriffen müssen alle Wörter vorkommen). Der Vergleich ist tolerant
// gegenüber Groß-/Kleinschreibung, Umlauten, Endungen (Kammer/Kammern) und kleinen
// Erkennungsfehlern der Spracherkennung (Edit-Distanz 1 bei längeren Wörtern).

export const norm = (s) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

function commonPrefix(a, b) { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; }

function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Zwei (bereits normalisierte) Wörter gelten als gleich? */
export function wordMatch(a, b) {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  if (m < 4) return false;                                  // kurze Wörter nur exakt
  if (Math.abs(a.length - b.length) <= 4 && commonPrefix(a, b) >= Math.max(4, m - 2)) return true; // Endungen
  return m >= 6 && withinOneEdit(a, b);                     // Erkennungsfehler
}

export function matchKeyword(tokens, keyword) {
  const words = norm(keyword).split(' ').filter(Boolean);
  return words.length > 0 && words.every((w) => tokens.some((t) => wordMatch(t, w)));
}

/**
 * @param {string} transcript
 * @param {{keyPoints:{label:string,keywords:string[],weight:number}[]}} q
 * @returns {{percent:number, matched:{label:string,via:string}[], missing:{label:string}[], words:number, engine:'local'}}
 */
export function evaluateLocal(transcript, q) {
  const tokens = norm(transcript).split(' ').filter(Boolean);
  let total = 0, got = 0;
  const matched = [], missing = [];
  for (const kp of q.keyPoints) {
    const w = kp.weight || 1;
    total += w;
    const via = kp.keywords.find((k) => matchKeyword(tokens, k));
    if (via) { got += w; matched.push({ label: kp.label, via }); } else missing.push({ label: kp.label });
  }
  return { percent: total ? Math.round((got / total) * 100) : 0, matched, missing, words: tokens.length, engine: 'local' };
}

/** Kurzes Feedback in ganzen Sätzen. */
export function feedbackText(ev) {
  const miss = ev.missing.map((m) => m.label);
  if (ev.words < 4) return 'Es wurde kaum etwas gesagt.';
  if (!miss.length) return 'Sehr vollständig – alle Pflichtpunkte wurden genannt.';
  const list = miss.length > 3 ? `${miss.slice(0, 3).join(', ')} u. a.` : miss.join(', ');
  if (ev.percent >= 70) return `Gut. Es fehlt noch: ${list}.`;
  if (ev.percent >= 40) return `Teilweise richtig. Wichtige Punkte fehlen: ${list}.`;
  return `Wesentliche Punkte fehlen: ${list}.`;
}
