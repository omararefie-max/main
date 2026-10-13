/* Statistiken: Trefferquote, Streak, Fortschritt je Thema, Problemkarten, Verlauf der mündlichen Prüfungen. */
import { h, dayKey, fmtDate, pct, LETTERS } from '../util.js';
import { S } from '../store.js';
import { isMastered, isWeak } from '../srs.js';
import { stat } from './filters.js';
import { protocolView } from './exam.js';

let openSession = null;

export function render(root, ctx) {
  if (openSession) {
    root.replaceChildren(
      h('button', { class: 'btn ghost small inline', onclick: () => { openSession = null; ctx.rerender(); } }, '← Zurück'),
      h('div', { style: 'height:.8rem' }), protocolView(openSession));
    return;
  }

  const revs = S.reviews;
  const okN = revs.filter((r) => r.correct).length;
  const { streak, best } = streaks();
  const today = revs.filter((r) => dayKey(r.ts) === dayKey(Date.now())).length;
  const seen = [...S.progress.values()].filter((p) => p.seen).length;

  root.replaceChildren(
    h('h2', {}, 'Dein Lernstand'),
    h('div', { class: 'stats-row' }, stat(pct(okN, revs.length) + '%', 'Trefferquote'), stat(streak + ' 🔥', 'Serie (Tage)'), stat(today, 'heute'), stat(`${seen}/${S.cards.length}`, 'gesehen')),
    h('p', { class: 'muted small' }, `Beste Serie: ${best} Tage · Antworten insgesamt: ${revs.length}`),
    activityBars(),
    h('h3', {}, 'Fortschritt je Thema'), topicTable(),
    h('h3', { style: 'margin-top:1.2rem' }, 'Problemkarten'), problemCards(),
    h('h3', { style: 'margin-top:1.2rem' }, 'Mündliche Prüfungen'), oralHistory(ctx)
  );
}

function streaks() {
  const days = new Set(S.reviews.map((r) => dayKey(r.ts)));
  const day = 864e5;
  let streak = 0, t = Date.now();
  if (!days.has(dayKey(t))) t -= day;               // heute noch nichts gelernt: Serie von gestern zählt noch
  while (days.has(dayKey(t))) { streak++; t -= day; }
  const sorted = [...days].sort();
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev && Math.round((new Date(d) - new Date(prev)) / day) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  return { streak, best };
}

function activityBars() {
  const day = 864e5, counts = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(Date.now() - i * day);
    counts.push([k, S.reviews.filter((r) => dayKey(r.ts) === k).length]);
  }
  const max = Math.max(1, ...counts.map((c) => c[1]));
  const w = 280, bw = w / 14;
  const bars = counts.map(([k, n], i) => `<rect x="${i * bw + 2}" y="${60 - (n / max) * 56}" width="${bw - 4}" height="${Math.max(2, (n / max) * 56)}" rx="3" fill="var(--accent)" opacity="${n ? 1 : .25}"><title>${k}: ${n}</title></rect>`).join('');
  return h('div', { class: 'box' }, h('div', { class: 'muted small' }, 'Antworten pro Tag (14 Tage)'),
    h('div', { html: `<svg class="spark" viewBox="0 0 ${w} 62" preserveAspectRatio="none" role="img" aria-label="Aktivität der letzten 14 Tage">${bars}</svg>` }));
}

function topicTable() {
  if (!S.cards.length) return h('p', { class: 'muted' }, 'Noch keine Karten.');
  const groups = new Map();
  for (const c of S.cards) {
    const key = [c.subject, c.topic].filter(Boolean).join(' › ') || 'Ohne Thema';
    const g = groups.get(key) || { n: 0, seen: 0, mastered: 0, ok: 0, tries: 0 };
    const p = S.progress.get(c.id);
    g.n++;
    if (p?.seen) { g.seen++; g.ok += p.correct; g.tries += p.seen; }
    if (isMastered(p)) g.mastered++;
    groups.set(key, g);
  }
  return h('div', {}, [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([name, g]) =>
    h('div', { class: 'box', style: 'padding:.8rem' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { style: 'flex:3' }, name), h('span', { class: 'muted small', style: 'flex:1;text-align:right' }, `${g.n} Karten`)),
      h('div', { class: 'bar ok', style: 'margin:.5rem 0' }, h('i', { style: `width:${pct(g.mastered, g.n)}%` })),
      h('div', { class: 'muted small' }, `Gefestigt ${pct(g.mastered, g.n)} % · gesehen ${pct(g.seen, g.n)} % · Trefferquote ${g.tries ? pct(g.ok, g.tries) + ' %' : '–'}`))));
}

function problemCards() {
  const probs = S.cards.map((c) => ({ c, p: S.progress.get(c.id) })).filter(({ p }) => p && isWeak(p) && p.lapses > 0)
    .sort((a, b) => b.p.lapses - a.p.lapses || a.p.correct / a.p.seen - b.p.correct / b.p.seen).slice(0, 25);
  if (!probs.length) return h('p', { class: 'muted' }, 'Keine Problemkarten – weiter so!');
  return h('div', {}, probs.map(({ c, p }) => {
    const right = c.correct.map((i) => `${LETTERS[i]}: ${c.answers[i]}`);
    return h('details', {}, h('summary', {}, h('span', { class: 'tag-bad' }, p.lapses + '×'), c.question),
      h('p', {}, h('b', {}, 'Richtig: '), right.join(' · ')), c.explanation ? h('p', { class: 'muted explain' }, c.explanation) : null,
      h('p', { class: 'muted small' }, `Trefferquote ${pct(p.correct, p.seen)} % bei ${p.seen} Versuchen`));
  }));
}

function oralHistory(ctx) {
  const list = [...S.sessions].sort((a, b) => b.ts - a.ts);
  if (!list.length) return h('p', { class: 'muted' }, 'Noch keine Prüfung absolviert.');
  const last = [...list].reverse().slice(-20);
  const w = 280, step = w / Math.max(1, last.length - 1);
  const pts = last.map((s, i) => `${last.length === 1 ? w / 2 : i * step},${56 - (s.percent / 100) * 52}`);
  const svg = `<svg class="spark" viewBox="0 0 ${w} 60" preserveAspectRatio="none" role="img" aria-label="Verlauf der Prüfungsergebnisse"><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${pts.join(' ')}"/>${pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3.5" fill="var(--accent)"/>`).join('')}</svg>`;
  return h('div', {}, h('div', { class: 'box' }, h('div', { class: 'muted small' }, 'Ergebnis in % (letzte 20)'), h('div', { html: svg })),
    list.slice(0, 15).map((s) => h('button', { class: 'list-item', onclick: () => { openSession = s; ctx.rerender(); } },
      `${s.percent} % · Note ${s.grade.note}`, h('small', {}, `${fmtDate(s.ts)} · ${s.items.length} Fragen${s.subject ? ' · ' + s.subject : ''}`))));
}
