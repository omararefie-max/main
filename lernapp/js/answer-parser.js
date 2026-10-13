// Wertet gesprochene Antworten aus ("Antwort C", "B und D", "wiederholen", …).
// Spracherkennung schreibt einzelne Buchstaben oft als Silben ("be", "ze", "de"),
// daher werden gängige Schreibweisen zugeordnet. Eine Äußerung gilt nur dann als
// Antwort, wenn ALLE Wörter Buchstaben oder bekannte Füllwörter sind – so wird
// "die Antwort ist Aorta" nicht fälschlich als "A" gewertet.

const LETTER_WORDS = {
  A: ['a', 'ah', 'aa', 'eins', 'ein', 'eine', '1'],
  B: ['b', 'be', 'bee', 'beh', 'bi', 'zwei', 'zwo', '2'],
  C: ['c', 'ce', 'cee', 'ze', 'zee', 'se', 'see', 'tse', 'tze', 'zeh', 'ceh', 'drei', '3'],
  D: ['d', 'de', 'dee', 'deh', 'di', 'vier', '4'],
  E: ['e', 'eh', 'ee', 'fuenf', 'funf', '5'],
};
const WORD2LETTER = new Map();
for (const [L, ws] of Object.entries(LETTER_WORDS)) ws.forEach((w) => WORD2LETTER.set(w, L));

const FILLER = new Set(['antwort', 'die', 'der', 'das', 'ist', 'sind', 'ich', 'glaube', 'denke', 'meine', 'wuerde', 'sage', 'sagen',
  'nehme', 'nehmen', 'nehm', 'waehle', 'buchstabe', 'option', 'nummer', 'und', 'sowie', 'bitte', 'also', 'richtig', 'ja', 'dann', 'noch', 'auch', 'mit', 'oder', 'vielleicht', 'ahm', 'aehm', 'hm', 'hmm']);

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * @param {string[]} alternatives Erkennungs-Alternativen (beste zuerst)
 * @returns {{type:'answer',letters:string[]}|{type:'cmd',cmd:'repeat'|'next'|'stop'}|null}
 */
export function parseSpoken(alternatives) {
  for (const alt of alternatives) {
    const t = norm(alt);
    if (!t) continue;
    if (/\bwiederhol/.test(t) || /\bnochmal/.test(t)) return { type: 'cmd', cmd: 'repeat' };
    if (/\b(weiter|naechste|ueberspring|skip)/.test(t)) return { type: 'cmd', cmd: 'next' };
    if (/\b(stopp|stop|beenden|ende|schluss|pause)\b/.test(t)) return { type: 'cmd', cmd: 'stop' };
    const letters = new Set();
    let ok = true;
    for (const w of t.split(' ')) {
      const L = WORD2LETTER.get(w);
      if (L) letters.add(L);
      else if (!FILLER.has(w)) { ok = false; break; }
    }
    if (ok && letters.size) return { type: 'answer', letters: [...letters].sort() };
  }
  return null;
}
