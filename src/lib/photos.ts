import { FunctionsHttpError } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
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

/**
 * Envoie les photos en attente de cet utilisateur. Celles d'un autre compte ou du mode démo (« demo/… »), rangées
 * dans la même file du navigateur, ne sont pas envoyées : le stockage les refuserait. Renvoie le nombre restant.
 */
export async function uploadPending(userId: string): Promise<number> {
  const paths = (await pendingPaths()).filter((p) => p.startsWith(`${userId}/`));
  let left = paths.length;
  let failure: Error | null = null;
  for (const path of paths) {
    const blob = await pendingBlob(path);
    if (blob) {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      // Photo refusée : les suivantes partent quand même, l'erreur est signalée à la fin.
      if (error) {
        failure ??= new Error(`Envoi de photo impossible : ${error.message}`);
        continue;
      }
    }
    await unqueue(path);
    left--;
  }
  if (failure) throw failure;
  return left;
}

/** Photos de cet utilisateur prises sans réseau et pas encore envoyées. */
export async function pendingPhotoCount(userId: string): Promise<number> {
  try {
    return (await pendingPaths()).filter((p) => p.startsWith(`${userId}/`)).length;
  } catch {
    return 0; // IndexedDB indisponible : pas de photo en attente connue
  }
}

/** Efface les photos en attente et la corbeille de cet utilisateur (celles des autres comptes sont gardées). */
export async function clearUserPhotos(userId: string) {
  const mine = (path: string) => path.startsWith(`${userId}/`);
  try {
    await Promise.all((await pendingPaths()).filter(mine).map((p) => unqueue(p)));
  } catch {
    // IndexedDB indisponible : rien à effacer
  }
  writeTrash(readTrash().filter((p) => !mine(p)));
  for (const path of [...urls.keys()].filter(mine)) {
    URL.revokeObjectURL(urls.get(path)!);
    urls.delete(path);
  }
}

// ---------- Affichage ----------

const urls = new Map<string, string>();
/** Fin de validité des liens temporaires (signés pour 1 h, gardés 50 min : l'appli reste ouverte des heures). */
const signedUntil = new Map<string, number>();

/** Adresse affichable : la copie locale si la photo n'est pas encore envoyée, sinon un lien temporaire. */
export async function photoUrl(path: string): Promise<string | null> {
  const cached = urls.get(path);
  if (cached && (cached.startsWith('blob:') || Date.now() < (signedUntil.get(path) ?? 0))) return cached;
  const blob = await pendingBlob(path);
  let url: string | null = null;
  if (blob) url = URL.createObjectURL(blob);
  else {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    url = data?.signedUrl ?? null;
    signedUntil.set(path, Date.now() + 50 * 60_000);
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
    URL.revokeObjectURL(urls.get(path) ?? '');
    urls.delete(path);
  }
  writeTrash([...new Set([...readTrash(), ...paths])]);
}

/** Efface du stockage les photos de cet utilisateur mises à la corbeille (celles des autres comptes attendent). */
export async function flushTrash(userId: string) {
  const paths = readTrash().filter((p) => p.startsWith(`${userId}/`));
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`Effacement de photo impossible : ${error.message}`);
    // Ce qui a été ajouté pendant l'effacement reste dans la corbeille.
    writeTrash(readTrash().filter((p) => !batch.includes(p)));
  }
}

/** Photos de l'utilisateur dans aucune LV, envoyées depuis plus de « minAge » (intervalle SQL, ex. « 24 hours »). */
async function orphanPhotos(minAge: string, keep: Set<string>): Promise<string[]> {
  const { data, error } = await supabase.rpc('orphan_waybill_photos', { min_age: minAge });
  if (error) throw new Error(error.message);
  return (data as { name: string }[]).map((r) => r.name).filter((name) => !keep.has(name));
}

/**
 * Ménage : efface les photos qui ne sont dans aucune LV, envoyées depuis plus de « minAge »
 * (24 h pour le ménage automatique, 1 h à la demande). `keep` : photos des LV pas encore envoyées,
 * jamais effacées. Renvoie le nombre de photos effacées et celles, plus récentes, laissées pour plus tard.
 */
export async function cleanOrphanPhotos(
  keep: Set<string>,
  minAge = '24 hours',
): Promise<{ deleted: number; waiting: number }> {
  const orphans = await orphanPhotos(minAge, keep);
  for (let i = 0; i < orphans.length; i += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(orphans.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  const waiting = (await orphanPhotos('0 seconds', keep)).length;
  return { deleted: orphans.length, waiting };
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
  /** Remarques de l'IA sur la photo et sa lecture (absentes avec une ancienne version du serveur). */
  remarks?: string[];
  number: string | null;
  shipper_name: string | null;
  shipper_city: string | null;
  shipper_department: string | null;
  consignee_name: string | null;
  consignee_city: string | null;
  consignee_department: string | null;
  goods: string | null;
  weight_kg: number | null;
  /** Informations données mais dont l'IA doute (absentes avec une ancienne version du serveur). */
  uncertain?: string[];
}

/**
 * Lit une photo déjà envoyée, en direct : `onText` reçoit tout ce que l'IA a écrit jusque-là.
 * Une seule tentative : jamais de nouvel essai automatique (le serveur limite à 2 lectures par photo).
 */
export async function readWaybillPhoto(
  path: string,
  mode: LetterKind,
  onText: (text: string) => void,
): Promise<{ reading: WaybillReading; cost_usd: number }> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Non connecté');
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/read-waybill`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path, mode, stream: true }),
    });
  } catch {
    throw new Error('Service de lecture injoignable');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Lecture impossible');
  }
  // Serveur pas encore mis à jour : la réponse arrive en une fois.
  if (!response.headers.get('Content-Type')?.includes('ndjson') || !response.body) return response.json();

  // Une ligne JSON par message : « start », « text » (morceau de la réponse), puis « done » ou « error ».
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try {
      chunk = await reader.read();
    } catch {
      throw new Error('Lecture interrompue : connexion perdue');
    }
    if (chunk.done) throw new Error('Lecture interrompue avant la fin');
    buffer += chunk.value;
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === 'text') onText((text += event.text));
      else if (event.type === 'done') return event;
      else if (event.type === 'error') throw new Error(event.error);
    }
  }
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
