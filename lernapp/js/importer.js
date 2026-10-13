/* Import: JSON und CSV → normalisierte Karten / Prüfungsfragen.
 * Dokumentation der Formate: data/schema.json, data/vorlage-*.csv, README.md */
import { hash } from './util.js';

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean));

/** Richtige Antworten: "A,C" | ["A","C"] | [1,3] (Ziffern = 1-basiert) → sortierte 0-basierte Indizes. */
export function parseCorrect(v) {
  if (v === null || v === undefined || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[\s,;|+&/]+/);
  const out = new Set();
  for (const x of arr) {
    const s = String(x).trim().toUpperCase();
    if (!s) continue;
    if (/^[A-E]$/.test(s)) out.add('ABCDE'.indexOf(s));
    else if (/^[1-5]$/.test(s)) out.add(Number(s) - 1);
    else throw new Error(`Ungültige Lösung „${x}“ (erlaubt: A–E)`);
  }
  return [...out].sort();
}

/* ---------- Quiz-Karte ---------- */
export function normalizeCard(r) {
  const question = str(r.question ?? r.frage);
  if (!question) throw new Error('Frage fehlt');
  let answers = r.answers ?? r.antworten;
  if (!Array.isArray(answers)) answers = ['a', 'b', 'c', 'd', 'e'].map((k) => r[k] ?? r[k.toUpperCase()]);
  const flagged = answers.map((a) => !!(a && typeof a === 'object' && a.correct));
  answers = answers.map((a) => (a && typeof a === 'object' ? str(a.text) : str(a)));
  if (answers.length !== 5 || answers.some((a) => !a)) throw new Error('Genau 5 nicht-leere Antworten (A–E) erforderlich');
  let correct = parseCorrect(r.correct ?? r.richtig ?? r.loesung ?? r.lösung);
  if (!correct.length) correct = flagged.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  if (!correct.length) throw new Error('Keine richtige Antwort angegeben');
  const diff = parseInt(r.difficulty ?? r.schwierigkeit, 10);
  return {
    id: str(r.id) || 'c_' + hash(question),
    subject: str(r.subject ?? r.fach), topic: str(r.topic ?? r.thema), chapter: str(r.chapter ?? r.kapitel),
    question, answers, correct,
    explanation: str(r.explanation ?? r.erklaerung ?? r.erklärung),
    difficulty: diff >= 1 && diff <= 3 ? diff : 0,
    tags: list(r.tags)
  };
}

/* ---------- Mündliche Prüfungsfrage ---------- */
function normKeyPoint(x) {
  if (typeof x === 'string') {
    const [text, kws, min] = x.split('::').map((s) => s.trim());
    if (!text) return null;
    return mkKp(text, kws ? kws.split('|') : [], min);
  }
  if (x && typeof x === 'object') {
    const text = str(x.text ?? x.punkt ?? x.label);
    if (!text) return null;
    return mkKp(text, Array.isArray(x.keywords ?? x.begriffe) ? (x.keywords ?? x.begriffe) : str(x.keywords ?? x.begriffe).split('|'), x.min, x.weight ?? x.gewicht);
  }
  return null;
}
function mkKp(text, kws, min, weight) {
  const keywords = kws.map(str).filter(Boolean);
  const m = Math.max(1, Math.min(parseInt(min, 10) || 1, keywords.length || 1));
  return { text, keywords, min: m, weight: Number(weight) > 0 ? Number(weight) : 1 };
}
export function parseKeyPoints(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/\n|;;/);
  return arr.map(normKeyPoint).filter(Boolean);
}
/** Für den Editor: eine Zeile pro Pflichtpunkt  „Text :: Begriff | Begriff :: min“ */
export const keyPointsToText = (kps = []) =>
  kps.map((k) => `${k.text} :: ${k.keywords.join(' | ')}${k.min > 1 ? ` :: ${k.min}` : ''}`).join('\n');

export function normalizeOral(r) {
  const question = str(r.question ?? r.frage);
  if (!question) throw new Error('Fragetext fehlt');
  const modelAnswer = str(r.modelAnswer ?? r.musterantwort);
  const keyPoints = parseKeyPoints(r.keyPoints ?? r.schluesselbegriffe ?? r.schlüsselbegriffe ?? r.pflichtpunkte);
  if (!modelAnswer && !keyPoints.length) throw new Error('Musterantwort oder Pflichtpunkte erforderlich');
  const fu = r.followUps ?? r.nachfragen;
  return {
    id: str(r.id) || 'o_' + hash(question),
    subject: str(r.subject ?? r.fach), topic: str(r.topic ?? r.thema), chapter: str(r.chapter ?? r.kapitel),
    question, modelAnswer, keyPoints,
    followUps: Array.isArray(fu) ? fu.map(str).filter(Boolean) : str(fu).split('|').map((s) => s.trim()).filter(Boolean),
    tags: list(r.tags)
  };
}

/* ---------- CSV ---------- */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const HEAD = (s) => s.trim().toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/* ---------- Gesamt-Parser ---------- */
/** → { cards, oral, errors:[string], backup:null|object } */
export function parseContent(text) {
  const out = { cards: [], oral: [], errors: [], backup: null };
  text = text.trim();
  if (!text) { out.errors.push('Kein Inhalt gefunden.'); return out; }

  if (text[0] === '{' || text[0] === '[') {
    let data;
    try { data = JSON.parse(text); } catch (e) { out.errors.push('Ungültiges JSON: ' + e.message); return out; }
    if (data && data.format === 'lernapp-backup/1') { out.backup = data; return out; }
    let cards = [], oral = [];
    if (Array.isArray(data)) {
      cards = data.filter((x) => x && (x.answers || x.antworten));
      oral = data.filter((x) => x && (x.modelAnswer || x.musterantwort || x.keyPoints));
    } else {
      cards = data.cards || data.karten || [];
      oral = data.oralQuestions || data.oral || data.pruefung || [];
    }
    cards.forEach((r, i) => { try { out.cards.push(normalizeCard(r)); } catch (e) { out.errors.push(`Karte #${i + 1}${r?.id ? ` (${r.id})` : ''}: ${e.message}`); } });
    oral.forEach((r, i) => { try { out.oral.push(normalizeOral(r)); } catch (e) { out.errors.push(`Prüfungsfrage #${i + 1}${r?.id ? ` (${r.id})` : ''}: ${e.message}`); } });
    return out;
  }

  const rows = parseCsv(text);
  if (rows.length < 2) { out.errors.push('CSV braucht eine Kopfzeile und mindestens eine Datenzeile.'); return out; }
  const head = rows[0].map(HEAD);
  rows.slice(1).forEach((cells, i) => {
    const r = {};
    head.forEach((k, j) => { r[k] = cells[j] ?? ''; });
    const line = i + 2;
    const typ = HEAD(r.typ || r.type || '');
    const isOral = typ ? /pruef|oral|muend/.test(typ) : !!(str(r.musterantwort) || str(r.modelanswer)) && !str(r.a);
    try {
      if (isOral) out.oral.push(normalizeOral(r)); else out.cards.push(normalizeCard(r));
    } catch (e) { out.errors.push(`Zeile ${line}: ${e.message}`); }
  });
  return out;
}
