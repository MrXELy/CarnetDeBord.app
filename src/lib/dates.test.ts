import { describe, expect, it } from 'vitest';
import type { TripEvent } from '../types';
import {
  currentDay,
  durationLabel,
  groupWeek,
  listWeeks,
  monthLabel,
  monthWeeks,
  summarizeDay,
  summarizeWeek,
  weekLabel,
  weekStart,
} from './dates';

function ev(id: string, occurred: string, extra: Partial<TripEvent> = {}): TripEvent {
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
    ...extra,
  };
}

describe('weekStart / weekLabel', () => {
  it('commence le dimanche à 22h', () => {
    expect(weekStart(new Date(2026, 9, 17))).toEqual(new Date(2026, 9, 11, 22)); // vendredi 17 oct.
    expect(weekStart(new Date(2026, 9, 18, 21, 59))).toEqual(new Date(2026, 9, 11, 22)); // dimanche 21h59
    expect(weekStart(new Date(2026, 9, 18, 22, 0))).toEqual(new Date(2026, 9, 18, 22)); // dimanche 22h00
  });

  it('affiche la semaine du lundi au dimanche', () => {
    expect(weekLabel(new Date(2026, 9, 11, 22))).toBe('Semaine 42 · 12 – 18 oct.');
  });
});

describe('groupWeek', () => {
  const start = new Date(2026, 9, 11, 22);

  it('regroupe par jour, le plus récent en premier, et ignore le reste', () => {
    const days = groupWeek(
      [
        ev('a', '2026-10-12T06:00'),
        ev('b', '2026-10-13T07:00'),
        ev('c', '2026-10-13T15:00'),
        ev('d', '2026-10-18T22:30'), // semaine suivante
        ev('e', '2026-10-14T08:00', { deleted_at: '2026-10-14T09:00:00Z' }),
      ],
      start,
    );
    expect(days.map((d) => d.events.map((e) => e.id))).toEqual([['c', 'b'], ['a']]);
  });

  it('rattache le dimanche soir au lundi', () => {
    const days = groupWeek(
      [
        ev('dim', '2026-10-11T22:30', { type: 'debut_journee' }),
        ev('lun', '2026-10-12T06:00'),
        ev('avant', '2026-10-11T21:00'), // semaine précédente
        ev('fin', '2026-10-18T21:00'), // dimanche 21h : encore cette semaine
      ],
      start,
    );
    expect(days.map((d) => [d.date.getDate(), d.events.map((e) => e.id)])).toEqual([
      [18, ['fin']],
      [12, ['lun', 'dim']],
    ]);
  });
});

describe('summarizeWeek', () => {
  it('finie par une fin de journée sans km : pas en cours', () => {
    expect(
      summarizeWeek([
        ev('f1', '2026-10-12T17:00', { type: 'fin_journee' }),
        ev('l1', '2026-10-12T12:00', { type: 'livraison', odometer_km: 100200 }),
        ev('d1', '2026-10-12T05:00', { type: 'debut_journee', odometer_km: 100000 }),
      ]).inProgress,
    ).toBe(false);
  });

  it('compte du premier début à la dernière fin', () => {
    expect(
      summarizeWeek([
        ev('f2', '2026-10-16T17:00', { type: 'fin_journee', odometer_km: 101300 }),
        ev('d2', '2026-10-16T05:00', { type: 'debut_journee', odometer_km: 100700 }),
        ev('f1', '2026-10-12T17:00', { type: 'fin_journee', odometer_km: 100700 }),
        ev('c1', '2026-10-12T09:00', { odometer_km: 100200 }),
        ev('d1', '2026-10-11T22:30', { type: 'debut_journee', odometer_km: 100000 }),
      ]),
    ).toEqual({ km: 1300, inProgress: false });
  });

  it('compte jusqu’au dernier relevé si la semaine est en cours', () => {
    expect(
      summarizeWeek([
        ev('c', '2026-10-13T10:00', { odometer_km: 100900 }),
        ev('d', '2026-10-13T05:00', { type: 'debut_journee', odometer_km: 100700 }),
        ev('f', '2026-10-12T17:00', { type: 'fin_journee', odometer_km: 100700 }),
        ev('d0', '2026-10-12T05:00', { type: 'debut_journee', odometer_km: 100000 }),
      ]),
    ).toEqual({ km: 900, inProgress: true });
  });

  it('ne donne rien avec un seul relevé', () => {
    expect(summarizeWeek([ev('c', '2026-10-13T10:00', { odometer_km: 100900 })]).km).toBeNull();
  });

  it('ne soustrait pas les compteurs de deux tracteurs', () => {
    expect(
      summarizeWeek([
        ev('f2', '2026-10-14T17:00', { type: 'fin_journee', odometer_km: 250400, tractor_plate: 'BB-222-BB' }),
        ev('d2', '2026-10-14T05:00', { type: 'debut_journee', odometer_km: 250000, tractor_plate: 'BB-222-BB' }),
        ev('f1', '2026-10-13T17:00', { type: 'fin_journee', odometer_km: 431300, tractor_plate: 'AA-111-AA' }),
        ev('d1', '2026-10-13T05:00', { type: 'debut_journee', odometer_km: 431000, tractor_plate: 'AA111AA' }),
      ]).km,
    ).toBe(700);
  });

  it('écarte un relevé incohérent', () => {
    expect(
      summarizeWeek([
        ev('f', '2026-10-13T17:00', { type: 'fin_journee', odometer_km: 100500 }),
        ev('c', '2026-10-13T10:00', { odometer_km: 1000200 }),
        ev('d', '2026-10-13T05:00', { type: 'debut_journee', odometer_km: 100000 }),
      ]).km,
    ).toBeNull();
  });
});

describe('summarizeDay', () => {
  it('calcule les km et l’amplitude', () => {
    const s = summarizeDay([
      ev('f', '2026-10-13T17:30', { type: 'fin_journee', odometer_km: 120450 }),
      ev('l', '2026-10-13T11:00', { type: 'livraison', odometer_km: 120200 }),
      ev('d', '2026-10-13T06:15', { type: 'debut_journee', odometer_km: 120000 }),
    ]);
    expect(s).toEqual({ km: 450, amplitude: 675 });
    expect(durationLabel(675)).toBe('11h15');
  });

  it('compte chaque tracteur à part en cas de changement dans la journée', () => {
    const s = summarizeDay([
      ev('f', '2026-10-13T17:30', { type: 'fin_journee', odometer_km: 250300, tractor_plate: 'BB-222-BB' }),
      ev('c', '2026-10-13T11:00', { odometer_km: 250000, tractor_plate: 'BB-222-BB' }),
      ev('l', '2026-10-13T10:00', { type: 'livraison', odometer_km: 431200, tractor_plate: 'AA-111-AA' }),
      ev('d', '2026-10-13T06:15', { type: 'debut_journee', odometer_km: 431000, tractor_plate: 'AA-111-AA' }),
    ]);
    expect(s.km).toBe(500);
  });
});

describe('listWeeks / monthLabel', () => {
  it('liste les semaines travaillées, la plus récente en premier', () => {
    const weeks = listWeeks([
      ev('a', '2026-01-26T07:00', { type: 'debut_journee', odometer_km: 1000 }),
      ev('b', '2026-01-30T17:00', { type: 'fin_journee', odometer_km: 1400 }),
      ev('c', '2026-01-25T22:30', { type: 'debut_journee', odometer_km: 900 }), // dimanche 22h30 : semaine du 26
      ev('d', '2026-01-14T08:00'),
      ev('e', '2026-01-07T08:00', { deleted_at: '2026-01-07T09:00:00Z' }),
    ]);
    expect(weeks.map((w) => [w.start, w.count, w.km])).toEqual([
      [new Date(2026, 0, 25, 22), 3, 500],
      [new Date(2026, 0, 11, 22), 1, null],
    ]);
  });

  it('donne le mois du lundi', () => {
    expect(monthLabel(new Date(2026, 0, 25, 22))).toBe('Janvier 2026');
    expect(monthLabel(new Date(2025, 10, 30, 22))).toBe('Décembre 2025'); // semaine du lundi 1er décembre
  });
});

describe('monthWeeks', () => {
  const events = [
    ev('a', '2026-02-03T08:00'), // semaine du lundi 2 février
    ev('b', '2026-01-26T07:00'), // semaine du lundi 26 janvier…
    ev('c', '2026-02-01T10:00'), // … qui finit le dimanche 1er février
    ev('d', '2026-01-25T22:30'), // dimanche 22h30 : déjà la semaine du 26
    ev('e', '2026-01-14T08:00'),
    ev('f', '2026-01-07T08:00', { deleted_at: '2026-01-07T09:00:00Z' }),
    ev('g', '2025-12-31T08:00'), // semaine du lundi 29 décembre : rattachée à décembre
  ];

  it('garde les semaines du mois de leur lundi, entières, de la plus ancienne à la plus récente', () => {
    const weeks = monthWeeks(events, 'Janvier 2026');
    expect(weeks.map((w) => w.start)).toEqual([new Date(2026, 0, 11, 22), new Date(2026, 0, 25, 22)]);
    expect(weeks[1].events.map((e) => e.id).sort()).toEqual(['b', 'c', 'd']);
  });

  it('ignore les étapes supprimées et les autres mois', () => {
    expect(monthWeeks(events, 'Février 2026').map((w) => w.events.map((e) => e.id))).toEqual([['a']]);
    expect(monthWeeks(events, 'Décembre 2025').map((w) => w.start)).toEqual([new Date(2025, 11, 28, 22)]);
    expect(monthWeeks(events, 'Mars 2026')).toEqual([]);
  });
});

describe('currentDay', () => {
  // Le plus récent en premier, comme dans l'appli.
  const list = (...events: TripEvent[]) => events.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  it('journée commencée hier soir et pas finie : ses étapes depuis le début, même après minuit', () => {
    const events = list(
      ev('fin-avant', '2026-10-21T18:00', { type: 'fin_journee' }),
      ev('debut', '2026-10-21T22:30', { type: 'debut_journee' }),
      ev('charge', '2026-10-21T23:10'),
      ev('livre', '2026-10-22T02:00', { type: 'livraison' }),
    );
    const day = currentDay(events, new Date(2026, 9, 22, 3));
    expect(day.inProgress).toBe(true);
    expect(day.events.map((e) => e.id)).toEqual(['livre', 'charge', 'debut']);
    expect(day.date).toEqual(new Date(2026, 9, 21));
  });

  it('journée finie ou pas commencée : les étapes du jour seulement', () => {
    const events = list(
      ev('hier', '2026-10-21T10:00'),
      ev('debut', '2026-10-22T06:00', { type: 'debut_journee' }),
      ev('fin', '2026-10-22T18:00', { type: 'fin_journee' }),
    );
    const day = currentDay(events, new Date(2026, 9, 22, 20));
    expect(day.inProgress).toBe(false);
    expect(day.events.map((e) => e.id)).toEqual(['fin', 'debut']);
    expect(currentDay(events, new Date(2026, 9, 23, 5)).events).toEqual([]);
  });

  it('ignore les étapes supprimées et celles notées dans le futur', () => {
    const events = list(
      ev('debut', '2026-10-22T06:00', { type: 'debut_journee' }),
      ev('fin-supprimee', '2026-10-22T07:00', { type: 'fin_journee', deleted_at: '2026-10-22T07:05' }),
      ev('demain', '2026-10-23T08:00'),
    );
    const day = currentDay(events, new Date(2026, 9, 22, 9));
    expect(day.inProgress).toBe(true);
    expect(day.events.map((e) => e.id)).toEqual(['debut']);
  });
});
