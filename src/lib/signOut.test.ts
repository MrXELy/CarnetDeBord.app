import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripEvent } from '../types';

let session: object | null = { user: 1 };
/** Comportement de supabase.auth.signOut : par défaut la session est retirée sans erreur. */
const signOutRemote = vi.fn<() => Promise<{ error: unknown }>>(async () => {
  session = null;
  return { error: null };
});
vi.mock('./supabase', () => ({
  supabase: { auth: { signOut: () => signOutRemote(), getSession: async () => ({ data: { session } }) } },
}));
let pendingPhotos = 0;
const clearedFor: string[] = [];
vi.mock('./photos', () => ({
  cleanOrphanPhotos: async () => ({ deleted: 0, waiting: 0 }),
  flushTrash: async () => {},
  trashPhotos: () => {},
  uploadPending: async () => 0,
  pendingPhotoCount: async () => pendingPhotos,
  clearUserPhotos: async (userId: string) => void clearedFor.push(userId),
}));

const { EventStore } = await import('./sync');
const { clearLocalData, signOutAndClear } = await import('./signOut');

// Stockage local simulé (avec les méthodes length et key utilisées pour parcourir les clés).
const storage = new Map<string, string>();
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
vi.stubGlobal('navigator', { onLine: false });
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
  get length() {
    return storage.size;
  },
  key: (i: number) => [...storage.keys()][i] ?? null,
});

function ev(id: string): TripEvent {
  return {
    id, type: 'chargement', occurred_at: new Date('2026-10-12T08:00').toISOString(), tractor_plate: '', trailer_plate: '',
    odometer_km: null, notes: null, client: null, cmr_number: null, station: null, diesel_l: null,
    adblue_l: null, city: '', postcode: null, department: null, country_code: null, lat: null, lon: null,
    updated_at: '', deleted_at: null,
  };
}

beforeEach(() => {
  storage.clear();
  session = { user: 1 };
  signOutRemote.mockClear();
  signOutRemote.mockImplementation(async () => {
    session = null;
    return { error: null };
  });
  clearedFor.length = 0;
  pendingPhotos = 0;
});

describe('clearLocalData', () => {
  it('efface les clés de l’utilisateur et garde les réglages de l’appareil et les autres comptes', () => {
    for (const k of ['data', 'waybills', 'week_maps', 'user_settings', 'plates', 'photos_cleaned']) {
      storage.set(`cdb.u1.${k}`, '{}');
    }
    storage.set('cdb.settings', '{"europe":true}');
    storage.set('cdb.photo-trash', '[]');
    storage.set('cdb.u2.data', '{}');
    clearLocalData('u1');
    expect([...storage.keys()].sort()).toEqual(['cdb.photo-trash', 'cdb.settings', 'cdb.u2.data']);
  });
});

describe('signOutAndClear', () => {
  it('rien en attente : une seule confirmation, puis tout est effacé et la session fermée', async () => {
    const store = new EventStore('u1', { offline: true });
    storage.set('cdb.u1.data', '{}');
    storage.set('cdb.settings', '{}');
    const ask = vi.fn(() => true);
    expect(await signOutAndClear(store, { ask })).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(storage.has('cdb.u1.data')).toBe(false);
    expect(storage.has('cdb.settings')).toBe(true);
    expect(clearedFor).toEqual(['u1']);
    expect(signOutRemote).toHaveBeenCalledTimes(1);
  });

  it('modifications non envoyées : avertit, et n’efface rien si l’utilisateur refuse', async () => {
    const store = new EventStore('u1', { offline: true });
    store.save(ev('a'));
    const ask = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(await signOutAndClear(store, { ask })).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0]).toMatch(/1 modification n’est pas encore envoyée.*effacera/);
    expect(storage.has('cdb.u1.data')).toBe(true);
    expect(clearedFor).toEqual([]);
    expect(signOutRemote).not.toHaveBeenCalled();
  });

  it('modifications non envoyées et perte confirmée : tout est effacé', async () => {
    const store = new EventStore('u1', { offline: true });
    store.save(ev('a'));
    expect(storage.has('cdb.u1.data')).toBe(true);
    expect(await signOutAndClear(store, { ask: () => true })).toBe(true);
    expect(storage.has('cdb.u1.data')).toBe(false);
    expect(signOutRemote).toHaveBeenCalledTimes(1);
  });

  it('photos en attente d’envoi : même avertissement', async () => {
    const store = new EventStore('u1', { offline: true });
    pendingPhotos = 2;
    const ask = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(await signOutAndClear(store, { ask })).toBe(false);
    expect(ask.mock.calls[1][0]).toMatch(/2 photos ne sont pas encore envoyées/);
    expect(signOutRemote).not.toHaveBeenCalled();
  });

  it('premier refus : rien ne se passe', async () => {
    const store = new EventStore('u1', { offline: true });
    storage.set('cdb.u1.data', '{}');
    expect(await signOutAndClear(store, { ask: () => false })).toBe(false);
    expect(storage.has('cdb.u1.data')).toBe(true);
    expect(signOutRemote).not.toHaveBeenCalled();
  });

  it('le store arrêté n’écrit plus dans le cache local', async () => {
    const store = new EventStore('u1', { offline: true });
    await signOutAndClear(store, { ask: () => true });
    store.save(ev('late')); // modification tardive d'une synchro en cours, par exemple
    expect([...storage.keys()].filter((k) => k.startsWith('cdb.u1.'))).toEqual([]);
  });

  it('déconnexion impossible (session toujours là) : rien n’est effacé, message affiché, appli rechargée', async () => {
    const store = new EventStore('u1', { offline: true });
    storage.set('cdb.u1.data', '{}');
    signOutRemote.mockImplementation(async () => ({ error: new Error('réseau') })); // la session reste
    const notify = vi.fn();
    const reload = vi.fn();
    expect(await signOutAndClear(store, { ask: () => true, notify, reload })).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Déconnexion impossible/));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.has('cdb.u1.data')).toBe(true);
    expect(clearedFor).toEqual([]);
  });

  it('erreur du serveur mais session locale retirée : déconnecté, données effacées', async () => {
    const store = new EventStore('u1', { offline: true });
    storage.set('cdb.u1.data', '{}');
    signOutRemote.mockImplementation(async () => {
      session = null;
      return { error: new Error('hors ligne') };
    });
    const notify = vi.fn();
    expect(await signOutAndClear(store, { ask: () => true, notify })).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(storage.has('cdb.u1.data')).toBe(false);
    expect(clearedFor).toEqual(['u1']);
  });

  it('l’effacement a lieu après la fermeture de la session', async () => {
    const store = new EventStore('u1', { offline: true });
    storage.set('cdb.u1.data', '{}');
    let presentAtSignOut = false;
    signOutRemote.mockImplementation(async () => {
      presentAtSignOut = storage.has('cdb.u1.data');
      session = null;
      return { error: null };
    });
    await signOutAndClear(store, { ask: () => true });
    expect(presentAtSignOut).toBe(true);
    expect(storage.has('cdb.u1.data')).toBe(false);
  });
});
