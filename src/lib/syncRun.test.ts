import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripEvent } from '../types';

// Faux Supabase : compte les envois et peut être mis en pause pour simuler une synchro longue.
const calls = { upserts: 0 };
let gate: Promise<void> | null = null;
let pulledRows: Record<string, unknown>[] = [];

const query = {
  select: () => query,
  order: () => query,
  limit: () => query,
  gt: () => query,
  then: (resolve: (v: unknown) => void) => {
    const data = pulledRows;
    pulledRows = [];
    resolve({ data, error: null });
  },
};
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      ...query,
      upsert: async () => {
        calls.upserts++;
        await gate;
        return { error: null };
      },
    }),
  },
}));
vi.mock('./photos', () => ({
  cleanOrphanPhotos: async () => ({ deleted: 0, waiting: 0 }),
  flushTrash: async () => {},
  trashPhotos: () => {},
  uploadPending: async () => 0,
}));

const { EventStore } = await import('./sync');

const storage = new Map<string, string>();
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
vi.stubGlobal('navigator', { onLine: true });
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
});

function ev(id: string, occurred: string): TripEvent {
  return {
    id,
    type: 'chargement',
    occurred_at: new Date(occurred).toISOString(),
    tractor_plate: '',
    trailer_plate: '',
    odometer_km: null,
    notes: null,
    client: null,
    cmr_number: null,
    station: null,
    diesel_l: null,
    adblue_l: null,
    city: '',
    postcode: null,
    department: null,
    country_code: null,
    lat: null,
    lon: null,
    updated_at: '',
    deleted_at: null,
  };
}

/** Laisse les promesses en attente se terminer. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('listes stables', () => {
  beforeEach(() => storage.clear());

  it('garde les mêmes tableaux après un changement sans rapport avec les données', async () => {
    const store = new EventStore('stable');
    await flush();
    store.save(ev('a', '2026-10-12T08:00'));
    await flush();
    const { events, waybills } = store.getState();
    store.subscribe(() => {});
    await store.sync(); // émet plusieurs fois (syncing, fin) sans rien changer
    expect(store.getState().events).toBe(events);
    expect(store.getState().waybills).toBe(waybills);
  });

  it('crée un nouveau tableau dès qu’une étape est modifiée, et le garde ensuite', async () => {
    const store = new EventStore('stable2');
    await flush();
    const before = store.getState().events;
    store.save(ev('a', '2026-10-12T08:00'));
    await flush();
    const after = store.getState().events;
    expect(after).not.toBe(before);
    expect(after.map((e) => e.id)).toEqual(['a']);
    store.remove(after[0]);
    await flush();
    expect(store.getState().events).not.toBe(after);
    expect(store.getState().events).toEqual([]);
  });

  it('prend en compte les lignes reçues du serveur', async () => {
    const store = new EventStore('stable3');
    await flush();
    const before = store.getState().events;
    pulledRows = [
      { ...ev('srv', '2026-10-13T08:00'), user_id: 'x', created_at: '', updated_at: '2026-10-13T09:00:00Z' },
    ];
    await store.sync();
    expect(store.getState().events).not.toBe(before);
    expect(store.getState().events.map((e) => e.id)).toEqual(['srv']);
  });

  it('les calculs mémorisés servent tant que rien ne change', async () => {
    const store = new EventStore('stable4');
    await flush();
    const timeline = store.kmTimeline();
    await store.sync();
    expect(store.kmTimeline()).toBe(timeline);
    store.save(ev('a', '2026-10-12T08:00'));
    await flush();
    expect(store.kmTimeline()).not.toBe(timeline);
  });
});

describe('synchro relancée', () => {
  beforeEach(() => {
    storage.clear();
    calls.upserts = 0;
    gate = null;
  });

  it('une modification faite pendant une synchro est envoyée juste après, en une seule relance', async () => {
    const store = new EventStore('resync');
    await flush();
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    store.save(ev('a', '2026-10-12T08:00')); // lance une synchro, bloquée pendant l'envoi
    await flush();
    expect(calls.upserts).toBe(1);

    // Trois modifications pendant la synchro en cours : une seule relance après.
    gate = null;
    store.save(ev('b', '2026-10-12T09:00'));
    store.save(ev('c', '2026-10-12T10:00'));
    store.save(ev('d', '2026-10-12T11:00'));
    release();
    await flush();
    expect(calls.upserts).toBe(2);
    expect(store.getState().pending).toBe(0);
  });

  it('sans demande pendant la synchro, pas de relance', async () => {
    const store = new EventStore('resync2');
    await flush();
    store.save(ev('a', '2026-10-12T08:00'));
    await flush();
    await flush();
    expect(calls.upserts).toBe(1);
  });
});
