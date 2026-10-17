import { describe, expect, it } from 'vitest';
import type { TripEvent } from '../types';
import { durationLabel, groupWeek, summarizeDay, weekLabel, weekStart } from './dates';

function ev(id: string, occurred: string, extra: Partial<TripEvent> = {}): TripEvent {
  return {
    id, type: 'chargement', occurred_at: new Date(occurred).toISOString(),
    tractor_plate: '', trailer_plate: '', odometer_km: null, notes: null, client: null, cmr_number: null,
    station: null, diesel_l: null, adblue_l: null, city: '', postcode: null, department: null,
    country_code: null, lat: null, lon: null, updated_at: '', deleted_at: null, ...extra,
  };
}

describe('weekStart / weekLabel', () => {
  it('commence le lundi', () => {
    const start = weekStart(new Date(2026, 9, 17)); // vendredi 17 oct. 2026
    expect(start).toEqual(new Date(2026, 9, 12));
    expect(weekLabel(start)).toBe('Semaine 42 · 12 – 18 oct.');
  });
});

describe('groupWeek', () => {
  it('regroupe par jour, le plus récent en premier, et ignore le reste', () => {
    const start = new Date(2026, 9, 12);
    const days = groupWeek(
      [
        ev('a', '2026-10-12T06:00'),
        ev('b', '2026-10-13T07:00'),
        ev('c', '2026-10-13T15:00'),
        ev('d', '2026-10-19T08:00'), // semaine suivante
        ev('e', '2026-10-14T08:00', { deleted_at: '2026-10-14T09:00:00Z' }),
      ],
      start,
    );
    expect(days.map((d) => d.events.map((e) => e.id))).toEqual([['c', 'b'], ['a']]);
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
});
