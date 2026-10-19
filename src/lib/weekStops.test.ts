import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Place, TripEvent } from '../types';
import { decodePolyline6, routeOptions, simplify } from './route';
import { buildStops, closestRoute, dayLegs, distanceKm, stopSegments, stopsHash } from './weekStops';

function ev(id: string, occurred: string, at: [number, number] | null, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id, type: 'chargement', occurred_at: new Date(occurred).toISOString(), tractor_plate: '', trailer_plate: '',
    odometer_km: null, notes: null, client: null, cmr_number: null, station: null, diesel_l: null, adblue_l: null,
    city: 'Ville', postcode: null, department: null, country_code: 'FR', lat: at?.[0] ?? null, lon: at?.[1] ?? null,
    updated_at: '', deleted_at: null, ...extra,
  };
}

// Centres de grandes villes (positions publiques).
const NARBONNE: [number, number] = [43.184, 3.004];
const CARCASSONNE: [number, number] = [43.213, 2.349];
const TOULOUSE: [number, number] = [43.605, 1.444];
const PERIGUEUX: [number, number] = [45.185, 0.721];

// Jeudi 29 → vendredi 30 janvier 2026.
const week = [
  ev('fin29', '2026-01-29T17:15', NARBONNE, { type: 'fin_journee' }),
  ev('deb30', '2026-01-30T07:25', [43.18402, 3.00396], { type: 'debut_journee' }), // même endroit
  ev('liv30', '2026-01-30T08:00', CARCASSONNE, { type: 'livraison' }),
  ev('cha30', '2026-01-30T10:45', TOULOUSE),
  ev('fin30', '2026-01-30T17:15', PERIGUEUX, { type: 'fin_journee' }),
];

describe('buildStops', () => {
  it('suit l’ordre chronologique et fusionne les étapes au même endroit', () => {
    const { stops, missing } = buildStops([...week].reverse());
    expect(stops.map((s) => [s.number, s.events.map((e) => e.id)])).toEqual([
      [1, ['fin29', 'deb30']],
      [2, ['liv30']],
      [3, ['cha30']],
      [4, ['fin30']],
    ]);
    expect(missing).toEqual([]);
  });

  it('donne une couleur par jour', () => {
    const { stops } = buildStops(week);
    expect(stops[0].day).toBe('2026-01-29');
    expect(stops[1].day).toBe('2026-01-30');
    expect(stops[0].color).not.toBe(stops[1].color);
    expect(stops[1].color).toBe(stops[3].color);
  });

  it('utilise la ville retrouvée pour une étape sans GPS, et liste les introuvables', () => {
    const typed = ev('typed', '2026-01-30T09:00', null, { city: 'Castelnaudary' });
    const lost = ev('lost', '2026-01-30T09:30', null, { city: 'Castelnodary' });
    const found: Place = { city: 'Castelnaudary', postcode: '11400', department: '11', country_code: 'FR', lat: 43.318, lon: 1.954 };
    const { stops, missing } = buildStops([...week, typed, lost], new Map([['typed', found]]));
    const stop = stops.find((s) => s.events[0].id === 'typed')!;
    expect(stop).toMatchObject({ lat: 43.318, lon: 1.954, approximate: true });
    expect(stops.filter((s) => s.approximate)).toHaveLength(1);
    expect(missing.map((e) => e.id)).toEqual(['lost']);
    // L'ordre est conservé : Carcassonne (08:00) → Castelnaudary (09:00) → Toulouse (10:45).
    expect(stops.map((s) => s.events[0].id)).toEqual(['fin29', 'liv30', 'typed', 'cha30', 'fin30']);
  });
});

describe('dayLegs', () => {
  it('fait partir chaque jour du dernier lieu de la veille', () => {
    const legs = dayLegs(buildStops(week).stops);
    expect(legs).toHaveLength(1); // jeudi : un seul lieu, pas de trajet
    expect(legs[0].day).toBe('2026-01-30');
    expect(legs[0].points).toEqual([NARBONNE, CARCASSONNE, TOULOUSE, PERIGUEUX]);
  });
});

describe('stopSegments', () => {
  const withKm = (e: TripEvent, km: number | null, plate = 'AB-123-CD') => ({ ...e, odometer_km: km, tractor_plate: plate });

  it('donne chaque tronçon avec les km relevés au compteur', () => {
    const [fin29, deb30, liv30, cha30, fin30] = week;
    const events = [
      withKm(fin29, 1000),
      withKm(deb30, 1000),
      withKm(liv30, 1062),
      withKm(cha30, null), // pas de relevé : tronçons avant et après inconnus
      withKm(fin30, 1400),
    ];
    const segments = stopSegments(buildStops(events).stops);
    expect(segments.map((s) => [s.day, s.from.events[0].id, s.to.events[0].id, s.odometerKm])).toEqual([
      ['2026-01-30', 'fin29', 'liv30', 62],
      ['2026-01-30', 'liv30', 'cha30', null],
      ['2026-01-30', 'cha30', 'fin30', null],
    ]);
  });

  it('ignore les km d’un autre tracteur ou incohérents', () => {
    const [fin29, , liv30, cha30, fin30] = week;
    const events = [
      withKm(fin29, 1000),
      withKm(liv30, 1062, 'ZZ-999-ZZ'), // changement de tracteur
      withKm(cha30, 1050, 'zz 999 zz'), // km qui baisse (même tracteur, écrit autrement)
      withKm(fin30, 5000, 'ZZ999ZZ'), // saut de plus de 2000 km
    ];
    expect(stopSegments(buildStops(events).stops).map((s) => s.odometerKm)).toEqual([null, null, null]);
  });
});

describe('closestRoute', () => {
  const options = [
    { coords: [], km: 300, minutes: 180 },
    { coords: [], km: 340, minutes: 200 },
    { coords: [], km: 315, minutes: 190 },
  ];

  it('choisit l’itinéraire le plus proche des km au compteur', () => {
    expect(closestRoute(options, 322).km).toBe(315);
    expect(closestRoute(options, 345).km).toBe(340);
  });

  it('garde le premier (le plus rapide) sans relevé', () => {
    expect(closestRoute(options, null).km).toBe(300);
  });
});

describe('stopsHash', () => {
  it('est stable, et change si une étape change', () => {
    const a = stopsHash(buildStops(week).stops);
    expect(stopsHash(buildStops([...week]).stops)).toBe(a);
    const moved = week.map((e) => (e.id === 'cha30' ? { ...e, lat: 43.6, lon: 1.44 } : e));
    expect(stopsHash(buildStops(moved).stops)).not.toBe(a);
  });
});

describe('distanceKm', () => {
  it('mesure la distance à vol d’oiseau', () => {
    expect(distanceKm(NARBONNE, CARCASSONNE)).toBeGreaterThan(50);
    expect(distanceKm(NARBONNE, CARCASSONNE)).toBeLessThan(56);
  });
});

describe('simplify', () => {
  it('réduit le nombre de points en gardant les extrémités', () => {
    const line: [number, number][] = Array.from({ length: 500 }, (_, i) => [43 + i * 0.001, 1 + Math.sin(i / 20) * 0.01]);
    const simple = simplify(line);
    expect(simple.length).toBeLessThan(120);
    expect(simple[0]).toEqual([43, 1]);
    expect(simple.at(-1)).toEqual([Math.round(line.at(-1)![0] * 1e4) / 1e4, Math.round(line.at(-1)![1] * 1e4) / 1e4]);
  });
});

describe('routeOptions', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Narbonne → Carcassonne en polyline à 6 décimales, puis par un point intermédiaire.
  const direct = '_wvjqA_ejvDosw@nh~f@';
  const detour = '_wvjqA_ejvD~`cD~lmKou{EnzoZ';

  it('décode un tracé Valhalla', () => {
    expect(decodePolyline6(direct)).toEqual([NARBONNE, CARCASSONNE]);
  });

  it('renvoie l’itinéraire Valhalla (camion) et ses autres propositions', async () => {
    let asked = '';
    vi.stubGlobal('fetch', async (url: string) => {
      asked = decodeURIComponent(url);
      return {
        ok: true,
        json: async () => ({
          trip: { legs: [{ shape: direct }], summary: { length: 60.5, time: 3000 } },
          alternates: [
            { trip: { legs: [{ shape: detour }], summary: { length: 72, time: 3600 } } },
            { trip: { legs: [{ shape: '' }], summary: { length: 80, time: 4000 } } }, // tracé vide : ignoré
          ],
        }),
      };
    });
    const options = await routeOptions(NARBONNE, CARCASSONNE);
    expect(asked).toContain('valhalla');
    expect(asked).toContain('"costing":"truck"');
    expect(options?.map((o) => [o.km, o.minutes, o.coords.length])).toEqual([
      [60.5, 50, 2],
      [72, 60, 3],
    ]);
  });

  it('se rabat sur OSRM si Valhalla ne répond pas', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('valhalla')
        ? { ok: false }
        : {
            ok: true,
            json: async () => ({
              code: 'Ok',
              routes: [
                {
                  distance: 61000,
                  duration: 3000,
                  geometry: {
                    coordinates: [
                      [3.004, 43.184],
                      [2.349, 43.213],
                    ],
                  },
                },
              ],
            }),
          },
    );
    expect(await routeOptions(NARBONNE, CARCASSONNE)).toEqual([
      { coords: [NARBONNE, CARCASSONNE], km: 61, minutes: 50 },
    ]);
  });

  it('renvoie null si aucun service ne trouve d’itinéraire', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('valhalla')
        ? { ok: true, json: async () => ({ error: 'No path' }) }
        : { ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) },
    );
    expect(await routeOptions(NARBONNE, CARCASSONNE)).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new Error('hors ligne');
    });
    expect(await routeOptions(NARBONNE, CARCASSONNE)).toBeNull();
  });
});
