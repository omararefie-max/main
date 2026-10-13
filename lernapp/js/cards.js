// cards.js – Darstellung und Auswertung einzelner Quizkarten.

import { shuffle } from './util.js';

export const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/** Bereitet eine Karte zur Anzeige vor (optional gemischt).
 *  Rückgabe: { card, multi, opts:[{letter, text, correct, orig}] }
 *  Hinweis: Nach dem Mischen passen Buchstaben in der Erklärung ("Antwort B ...") evtl. nicht mehr.
 *  Erklärungen sollten daher keine Buchstaben referenzieren (steht auch in der Datenformat-Doku). */
export function present(card, doShuffle) {
  const order = doShuffle ? shuffle([0, 1, 2, 3, 4]) : [0, 1, 2, 3, 4];
  const opts = order.map((orig, i) => ({
    letter: LETTERS[i], text: card.antworten[orig], correct: card.richtig.includes(orig), orig,
  }));
  return { card, multi: card.richtig.length > 1, opts };
}

/** selected: Array von Buchstaben ['A','C'] (Anzeige-Buchstaben). */
export function isCorrect(view, selected) {
  const right = view.opts.filter((o) => o.correct).map((o) => o.letter).sort().join('');
  return right === [...selected].sort().join('');
}

export const correctLetters = (view) => view.opts.filter((o) => o.correct).map((o) => o.letter);
