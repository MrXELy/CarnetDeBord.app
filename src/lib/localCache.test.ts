import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripEvent } from '../types';

vi.mock('./supabase', () => ({ supabase: {} }));

const storage = new Map<string, string>();
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
vi.stubGlobal('navigator', { onLine: false });
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
});

/** Appli relancée : modules neufs (rien en mémoire), même IndexedDB. */
async function restart() {
  vi.resetModules();
  return { ...(await import('./localCache')), ...(await import('./sync')) };
}

function ev(id: string): TripEvent {
  return {
    id,
    type: 'chargement',
    occurred_at: new Date('2026-10-12T08:00').toISOString(),
    tractor_plate: '',
    trailer_plate: '',
    odometer_km: null,
    notes: null,
    station: null,
    diesel_l: null,
    adblue_l: null,
    city: 'Narbonne',
    postcode: null,
    department: null,
    country_code: null,
    lat: null,
    lon: null,
    updated_at: '',
    deleted_at: null,
  };
}

beforeEach(async () => {
  storage.clear();
  await (await restart()).clearCache('cdb.');
});

describe('cache local dans IndexedDB', () => {
  it('une étape notée sans réseau est toujours là, et toujours à envoyer, après une relance', async () => {
    const before = await restart();
    await before.loadStoreCache('u');
    new before.EventStore('u').save(ev('a'));
    await before.clearCache('cdb.rien.'); // passe après l'écriture en cours : attend sa fin

    const after = await restart();
    await after.loadStoreCache('u');
    const store = new after.EventStore('u');
    expect(store.getState().events.map((e) => e.id)).toEqual(['a']);
    expect(store.getState().pending).toBe(1);
  });

  it('reprend une fois le cache de l’ancienne version (localStorage), puis l’efface de localStorage', async () => {
    storage.set('cdb.u.data', JSON.stringify({ events: [ev('a')], outbox: ['a'], cursor: null }));
    storage.set('cdb.u.plates', '{"tractor":"","trailer":""}');
    const first = await restart();
    await first.loadStoreCache('u');
    expect(storage.has('cdb.u.data')).toBe(false);
    expect(storage.has('cdb.u.plates')).toBe(true); // petites clés : restent dans localStorage

    const after = await restart();
    await after.loadStoreCache('u');
    expect(new after.EventStore('u').getState().pending).toBe(1);
  });

  it('efface en mémoire et dans IndexedDB les clés d’un seul compte', async () => {
    const before = await restart();
    await before.writeCache({ 'cdb.u1.data': 1, 'cdb.u2.data': 2 });
    await before.clearCache('cdb.u1.');
    expect(before.readCache('cdb.u1.data')).toBeNull();

    const after = await restart();
    await after.loadCache(['cdb.u1.data', 'cdb.u2.data']);
    expect(after.readCache('cdb.u1.data')).toBeNull();
    expect(after.readCache('cdb.u2.data')).toBe(2);
  });
});
