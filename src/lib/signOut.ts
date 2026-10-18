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

/**
 * Déconnexion : demande confirmation, envoie d'abord ce qui attend (synchro), ferme la session, et seulement
 * ensuite efface les données locales de l'utilisateur. Si l'envoi échoue, l'utilisateur doit confirmer la perte
 * explicitement. Renvoie false si l'utilisateur a renoncé ou si la déconnexion a échoué (rien n'est effacé).
 */
export async function signOutAndClear(
  store: EventStore,
  {
    ask = (message: string) => confirm(message),
    notify = (message: string) => alert(message),
    reload = () => location.reload(),
  } = {},
): Promise<boolean> {
  if (!ask('Se déconnecter ?')) return false;

  let left = await unsent(store);
  if (left.changes + left.photos > 0) {
    await store.sync();
    await store.whenIdle();
    left = await unsent(store);
  }
  if (left.changes + left.photos > 0) {
    const what = [
      left.changes && plural(left.changes, 'modification'),
      left.photos && plural(left.photos, 'photo'),
    ].filter(Boolean);
    const verb = left.changes + left.photos > 1 ? 'ne sont pas encore envoyées' : 'n’est pas encore envoyée';
    if (!ask(`${what.join(' et ')} ${verb}. Se déconnecter les effacera définitivement. Se déconnecter quand même ?`)) {
      return false;
    }
  }

  // Le store est arrêté : une synchro en cours ne réécrira pas le cache pendant la déconnexion.
  store.dispose();
  await store.whenIdle();

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
