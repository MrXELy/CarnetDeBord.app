import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

const BUCKET = 'waybill-photos';
/** Côté le plus long : au-delà, la photo coûterait plus cher à lire sans être mieux lue. */
const MAX_SIDE = 1568;

/** Réduit et compresse une photo en JPEG avant de la stocker. */
export async function compressPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Compression impossible'))), 'image/jpeg', 0.85),
  );
}

export function newPhotoPath(userId: string, waybillId: string): string {
  return `${userId}/${waybillId}/${crypto.randomUUID()}.jpg`;
}

// ---------- File d'attente sans réseau (IndexedDB : les photos sont trop lourdes pour localStorage) ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('carnetdebord-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction('pending', mode).objectStore('pending'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const queuePhoto = (path: string, blob: Blob) => withStore('readwrite', (s) => s.put(blob, path));
const pendingBlob = (path: string) => withStore<Blob | undefined>('readonly', (s) => s.get(path));
const unqueue = (path: string) => withStore('readwrite', (s) => s.delete(path));
export const pendingPaths = async () => (await withStore('readonly', (s) => s.getAllKeys())) as string[];

/** Envoie les photos en attente. Renvoie le nombre de photos restant à envoyer. */
export async function uploadPending(): Promise<number> {
  const paths = await pendingPaths();
  let left = paths.length;
  for (const path of paths) {
    const blob = await pendingBlob(path);
    if (blob) {
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(`Envoi de photo impossible : ${error.message}`);
    }
    await unqueue(path);
    left--;
  }
  return left;
}

// ---------- Affichage ----------

const urls = new Map<string, string>();

/** Adresse affichable : la copie locale si la photo n'est pas encore envoyée, sinon un lien temporaire. */
export async function photoUrl(path: string): Promise<string | null> {
  const cached = urls.get(path);
  if (cached) return cached;
  const blob = await pendingBlob(path);
  let url: string | null = null;
  if (blob) url = URL.createObjectURL(blob);
  else {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    url = data?.signedUrl ?? null;
  }
  if (url) urls.set(path, url);
  return url;
}

export async function deletePhoto(path: string) {
  await unqueue(path);
  urls.delete(path);
  await supabase.storage.from(BUCKET).remove([path]);
}

// ---------- Lecture automatique ----------

/**
 * Mode de lecture : « printed » = économique (utilisée par défaut, lit aussi bien le manuscrit) ;
 * « handwritten » = la plus fiable, plus chère (bouton « Relire en mode fiable »).
 */
export type LetterKind = 'printed' | 'handwritten';

/** Ce que la fonction « read-waybill » lit sur la photo (null = absent ou illisible). */
export interface WaybillReading {
  number: string | null;
  shipper_name: string | null;
  shipper_city: string | null;
  shipper_department: string | null;
  consignee_name: string | null;
  consignee_city: string | null;
  consignee_department: string | null;
  goods: string | null;
  weight_kg: number | null;
}

/**
 * Lit une photo déjà envoyée. Une seule tentative : jamais de nouvel essai automatique
 * (le serveur limite de toute façon à 2 lectures par photo).
 */
export async function readWaybillPhoto(
  path: string,
  mode: LetterKind,
): Promise<{ reading: WaybillReading; cost_usd: number }> {
  const { data, error } = await supabase.functions.invoke('read-waybill', { body: { path, mode } });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      throw new Error(body?.error ?? 'Lecture impossible');
    }
    throw new Error('Service de lecture injoignable');
  }
  return data;
}

/** Lectures du mois en cours (nombre et coût estimé). */
export async function monthUsage(): Promise<{ count: number; cost: number } | null> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await supabase.from('ocr_usage').select('cost_usd').gte('created_at', monthStart);
  if (error) return null;
  return { count: data.length, cost: data.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0) };
}
