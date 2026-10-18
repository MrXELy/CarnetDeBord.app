import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newWaybill, waybillStatus, type TripEvent } from '../types';

vi.mock('./supabase', () => ({ supabase: {} }));

const { EventStore } = await import('./sync');
const { isBlankWaybill } = await import('./waybills');

// Environnement « navigateur » minimal : hors ligne, pour ne jamais appeler Supabase.
const storage = new Map<string, string>();
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
vi.stubGlobal('navigator', { onLine: false });
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
});

function ev(id: string, type: TripEvent['type'], occurred: string): TripEvent {
  return {
    id,
    type,
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

describe('isBlankWaybill', () => {
  it('reconnaît une LV vide, et plus dès qu’un champ ou une photo est ajouté', () => {
    expect(isBlankWaybill(newWaybill())).toBe(true);
    expect(isBlankWaybill(newWaybill({ shipper: '  ' }))).toBe(true);
    expect(isBlankWaybill(newWaybill({ goods: 'Palettes' }))).toBe(false);
    expect(isBlankWaybill(newWaybill({ weight_kg: 0 }))).toBe(false);
    expect(isBlankWaybill(newWaybill({ photo_paths: ['u/lv/p.jpg'] }))).toBe(false);
  });
});

describe('waybillStatus', () => {
  it('à compléter sans numéro, puis dans le camion, puis livrée', () => {
    expect(waybillStatus(newWaybill())).toBe('a_completer');
    expect(waybillStatus(newWaybill({ number: '  ' }))).toBe('a_completer');
    expect(waybillStatus(newWaybill({ number: '458712' }))).toBe('dans_camion');
    expect(waybillStatus(newWaybill({ number: '458712', delivery_event_id: 'x' }))).toBe('livree');
  });
});

describe('EventStore et lettres de voiture', () => {
  beforeEach(() => storage.clear());

  it('relit l’ancien cache local des étapes', () => {
    storage.set(
      'cdb.u.data',
      JSON.stringify({ events: [ev('a', 'chargement', '2026-10-12T08:00')], outbox: [], cursor: null }),
    );
    const store = new EventStore('u');
    expect(store.getState().events.map((e) => e.id)).toEqual(['a']);
    expect(store.getState().waybills).toEqual([]);
  });

  it('donne les LV dans le camion à une date', () => {
    const store = new EventStore('u');
    const loadA = ev('loadA', 'chargement', '2026-10-12T08:00');
    const loadB = ev('loadB', 'chargement', '2026-10-13T08:00');
    const drop = ev('drop', 'livraison', '2026-10-12T15:00');
    store.save(loadA, [
      newWaybill({ id: 'w1', loading_event_id: 'loadA' }),
      newWaybill({ id: 'w2', loading_event_id: 'loadA', delivery_event_id: 'drop' }),
    ]);
    store.save(loadB, [newWaybill({ id: 'w3', loading_event_id: 'loadB' })]);
    store.save(drop, [newWaybill({ id: 'w4' })]); // chargement inconnu

    const ids = (at: string) =>
      store
        .inTruck(new Date(at))
        .map((w) => w.id)
        .sort();
    expect(ids('2026-10-12T16:00')).toEqual(['w1', 'w4']); // w2 livrée, w3 pas encore chargée
    expect(ids('2026-10-13T09:00')).toEqual(['w1', 'w3', 'w4']);
  });

  it('supprime les LV d’un chargement et remet celles d’une livraison dans le camion', () => {
    const store = new EventStore('u');
    const load = ev('load', 'chargement', '2026-10-12T08:00');
    const drop = ev('drop', 'livraison', '2026-10-12T15:00');
    store.save(load, [
      newWaybill({ id: 'w1', loading_event_id: 'load', delivery_event_id: 'drop' }),
      newWaybill({ id: 'w2', loading_event_id: 'load' }),
    ]);
    store.save(drop);

    store.remove(drop);
    expect(store.getState().waybills.map((w) => [w.id, w.delivery_event_id])).toEqual([
      ['w1', null],
      ['w2', null],
    ]);

    store.remove(load);
    expect(store.getState().waybills).toEqual([]);
    expect(store.getState().pending).toBe(4); // 2 étapes + 2 LV à envoyer
  });

  it('retrouve les LV chargées et livrées à une étape, comme un filtre sur toute la liste', () => {
    const store = new EventStore('u');
    store.save(ev('c1', 'chargement', '2026-10-12T08:00'), [
      newWaybill({ id: 'w1', loading_event_id: 'c1' }),
      newWaybill({ id: 'w2', loading_event_id: 'c1', delivery_event_id: 'd1' }),
      newWaybill({ id: 'w3', loading_event_id: 'c2', delivery_event_id: 'd1' }),
    ]);
    store.save(ev('d1', 'livraison', '2026-10-12T15:00'), [newWaybill({ id: 'w4', loading_event_id: 'c1' })]);
    store.saveWaybill({ ...store.waybill('w4')!, deleted_at: new Date().toISOString() }); // supprimée : exclue
    const all = store.getState().waybills;
    for (const id of ['c1', 'c2', 'd1', 'inconnue']) {
      expect(store.loadedAt(id)).toEqual(all.filter((w) => w.loading_event_id === id));
      expect(store.deliveredAt(id)).toEqual(all.filter((w) => w.delivery_event_id === id));
    }
    expect(store.loadedAt('c1').map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(store.deliveredAt('d1').map((w) => w.id)).toEqual(['w2', 'w3']);
    // Une modification est vue tout de suite (l'index suit la liste).
    store.saveWaybill({ ...store.waybill('w1')!, loading_event_id: 'c2' });
    expect(store.loadedAt('c1').map((w) => w.id)).toEqual(['w2']);
    expect(
      store
        .loadedAt('c2')
        .map((w) => w.id)
        .sort(),
    ).toEqual(['w1', 'w3']);
  });

  it('propose les noms déjà saisis, du plus fréquent au moins fréquent', () => {
    const store = new EventStore('u');
    store.save(ev('load', 'chargement', '2026-10-12T08:00'), [
      newWaybill({ consignee: 'Knauf', shipper: 'Placoplâtre' }),
      newWaybill({ consignee: 'Placoplâtre' }),
    ]);
    expect(store.knownNames()).toEqual(['Placoplâtre', 'Knauf']);
  });
});

describe('cartes des semaines et lieux complétés', () => {
  beforeEach(() => storage.clear());

  it('enregistre la carte d’une semaine et la relit', () => {
    const store = new EventStore('u');
    const start = new Date(2026, 0, 25, 22);
    expect(store.weekMap(start)).toBeNull();
    store.saveWeekMap({
      id: 'm1',
      week_start: start.toISOString(),
      stops_hash: '4-abc',
      generated_at: '',
      legs: [
        {
          day: '2026-01-30',
          coords: [
            [43.2, 3.07],
            [43.17, 2.75],
          ],
        },
      ],
      updated_at: '',
      deleted_at: null,
    });
    expect(new EventStore('u').weekMap(start)?.stops_hash).toBe('4-abc'); // relue depuis le cache local
    expect(store.weekMap(new Date(2026, 0, 18, 22))).toBeNull();
  });

  it('change le lieu d’une étape depuis une de ses LV et le met en file d’envoi', () => {
    const store = new EventStore('u');
    store.save({ ...ev('a', 'chargement', '2026-01-30T08:00'), city: 'Tours', lat: 47.39, lon: 0.69 });
    store.setEventPlace('a', {
      city: 'Toulouse ',
      postcode: '31000',
      department: '31',
      country_code: 'FR',
      lat: 43.6,
      lon: 1.44,
    });
    expect(store.getState().events[0]).toMatchObject({ city: 'Toulouse', department: '31', lat: 43.6, lon: 1.44 });
    expect(store.isPending('a')).toBe(true);
  });

  it('change la date d’une étape depuis une de ses LV', () => {
    const store = new EventStore('u');
    store.save(ev('a', 'livraison', '2026-01-30T08:00'));
    const iso = new Date('2026-01-30T09:15').toISOString();
    store.setEventTime('a', iso);
    expect(store.getState().events[0].occurred_at).toBe(iso);
    expect(store.isPending('a')).toBe(true);
  });

  it('complète les coordonnées d’une étape sans changer sa ville', () => {
    const store = new EventStore('u');
    store.save({ ...ev('a', 'livraison', '2026-01-30T08:00'), city: 'Tours' });
    store.completePlace('a', {
      city: 'Tours',
      postcode: '37000',
      department: '37',
      country_code: 'FR',
      lat: 47.39,
      lon: 0.69,
    });
    expect(store.getState().events[0]).toMatchObject({ city: 'Tours', postcode: '37000', lat: 47.39, lon: 0.69 });
  });
});

describe('photos des LV', () => {
  const trash = () => JSON.parse(storage.get('cdb.photo-trash') ?? '[]') as string[];
  beforeEach(() => storage.clear());

  it('photos retirées d’une LV, puis LV supprimée : mises à l’effacement', () => {
    const store = new EventStore('photos', { offline: true });
    const w = newWaybill({ photo_paths: ['u/lv/a.jpg', 'u/lv/b.jpg'] });
    store.saveWaybill(w);
    expect(trash()).toEqual([]);
    store.saveWaybill({ ...w, photo_paths: ['u/lv/b.jpg'] });
    expect(trash()).toEqual(['u/lv/a.jpg']);
    store.removeWaybill({ ...w, photo_paths: ['u/lv/b.jpg'] });
    expect(trash()).toEqual(['u/lv/a.jpg', 'u/lv/b.jpg']);
  });

  it('chargement supprimé : photos de ses LV mises à l’effacement', () => {
    const store = new EventStore('photos2', { offline: true });
    const loading = ev('c1', 'chargement', '2026-01-12T08:00');
    store.save(loading, [newWaybill({ loading_event_id: 'c1', photo_paths: ['u/lv/c.jpg'] })]);
    store.remove(loading);
    expect(trash()).toEqual(['u/lv/c.jpg']);
  });
});
