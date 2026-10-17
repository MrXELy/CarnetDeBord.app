import {
  addDays,
  addHours,
  differenceInMinutes,
  format,
  getISOWeek,
  isSameMonth,
  isSunday,
  parseISO,
  startOfDay,
  startOfWeek,
  subHours,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { TripEvent } from '../types';

/** La semaine de travail commence le dimanche à 22h, soit 2 heures avant le lundi. */
const WEEK_LEAD_HOURS = 2;

/** Début de la semaine de travail contenant cette date : le dimanche à 22h. */
export function weekStart(date: Date): Date {
  return subHours(startOfWeek(addHours(date, WEEK_LEAD_HOURS), { weekStartsOn: 1 }), WEEK_LEAD_HOURS);
}

/** Jour auquel rattacher une étape : le dimanche à partir de 22h compte comme le lundi. */
export function workDay(date: Date): Date {
  return isSunday(date) && date.getHours() >= 24 - WEEK_LEAD_HOURS ? startOfDay(addDays(date, 1)) : startOfDay(date);
}

/** « Semaine 42 · 12 – 18 oct. » (du lundi au dimanche). */
export function weekLabel(weekStartDate: Date): string {
  const start = addHours(weekStartDate, WEEK_LEAD_HOURS);
  const end = addDays(start, 6);
  const range = isSameMonth(start, end)
    ? `${format(start, 'd')} – ${format(end, 'd MMM', { locale: fr })}`
    : `${format(start, 'd MMM', { locale: fr })} – ${format(end, 'd MMM', { locale: fr })}`;
  return `Semaine ${getISOWeek(start)} · ${range}`;
}

export function dayLabel(day: Date): string {
  const s = format(day, 'EEEE d MMMM', { locale: fr });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function timeLabel(iso: string): string {
  return format(parseISO(iso), 'HH:mm');
}

/** Valeur pour un champ <input type="datetime-local">. */
export function toLocalInput(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export interface Day {
  date: Date;
  events: TripEvent[];
}

/** Événements de la semaine regroupés par jour, le plus récent en premier (jours et événements). */
export function groupWeek(events: TripEvent[], start: Date): Day[] {
  const end = addDays(start, 7);
  const byDay = new Map<number, TripEvent[]>();
  for (const e of events) {
    const d = parseISO(e.occurred_at);
    if (e.deleted_at || d < start || d >= end) continue;
    const key = workDay(d).getTime();
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b - a)
    .map(([key, list]) => ({
      date: new Date(key),
      events: list.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
    }));
}

export interface DaySummary {
  km: number | null;
  /** Amplitude en minutes entre « début » et « fin de journée ». */
  amplitude: number | null;
}

export function summarizeDay(events: TripEvent[]): DaySummary {
  const kms = events.map((e) => e.odometer_km).filter((k): k is number => k != null);
  const start = events.find((e) => e.type === 'debut_journee');
  const end = events.find((e) => e.type === 'fin_journee');
  return {
    km: kms.length >= 2 ? Math.max(...kms) - Math.min(...kms) : null,
    amplitude: start && end ? differenceInMinutes(parseISO(end.occurred_at), parseISO(start.occurred_at)) : null,
  };
}

export interface WeekSummary {
  km: number | null;
  /** Vrai si la semaine n'est pas terminée par une fin de journée. */
  inProgress: boolean;
}

/**
 * Km de la semaine : du premier « début de journée » à la dernière « fin de journée ».
 * Si des étapes ont suivi cette fin (ou s'il n'y en a pas), on compte jusqu'au dernier relevé.
 */
export function summarizeWeek(events: TripEvent[]): WeekSummary {
  const withKm = events
    .filter((e) => e.odometer_km != null)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const first = withKm.find((e) => e.type === 'debut_journee');
  if (!first) return { km: null, inProgress: false };
  const last = withKm[withKm.length - 1];
  return { km: last.odometer_km! - first.odometer_km!, inProgress: last.type !== 'fin_journee' };
}

export function durationLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}
