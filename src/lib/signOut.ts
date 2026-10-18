import { clearUserPhotos, pendingPhotoCount } from './photos';
import { supabase } from './supabase';
import type { EventStore } from './sync';

/**
 * Efface les données locales d'un utilisateur : toutes les clés `cdb.<id>.*` (étapes, LV, cartes, réglages
 * partagés, dernières plaques…). Les réglages de l'appareil (`cdb.settings` : carte, mode Europe) et les clés
 * des autres comptes sont gardés.
 */
export function clearLocalData(userId: string, storage: Pick<Storage, 'length' | 'key' | 'removeItem'> = localStorage) {
  const prefix = `cdb.${userId}.`;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Ce qui n'est pas encore envoyé : modifications en file et photos prises sans réseau. */
async function unsent(store: EventStore) {
  return { changes: store.getState().pending, photos: await pendingPhotoCount(store.userId) };
}

/** Temps laissé à l'envoi avant de considérer qu'il reste des envois (réseau très lent ou coupé). */
export const SEND_TIMEOUT_MS = 20_000;
/** Attente maximale de la fin d'une synchro lente, une fois le store arrêté (elle n'écrit plus rien de toute façon). */
const IDLE_TIMEOUT_MS = 3_000;

/** Attend la promesse au plus `ms` millisecondes : vrai si elle s'est terminée à temps. */
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Étape en cours, pour l'affichage : envoi de ce qui attend, fermeture de la session, ou rien (terminé, abandonné). */
export type SignOutStep = 'sending' | 'closing' | null;

interface Options {
  ask: (message: string) => boolean;
  notify: (message: string) => void;
  reload: () => void;
  progress: (step: SignOutStep) => void;
  timeout: number;
}

/** Une déconnexion à la fois : un deuxième clic pendant la première ne fait rien. */
let inProgress = false;

/**
 * Déconnexion : demande confirmation, envoie d'abord ce qui attend (synchro, au plus `timeout` ms), ferme la session,
 * et seulement ensuite efface les données locales de l'utilisateur. Si l'envoi échoue ou dépasse le délai,
 * l'utilisateur doit confirmer la perte explicitement. Renvoie false si l'utilisateur a renoncé, si une déconnexion
 * est déjà en cours, ou si la déconnexion a échoué (rien n'est effacé).
 */
export async function signOutAndClear(
  store: EventStore,
  {
    ask = (message: string) => confirm(message),
    notify = (message: string) => alert(message),
    reload = () => location.reload(),
    progress = () => {},
    timeout = SEND_TIMEOUT_MS,
  }: Partial<Options> = {},
): Promise<boolean> {
  if (inProgress) return false;
  inProgress = true;
  try {
    return await signOutSteps(store, { ask, notify, reload, progress, timeout });
  } finally {
    inProgress = false;
    progress(null);
  }
}

async function signOutSteps(store: EventStore, { ask, notify, reload, progress, timeout }: Options): Promise<boolean> {
  if (!ask('Se déconnecter ?')) return false;

  progress('sending');
  let left = await unsent(store);
  let tooSlow = false;
  if (left.changes + left.photos > 0) {
    tooSlow = !(await within(
      store.sync().then(() => store.whenIdle()),
      timeout,
    ));
    left = await unsent(store);
  }
  if (tooSlow || left.changes + left.photos > 0) {
    const what = [
      left.changes && plural(left.changes, 'modification'),
      left.photos && plural(left.photos, 'photo'),
    ].filter(Boolean);
    const verb = left.changes + left.photos > 1 ? 'ne sont pas encore envoyées' : 'n’est pas encore envoyée';
    const state = what.length ? `${what.join(' et ')} ${verb}` : 'L’envoi n’est pas terminé';
    if (!ask(`${state}. Se déconnecter les effacera définitivement. Se déconnecter quand même ?`)) {
      return false;
    }
  }

  progress('closing');
  // Le store est arrêté : une synchro en cours (même lente, après un dépassement du délai) n'écrira plus dans le
  // cache local (`disposed`) ; on ne l'attend que brièvement.
  store.dispose();
  await within(store.whenIdle(), IDLE_TIMEOUT_MS);

  // Déconnexion de cet appareil seulement (« local ») : les autres appareils restent connectés. Même sans réseau,
  // la session locale est retirée (l'erreur renvoyée dit seulement que le serveur n'a pas pu être prévenu).
  // On ne se fie donc pas à l'erreur : on regarde si la session a vraiment disparu.
  let closed = false;
  try {
    await supabase.auth.signOut({ scope: 'local' });
    closed = (await supabase.auth.getSession()).data.session == null;
  } catch {
    closed = false;
  }
  if (!closed) {
    // Toujours connecté : rien n'est effacé. L'appli recharge son cache pour redevenir utilisable (le store est arrêté).
    notify('Déconnexion impossible : vérifie la connexion, puis réessaie.');
    reload();
    return false;
  }

  // Session fermée : le store ne revient pas (plus d'utilisateur), on peut effacer les données locales.
  clearLocalData(store.userId);
  await clearUserPhotos(store.userId);
  return true;
}
