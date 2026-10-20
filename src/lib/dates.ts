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
import { kmSegments } from './emptyKm';

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

/**
 * Km de ces étapes, calculés comme dans les Statistiques : somme des tronçons entre deux relevés qui se suivent
 * avec le même tracteur (sans le repos, un changement de tracteur sans relevé ni les relevés incohérents).
 * Null s'il n'y a aucun tronçon.
 */
export function periodKm(events: TripEvent[]): number | null {
  const segments = kmSegments(events);
  return segments.length ? segments.reduce((sum, s) => sum + s.km, 0) : null;
}

export function summarizeDay(events: TripEvent[]): DaySummary {
  const start = events.find((e) => e.type === 'debut_journee');
  const end = events.find((e) => e.type === 'fin_journee');
  return {
    km: periodKm(events),
    amplitude: start && end ? differenceInMinutes(parseISO(end.occurred_at), parseISO(start.occurred_at)) : null,
  };
}

export interface WeekSummary {
  km: number | null;
  /** Vrai si la semaine n'est pas terminée par une fin de journée. */
  inProgress: boolean;
}

/** Km de la semaine (voir periodKm), et si elle est en cours : dernier relevé autre qu'une fin de journée. */
export function summarizeWeek(events: TripEvent[]): WeekSummary {
  const withKm = events
    .filter((e) => e.odometer_km != null && !e.deleted_at)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const last = withKm[withKm.length - 1];
  return { km: periodKm(events), inProgress: !!last && last.type !== 'fin_journee' };
}

export interface WeekEntry {
  /** Début de la semaine de travail (dimanche 22h). */
  start: Date;
  /** Nombre d'étapes de la semaine. */
  count: number;
  km: number | null;
}

/** Semaines contenant au moins une étape, de la plus récente à la plus ancienne. */
export function listWeeks(events: TripEvent[]): WeekEntry[] {
  const byWeek = new Map<number, TripEvent[]>();
  for (const e of events) {
    if (e.deleted_at) continue;
    const key = weekStart(parseISO(e.occurred_at)).getTime();
    byWeek.set(key, [...(byWeek.get(key) ?? []), e]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => b - a)
    .map(([key, list]) => ({ start: new Date(key), count: list.length, km: summarizeWeek(list).km }));
}

/**
 * Semaines d'un mois, telles que groupées dans la liste des semaines (mois de leur lundi),
 * de la plus ancienne à la plus récente, avec leurs étapes.
 */
export function monthWeeks(events: TripEvent[], label: string): { start: Date; events: TripEvent[] }[] {
  const byWeek = new Map<number, TripEvent[]>();
  for (const e of events) {
    if (e.deleted_at) continue;
    const start = weekStart(parseISO(e.occurred_at));
    if (monthLabel(start) !== label) continue;
    byWeek.set(start.getTime(), [...(byWeek.get(start.getTime()) ?? []), e]);
  }
  return [...byWeek.entries()].sort(([a], [b]) => a - b).map(([key, list]) => ({ start: new Date(key), events: list }));
}

/** Mois d'une semaine, d'après son lundi : « Janvier 2026 ». */
export function monthLabel(weekStartDate: Date): string {
  const s = format(addHours(weekStartDate, WEEK_LEAD_HOURS), 'MMMM yyyy', { locale: fr });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function durationLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}
