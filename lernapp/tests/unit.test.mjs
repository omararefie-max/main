// Läuft mit: node tests/unit.test.mjs  (keine Abhängigkeiten)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseContent, cardsToCSV, oralToCSV, parseCSV } from '../js/importer.js';
import { gradeLocal, gradeFromPercent } from '../js/grader.js';
import { parseSpoken } from '../js/voice.js';
import { review, newProgress, buildQueue, streak, isWeak } from '../js/srs.js';
import { present, isCorrect } from '../js/cards.js';
import { dayKey } from '../js/util.js';

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

const ex = JSON.parse(fs.readFileSync(new URL('../data/beispiel.json', import.meta.url)));
const parsed = parseContent(JSON.stringify(ex));
t('Beispiel-JSON importierbar', () => { assert.equal(parsed.errors.length, 0); assert.equal(parsed.cards.length, 3); assert.equal(parsed.oral.length, 3); });
t('Mehrfachauswahl A,B,E', () => assert.deepEqual(parsed.cards[1].richtig, [0, 1, 4]));
t('Auto-ID stabil', () => {
  const a = parseContent(JSON.stringify([{ frage: 'X?', antworten: ['1','2','3','4','5'], richtig: 'B' }]));
  const b = parseContent(JSON.stringify([{ frage: 'X?', antworten: ['9','2','3','4','5'], richtig: 'C' }]));
  assert.equal(a.cards[0].id, b.cards[0].id);
});
t('Fehler werden gemeldet', () => {
  const r = parseContent(JSON.stringify([{ frage: 'X?', antworten: ['1','2'], richtig: 'A' }, { frage: 'Y', antworten: ['1','2','3','4','5'], richtig: 'Z' }]));
  assert.equal(r.cards.length, 0); assert.equal(r.errors.length, 2);
});
t('CSV Roundtrip Karten', () => {
  const csv = cardsToCSV(parsed.cards); const back = parseContent(csv);
  assert.equal(back.errors.length, 0); assert.deepEqual(back.cards.map(c => c.id), parsed.cards.map(c => c.id));
  assert.deepEqual(back.cards[1].richtig, [0, 1, 4]); assert.equal(back.cards[0].frage, parsed.cards[0].frage);
});
t('CSV Roundtrip Prüfungsfragen', () => {
  const back = parseContent(oralToCSV(parsed.oral));
  assert.equal(back.errors.length, 0); assert.equal(back.oral.length, 3);
  assert.equal(back.oral[0].schluesselbegriffe[0].synonyme.length, 2);
});
t('CSV mit Komma-Trenner und Anführungszeichen', () => {
  const r = parseContent('frage,A,B,C,D,E,richtig\n"Was, bitte?",a,b,c,d,"e ""x""",ae');
  assert.equal(r.errors.length, 0); assert.equal(r.cards[0].antworten[4], 'e "x"'); assert.deepEqual(r.cards[0].richtig, [0, 4]);
});
t('Bewertung: gute Antwort', () => {
  const q = parsed.oral[0];
  const r = gradeLocal(q, 'Beim Herzinfarkt verschließt sich ein Herzkranzgefäß durch ein Gerinnsel, der Herzmuskel stirbt ab. Typisch sind Brustschmerzen die in den Arm und Kiefer ausstrahlen. Man macht ein EKG und bestimmt Troponin, behandelt wird mit einem Herzkatheter.');
  assert.ok(r.score >= 85, 'score ' + r.score + ' fehlt ' + r.missing);
});
t('Bewertung: lückenhaft + STT-Fehler', () => {
  const q = parsed.oral[0];
  const r = gradeLocal(q, 'das ist ein Herz Infarkt da gibt es Thorax schmerzen und man macht ein ekg und troponihn');
  assert.ok(r.score > 20 && r.score < 70, 'score ' + r.score); assert.ok(r.covered.includes('Troponin')); assert.ok(r.covered.includes('EKG'));
});
t('Bewertung: Unsinn = niedrig', () => assert.ok(gradeLocal(parsed.oral[0], 'Ich weiß nicht so recht das Wetter ist schön').score < 15));
t('Reanimation Zahlen', () => {
  const r = gradeLocal(parsed.oral[2], 'Ich prüfe Bewusstsein und Atmung, rufe den Notruf 144, beginne mit der Herzdruckmassage im Verhältnis 30 zu 2, fünf bis sechs Zentimeter tief, hundert bis 120 pro Minute und hole den AED.');
  assert.ok(r.covered.includes('AED/Defibrillator'.split('/')[0]) && r.covered.includes('Notruf'), JSON.stringify(r));
});
t('Notenschlüssel', () => { assert.equal(gradeFromPercent(90).note, 1); assert.equal(gradeFromPercent(50).note, 4); assert.equal(gradeFromPercent(49).note, 5); });
t('Sprachbefehle', () => {
  assert.deepEqual(parseSpoken('Antwort C', false), { type: 'answer', letters: ['C'] });
  assert.deepEqual(parseSpoken('a und d', true), { type: 'answer', letters: ['A', 'D'] });
  assert.deepEqual(parseSpoken('Antwort be', false), { type: 'answer', letters: ['B'] });
  assert.equal(parseSpoken('bitte wiederholen').type, 'repeat');
  assert.equal(parseSpoken('weiter').type, 'skip'); assert.equal(parseSpoken('stopp').type, 'stop');
  assert.equal(parseSpoken('hmm schwierig'), null);
});
t('SRS: richtig/falsch', () => {
  let p = newProgress('x'); const T = 1e12;
  p = review(p, true, T); assert.equal(p.interval, 1);
  p = review(p, true, T); assert.equal(p.interval, 3);
  p = review(p, true, T); assert.ok(p.interval >= 7);
  p = review(p, false, T); assert.equal(p.interval, 0); assert.equal(p.reps, 0); assert.ok(p.due - T < 3600e3);
});
t('SRS: Queue-Modi', () => {
  const cards = parsed.cards; const prog = new Map();
  assert.equal(buildQueue(cards, prog, 'neu', 10).length, 3);
  let p = newProgress(cards[0].id); p = review(p, false); p = review(p, false); prog.set(p.id, p);
  assert.ok(isWeak(p)); assert.equal(buildQueue(cards, prog, 'schwach', 10)[0].id, cards[0].id);
  assert.equal(buildQueue(cards, prog, 'neu', 10).length, 2);
});
t('Streak', () => {
  const now = Date.now(); const D = 864e5; const days = new Map();
  for (const k of [0, 1, 2, 4]) days.set(dayKey(now - k * D), { answered: 3 });
  assert.equal(streak(days, dayKey, now), 3);
  days.delete(dayKey(now)); assert.equal(streak(days, dayKey, now), 2);
});
t('Antworten mischen: Korrektheit bleibt', () => {
  const v = present(parsed.cards[1], true);
  const right = v.opts.filter(o => o.correct).map(o => o.letter);
  assert.ok(isCorrect(v, right)); assert.ok(!isCorrect(v, [right[0]]));
});
console.log(`\n${n} Tests bestanden`);
