import { describe, expect, it } from 'vitest';
import type { Place, TripEvent } from '../types';
import {
  DEFAULT_RATES,
  computeAllowances,
  holidays,
  isAtBase,
  ratesAt,
  summarizeAllowances,
  type AllowanceSettings,
} from './allowances';

let n = 0;
function ev(type: TripEvent['type'], local: string, city: string, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id: `e${n++}`,
    type,
    occurred_at: new Date(local).toISOString(),
    tractor_plate: 'AA-111-AA',
    trailer_plate: '',
    odometer_km: null,
    notes: null,
    station: null,
    diesel_l: null,
    adblue_l: null,
    city,
    postcode: null,
    department: null,
    country_code: 'FR',
    lat: null,
    lon: null,
    updated_at: '',
    deleted_at: null,
    ...extra,
  };
}

/** Une journée : début et fin, avec une étape au milieu. */
const day = (from: string, fromCity: string, to: string, toCity: string, extra: Partial<TripEvent> = {}) => [
  ev('debut_journee', from, fromCity),
  ev('livraison', from.slice(0, 11) + '12:00', toCity, extra),
  ev('fin_journee', to, toCity, extra),
];

const base = (city: string, department: string | null = null): Place => ({
  city,
  department,
  postcode: null,
  country_code: 'FR',
  lat: null,
  lon: null,
});

const settings: AllowanceSettings = { bases: [base('Narbonne', '11'), base('Toulouse')], rates: [DEFAULT_RATES] };

const kinds = (events: TripEvent[], s = settings) =>
  computeAllowances(events, s).map((a) => `${a.day.slice(5)} ${a.kind}${a.foreign ? ' étranger' : ''}`);

describe('isAtBase', () => {
  it('compare les villes sans accents, tirets ni majuscules', () => {
    const bases = [base('Saint-Étienne-du-Grès')];
    expect(isAtBase({ city: 'saint etienne du gres', department: null }, bases)).toBe(true);
    expect(isAtBase({ city: 'St-Étienne-du-Grès', department: null }, bases)).toBe(true);
    expect(isAtBase({ city: 'Saint-Étienne', department: null }, bases)).toBe(false);
  });

  it('tient compte du département quand les deux le connaissent', () => {
    expect(isAtBase({ city: 'Narbonne', department: '11' }, settings.bases)).toBe(true);
    expect(isAtBase({ city: 'Narbonne', department: '34' }, settings.bases)).toBe(false);
    expect(isAtBase({ city: 'Narbonne', department: null }, settings.bases)).toBe(true);
  });
});

describe('holidays', () => {
  it('fêtes fixes et mobiles', () => {
    const h = holidays(2026);
    expect(h.has('2026-04-06')).toBe(true); // lundi de Pâques
    expect(h.has('2026-05-14')).toBe(true); // Ascension
    expect(h.has('2026-05-25')).toBe(true); // lundi de Pentecôte
    expect(h.has('2026-12-25')).toBe(true);
    expect(h.size).toBe(11);
  });
});

describe('ratesAt', () => {
  it('tarifs en vigueur à la date, sinon les plus anciens', () => {
    const old = { ...DEFAULT_RATES, from: '2025-01-01', primeLundi: 20 };
    expect(ratesAt([DEFAULT_RATES, old], '2025-06-01').primeLundi).toBe(20);
    expect(ratesAt([DEFAULT_RATES, old], '2026-02-01').primeLundi).toBe(25.76);
    expect(ratesAt([DEFAULT_RATES], '2024-01-01').primeLundi).toBe(25.76);
  });
});

describe('computeAllowances', () => {
  it('sans base réglée : rien', () => {
    expect(
      computeAllowances(day('2026-01-19T08:00', 'Narbonne', '2026-01-19T18:00', 'Périgueux'), {
        ...settings,
        bases: [],
      }),
    ).toEqual([]);
  });

  it('semaine type : GD chaque soir dehors, casse-croûte seulement au départ avant 5h de la maison', () => {
    const events = [
      ...day('2026-01-19T02:30', 'Narbonne', '2026-01-19T15:20', 'Lyon'),
      ...day('2026-01-20T05:00', 'Lyon', '2026-01-20T19:00', 'Clermont-Ferrand'),
      ...day('2026-01-21T04:30', 'Clermont-Ferrand', '2026-01-21T19:30', 'Périgueux'),
      ...day('2026-01-23T06:30', 'Périgueux', '2026-01-23T16:15', 'Toulouse'),
    ];
    expect(kinds(events)).toEqual([
      '01-19 casse_croute',
      '01-19 gd2',
      '01-20 gd2',
      // Départ avant 5h après un découcher : compris dans le GD de la veille.
      '01-21 gd2',
      // Jeudi sans étape, resté à Périgueux : bloqué.
      '01-22 gd2',
      '01-23 repas',
    ]);
    const week = summarizeAllowances(computeAllowances(events, settings));
    expect(week.total).toBe(8.87 + 4 * 68.67 + 17.68);
  });

  it('GD 1 repas si la journée ne couvre pas le midi', () => {
    expect(kinds(day('2026-01-07T16:00', 'Narbonne', '2026-01-07T22:00', 'Lyon'))).toEqual(['01-07 gd1']);
    expect(kinds(day('2026-01-07T12:00', 'Narbonne', '2026-01-07T22:00', 'Lyon'))).toEqual(['01-07 gd1']);
  });

  it('retour à la base : repas du midi et du soir selon les horaires', () => {
    expect(kinds(day('2026-01-09T09:20', 'Lyon', '2026-01-09T22:00', 'Narbonne'))).toEqual([
      '01-09 repas',
      '01-09 repas',
    ]);
    expect(kinds(day('2026-01-09T07:00', 'Lyon', '2026-01-09T14:00', 'Narbonne'))).toEqual([]);
    expect(kinds(day('2026-01-09T12:00', 'Lyon', '2026-01-09T21:15', 'Narbonne'))).toEqual(['01-09 repas']);
  });

  it('casse-croûte : strictement avant 5h', () => {
    expect(kinds(day('2026-01-13T05:00', 'Narbonne', '2026-01-13T11:00', 'Narbonne'))).toEqual([]);
    expect(kinds(day('2026-01-13T04:59', 'Narbonne', '2026-01-13T11:00', 'Narbonne'))).toEqual(['01-13 casse_croute']);
  });

  it('repas unique de nuit : 4 h entre 22h et 7h, sans casse-croûte', () => {
    expect(kinds(day('2026-01-13T20:00', 'Narbonne', '2026-01-14T03:00', 'Narbonne'))).toEqual(['01-13 repas_nuit']);
    expect(kinds(day('2026-01-13T20:00', 'Narbonne', '2026-01-14T01:00', 'Narbonne'))).toEqual([]);
  });

  it('prime du lundi : départ le dimanche à partir de 22h ou le lundi avant 2h', () => {
    expect(kinds(day('2026-01-18T23:00', 'Narbonne', '2026-01-19T10:00', 'Narbonne'))).toEqual([
      '01-19 prime_lundi',
      '01-19 casse_croute',
    ]);
    expect(kinds(day('2026-01-19T01:59', 'Narbonne', '2026-01-19T10:00', 'Narbonne'))[0]).toBe('01-19 prime_lundi');
    expect(kinds(day('2026-01-19T02:00', 'Narbonne', '2026-01-19T10:00', 'Narbonne'))).toEqual(['01-19 casse_croute']);
  });

  it('week-end bloqué : GD chaque jour, prime le dimanche et les jours fériés seulement', () => {
    const events = [
      ...day('2026-05-07T08:00', 'Narbonne', '2026-05-07T18:00', 'Madrid', { country_code: 'ES' }),
      ev('debut_journee', '2026-05-11T08:00', 'Madrid', { country_code: 'ES' }),
      ev('fin_journee', '2026-05-11T18:00', 'Narbonne'),
    ];
    expect(kinds(events)).toEqual([
      '05-07 gd2 étranger',
      '05-08 gd2 étranger',
      '05-08 prime_bloque', // 8 mai, férié
      '05-09 gd2 étranger', // samedi : pas de prime
      '05-10 gd2 étranger',
      '05-10 prime_bloque', // dimanche
      '05-11 repas étranger', // une étape en Espagne ce jour-là
    ]);
    const summary = summarizeAllowances(computeAllowances(events, settings));
    expect(summary.unpriced).toBe(2);
    expect(summary.total).toBe(Math.round((4 * 81.03 + 20.86) * 100) / 100);
  });

  it('dernier découcher sans reprise notée : pas encore de jour bloqué', () => {
    const events = day('2026-02-27T08:00', 'Narbonne', '2026-02-27T18:00', 'Lyon');
    expect(kinds(events)).toEqual(['02-27 gd2']);
  });

  it('journée en cours (sans fin) : pas encore comptée', () => {
    expect(kinds([ev('debut_journee', '2026-02-27T04:00', 'Narbonne')])).toEqual([]);
  });
});

describe('summarizeAllowances', () => {
  it('ne garde que les jours de la période', () => {
    const events = [
      ...day('2026-01-16T08:00', 'Narbonne', '2026-01-16T18:00', 'Narbonne'),
      ...day('2026-01-19T08:00', 'Narbonne', '2026-01-19T18:00', 'Narbonne'),
    ];
    const all = computeAllowances(events, settings);
    const week = summarizeAllowances(all, { start: new Date('2026-01-18T22:00'), end: new Date('2026-01-25T22:00') });
    expect(week.lines).toEqual([{ kind: 'repas', foreign: false, count: 1, amount: 17.68, unpriced: 0 }]);
  });
});
