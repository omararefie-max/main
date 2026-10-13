/* Lokale Bewertung mündlicher Antworten über Schlüsselbegriffe (keine KI, keine Cloud).
 *
 * Pflichtpunkt = { text, keywords[], min, weight }
 *  → "genannt", wenn mindestens `min` Schlüsselbegriffe im Transkript vorkommen.
 * Toleranzen: Groß/Kleinschreibung, Umlaute (ä=ae=a), Wortstämme (Teilstring), kleine Erkennungsfehler (Levenshtein). */

export const GENERIC_FOLLOWUP = 'Können Sie das genauer erläutern?';

export function norm(s) {
  return String(s).toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function wordHit(kw, text, tokens) {
  if (kw.length < 4) return tokens.includes(kw);       // kurze Begriffe nur als ganzes Wort
  if (text.includes(kw)) return true;                  // Wortstamm / Teilstring
  const tol = kw.length >= 10 ? 2 : kw.length >= 6 ? 1 : 0;
  if (!tol) return false;
  return tokens.some((t) => Math.abs(t.length - kw.length) <= tol + 2 && (lev(kw, t) <= tol || lev(kw, t.slice(0, kw.length)) <= tol));
}

function keywordHit(keyword, text, tokens) {
  const k = norm(keyword);
  return !!k && k.split(' ').every((w) => wordHit(w, text, tokens));
}

const STOP = new Set(['dass', 'werden', 'wird', 'sind', 'eine', 'einer', 'einen', 'einem', 'dieser', 'diese', 'dieses', 'sowie', 'durch', 'nicht', 'auch', 'oder', 'wenn', 'dabei', 'damit', 'muss', 'sollte', 'sollen', 'koennen', 'haben', 'wurde', 'ueber', 'unter', 'zwischen', 'ihrer', 'seiner'].map(norm));

/** Pflichtpunkte der Frage; falls keine hinterlegt sind, werden sie aus der Musterantwort abgeleitet. */
export function getKeyPoints(q) {
  if (q.keyPoints?.length) return q.keyPoints.map((k) => ({ ...k, keywords: k.keywords?.length ? k.keywords : derive(k.text), min: k.min || 1, weight: k.weight || 1 }));
  return (q.modelAnswer || '').split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 12).map((s) => {
    const kws = derive(s);
    return { text: s.trim(), keywords: kws, min: Math.max(1, Math.ceil(kws.length / 3)), weight: 1 };
  });
}
const derive = (text) => [...new Set(norm(text).split(' '))].filter((w) => w.length >= 6 && !STOP.has(w)).slice(0, 6);

export function evaluate(q, transcript) {
  const text = norm(transcript || '');
  const tokens = text.split(' ').filter(Boolean);
  const points = getKeyPoints(q).map((p) => {
    const hits = p.keywords.filter((k) => keywordHit(k, text, tokens));
    return { text: p.text, hit: hits.length >= p.min, hits, weight: p.weight };
  });
  const total = points.reduce((a, p) => a + p.weight, 0);
  const got = points.reduce((a, p) => a + (p.hit ? p.weight : 0), 0);
  const coverage = total ? got / total : 0;
  return { points, coverage, percent: Math.round(coverage * 100), words: tokens.length };
}

/** Österreichische Notenskala (90/80/65/50 %). */
export function gradeFor(percent) {
  if (percent >= 90) return { note: 1, label: 'Sehr gut' };
  if (percent >= 80) return { note: 2, label: 'Gut' };
  if (percent >= 65) return { note: 3, label: 'Befriedigend' };
  if (percent >= 50) return { note: 4, label: 'Genügend' };
  return { note: 5, label: 'Nicht genügend' };
}

export function feedbackFor(percent) {
  if (percent >= 90) return 'Ausgezeichnet – nahezu alle Pflichtpunkte wurden genannt.';
  if (percent >= 80) return 'Gute Antworten, nur wenige Punkte fehlten.';
  if (percent >= 65) return 'Solide Grundlage, aber einige wichtige Punkte fehlten. Wiederhole die markierten Themen.';
  if (percent >= 50) return 'Teilweise richtig. Es fehlen mehrere Pflichtpunkte – gezielt nachlernen.';
  return 'Noch deutliche Lücken. Lerne die Musterantworten und übe die Fragen erneut.';
}
