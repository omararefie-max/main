// Statistik: Lernfortschritt pro Thema, Trefferquote, Serie, Problemkarten, Verlauf.
import { state, cardList } from './store.js';
import { level } from './srs.js';
import { streak } from './quiz.js';
import { h, mount, dayKey, fmtDate } from './util.js';
import { emptyState } from './ui.js';

export function renderStats(view, ctx) {
  const cards = cardList();
  if (!cards.length) {
    mount(view, h('h1', null, 'Statistik'), emptyState('Noch keine Daten. Beantworte ein paar Karten, dann erscheint hier dein Fortschritt.',
      h('a', { class: 'btn primary', href: '#/learn' }, 'Zum Lernen')));
    return;
  }

  // --- Kennzahlen ---
  let right = 0, wrong = 0, seen = 0;
  for (const p of state.progress.values()) { right += p.right; wrong += p.wrong; if (p.seen > 0) seen++; }
  const acc = right + wrong ? Math.round((right / (right + wrong)) * 100) : 0;
  const today = dayKey();
  const todayCount = state.reviews.filter((r) => dayKey(r.ts) === today).length;

  // --- Aktivität letzte 14 Tage ---
  const perDay = new Map();
  for (const r of state.reviews) { const k = dayKey(r.ts); perDay.set(k, (perDay.get(k) || 0) + 1); }
  const days = [];
  for (let n = 13; n >= 0; n--) { const k = dayKey(Date.now() - n * 86400000); days.push({ k, v: perDay.get(k) || 0 }); }
  const maxDay = Math.max(1, ...days.map((d) => d.v));

  // --- pro Fach/Thema ---
  const groups = new Map();
  for (const c of cards) {
    const key = `${c.deck} › ${c.topic}`;
    if (!groups.has(key)) groups.set(key, { key, deck: c.deck, topic: c.topic, n: 0, lv: { new: 0, learn: 0, known: 0, master: 0 }, right: 0, wrong: 0 });
    const g = groups.get(key); const p = state.progress.get(c.id);
    g.n++; g.lv[level(p)]++;
    if (p) { g.right += p.right; g.wrong += p.wrong; }
  }
  const groupList = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, 'de'));

  // --- Problemkarten ---
  const problems = cards
    .map((c) => ({ c, p: state.progress.get(c.id) }))
    .filter((x) => x.p && x.p.wrong > 0 && x.p.seen >= 2)
    .sort((a, b) => b.p.wrong / b.p.seen - a.p.wrong / a.p.seen || b.p.wrong - a.p.wrong)
    .slice(0, 15);

  const sessions = state.sessions.slice(-8).reverse();

  mount(view,
    h('h1', null, 'Statistik'),
    h('div', { class: 'grid2' },
      h('div', { class: 'card stat' }, h('b', null, `${streak()}`), h('span', null, 'Tage in Folge')),
      h('div', { class: 'card stat' }, h('b', null, `${acc}%`), h('span', null, 'Trefferquote'))),
    h('div', { class: 'grid2' },
      h('div', { class: 'card stat' }, h('b', null, `${todayCount}`), h('span', null, 'heute beantwortet')),
      h('div', { class: 'card stat' }, h('b', null, `${seen}/${cards.length}`), h('span', null, 'Karten gesehen'))),

    h('h2', null, 'Letzte 14 Tage'),
    h('div', { class: 'card' },
      h('div', { class: 'bars', role: 'img', 'aria-label': 'Antworten pro Tag' },
        days.map((d) => h('div', { class: d.v ? '' : 'zero', style: { height: `${Math.max(2, (d.v / maxDay) * 100)}%` }, title: `${d.k}: ${d.v}` }))),
      h('div', { class: 'row between muted small', style: { marginTop: '.3rem' } }, h('span', null, days[0].k.slice(5)), h('span', null, 'heute'))),

    h('h2', null, 'Fortschritt pro Thema'),
    h('div', { class: 'legend', style: { marginBottom: '.5rem' } },
      legend('lv-new', 'neu'), legend('lv-learn', 'lernend'), legend('lv-known', 'bekannt'), legend('lv-master', 'sicher')),
    groupList.map((g) => {
      const t = g.right + g.wrong;
      return h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('b', null, g.key), h('span', { class: 'muted small' }, `${g.n} Karten${t ? ` · ${Math.round((g.right / t) * 100)}% richtig` : ''}`)),
        h('div', { class: 'stacked', style: { marginTop: '.5rem' } },
          ['new', 'learn', 'known', 'master'].map((k) => h('i', { class: 'lv-' + (k === 'learn' ? 'learn' : k), style: { width: `${(g.lv[k] / g.n) * 100}%` } }))));
    }),

    h('h2', null, 'Problemkarten'),
    problems.length ? [
      problems.map(({ c, p }) => h('div', { class: 'list-item' },
        h('div', { class: 't' }, c.question),
        h('div', { class: 'muted small' }, `${c.deck} › ${c.topic} · ${p.wrong} von ${p.seen} falsch`))),
      h('button', { class: 'btn', onclick: () => ctx.go('/quiz', { mode: 'weak', scope: {}, size: 20 }) }, 'Schwache Karten üben'),
    ] : h('p', { class: 'muted' }, 'Noch keine Problemkarten – sobald du Karten mehrfach falsch beantwortest, erscheinen sie hier.'),

    sessions.length ? [
      h('h2', null, 'Letzte Sitzungen'),
      sessions.map((s) => h('div', { class: 'list-item' },
        h('div', { class: 'row between' }, h('span', null, `${s.correct}/${s.total} richtig`), h('b', null, `${s.percent}%`)),
        h('div', { class: 'muted small' }, `${fmtDate(s.ts)} · ${s.mode === 'exam' ? 'Prüfungsmodus' : 'Lernen'}`))),
    ] : null);
}

const legend = (cls, text) => h('span', null, h('i', { class: cls }), text);
