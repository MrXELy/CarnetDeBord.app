import { describe, expect, it } from 'vitest';
import { newWaybill, type TripEvent, type Waybill } from '../types';
import { emptyReport, kmTimeline } from './emptyKm';
import { kmByTractor } from './stats';

let n = 0;
function ev(type: TripEvent['type'], occurred: string, km: number | null, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id: `e${n++}`,
    type,
    occurred_at: new Date(occurred).toISOString(),
    tractor_plate: 'AA-111-AA',
    trailer_plate: '',
    odometer_km: km,
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

const d = (s: string) => new Date(s);
const report = (events: TripEvent[], start: string, end: string, waybills: Waybill[] = []) =>
  emptyReport(kmTimeline(events, waybills), d(start), d(end));

describe('km à vide', () => {
  it('compte de la dernière livraison au chargement suivant', () => {
    const events = [
      ev('debut_journee', '2026-10-13T05:00', 1000),
      ev('livraison', '2026-10-13T07:00', 1100, { city: 'Toulouse' }),
      ev('carburant', '2026-10-13T08:00', 1130),
      ev('chargement', '2026-10-13T09:00', 1180, { city: 'Périgueux' }),
      ev('fin_journee', '2026-10-13T17:00', 1500),
    ];
    const r = report(events, '2026-10-11T22:00', '2026-10-18T22:00');
    expect(r.empty).toBe(80);
    // Avant la première livraison, l'état du camion est inconnu : ces 100 km ne comptent ni d'un côté ni de l'autre.
    expect(r.loaded).toBe(320);
    expect(r.share).toBeCloseTo(80 / 400);
    expect(r.legs).toHaveLength(1);
    expect(r.longest?.km).toBe(80);
    expect(r.incomplete).toBe(0);
  });

  it('tournée : à vide seulement après la dernière livraison', () => {
    const events = [
      ev('chargement', '2026-10-13T06:00', 1000),
      ev('livraison', '2026-10-13T08:00', 1100),
      ev('livraison', '2026-10-13T10:00', 1150),
      ev('chargement', '2026-10-13T12:00', 1210),
    ];
    const r = report(events, '2026-10-11T22:00', '2026-10-18T22:00');
    expect(r.empty).toBe(60);
    expect(r.loaded).toBe(150);
  });

  it('chargement le vendredi, livraison le lundi : en charge tout le week-end', () => {
    const events = [
      ev('chargement', '2026-10-16T14:00', 1000),
      ev('fin_journee', '2026-10-16T17:00', 1200),
      ev('debut_journee', '2026-10-19T05:00', 1200),
      ev('livraison', '2026-10-19T07:00', 1300),
    ];
    const timeline = kmTimeline(events);
    expect(emptyReport(timeline, d('2026-10-11T22:00'), d('2026-10-18T22:00'))).toMatchObject({
      empty: 0,
      loaded: 200,
    });
    expect(emptyReport(timeline, d('2026-10-18T22:00'), d('2026-10-25T22:00'))).toMatchObject({
      empty: 0,
      loaded: 100,
    });
  });

  it('livraison le vendredi, chargement le lundi : chaque morceau dans sa semaine', () => {
    const events = [
      ev('livraison', '2026-10-16T14:00', 1000),
      ev('fin_journee', '2026-10-16T17:00', 1080),
      ev('debut_journee', '2026-10-19T05:00', 1080),
      ev('chargement', '2026-10-19T07:00', 1150),
    ];
    const timeline = kmTimeline(events);
    expect(emptyReport(timeline, d('2026-10-11T22:00'), d('2026-10-18T22:00')).empty).toBe(80);
    const next = emptyReport(timeline, d('2026-10-18T22:00'), d('2026-10-25T22:00'));
    expect(next.empty).toBe(70);
    // Le trajet est compté en entier dans la semaine où il se termine.
    expect(next.legs.map((l) => l.km)).toEqual([150]);
  });

  it('changement de tracteur pendant le repos : jamais de soustraction entre deux compteurs', () => {
    const events = [
      ev('livraison', '2026-10-13T14:00', 512300),
      ev('fin_journee', '2026-10-13T17:00', 512360),
      ev('debut_journee', '2026-10-14T05:00', 87000, { tractor_plate: 'BB-222-BB' }),
      ev('chargement', '2026-10-14T06:00', 87045, { tractor_plate: 'BB-222-BB' }),
      ev('livraison', '2026-10-14T09:00', 87245, { tractor_plate: 'BB-222-BB' }),
    ];
    const r = report(events, '2026-10-11T22:00', '2026-10-18T22:00');
    expect(r.empty).toBe(105);
    expect(r.legs[0]).toMatchObject({ km: 105, complete: true });
    expect(r.tractors).toEqual([
      { plate: 'BB-222-BB', empty: 45, loaded: 200 },
      { plate: 'AA-111-AA', empty: 60, loaded: 0 },
    ]);
  });

  it('changement de tracteur en pleine journée sans relevé : trajet incomplet, rien d’inventé', () => {
    const events = [
      ev('livraison', '2026-10-13T08:00', 512300),
      ev('chargement', '2026-10-13T11:00', 87045, { tractor_plate: 'BB-222-BB' }),
      ev('fin_journee', '2026-10-13T17:00', 87300, { tractor_plate: 'BB-222-BB' }),
    ];
    const r = report(events, '2026-10-11T22:00', '2026-10-18T22:00');
    expect(r.empty).toBe(0);
    expect(r.loaded).toBe(255);
    expect(r.incomplete).toBe(1);
  });

  it('le compteur qui bouge pendant le repos n’est pas compté', () => {
    const events = [
      ev('livraison', '2026-10-13T14:00', 1000),
      ev('fin_journee', '2026-10-13T17:00', 1050),
      ev('debut_journee', '2026-10-15T05:00', 1600),
      ev('chargement', '2026-10-15T06:00', 1640),
    ];
    const r = report(events, '2026-10-11T22:00', '2026-10-18T22:00');
    expect(r.empty).toBe(90);
    expect(kmByTractor(events)).toEqual(new Map([['AA-111-AA', 90]]));
  });

  it('relevé incohérent : ignoré et signalé', () => {
    const events = [
      ev('livraison', '2026-10-13T08:00', 1000),
      ev('carburant', '2026-10-13T09:00', 900),
      ev('chargement', '2026-10-13T10:00', 950),
    ];
    const r = report(events, '2026-10-11T22:00', '2026-10-18T22:00');
    expect(r.empty).toBe(50);
    expect(r.incomplete).toBe(1);
  });

  it('une plaque écrite autrement reste le même tracteur', () => {
    const events = [
      ev('livraison', '2026-10-13T08:00', 1000),
      ev('chargement', '2026-10-13T09:00', 1040, { tractor_plate: 'aa111aa' }),
    ];
    expect(report(events, '2026-10-11T22:00', '2026-10-18T22:00').empty).toBe(40);
    expect([...kmByTractor(events).values()]).toEqual([40]);
  });

  it('une LV encore à livrer après la livraison : pas à vide', () => {
    const load = ev('chargement', '2026-10-13T06:00', 1000);
    const drop1 = ev('livraison', '2026-10-13T08:00', 1100);
    const reload = ev('chargement', '2026-10-13T09:00', 1120);
    const drop2 = ev('livraison', '2026-10-13T11:00', 1200);
    const waybills = [
      newWaybill({ loading_event_id: load.id, delivery_event_id: drop1.id }),
      newWaybill({ loading_event_id: load.id, delivery_event_id: drop2.id }),
      newWaybill({ loading_event_id: reload.id, delivery_event_id: drop2.id }),
    ];
    const r = report([load, drop1, reload, drop2], '2026-10-11T22:00', '2026-10-18T22:00', waybills);
    expect(r.empty).toBe(0);
    expect(r.loaded).toBe(200);
  });

  it('une LV oubliée « dans le camion » ne bloque pas un trajet terminé', () => {
    const load = ev('chargement', '2026-10-13T06:00', 1000);
    const drop = ev('livraison', '2026-10-13T08:00', 1100);
    const next = ev('chargement', '2026-10-13T09:00', 1130);
    const waybills = [newWaybill({ loading_event_id: load.id })];
    expect(report([load, drop, next], '2026-10-11T22:00', '2026-10-18T22:00', waybills).empty).toBe(30);
  });

  it('après la dernière livraison : à vide, sauf s’il reste une LV dans le camion', () => {
    const load = ev('chargement', '2026-10-13T06:00', 1000);
    const drop = ev('livraison', '2026-10-13T08:00', 1100);
    const end = ev('fin_journee', '2026-10-13T10:00', 1160);
    const range = ['2026-10-11T22:00', '2026-10-18T22:00'] as const;
    expect(report([load, drop, end], ...range).empty).toBe(60);
    const waybills = [newWaybill({ loading_event_id: load.id })];
    expect(report([load, drop, end], ...range, waybills).empty).toBe(0);
  });

  it('chargement sans km : km inconnus et trajet incomplet', () => {
    const events = [
      ev('livraison', '2026-10-13T08:00', 1000),
      ev('chargement', '2026-10-13T09:00', null),
      ev('livraison', '2026-10-13T12:00', 1200),
    ];
    const r = report(events, '2026-10-11T22:00', '2026-10-18T22:00');
    expect(r).toMatchObject({ empty: 0, loaded: 0, share: null, incomplete: 1 });
  });
});
