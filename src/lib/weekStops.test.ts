import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Place, TripEvent } from '../types';
import { decodePolyline6, orderWaypoints, routeOptions, routeVia, routing, simplify, tapRadius } from './route';
import { buildStops, closestRoute, dayLegs, dayStops, distanceKm, stopSegments, stopsHash } from './weekStops';

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

describe('dayStops', () => {
  const twoDays = [
    ...week,
    ev('deb31', '2026-01-31T06:00', PERIGUEUX, { type: 'debut_journee' }),
    ev('liv31', '2026-01-31T09:00', TOULOUSE, { type: 'livraison' }),
  ];
  const { stops } = buildStops(twoDays);

  it('garde les lieux du jour, renumérotés, avec seulement leurs étapes du jour', () => {
    const day = dayStops(stops, '2026-01-30');
    expect(day.map((s) => [s.number, s.events.map((e) => e.id)])).toEqual([
      [1, ['deb30']],
      [2, ['liv30']],
      [3, ['cha30']],
      [4, ['fin30']],
    ]);
    expect(day[0].day).toBe('2026-01-30');
    expect(dayStops(stops, '2026-01-31').map((s) => s.events.map((e) => e.id))).toEqual([['deb31'], ['liv31']]);
  });

  it('part du dernier lieu de la veille quand la journée commence ailleurs', () => {
    const { stops: apart } = buildStops([
      ev('fin29', '2026-01-29T17:15', NARBONNE, { type: 'fin_journee' }),
      ev('liv30', '2026-01-30T08:00', CARCASSONNE, { type: 'livraison' }),
    ]);
    const day = dayStops(apart, '2026-01-30');
    expect(day.map((s) => [s.number, s.events.map((e) => e.id), s.day])).toEqual([
      [1, ['fin29'], '2026-01-29'],
      [2, ['liv30'], '2026-01-30'],
    ]);
    expect(stopSegments(day)).toHaveLength(1);
  });

  it('ne garde rien un jour sans étape', () => {
    expect(dayStops(stops, '2026-02-02')).toEqual([]);
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
  beforeEach(() => {
    routing.gapMs = 0; // pas d'attente entre les demandes, sauf dans le test qui la vérifie
  });
  afterEach(() => vi.unstubAllGlobals());

  // Narbonne → Carcassonne en polyline à 6 décimales, puis par un point intermédiaire.
  const direct = '_wvjqA_ejvDosw@nh~f@';
  const detour = '_wvjqA_ejvD~`cD~lmKou{EnzoZ';

  it('décode un tracé Valhalla', () => {
    expect(decodePolyline6(direct)).toEqual([NARBONNE, CARCASSONNE]);
  });

  it('laisse un écart minimum entre deux demandes au même serveur', async () => {
    routing.gapMs = 60;
    const times: number[] = [];
    vi.stubGlobal('fetch', async () => {
      times.push(Date.now());
      return { ok: true, json: async () => ({ trip: { legs: [{ shape: direct }], summary: { length: 60, time: 3000 } } }) };
    });
    await Promise.all([routeOptions(NARBONNE, CARCASSONNE), routeOptions(NARBONNE, CARCASSONNE)]);
    await routeOptions(NARBONNE, CARCASSONNE);
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(55);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(55);
  });

  it('renvoie l’itinéraire Valhalla et ses autres propositions', async () => {
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
    expect(asked).toContain('"costing":"auto"');
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

  it('fait passer l’itinéraire par une ville : par le centre ou par la grande route', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(decodeURIComponent(url));
      return {
        ok: true,
        json: async () => ({
          trip: { legs: [{ shape: direct }], summary: { length: 75, time: 4000 } },
        }),
      };
    });
    const GAILLAC: [number, number] = [43.901, 1.897];
    expect(await routeVia(NARBONNE, CARCASSONNE, [{ at: GAILLAC }], 'centre')).toMatchObject({ km: 75, coords: [NARBONNE, CARCASSONNE] });
    await routeVia(NARBONNE, CARCASSONNE, [{ at: GAILLAC }], 'road');
    const [centre, road] = asked.map((a) => JSON.parse(a.slice(a.indexOf('json=') + 5)));
    expect(centre.locations).toEqual([
      { lat: 43.184, lon: 3.004 },
      { lat: 43.901, lon: 1.897, type: 'through' },
      { lat: 43.213, lon: 2.349 },
    ]);
    expect(centre.alternates).toBe(0);
    expect(road.locations[1]).toEqual({ lat: 43.901, lon: 1.897, type: 'through', search_filter: { min_road_class: 'trunk' } });
  });

  it('se rabat sur OSRM par le centre seulement', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      return url.includes('valhalla')
        ? { ok: false }
        : {
            ok: true,
            json: async () => ({
              code: 'Ok',
              routes: [{ distance: 80000, duration: 4200, geometry: { coordinates: [[3.004, 43.184], [2.349, 43.213]] } }],
            }),
          };
    });
    const GAILLAC: [number, number] = [43.901, 1.897];
    expect((await routeVia(NARBONNE, CARCASSONNE, [{ at: GAILLAC }], 'centre'))?.km).toBe(80);
    expect(asked.at(-1)).toContain('3.00400,43.18400;1.89700,43.90100;2.34900,43.21300');
    expect(await routeVia(NARBONNE, CARCASSONNE, [{ at: GAILLAC }], 'road')).toBeNull();
  });

  it('prend un point placé sur la carte tel quel, avec son rayon de recherche', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(decodeURIComponent(url));
      return { ok: true, json: async () => ({ trip: { legs: [{ shape: direct }], summary: { length: 70, time: 4000 } } }) };
    });
    await routeVia(NARBONNE, CARCASSONNE, [{ at: [43.2, 2.7], radius: 61.4 }, { at: [43.3, 2.5] }], 'road');
    const request = JSON.parse(asked[0].slice(asked[0].indexOf('json=') + 5));
    expect(request.locations.slice(1, 3)).toEqual([
      { lat: 43.2, lon: 2.7, type: 'through', radius: 61 }, // point : pas de filtre « grande route »
      { lat: 43.3, lon: 2.5, type: 'through', search_filter: { min_road_class: 'trunk' } },
    ]);
  });
});

describe('orderWaypoints', () => {
  it('range les points de passage du départ vers l’arrivée', () => {
    const vias = [
      { name: 'Montauban', at: [44.018, 1.355] as [number, number] },
      { name: 'Brive', at: [45.159, 1.533] as [number, number] },
      { name: 'Cahors', at: [44.447, 1.441] as [number, number] },
    ];
    expect(orderWaypoints(TOULOUSE, PERIGUEUX, vias).map((v) => v.name)).toEqual(['Montauban', 'Cahors', 'Brive']);
    expect(orderWaypoints(PERIGUEUX, TOULOUSE, vias).map((v) => v.name)).toEqual(['Brive', 'Cahors', 'Montauban']);
  });
});

describe('tapRadius', () => {
  it('donne la précision du doigt selon le zoom, entre 15 et 300 m', () => {
    expect(tapRadius(44, 15)).toBe(69); // ≈ 3,4 m par pixel
    expect(tapRadius(44, 18)).toBe(15);
    expect(tapRadius(44, 8)).toBe(300);
  });
});
