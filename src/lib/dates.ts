import { addDays, differenceInMinutes, format, getISOWeek, isSameMonth, parseISO, startOfDay, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { TripEvent } from '../types';

export function weekStart(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

/** « Semaine 42 · 13 – 19 oct. » */
export function weekLabel(start: Date): string {
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
    const key = startOfDay(d).getTime();
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

export function durationLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}
