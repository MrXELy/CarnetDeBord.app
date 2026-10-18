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
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
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

// ---------- Effacement ----------

/** Photos à effacer du stockage, gardées jusqu'à ce que l'effacement réussisse (réseau absent, erreur). */
const TRASH_KEY = 'cdb.photo-trash';

function readTrash(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TRASH_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeTrash(paths: string[]) {
  try {
    localStorage.setItem(TRASH_KEY, JSON.stringify(paths));
  } catch {
    // Stockage indisponible : le ménage quotidien rattrapera ces photos.
  }
}

/** Met des photos à effacer : retirées tout de suite de la file d'envoi, effacées du stockage à la prochaine synchro. */
export function trashPhotos(paths: string[]) {
  if (!paths.length) return;
  for (const path of paths) {
    void unqueue(path).catch(() => {});
    urls.delete(path);
  }
  writeTrash([...new Set([...readTrash(), ...paths])]);
}

/** Efface du stockage les photos mises à la corbeille. */
export async function flushTrash() {
  const paths = readTrash();
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`Effacement de photo impossible : ${error.message}`);
    // Ce qui a été ajouté pendant l'effacement reste dans la corbeille.
    writeTrash(readTrash().filter((p) => !batch.includes(p)));
  }
}

/**
 * Ménage : efface les photos de plus de 24 h qui ne sont dans aucune LV (fonction « orphan_waybill_photos »).
 * `keep` : photos des LV pas encore envoyées, jamais effacées. Renvoie le nombre de photos effacées.
 */
export async function cleanOrphanPhotos(keep: Set<string>): Promise<number> {
  const { data, error } = await supabase.rpc('orphan_waybill_photos');
  if (error) throw new Error(error.message);
  const orphans = (data as { name: string }[]).map((r) => r.name).filter((name) => !keep.has(name));
  for (let i = 0; i < orphans.length; i += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(orphans.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  return orphans.length;
}

/** Nombre et poids des photos stockées (null si indisponible). */
export async function photoStats(): Promise<{ photos: number; bytes: number } | null> {
  const { data, error } = await supabase.rpc('waybill_photo_stats');
  if (error || !data?.[0]) return null;
  return { photos: Number(data[0].photos), bytes: Number(data[0].bytes) };
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
export function readWaybillPhoto(
  path: string,
  mode: LetterKind,
): Promise<{ reading: WaybillReading; cost_usd: number }> {
  return invokeReader({ path, mode });
}

/** Appelle la fonction de lecture et traduit ses erreurs en messages lisibles. */
export async function invokeReader<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('read-waybill', { body });
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
