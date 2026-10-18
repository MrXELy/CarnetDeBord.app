import { describe, expect, it } from 'vitest';
import { newWaybill, type TripEvent } from '../types';
import { kmTimeline } from './emptyKm';
import { fuelIntervals } from './fuel';
import {
  clientGrouper,
  kmByDay,
  periodAt,
  periodRange,
  periodStats,
  periodTitle,
  previousRange,
  records,
  shiftPeriod,
  shortLabel,
  subPeriods,
  topNames,
  topPlaces,
  workTimes,
} from './stats';

let n = 0;
function ev(type: TripEvent['type'], occurred: string, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id: `e${n++}`,
    type,
    occurred_at: new Date(occurred).toISOString(),
    tractor_plate: 'AA-111-AA',
    trailer_plate: '',
    odometer_km: null,
    notes: null,
    client: null,
    cmr_number: null,
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

const d = (s: string) => new Date(s);

describe('périodes', () => {
  it('le lundi commence le dimanche à 22h', () => {
    const p = periodAt('jour', d('2026-10-11T23:00'));
    expect(p.anchor).toEqual(d('2026-10-12T00:00'));
    expect(periodRange(p)).toEqual({ start: d('2026-10-11T22:00'), end: d('2026-10-13T00:00') });
    expect(periodRange(shiftPeriod(p, -1))).toEqual({ start: d('2026-10-11T00:00'), end: d('2026-10-11T22:00') });
  });

  it('un mois regroupe les semaines entières dont le lundi tombe dans le mois', () => {
    const oct = periodAt('mois', d('2026-10-20T12:00'));
    expect(periodRange(oct)).toEqual({ start: d('2026-10-04T22:00'), end: d('2026-11-01T22:00') });
    // Vendredi 2 octobre : sa semaine commence le lundi 28 septembre, elle compte en septembre.
    expect(periodAt('mois', d('2026-10-02T12:00')).anchor).toEqual(d('2026-09-01T00:00'));
    expect(subPeriods(oct).map(shortLabel)).toEqual(['S41', 'S42', 'S43', 'S44']);
    expect(periodTitle(oct)).toBe('Octobre 2026');
  });

  it('une semaine a 7 jours, une année 12 mois', () => {
    const week = periodAt('semaine', d('2026-10-14T12:00'));
    expect(week.anchor).toEqual(d('2026-10-11T22:00'));
    expect(subPeriods(week).map(shortLabel)).toEqual(['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di']);
    expect(shiftPeriod(week, 1).anchor).toEqual(d('2026-10-18T22:00'));
    expect(
      subPeriods(periodAt('annee', d('2026-06-01T12:00')))
        .map(shortLabel)
        .join(''),
    ).toBe('JFMAMJJASOND');
  });

  it('compare une période en cours avec la précédente au même moment', () => {
    const week = periodAt('semaine', d('2026-10-14T12:00'));
    expect(previousRange(week, d('2026-10-14T12:00'))).toEqual({
      range: { start: d('2026-10-04T22:00'), end: d('2026-10-07T12:00') },
      partial: true,
    });
    expect(previousRange(week, d('2026-10-30T12:00')).partial).toBe(false);
  });
});

describe('periodStats', () => {
  const events = [
    ev('debut_journee', '2026-10-12T05:00', { odometer_km: 100000 }),
    ev('chargement', '2026-10-12T06:00', { odometer_km: 100010, id: 'load', department: '11' }),
    ev('carburant', '2026-10-12T08:00', { odometer_km: 100100, station: 'Doumen', diesel_l: 400, adblue_l: 40 }),
    ev('livraison', '2026-10-12T12:00', { odometer_km: 100300, id: 'drop', city: 'Toulouse', department: '31' }),
    ev('fin_journee', '2026-10-12T16:00', { odometer_km: 100500, department: '31' }),
    ev('debut_journee', '2026-10-13T05:30', { odometer_km: 100500 }),
    ev('carburant', '2026-10-13T08:00', { odometer_km: 100600, station: 'AS24', diesel_l: 250 }),
    ev('fin_journee', '2026-10-13T17:30', { odometer_km: 101100 }),
  ];
  const waybills = [
    newWaybill({
      loading_event_id: 'load',
      delivery_event_id: 'drop',
      shipper: 'Client A',
      consignee: 'Client B',
      weight_kg: 24000,
    }),
  ];
  const week = periodRange(periodAt('semaine', d('2026-10-14T12:00')));

  it('fait le bilan de la semaine', () => {
    const s = periodStats(events, waybills, week, fuelIntervals(events), kmTimeline(events, waybills));
    expect(s).toMatchObject({
      km: 1100,
      days: 2,
      amplitude: 11 * 60 + 12 * 60,
      fullDays: 2,
      loads: 1,
      deliveries: 1,
      steps: 4,
      adblue: 40,
      weightKg: 24000,
    });
    expect(s.fuel.bought).toBe(650);
    expect(s.stations).toEqual([
      { station: 'Doumen', liters: 400 },
      { station: 'AS24', liters: 250 },
    ]);
    expect(s.tractors).toEqual([{ plate: 'AA-111-AA', km: 1100 }]);
  });

  it('calcule les horaires et le repos', () => {
    expect(workTimes(events, week)).toEqual({
      avgStart: 5 * 60 + 15,
      earliestStart: 5 * 60,
      avgEnd: 16 * 60 + 45,
      latestEnd: 17 * 60 + 30,
      avgAmplitude: 11 * 60 + 30,
      longestAmplitude: 12 * 60,
      shortestRest: 13 * 60 + 30,
    });
  });

  it('classe les clients avec leur ville, et les départements', () => {
    expect(topPlaces(events, waybills, week)).toEqual({
      shippers: [{ name: 'Client A', count: 1 }],
      consignees: [{ name: 'Client B', count: 1 }],
      // Seulement les chargements et livraisons (la fin de journée en Haute-Garonne ne compte pas).
      departments: [
        { name: '11', detail: 'Aude', count: 1 },
        { name: '31', detail: 'Haute-Garonne', count: 1 },
      ],
    });
    expect(
      topPlaces([ev('livraison', '2026-10-14T10:00', { country_code: 'ES', city: 'Barcelone' })], [], week).departments,
    ).toEqual([{ name: 'ES', detail: 'Espagne', count: 1 }]);
    // Anciennes étapes sans LV : le client saisi sur l'étape ; un même client dans deux villes compte ensemble.
    const old = [
      ev('chargement', '2026-10-14T08:00', { client: 'Client C', city: 'Albi' }),
      ev('chargement', '2026-10-15T08:00', { client: 'client C', city: 'Rodez' }),
      ev('livraison', '2026-10-14T15:00', { client: 'Client D', city: 'Rodez' }),
    ];
    expect(topPlaces(old, [], week)).toMatchObject({
      shippers: [{ name: 'Client C', count: 2 }],
      consignees: [{ name: 'Client D', count: 1 }],
    });
    expect(topNames(['Toulouse', 'toulouse ', 'Albi', null])).toEqual([
      { name: 'Toulouse', count: 2 },
      { name: 'Albi', count: 1 },
    ]);
  });

  it('regroupe un client sous un autre nom de client qu’il contient', () => {
    const group = clientGrouper([
      'Client A',
      'Usine (Client A)',
      'Dépôt Nord (Groupe Client A)',
      'Client AB',
      'Client B',
    ]);
    expect(group('Usine (Client A)')).toBe('Client A');
    expect(group('dépôt nord (groupe client a)')).toBe('Client A');
    expect(group('Client AB')).toBe('Client AB'); // « Client A » au début d'un mot plus long : pas concerné
    expect(group('Client B')).toBe('Client B');
    const loads = [
      ev('chargement', '2026-10-14T08:00', { client: 'Client A' }),
      ev('chargement', '2026-10-14T10:00', { client: 'Usine (Client A)' }),
      ev('chargement', '2026-10-15T08:00', { client: 'Dépôt Nord (Groupe Client A)' }),
    ];
    expect(topPlaces(loads, [], week).shippers).toEqual([{ name: 'Client A', count: 3 }]);
  });

  it('trouve les records et les km de chaque jour', () => {
    expect(records(events)).toEqual({
      bestDay: { day: d('2026-10-13T00:00'), km: 600 },
      bestWeek: { start: d('2026-10-11T22:00'), km: 1100 },
      longestDay: { day: d('2026-10-13T00:00'), minutes: 12 * 60 },
    });
    expect([...kmByDay(events, week).values()]).toEqual([500, 600]);
  });
});
