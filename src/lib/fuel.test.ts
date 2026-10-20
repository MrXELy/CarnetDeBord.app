import { describe, expect, it } from 'vitest';
import type { TripEvent } from '../types';
import {
  averageRate,
  fuelIntervals,
  fuelReport,
  intervalRate,
  isDoumenCity,
  isFullTank,
  recentIntervals,
} from './fuel';

let n = 0;
function ev(occurred: string, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id: `e${n++}`,
    type: 'carburant',
    occurred_at: new Date(occurred).toISOString(),
    tractor_plate: 'AA-111-AA',
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
    ...extra,
  };
}

const plein = (occurred: string, km: number, l: number, extra: Partial<TripEvent> = {}) =>
  ev(occurred, { station: 'Doumen', odometer_km: km, diesel_l: l, ...extra });
const complement = (occurred: string, km: number | null, l: number | null, extra: Partial<TripEvent> = {}) =>
  ev(occurred, { station: 'AS24', odometer_km: km, diesel_l: l, ...extra });
const etape = (occurred: string, km: number, extra: Partial<TripEvent> = {}) =>
  ev(occurred, { type: 'debut_journee', odometer_km: km, ...extra });

describe('isFullTank', () => {
  it('suit le choix de la saisie, sinon Doumen = plein et AS24/DKV = complément', () => {
    expect(isFullTank(plein('2026-10-12T08:00', 0, 400))).toBe(true);
    expect(isFullTank(complement('2026-10-12T08:00', 0, 250))).toBe(false);
    expect(isFullTank(complement('2026-10-12T08:00', 0, 600, { full_tank: true }))).toBe(true);
    expect(isFullTank(plein('2026-10-12T08:00', 0, 100, { full_tank: false }))).toBe(false);
  });
});

describe('fuelIntervals', () => {
  it('compte les compléments dans le plein suivant', () => {
    const [i] = fuelIntervals([
      plein('2026-10-12T06:00', 100000, 500),
      complement('2026-10-13T10:00', 100800, 250),
      complement('2026-10-14T10:00', 101500, 200),
      plein('2026-10-15T06:00', 102000, 150),
    ]);
    expect(i.liters).toBe(600);
    expect(intervalRate(i)).toBe(30);
    expect(i.problem).toBeNull();
  });

  it('ignore les compléments faits avant le premier plein connu', () => {
    const list = fuelIntervals([complement('2026-10-11T06:00', 99000, 300), plein('2026-10-12T06:00', 100000, 500)]);
    expect(list).toHaveLength(0);
  });

  it('sépare les tracteurs, chacun son réservoir', () => {
    const list = fuelIntervals([
      plein('2026-10-12T06:00', 100000, 500),
      plein('2026-10-12T07:00', 50000, 500, { tractor_plate: 'BB-222-BB' }),
      plein('2026-10-13T06:00', 101000, 300),
      plein('2026-10-14T07:00', 51000, 320, { tractor_plate: 'BB-222-BB' }),
    ]);
    expect(list.map((i) => [i.tractor, i.liters])).toEqual([
      ['AA111AA', 300],
      ['BB222BB', 320],
    ]);
  });

  it('écarte les intervalles sans km, sans litres ou improbables', () => {
    const problems = fuelIntervals([
      plein('2026-10-01T06:00', 100000, 500),
      plein('2026-10-02T06:00', 101000, 300, { odometer_km: null }),
      plein('2026-10-03T06:00', 102000, 300),
      complement('2026-10-04T06:00', 102500, null),
      plein('2026-10-05T06:00', 103000, 300),
      plein('2026-10-06T06:00', 103100, 300),
    ]).map((i) => i.problem);
    expect(problems).toEqual([
      'kilométrage manquant',
      'kilométrage manquant',
      'litres manquants',
      'conso improbable (300,0 L/100)',
    ]);
  });
});

describe('averageRate et recentIntervals', () => {
  const list = fuelIntervals([
    plein('2026-09-01T06:00', 100000, 500),
    plein('2026-09-05T06:00', 101000, 250), // 25 L/100 sur 1000 km
    plein('2026-09-10T06:00', 103000, 700), // 35 L/100 sur 2000 km
    plein('2026-09-15T06:00', 104000, 300), // 30 L/100 sur 1000 km
  ]);

  it('pondère par les km', () => {
    expect(averageRate(list)).toBe(31.25); // 1250 L / 4000 km
  });

  it('prend les derniers pleins avant la date, ou les premiers après', () => {
    expect(recentIntervals(list, new Date('2026-09-12T00:00'), undefined, 2).map(intervalRate)).toEqual([25, 35]);
    expect(recentIntervals(list, new Date('2026-08-01T00:00'), undefined, 1).map(intervalRate)).toEqual([25]);
  });
});

describe('fuelReport', () => {
  // Plein le lundi 12, complément le mercredi 14, plein le lundi 19 : 30 L/100 sur 3000 km.
  const events = [
    etape('2026-10-12T05:00', 100000),
    plein('2026-10-12T06:00', 100000, 500),
    complement('2026-10-14T10:00', 101000, 250),
    etape('2026-10-17T17:00', 102000),
    etape('2026-10-19T05:00', 102000),
    plein('2026-10-19T06:00', 103000, 650),
    etape('2026-10-21T17:00', 104000),
  ];

  it('mesure la conso de chaque km avec l’intervalle entre pleins qui le contient', () => {
    const r = fuelReport(events, new Date('2026-10-11T22:00'), new Date('2026-10-18T22:00'));
    expect(r).toMatchObject({ bought: 750, km: 2000, used: 600, measuredKm: 2000, rate: 30 });
  });

  it('une semaine sans plein a quand même consommé', () => {
    const r = fuelReport(
      [...events, etape('2026-10-26T05:00', 104000), etape('2026-10-30T17:00', 106000)],
      new Date('2026-10-25T22:00'),
      new Date('2026-11-01T22:00'),
    );
    // Aucun plein cette semaine : estimé avec la conso habituelle (30 L/100).
    expect(r).toMatchObject({ bought: 0, km: 2000, used: 600, measuredKm: 0, rate: 30 });
  });

  it('sans aucun intervalle fiable, la consommation reste inconnue', () => {
    const r = fuelReport(events.slice(0, 4), new Date('2026-10-11T22:00'), new Date('2026-10-18T22:00'));
    expect(r).toMatchObject({ bought: 750, km: 2000, used: null, rate: null });
  });

  it('estime les km après le dernier plein avec la conso habituelle', () => {
    const r = fuelReport(events, new Date('2026-10-18T22:00'), new Date('2026-10-25T22:00'));
    // 102000 → 103000 mesurés à 30 L/100, 103000 → 104000 estimés à 30 L/100.
    expect(r).toMatchObject({ bought: 650, km: 2000, used: 600, measuredKm: 1000, rate: 30 });
  });
});

describe('isDoumenCity', () => {
  it('reconnaît les villes des stations, sans tenir compte des accents ni des tirets', () => {
    expect(isDoumenCity('Monteux')).toBe(true);
    expect(isDoumenCity('saint loubes')).toBe(true);
    expect(isDoumenCity('Boulazac Isle Manoire')).toBe(true);
    expect(isDoumenCity('Toulouse')).toBe(false);
    expect(isDoumenCity('')).toBe(false);
  });
});
