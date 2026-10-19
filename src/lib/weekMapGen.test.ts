import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripEvent, WeekMap } from '../types';
import { routing } from './route';
import type { EventStore } from './sync';
import { generateWeekMap, withChosenRoute } from './weekMapGen';
import { buildStops, joinDayLegs, segmentKey, stopSegments } from './weekStops';

// Centres de villes publiques.
const NARBONNE: [number, number] = [43.184, 3.004];
const CARCASSONNE: [number, number] = [43.213, 2.349];
const TOULOUSE: [number, number] = [43.605, 1.444];

function ev(id: string, occurred: string, at: [number, number], km: number, type: TripEvent['type']): TripEvent {
  return {
    id, type, occurred_at: new Date(occurred).toISOString(), tractor_plate: 'AB-123-CD', trailer_plate: '',
    odometer_km: km, notes: null, client: null, cmr_number: null, station: null, diesel_l: null, adblue_l: null,
    city: 'Ville', postcode: null, department: null, country_code: 'FR', lat: at[0], lon: at[1],
    updated_at: '', deleted_at: null,
  };
}

// Mardi 3 février 2026 : Narbonne → Carcassonne (62 km au compteur) → Toulouse (98 km).
const events = [
  ev('deb', '2026-02-03T06:00', NARBONNE, 1000, 'debut_journee'),
  ev('cha', '2026-02-03T08:00', CARCASSONNE, 1062, 'chargement'),
  ev('liv', '2026-02-03T11:00', TOULOUSE, 1160, 'livraison'),
];
const start = new Date('2026-02-01T22:00');

// Narbonne → Carcassonne en polyline à 6 décimales, en ligne droite puis par un détour.
const direct = '_wvjqA_ejvDosw@nh~f@';
const detour = '_wvjqA_ejvD~`cD~lmKou{EnzoZ';

/** Valhalla répond toujours : un itinéraire de 60 km, un autre de 100 km. */
function stubRoutes() {
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        trip: { legs: [{ shape: direct }], summary: { length: 60, time: 3000 } },
        alternates: [{ trip: { legs: [{ shape: detour }], summary: { length: 100, time: 4000 } } }],
      }),
    };
  });
  return () => calls;
}

function fakeStore(previous: WeekMap | null = null) {
  const store = {
    userId: 'utilisateur',
    saved: previous,
    weekMap: () => store.saved,
    saveWeekMap: (map: WeekMap) => (store.saved = map),
    completePlace: () => {},
  };
  return store;
}

describe('generateWeekMap', () => {
  beforeEach(() => {
    routing.gapMs = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('enregistre un tronçon par trajet, l’itinéraire le plus proche des km au compteur', async () => {
    stubRoutes();
    const store = fakeStore();
    await generateWeekMap(store as unknown as EventStore, start, events, new Map(), () => {});
    const legs = store.saved!.legs;
    expect(legs.map((l) => [l.day, l.km, l.manual])).toEqual([
      ['2026-02-03', 60, undefined], // 62 km au compteur
      ['2026-02-03', 100, undefined], // 98 km au compteur
    ]);
    const segments = stopSegments(buildStops(events).stops);
    expect(legs.map((l) => l.key)).toEqual(segments.map(segmentKey));
  });

  it('garde un itinéraire choisi à la main, sans le recalculer', async () => {
    const calls = stubRoutes();
    const store = fakeStore();
    await generateWeekMap(store as unknown as EventStore, start, events, new Map(), () => {});
    const key = store.saved!.legs[0].key!;
    store.saved = withChosenRoute(store.saved!, key, { coords: [NARBONNE, [43.3, 2.7], CARCASSONNE], km: 71.26, minutes: 60 });
    expect(store.saved.legs[0]).toMatchObject({ key, km: 71.3, manual: true, coords: [NARBONNE, [43.3, 2.7], CARCASSONNE] });
    expect(store.saved.legs[0].via).toBeUndefined();
    expect(store.saved.legs[1].manual).toBeUndefined();
    // Itinéraire imposé par une ville : la ville est gardée avec le tronçon.
    const via = withChosenRoute(store.saved, key, { coords: [NARBONNE, CARCASSONNE], km: 80, minutes: 70, label: 'par le centre de Lézignan' });
    expect(via.legs[0]).toMatchObject({ km: 80, manual: true, via: 'par le centre de Lézignan' });

    const before = calls();
    await generateWeekMap(store as unknown as EventStore, start, events, new Map(), () => {});
    expect(calls() - before).toBe(1); // seul le second tronçon est recalculé
    expect(store.saved!.legs[0]).toMatchObject({ km: 71.3, manual: true });
    // Points de passage gardés avec l'itinéraire choisi, et à la régénération.
    const waypoints = [{ kind: 'point' as const, lat: 43.2, lon: 2.8, name: 'Lézignan', radius: 60 }];
    store.saved = withChosenRoute(store.saved!, key, { coords: [NARBONNE, CARCASSONNE], km: 81, minutes: 70, waypoints });
    await generateWeekMap(store as unknown as EventStore, start, events, new Map(), () => {});
    expect(store.saved!.legs[0]).toMatchObject({ km: 81, manual: true, waypoints });
    // Itinéraire proposé choisi ensuite : plus de points de passage.
    store.saved = withChosenRoute(store.saved!, key, { coords: [NARBONNE, CARCASSONNE], km: 60, minutes: 50 });
    expect(store.saved.legs[0].waypoints).toBeUndefined();
  });
});

describe('joinDayLegs', () => {
  it('met bout à bout les tronçons d’un même jour', () => {
    expect(
      joinDayLegs([
        { day: '2026-02-03', coords: [NARBONNE, CARCASSONNE] },
        { day: '2026-02-03', coords: [CARCASSONNE, TOULOUSE] },
        { day: '2026-02-04', coords: [TOULOUSE, NARBONNE] },
      ]),
    ).toEqual([
      { day: '2026-02-03', coords: [NARBONNE, CARCASSONNE, TOULOUSE] },
      { day: '2026-02-04', coords: [TOULOUSE, NARBONNE] },
    ]);
  });
});
