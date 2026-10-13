// voice.js – gesprochene Antworten ("Antwort C", "A und D", "wiederholen") in Befehle umwandeln.
// Reine Textlogik, unabhängig von der Spracherkennung -> testbar.

import { normalize } from './grader.js';

// Spracherkennung versteht Buchstaben oft als Silben ("be", "ce", "de") oder Zahlwörter.
const LETTER_WORDS = {
  a: ['a', 'ah', 'aa', 'eins'],
  b: ['b', 'be', 'bee', 'beh', 'zwei'],
  c: ['c', 'ce', 'ze', 'zeh', 'see', 'se', 'drei'],
  d: ['d', 'de', 'deh', 'vier'],
  e: ['e', 'eh', 'fuenf'],
};
const WORD2LETTER = {};
for (const [l, ws] of Object.entries(LETTER_WORDS)) for (const w of ws) WORD2LETTER[w] = l.toUpperCase();

const CMD = [
  ['stop', /\b(stopp|stop|beenden|aufhoeren|ende)\b/],
  ['repeat', /\b(wiederhol\w*|nochmal|noch einmal|bitte nochmal)\b/],
  ['skip', /\b(weiter|naechste\w*|ueberspring\w*|skip|weiss nicht|keine ahnung|passe?)\b/],
];

/** Liefert {type:'answer', letters:['A','C']} | {type:'repeat'|'skip'|'stop'} | null */
export function parseSpoken(text, multi = false) {
  const n = normalize(text);
  if (!n) return null;
  const letters = [];
  for (const tok of n.split(' ')) {
    const l = WORD2LETTER[tok];
    if (l && !letters.includes(l)) letters.push(l);
  }
  if (letters.length) return { type: 'answer', letters: multi ? letters.sort() : [letters[0]] };
  for (const [type, re] of CMD) if (re.test(n)) return { type };
  return null;
}

/** Probiert mehrere Erkennungs-Alternativen durch und nimmt die erste verständliche. */
export function parseAlternatives(alts, multi) {
  for (const a of alts) { const r = parseSpoken(a, multi); if (r) return r; }
  return null;
}
