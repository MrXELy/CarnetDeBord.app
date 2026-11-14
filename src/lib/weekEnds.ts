import { addDays, addHours, differenceInMinutes, parseISO } from 'date-fns';
import type { TripEvent } from '../types';
import { weekStart } from './dates';
import type { Range } from './stats';

/** Fin d'une semaine : sa dernière fin de journée, comparée à l'heure habituelle du vendredi. */
export interface WeekEnd {
  /** Début de la semaine (dimanche 22h). */
  week: Date;
  end: Date;
  /** Fini un autre jour que le vendredi. */
  other: boolean;
  /** Écart en minutes avec le vendredi à l'heure habituelle (négatif = plus tôt). */
  diff: number;
}

export interface WeekEnds {
  /** Heure habituelle de fin le vendredi, en minutes après minuit (médiane). */
  usual: number;
  /** Plus récente en premier. */
  weeks: WeekEnd[];
}

/** Vendredi 0 h de la semaine (dimanche 22h + 2 h + 4 jours). */
const friday = (week: Date) => addDays(addHours(week, 2), 4);

/**
 * Fins de semaine de la période. L'heure habituelle est la médiane des fins du vendredi, sur tout l'historique
 * jusqu'à la fin de la période. Semaine en cours : comptée seulement à partir du samedi, journée finie.
 * Null s'il n'y a encore aucune semaine finie un vendredi.
 */
export function weekEnds(events: TripEvent[], range: Range, now: Date): WeekEnds | null {
  // Dernière limite de journée (début ou fin) de chaque semaine.
  const last = new Map<number, TripEvent>();
  for (const e of events) {
    if (e.deleted_at || (e.type !== 'fin_journee' && e.type !== 'debut_journee')) continue;
    const key = weekStart(parseISO(e.occurred_at)).getTime();
    const prev = last.get(key);
    if (!prev || e.occurred_at > prev.occurred_at) last.set(key, e);
  }
  const ends: { week: Date; end: Date }[] = [];
  for (const [key, e] of last) {
    const week = new Date(key);
    if (e.type !== 'fin_journee' || now < addDays(friday(week), 1)) continue;
    ends.push({ week, end: parseISO(e.occurred_at) });
  }

  const fridays = ends
    .filter((w) => w.week < range.end && w.end.getDay() === 5)
    .map((w) => w.end.getHours() * 60 + w.end.getMinutes())
    .sort((a, b) => a - b);
  if (fridays.length === 0) return null;
  const mid = fridays.length >> 1;
  const usual = fridays.length % 2 ? fridays[mid] : Math.round((fridays[mid - 1] + fridays[mid]) / 2);

  const weeks = ends
    .filter((w) => w.week >= range.start && w.week < range.end)
    .map((w) => ({
      ...w,
      other: w.end.getDay() !== 5,
      diff: differenceInMinutes(w.end, friday(w.week)) - usual,
    }))
    .sort((a, b) => b.week.getTime() - a.week.getTime());
  return { usual, weeks };
}
