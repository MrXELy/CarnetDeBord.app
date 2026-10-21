/**
 * Cache local des données (étapes, LV, cartes, réglages partagés) dans IndexedDB : bien plus de place que
 * localStorage (environ 5 Mo, partagés avec les autres sites en mrxely.github.io), qui aurait débordé en quelques
 * années d'historique. Gardé aussi en mémoire pour être lu sans attendre : `loadCache` avant la première lecture.
 */

const memory = new Map<string, unknown>();

let opened: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      const request = indexedDB.open('carnetdebord-cache', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('cache');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    opened.catch(() => (opened = null)); // retenté au prochain appel
  }
  return opened;
}

async function transact(mode: IDBTransactionMode, run: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cache', mode);
    run(tx.objectStore('cache'));
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Écritures et effacements l'un après l'autre, dans l'ordre demandé (un effacement n'est jamais doublé). */
let queue: Promise<unknown> = Promise.resolve();
function enqueue(job: () => Promise<void>): Promise<void> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/** Valeur écrite par l'ancienne version de l'appli dans localStorage, ou null. */
function oldValue(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Charge ces clés en mémoire (celles déjà en mémoire sont à jour). Une clé encore dans localStorage (ancienne
 * version de l'appli) est recopiée dans IndexedDB, puis effacée de localStorage une fois la copie réussie.
 */
export async function loadCache(keys: string[]): Promise<void> {
  const missing = keys.filter((key) => !memory.has(key));
  if (!missing.length) return;
  const stored = new Map<string, unknown>();
  await enqueue(() =>
    transact('readonly', (store) => {
      for (const key of missing) {
        const request = store.get(key);
        request.onsuccess = () => request.result !== undefined && stored.set(key, request.result);
      }
    }),
  ).catch(() => {}); // IndexedDB indisponible : rien de relu, l'erreur apparaîtra au premier enregistrement
  const moved: Record<string, unknown> = {};
  for (const key of missing) {
    const value = stored.has(key) ? stored.get(key) : oldValue(key);
    if (value == null) continue;
    memory.set(key, value);
    if (!stored.has(key)) moved[key] = value;
  }
  if (!Object.keys(moved).length) return;
  try {
    await writeCache(moved);
    Object.keys(moved).forEach((key) => localStorage.removeItem(key));
  } catch {
    // Copie impossible : l'ancienne valeur reste dans localStorage, recopiée au prochain lancement.
  }
}

export function readCache<T>(key: string): T | null {
  return (memory.get(key) as T | undefined) ?? null;
}

/** Enregistre ces valeurs : tout de suite en mémoire, puis dans IndexedDB en une seule fois (tout ou rien). */
export function writeCache(entries: Record<string, unknown>): Promise<void> {
  Object.entries(entries).forEach(([key, value]) => memory.set(key, value));
  return enqueue(() => transact('readwrite', (store) => Object.entries(entries).forEach(([k, v]) => store.put(v, k))));
}

/** Efface les clés qui commencent ainsi (par exemple « cdb.<id utilisateur>. »), en mémoire et dans IndexedDB. */
export function clearCache(prefix: string): Promise<void> {
  [...memory.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => memory.delete(key));
  return enqueue(() => transact('readwrite', (store) => store.delete(IDBKeyRange.bound(prefix, `${prefix}￿`))));
}
