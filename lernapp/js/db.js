/* Schlanker IndexedDB-Wrapper. Alle Daten bleiben lokal im Browser.
 *
 * Object Stores:
 *  cards     – Quiz-Karten            (Schlüssel: id)
 *  oral      – Mündliche Prüfungsfragen (Schlüssel: id)
 *  progress  – Lernfortschritt/SM-2    (Schlüssel: cardId)  ← getrennt von den Karten, damit Re-Import nichts löscht
 *  reviews   – Protokoll jeder Antwort (auto-ID)            ← für Statistik/Streak
 *  sessions  – Mündliche Prüfungen     (auto-ID)
 *  meta      – Einstellungen u. a.     (Schlüssel: key)
 */
const DB_NAME = 'lernapp';
const DB_VERSION = 1;
export const STORES = ['cards', 'oral', 'progress', 'reviews', 'sessions', 'meta'];

let dbPromise;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('cards', { keyPath: 'id' });
      db.createObjectStore('oral', { keyPath: 'id' });
      db.createObjectStore('progress', { keyPath: 'cardId' });
      db.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(...[].concat(stores).map((s) => tx.objectStore(s)))).then((v) => (out = v));
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const getAll = (store) => run(store, 'readonly', (s) => wrap(s.getAll()));
export const get = (store, key) => run(store, 'readonly', (s) => wrap(s.get(key)));
export const put = (store, val) => run(store, 'readwrite', (s) => wrap(s.put(val)));
export const del = (store, key) => run(store, 'readwrite', (s) => wrap(s.delete(key)));
export const clear = (store) => run(store, 'readwrite', (s) => wrap(s.clear()));

/** Viele Datensätze in EINER Transaktion schreiben (schnell auch bei tausenden Karten). */
export function putMany(store, vals) {
  return run(store, 'readwrite', (s) => { vals.forEach((v) => s.put(v)); });
}

export function clearAll() {
  return run(STORES, 'readwrite', (...ss) => { ss.forEach((s) => s.clear()); });
}
