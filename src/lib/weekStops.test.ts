import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Place, TripEvent } from '../types';
import { routeLeg, routeOptions, simplify } from './route';
import { buildStops, dayLegs, distanceKm, stopsHash } from './weekStops';

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

describe('routeLeg', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renvoie le tracé en [latitude, longitude]', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [[3.004, 43.184], [2.7, 43.2], [2.349, 43.213]] } }] }),
    }));
    expect(await routeLeg([NARBONNE, CARCASSONNE])).toEqual([[43.184, 3.004], [43.2, 2.7], [43.213, 2.349]]);
  });

  it('renvoie null si le service échoue ou répond mal', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) }));
    expect(await routeLeg([NARBONNE, CARCASSONNE])).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new Error('hors ligne');
    });
    expect(await routeLeg([NARBONNE, CARCASSONNE])).toBeNull();
  });
});

describe('routeOptions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renvoie chaque itinéraire proposé avec sa longueur en km', async () => {
    let asked = '';
    vi.stubGlobal('fetch', async (url: string) => {
      asked = url;
      return {
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [
            { distance: 60500, duration: 3000, geometry: { coordinates: [[3.004, 43.184], [2.349, 43.213]] } },
            { distance: 72000, duration: 3600, geometry: { coordinates: [[3.004, 43.184], [2.8, 43.1], [2.349, 43.213]] } },
            { distance: 80000, geometry: { coordinates: [] } }, // tracé vide : ignoré
          ],
        }),
      };
    });
    const options = await routeOptions(NARBONNE, CARCASSONNE);
    expect(asked).toContain('alternatives=3');
    expect(options).toEqual([
      { coords: [[43.184, 3.004], [43.213, 2.349]], km: 60.5, minutes: 50 },
      { coords: [[43.184, 3.004], [43.1, 2.8], [43.213, 2.349]], km: 72, minutes: 60 },
    ]);
  });

  it('renvoie null si le service échoue ou ne trouve rien', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) }));
    expect(await routeOptions(NARBONNE, CARCASSONNE)).toBeNull();
    vi.stubGlobal('fetch', async () => ({ ok: false }));
    expect(await routeOptions(NARBONNE, CARCASSONNE)).toBeNull();
  });
});
