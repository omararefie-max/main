/* Zentraler In-Memory-Zustand (S) + Persistenz in IndexedDB.
 * Alles wird beim Start einmal geladen; mehrere tausend Karten sind im Speicher unproblematisch. */
import * as db from './db.js';
import { newProgress, reviewProgress } from './srs.js';

export const DEFAULTS = {
  theme: 'dark',          // dark | light | auto
  fontSize: 18,           // px
  shuffle: true,          // Antwortreihenfolge mischen
  sessionSize: 20,
  ttsVoice: '',           // voiceURI
  ttsRate: 1,
  recLang: 'de-AT',       // de-AT | de-DE
  recLocalOnly: false,    // nur lokale (Offline-)Spracherkennung zulassen
  keepAlive: true,        // Bildschirm wach halten + Medien-Sitzung (Hörmodi)
  thinkPause: 4,          // Sekunden Denkpause im Hörmodus
  examQuestions: 8,
  examMinutes: 15,
  examInput: 'voice',     // voice | text
  aiEndpoint: ''          // optional, siehe js/ai-hook.js
};

export const S = {
  cards: [], oral: [], progress: new Map(), reviews: [], sessions: [],
  cardIndex: new Map(), settings: { ...DEFAULTS }
};

const reindex = () => { S.cardIndex = new Map(S.cards.map((c) => [c.id, c])); };

export async function loadAll() {
  const [cards, oral, prog, reviews, sessions, meta] = await Promise.all(
    ['cards', 'oral', 'progress', 'reviews', 'sessions', 'meta'].map(db.getAll)
  );
  S.cards = cards; S.oral = oral; S.reviews = reviews; S.sessions = sessions;
  S.progress = new Map(prog.map((p) => [p.cardId, p]));
  S.settings = { ...DEFAULTS, ...(meta.find((m) => m.key === 'settings')?.value || {}) };
  reindex();
  applySettings();
}

export function applySettings() {
  const r = document.documentElement;
  r.dataset.theme = S.settings.theme;
  r.style.setProperty('--fs', S.settings.fontSize);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) {
    const light = S.settings.theme === 'light' || (S.settings.theme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches);
    meta.content = light ? '#f4f6f8' : '#0f1318';
  }
}

export async function saveSettings(patch) {
  Object.assign(S.settings, patch);
  await db.put('meta', { key: 'settings', value: S.settings });
  applySettings();
}

/* ---------- Lernfortschritt ---------- */
export async function recordReview(card, correct) {
  const p = S.progress.get(card.id) || newProgress(card.id);
  reviewProgress(p, correct);
  S.progress.set(card.id, p);
  const r = { cardId: card.id, ts: Date.now(), correct, subject: card.subject || '', topic: card.topic || '' };
  S.reviews.push(r);
  await Promise.all([db.put('progress', p), db.put('reviews', r)]);
}

/* ---------- Inhalte (Upsert über feste IDs, Fortschritt bleibt erhalten) ---------- */
async function upsert(store, list, items) {
  const idx = new Map(list.map((x, i) => [x.id, i]));
  let added = 0, updated = 0;
  const now = Date.now();
  for (const it of items) {
    const i = idx.get(it.id);
    if (i === undefined) { it.createdAt = now; it.updatedAt = now; list.push(it); idx.set(it.id, list.length - 1); added++; }
    else { it.createdAt = list[i].createdAt || now; it.updatedAt = now; list[i] = it; updated++; }
  }
  await db.putMany(store, items);
  return { added, updated };
}
export async function upsertCards(items) { const r = await upsert('cards', S.cards, items); reindex(); return r; }
export function upsertOral(items) { return upsert('oral', S.oral, items); }

export async function removeCard(id) {
  S.cards = S.cards.filter((c) => c.id !== id); S.progress.delete(id); reindex();
  await Promise.all([db.del('cards', id), db.del('progress', id)]);
}
export async function removeOral(id) { S.oral = S.oral.filter((c) => c.id !== id); await db.del('oral', id); }

export async function saveSession(s) { S.sessions.push(s); await db.put('sessions', s); }

/* ---------- Backup ---------- */
export function exportContent() {
  return { format: 'lernapp/1', exportedAt: new Date().toISOString(), cards: S.cards.map(stripMeta), oralQuestions: S.oral.map(stripMeta) };
}
const stripMeta = ({ createdAt, updatedAt, ...rest }) => rest;

export function exportBackup() {
  return {
    format: 'lernapp-backup/1', exportedAt: new Date().toISOString(),
    cards: S.cards, oralQuestions: S.oral, progress: [...S.progress.values()],
    reviews: S.reviews, sessions: S.sessions, settings: S.settings
  };
}

export async function restoreBackup(b) {
  await db.clearAll();
  await Promise.all([
    db.putMany('cards', b.cards || []), db.putMany('oral', b.oralQuestions || []),
    db.putMany('progress', b.progress || []), db.putMany('reviews', (b.reviews || []).map(({ id, ...r }) => r)),
    db.putMany('sessions', (b.sessions || []).map(({ id, ...r }) => r)),
    db.put('meta', { key: 'settings', value: { ...DEFAULTS, ...(b.settings || {}) } })
  ]);
  await loadAll();
}

export async function wipeAll() { await db.clearAll(); await loadAll(); }
