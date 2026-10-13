// grader.js – lokale Bewertung mündlicher Antworten über Schlüsselbegriffe.
// Läuft komplett auf dem Gerät. Optional kann eine KI angebunden werden (siehe gradeAnswer / ai-Einstellungen).
//
// Idee: Spracherkennung liefert unscharfen Text ("Herz Infarkt", "Troponin" -> "Tropo nin").
// Darum: Normalisieren, leichtes Stemming, Teilwort-/Tippfehler-Toleranz und Vergleich ohne Leerzeichen.

export function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const SUFFIXES = ['ungen', 'ung', 'keit', 'heit', 'lich', 'isch', 'ern', 'ens', 'en', 'er', 'es', 'em', 'e', 's', 'n'];
/** Sehr leichtes deutsches Stemming (nur zum Vergleichen, nicht linguistisch korrekt). */
export function stem(w) {
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

function tokenMatches(termTok, stems) {
  const ts = stem(termTok);
  for (const s of stems) {
    if (s === ts) return true;
    if (ts.length >= 5 && s.length >= 5 && (s.startsWith(ts) || ts.startsWith(s))) return true;
    const maxErr = ts.length >= 10 ? 2 : ts.length >= 6 ? 1 : 0;
    if (maxErr && lev(s, ts, maxErr) <= maxErr) return true;
  }
  return false;
}

/** Prüft, ob ein Begriff (oder Ausdruck) im Transkript vorkommt. */
export function termMatches(term, ctx) {
  const n = normalize(term);
  if (!n) return false;
  const toks = n.split(' ');
  // 1) alle Wörter des Begriffs (stemmed/fuzzy) vorhanden
  if (toks.every((t) => (/^\d+$/.test(t) ? ctx.tokens.includes(t) : tokenMatches(t, ctx.stems)))) return true;
  // 2) Komposita / getrennt geschriebene Wörter: "herz infarkt" vs "herzinfarkt"
  const sq = n.replace(/ /g, '');
  return sq.length >= 5 && ctx.squashed.includes(sq);
}

function makeCtx(text) {
  const norm = normalize(text);
  const tokens = norm ? norm.split(' ') : [];
  return { tokens, stems: tokens.map(stem), squashed: norm.replace(/ /g, '') };
}

/** Österreichischer Notenschlüssel (88/75/62/50). */
export function gradeFromPercent(p) {
  if (p >= 88) return { note: 1, text: 'Sehr gut' };
  if (p >= 75) return { note: 2, text: 'Gut' };
  if (p >= 62) return { note: 3, text: 'Befriedigend' };
  if (p >= 50) return { note: 4, text: 'Genügend' };
  return { note: 5, text: 'Nicht genügend' };
}

/** Lokale Bewertung. q: Prüfungsfrage, transcript: erkannter Text (ggf. mehrere Antworten verbunden).
 *  Rückgabe: {score 0-100, covered:[begriff], missing:[begriff], feedback, mode:'local'} */
export function gradeLocal(q, transcript) {
  const ctx = makeCtx(transcript);
  const keys = q.schluesselbegriffe || [];
  let covered = [], missing = [], score;

  if (keys.length) {
    let got = 0, total = 0;
    for (const k of keys) {
      const w = k.gewicht || 1; total += w;
      const hit = [k.begriff, ...(k.synonyme || [])].some((t) => termMatches(t, ctx));
      if (hit) { got += w; covered.push(k.begriff); } else missing.push(k.begriff);
    }
    score = Math.round((got / total) * 100);
  } else {
    // Fallback ohne Schlüsselbegriffe: Anteil der inhaltstragenden Wörter der Musterantwort
    const words = [...new Set(normalize(q.musterantwort).split(' ').filter((w) => w.length >= 6))];
    const hit = words.filter((w) => termMatches(w, ctx));
    score = words.length ? Math.min(100, Math.round((hit.length / words.length) * 130)) : 0;
    covered = hit; missing = words.filter((w) => !hit.includes(w)).slice(0, 8);
  }
  if (ctx.tokens.length < 3) score = Math.min(score, 10);
  return { score, covered, missing, feedback: feedbackText(score, missing), mode: 'local' };
}

export function feedbackText(score, missing) {
  const base = score >= 88 ? 'Sehr gut – alle wesentlichen Punkte genannt.'
    : score >= 75 ? 'Gut – das meiste wurde genannt.'
      : score >= 62 ? 'Befriedigend – wichtige Punkte fehlen noch.'
        : score >= 50 ? 'Genügend – die Antwort war lückenhaft.'
          : 'Nicht genügend – zentrale Punkte fehlen. Bitte den Stoff wiederholen.';
  return missing.length ? `${base} Es fehlt: ${missing.slice(0, 6).join(', ')}.` : base;
}

/** Soll nachgefragt werden? (Abdeckung unter 60 %) */
export const needsFollowUp = (res) => res.score < 60;

/* -------------------------------------------------- Optionale KI-Schnittstelle */

/** Erweiterungspunkt: Bewerter nach Name. Eigene Bewerter hier eintragen:
 *  graders.meinBewerter = async (q, transcript, settings) => ({score, covered, missing, feedback})
 *  und in den Einstellungen "ai.enabled" aktivieren. Standard ist rein lokal. */
export const graders = {
  local: async (q, t) => gradeLocal(q, t),
  /** OpenAI-kompatibler Chat-Endpunkt (URL/Modell/Key in den Einstellungen).
   *  ACHTUNG: sendet Frage, Musterantwort und dein Transkript an diesen Server! */
  ai: async (q, t, s) => {
    const cfg = s.ai || {};
    const body = {
      model: cfg.model || undefined,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Du bist ein fairer Prüfer. Bewerte die Antwort inhaltlich anhand von Musterantwort und Schlüsselbegriffen. Antworte NUR mit JSON: {"score":0-100,"genannt":[string],"fehlend":[string],"feedback":string}' },
        { role: 'user', content: JSON.stringify({ frage: q.frage, musterantwort: q.musterantwort, schluesselbegriffe: (q.schluesselbegriffe || []).map((k) => k.begriff), antwort: t }) },
      ],
    };
    const r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('KI-Server antwortete mit ' + r.status);
    const data = await r.json();
    const txt = data.choices?.[0]?.message?.content ?? '';
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    return { score: Math.max(0, Math.min(100, Math.round(j.score))), covered: j.genannt || [], missing: j.fehlend || [], feedback: String(j.feedback || ''), mode: 'ai' };
  },
};

/** Bewertet eine Antwort mit dem konfigurierten Bewerter; fällt bei Fehlern auf lokal zurück. */
export async function gradeAnswer(q, transcript, settings) {
  if (settings?.ai?.enabled && settings.ai.url) {
    try { return await graders.ai(q, transcript, settings); }
    catch (e) { const r = gradeLocal(q, transcript); r.feedback += ' (KI nicht erreichbar – lokal bewertet.)'; return r; }
  }
  return graders.local(q, transcript);
}
