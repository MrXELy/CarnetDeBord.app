import { format } from 'date-fns';

/*
 * Fins d'étape notées depuis la notification (bouton « Fin de la livraison ») : le service worker (`src/sw.ts`)
 * les garde dans IndexedDB, l'appli les applique à son ouverture, ou tout de suite si elle est ouverte.
 * Partagé entre l'appli et le service worker : rien qui dépende de la page (window, localStorage).
 */

/** Notification de l'étape en cours (une seule à la fois) et confirmation après le bouton. */
export const STEP_TAG = 'step';
export const DONE_TAG = 'step-done';
/** Bouton « Fin du chargement / de la livraison » de la notification. */
export const FINISH_ACTION = 'finish';
/** Message du service worker aux fenêtres ouvertes : une fin attend d'être appliquée. */
export const FINISH_MESSAGE = 'step-finished';

/** Données gardées dans la notification de l'étape. */
export interface StepNoticeData {
  eventId: string;
  type: 'chargement' | 'livraison';
}

export interface NotifiedFinish {
  eventId: string;
  /** Heure du toucher (ISO). */
  finishedAt: string;
}

/** Texte de la confirmation : « Fin du chargement notée à 15:20 ». */
export function finishedText(type: StepNoticeData['type'], at: Date): string {
  return `${type === 'chargement' ? 'Fin du chargement' : 'Fin de la livraison'} notée à ${format(at, 'HH:mm')}`;
}

let opened: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      const request = indexedDB.open('carnetdebord-notifications', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('finishes', { keyPath: 'eventId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    opened.catch(() => (opened = null)); // retenté au prochain appel
  }
  return opened;
}

/** Garde une fin notée (une seule par étape : un second toucher remplace le premier). */
export async function addFinish(finish: NotifiedFinish): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('finishes', 'readwrite');
    tx.objectStore('finishes').put(finish);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Fins en attente, retirées en même temps (une seule transaction : chacune n'est appliquée qu'une fois). */
export async function takeFinishes(): Promise<NotifiedFinish[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('finishes', 'readwrite');
    const store = tx.objectStore('finishes');
    const request = store.getAll();
    request.onsuccess = () => store.clear();
    tx.oncomplete = () => resolve(request.result as NotifiedFinish[]);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
