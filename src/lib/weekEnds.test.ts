import { describe, expect, it } from 'vitest';
import type { TripEvent } from '../types';
import { weekEnds } from './weekEnds';

let n = 0;
const ev = (type: TripEvent['type'], at: string) =>
  ({ id: `e${n++}`, type, occurred_at: new Date(at).toISOString() }) as TripEvent;
/** Semaine finie à cette date et heure (début de journée 5 h le même jour). */
const week = (end: string) => [ev('debut_journee', `${end.slice(0, 10)}T05:00`), ev('fin_journee', end)];

const all = { start: new Date('2026-10-01'), end: new Date('2026-12-01') };
const now = new Date('2026-11-20T12:00');

describe('weekEnds', () => {
  const events = [
    ...week('2026-10-16T14:00'), // ven.
    ...week('2026-10-23T16:00'), // ven.
    ...week('2026-10-30T18:00'), // ven.
    ...week('2026-11-07T09:30'), // sam.
    ...week('2026-11-12T20:00'), // jeu.
    ev('debut_journee', '2026-11-16T05:00'), // semaine en cours, pas finie
  ];

  it('heure habituelle = médiane des vendredis, écart avec le vendredi à cette heure', () => {
    const r = weekEnds(events, all, now)!;
    expect(r.usual).toBe(16 * 60);
    expect(r.weeks.map((w) => [w.other, w.diff])).toEqual([
      [true, -20 * 60], // jeu. 20:00
      [true, 17 * 60 + 30], // sam. 09:30
      [false, 120],
      [false, 0],
      [false, -120],
    ]);
  });

  it('semaine en cours comptée à partir du samedi, journée finie', () => {
    const friday = [...events, ev('fin_journee', '2026-11-20T15:00')];
    expect(weekEnds(friday, all, now)!.weeks).toHaveLength(5);
    expect(weekEnds(friday, all, new Date('2026-11-21T08:00'))!.weeks[0].diff).toBe(-30); // médiane 15:30 avec ce 4e vendredi
  });

  it('aucun vendredi : rien', () => {
    expect(weekEnds(week('2026-11-07T09:30'), all, now)).toBeNull();
  });
});
