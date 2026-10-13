/* Spaced Repetition (vereinfachtes SM-2).
 *
 * Lernfortschritt pro Karte (Store "progress"):
 *  { cardId, ease, interval (Tage), reps, lapses, due (ms), seen, correct, lastCorrect, first, last }
 *
 *  richtig → reps+1; Intervall: 1 Tag → 3 Tage → Intervall × ease
 *  falsch  → reps=0, lapses+1, ease −0,2 (min. 1,3), Karte ist nach 10 Minuten wieder fällig
 */
const DAY = 864e5;

export function newProgress(cardId) {
  return { cardId, ease: 2.5, interval: 0, reps: 0, lapses: 0, due: 0, seen: 0, correct: 0, lastCorrect: null, first: 0, last: 0 };
}

export function reviewProgress(p, correct, now = Date.now()) {
  p.seen++;
  p.last = now;
  if (!p.first) p.first = now;
  p.lastCorrect = correct;
  if (correct) {
    p.correct++;
    p.reps++;
    p.interval = p.reps === 1 ? 1 : p.reps === 2 ? 3 : Math.round(p.interval * p.ease);
    p.due = now + p.interval * DAY;
  } else {
    p.lapses++;
    p.reps = 0;
    p.interval = 0;
    p.ease = Math.max(1.3, p.ease - 0.2);
    p.due = now + 10 * 60 * 1000;
  }
  return p;
}

/** "Schwach": zuletzt falsch, niedrige Ease oder Trefferquote < 70 % (ab 2 Versuchen). */
export function isWeak(p) {
  return !!p && p.seen > 0 && (p.lastCorrect === false || p.ease < 2.0 || (p.seen >= 2 && p.correct / p.seen < 0.7));
}

/** "Gefestigt": Intervall ≥ 7 Tage. */
export const isMastered = (p) => !!p && p.interval >= 7;

/** Teilt Karten in fällig / neu / schwach / später auf. */
export function classify(cards, progress, now = Date.now()) {
  const due = [], neu = [], weak = [], later = [];
  for (const c of cards) {
    const p = progress.get(c.id);
    if (!p || !p.seen) { neu.push(c); continue; }
    (p.due <= now ? due : later).push(c);
    if (isWeak(p)) weak.push(c);
  }
  const byDue = (a, b) => progress.get(a.id).due - progress.get(b.id).due;
  due.sort(byDue);
  later.sort(byDue);
  weak.sort((a, b) => acc(progress.get(a.id)) - acc(progress.get(b.id)));
  return { due, neu, weak, later };
}

const acc = (p) => (p.seen ? p.correct / p.seen : 0);
