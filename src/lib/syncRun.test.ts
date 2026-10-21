import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCache, readCache } from './localCache';
import { newWaybill, type TripEvent } from '../types';

// Faux Supabase : compte les envois, peut être mis en pause (synchro longue), refuser des lignes,
// et rejoue les pages de lecture comme PostgREST (tri par date puis id, filtre du curseur).
type Row = Record<string, unknown> & { id: string; updated_at: string };
const calls = {
  upserts: 0,
  rowUpserts: 0,
  uploads: 0,
  pulls: [] as string[],
  upsertTables: [] as string[],
  purges: [] as string[],
};
let gate: Promise<void> | null = null;
/** Lignes présentes sur le « serveur », par table. */
let server: Record<string, Row[]> = {};
/** Lignes que le serveur refuse (id → message). */
let refusedIds: Record<string, string> = {};
/** Panne réseau simulée pour les envois. */
let offline = false;
/** Erreur qui concerne tout l'envoi (code PostgREST ou Postgres), renvoyée à chaque tentative. */
let batchErrorCode = '';
/** Filtres reçus par les lectures, pour vérifier le format du curseur. */
let pullFilters: string[] = [];
let pageSize = 1000;

function fakeQuery(table: string) {
  let cursor: ((r: Row) => boolean) | null = null;
  const q = {
    select: () => q,
    order: () => q,
    limit: (n: number) => {
      pageSize = n;
      return q;
    },
    gt: (_: string, v: string) => {
      cursor = (r) => r.updated_at > v;
      pullFilters.push(`gt ${v}`);
      return q;
    },
    gte: (_: string, v: string) => {
      cursor = (r) => r.updated_at >= v;
      pullFilters.push(`gte ${v}`);
      return q;
    },
    or: (filter: string) => {
      pullFilters.push(filter);
      const m = /updated_at\.gt\."(.+?)",and\(updated_at\.eq\."(.+?)",id\.gt\."(.+?)"\)/.exec(filter)!;
      cursor = (r) => r.updated_at > m[1] || (r.updated_at === m[2] && r.id > m[3]);
      return q;
    },
    then: (resolve: (v: unknown) => void) => {
      calls.pulls.push(table);
      const rows = (server[table] ?? [])
        .filter((r) => !cursor || cursor(r))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))
        .slice(0, pageSize);
      resolve({ data: rows, error: null });
    },
  };
  return q;
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      ...fakeQuery(table),
      // Effacement des lignes supprimées avant une date (« purge »).
      delete: () => ({
        lt: async (column: string, before: string) => {
          calls.purges.push(table);
          server[table] = (server[table] ?? []).filter((r) => !(r[column] && String(r[column]) < before));
          return { error: null };
        },
      }),
      upsert: async (rows: Row[]) => {
        calls.upserts++;
        calls.upsertTables.push(table);
        if (rows.length === 1) calls.rowUpserts++;
        await gate;
        if (batchErrorCode) return { error: { message: 'erreur de schéma', code: batchErrorCode }, status: 400 };
        if (offline) return { error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 };
        const bad = rows.find((r) => refusedIds[r.id]);
        if (bad) return { error: { message: refusedIds[bad.id], code: '23514' }, status: 400 };
        return { error: null, status: 201 };
      },
    }),
  },
}));
vi.mock('./photos', () => ({
  cleanOrphanPhotos: async () => ({ deleted: 0, waiting: 0 }),
  flushTrash: async () => {},
  trashPhotos: () => {},
  uploadPending: async () => {
    calls.uploads++;
    return 0;
  },
}));

const { EventStore, loadStoreCache } = await import('./sync');

const storage = new Map<string, string>();
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
vi.stubGlobal('navigator', { onLine: true });
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
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

beforeEach(async () => {
  await clearCache('cdb.');
  storage.clear();
  server = {};
  refusedIds = {};
  offline = false;
  batchErrorCode = '';
  pullFilters = [];
  pageSize = 1000;
  calls.upserts = 0;
  calls.rowUpserts = 0;
  calls.uploads = 0;
  calls.pulls = [];
  calls.upsertTables = [];
  calls.purges = [];
  gate = null;
});

describe('listes stables', () => {
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
    server.events = [
      { ...ev('srv', '2026-10-13T08:00'), user_id: 'x', created_at: '', updated_at: '2026-10-13T09:00:00Z' },
    ] as unknown as Row[];
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

describe('envoi : une ligne refusée ne bloque pas les autres', () => {
  it('les lignes acceptées partent, la refusée reste dans la file et l’erreur la nomme', async () => {
    const store = new EventStore('push1');
    await flush();
    refusedIds = { bad: 'violates check constraint' };
    store.save(ev('ok1', '2026-10-12T08:00'));
    store.save(ev('bad', '2026-10-12T09:00'));
    store.save(ev('ok2', '2026-10-12T10:00'));
    await flush();
    await flush();
    expect(store.isPending('ok1')).toBe(false);
    expect(store.isPending('ok2')).toBe(false);
    expect(store.isPending('bad')).toBe(true);
    expect(store.getState().pending).toBe(1);
    expect(store.getState().error).toMatch(/bad : violates check constraint/);
  });

  it('une fois la ligne acceptée par le serveur, elle part à la synchro suivante', async () => {
    const store = new EventStore('push2');
    await flush();
    refusedIds = { bad: 'refus' };
    store.save(ev('bad', '2026-10-12T09:00'));
    await flush();
    expect(store.getState().pending).toBe(1);
    refusedIds = {};
    await store.sync();
    expect(store.getState().pending).toBe(0);
    expect(store.getState().error).toBeNull();
  });

  it('erreur réseau : pas de renvoi ligne par ligne, tout reste dans la file', async () => {
    const store = new EventStore('push3');
    await flush();
    offline = true;
    store.save(ev('a', '2026-10-12T08:00'));
    store.save(ev('b', '2026-10-12T09:00'));
    await flush();
    await flush();
    expect(calls.upserts).toBe(2); // un envoi par modification, jamais de renvoi ligne par ligne
    expect(store.getState().pending).toBe(2);
  });
});

describe('envoi : erreurs qui concernent tout le lot', () => {
  it.each(['PGRST204', 'PGRST205', '42703', '42501'])(
    'erreur %s sur le lot : aucun renvoi ligne par ligne, tout reste dans la file',
    async (code) => {
      const store = new EventStore(`batch-${code}`);
      await flush();
      batchErrorCode = code;
      store.save(ev('a', '2026-10-12T08:00'));
      store.save(ev('b', '2026-10-12T09:00'));
      await flush();
      await flush();
      expect(calls.upserts).toBe(2); // un envoi par modification, aucun renvoi ligne par ligne
      expect(store.getState().pending).toBe(2);
      expect(store.isPending('a') && store.isPending('b')).toBe(true);
    },
  );
});

describe('lecture : curseur (date, id)', () => {
  const stamp = '2026-10-13T09:00:00.123456+00:00';
  const make = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      ...ev(`id-${String(i).padStart(5, '0')}`, '2026-10-13T08:00'),
      user_id: 'x',
      created_at: '',
      updated_at: stamp,
    })) as unknown as Row[];

  it('plus de 1000 lignes avec la même date de modification : aucune n’est perdue', async () => {
    server.events = make(2500);
    const store = new EventStore('pull1');
    await flush();
    await store.sync();
    expect(store.getState().error).toBeNull();
    expect(store.getState().events).toHaveLength(2500);
    // Filtre bien formé : date entre guillemets, avec « + » et « : » intacts.
    expect(pullFilters.some((f) => f.includes(`updated_at.gt."${stamp}"`) && f.includes('id.gt."id-'))).toBe(true);
  });

  it('un ancien curseur (date seule) reprend à cette date sans rien perdre', async () => {
    server.events = make(1500);
    storage.set('cdb.pull2.data', JSON.stringify({ events: [], outbox: [], cursor: stamp }));
    storage.set('cdb.pull2.full_synced', JSON.stringify(new Date().toISOString()));
    await loadStoreCache('pull2');
    const store = new EventStore('pull2');
    await flush();
    await store.sync();
    expect(pullFilters[0]).toBe(`gte ${stamp}`);
    expect(store.getState().events).toHaveLength(1500);
  });

  it('le curseur enregistré garde la date et l’id, et une synchro suivante ne perd rien', async () => {
    server.events = make(3);
    const store = new EventStore('pull3');
    await flush();
    await store.sync();
    const saved = readCache<{ cursor: string }>('cdb.pull3.data')!;
    expect(saved.cursor).toBe(`${stamp}|id-00002`);
    server.events = [];
    await store.sync();
    expect(store.getState().events).toHaveLength(3);
  });
});

describe('lignes supprimées : effacées du serveur après 30 jours', () => {
  const row = (id: string, deletedAt: string | null, updatedAt: string): Row =>
    ({
      ...ev(id, '2026-10-01T08:00'),
      deleted_at: deletedAt,
      user_id: 'x',
      created_at: '',
      updated_at: updatedAt,
    }) as Row;
  const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  const recent = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

  it('efface du serveur celles supprimées depuis plus de 30 jours, les LV avant les étapes, une fois par jour', async () => {
    server.events = [row('vieille', old, old), row('recente', recent, recent), row('vivante', null, recent)];
    const store = new EventStore('purge1');
    await flush();
    expect(calls.purges).toEqual(['waybills', 'week_maps', 'events']);
    expect(server.events.map((r) => r.id)).toEqual(['recente', 'vivante']);
    await store.sync();
    expect(calls.purges).toHaveLength(3);
  });

  it('relecture complète : oublie ce que le serveur n’a plus, garde ce qui attend d’être envoyé', async () => {
    server.events = [row('a', null, recent), row('b', null, recent)];
    const store = new EventStore('full1');
    await flush();
    expect(
      store
        .getState()
        .events.map((e) => e.id)
        .sort(),
    ).toEqual(['a', 'b']);
    // « b » effacé du serveur par un autre appareil ; une étape ajoutée ici attend l'envoi (refusée pour l'instant).
    server.events = [row('a', null, recent)];
    refusedIds = { locale: 'refusée' };
    store.save(ev('locale', '2026-10-13T08:00'));
    await flush();
    // Relecture simple : rien n'est oublié.
    expect(
      store
        .getState()
        .events.map((e) => e.id)
        .sort(),
    ).toEqual(['a', 'b', 'locale']);
    // Une semaine plus tard : relecture complète.
    storage.set('cdb.full1.full_synced', JSON.stringify(new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()));
    await store.sync();
    expect(
      store
        .getState()
        .events.map((e) => e.id)
        .sort(),
    ).toEqual(['a', 'locale']);
    expect(
      readCache<{ events: TripEvent[] }>('cdb.full1.data')!
        .events.map((e) => e.id)
        .sort(),
    ).toEqual(['a', 'locale']);
  });

  it('les anciennes colonnes client et cmr_number ne sont plus gardées', async () => {
    storage.set(
      'cdb.cols1.data',
      JSON.stringify({
        events: [{ ...ev('x', '2026-10-13T08:00'), client: null, cmr_number: null }],
        outbox: [],
        cursor: null,
      }),
    );
    await loadStoreCache('cols1');
    const store = new EventStore('cols1');
    expect(store.getState().events[0]).not.toHaveProperty('client');
    expect(store.getState().events[0]).not.toHaveProperty('cmr_number');
  });
});

describe('envoi : une ligne refusée ne bloque pas le reste de la synchro', () => {
  const serverEvent = (id: string): Row =>
    ({
      ...ev(id, '2026-10-13T08:00'),
      user_id: 'x',
      created_at: '',
      updated_at: '2026-10-13T09:00:00+00:00',
    }) as unknown as Row;

  it('une étape refusée n’empêche ni la réception, ni l’envoi des LV, ni celui des photos', async () => {
    const store = new EventStore('refus1');
    await flush();
    refusedIds = { bad: 'violates check constraint' };
    server.events = [serverEvent('srv')];
    calls.pulls = [];
    calls.upsertTables = [];
    calls.uploads = 0;
    store.save(ev('bad', '2026-10-12T09:00'));
    store.saveWaybill(newWaybill({ id: 'lv-ok' }));
    await flush();
    await flush();
    expect(calls.pulls).toContain('events');
    expect(store.getState().events.map((e) => e.id)).toContain('srv');
    expect(calls.upsertTables).toContain('waybills');
    expect(store.isPending('lv-ok')).toBe(false);
    expect(calls.pulls).toContain('waybills');
    expect(calls.uploads).toBeGreaterThan(0);
    expect(store.isPending('bad')).toBe(true);
  });

  it('l’erreur affichée nomme la ligne refusée, même si tout le reste a réussi', async () => {
    const store = new EventStore('refus2');
    await flush();
    refusedIds = { bad: 'violates check constraint' };
    store.save(ev('bad', '2026-10-12T09:00'));
    await flush();
    await flush();
    expect(store.getState().error).toMatch(/\(events\) bad : violates check constraint/);
  });

  it('plusieurs refus (étapes et LV) : la première ligne est nommée avec le nombre total', async () => {
    const store = new EventStore('refus3');
    await flush();
    refusedIds = { bad1: 'refus', bad2: 'refus', 'lv-bad': 'refus' };
    store.save(ev('bad1', '2026-10-12T09:00'));
    store.save(ev('bad2', '2026-10-12T10:00'));
    store.saveWaybill(newWaybill({ id: 'lv-bad' }));
    await flush();
    await flush();
    await store.sync();
    expect(store.getState().error).toMatch(/^Ligne refusée par le serveur \(events\) bad1 : refus \(et 2 autres\)$/);
  });

  it('une LV refusée n’affiche pas « Table des lettres de voiture absente »', async () => {
    const store = new EventStore('refus4');
    await flush();
    refusedIds = { 'lv-bad': 'violates foreign key constraint' };
    store.saveWaybill(newWaybill({ id: 'lv-bad' }));
    await flush();
    await flush();
    const error = store.getState().error ?? '';
    expect(error).toMatch(/\(waybills\) lv-bad : violates foreign key constraint/);
    expect(error).not.toMatch(/Table des lettres de voiture absente/);
  });

  it('une panne réseau arrête toujours la synchro : ni réception, ni LV, ni photos', async () => {
    const store = new EventStore('refus5');
    await flush();
    offline = true;
    calls.pulls = [];
    calls.upsertTables = [];
    calls.uploads = 0;
    store.save(ev('a', '2026-10-12T08:00'));
    store.saveWaybill(newWaybill({ id: 'lv-a' }));
    await flush();
    await flush();
    expect(calls.pulls).toEqual([]);
    expect(calls.upsertTables.every((t) => t === 'events')).toBe(true);
    expect(calls.uploads).toBe(0);
    expect(store.getState().error).toMatch(/Failed to fetch/);
  });
});
