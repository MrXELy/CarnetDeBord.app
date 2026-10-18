import { inRange, totalKm, type Range } from '../../lib/stats';
import type { TripEvent } from '../../types';

export const num = (n: number, digits = 0) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const liters = (n: number) => `${num(Math.round(n))} L`;

/** Heure de la journée à partir des minutes après minuit (−60 → 23:00). */
export const clock = (minutes: number | null) => {
  if (minutes == null) return '—';
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const kmOf = (events: TripEvent[], range: Range) => totalKm(inRange(events, range));

/** Part en pourcentage arrondi (0,153 → 15), ou null. */
export const percent = (share: number | null) => (share == null ? null : Math.round(share * 100));
