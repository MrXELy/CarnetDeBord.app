import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { Place, TripEvent } from '../types';
import { workDay } from './dates';

/** Couleur de chaque jour, du lundi au dimanche (lisibles sur fond sombre). */
export const DAY_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#94a3b8'];

/** Couleur de chaque semaine sur la carte du mois (distinctes des couleurs des jours). */
export const WEEK_COLORS = ['#60a5fa', '#fbbf24', '#f472b6', '#34d399', '#a78bfa'];

/** Lieu de la carte : une ou plusieurs étapes consécutives au même endroit. */
export interface Stop {
  /** Numéro affiché sur la carte (1, 2, 3…). */
  number: number;
  lat: number;
  lon: number;
  /** Jour de travail (« 2026-01-26 ») de la première étape du lieu. */
  day: string;
  color: string;
  events: TripEvent[];
  /** Position retrouvée d'après le nom de la ville (centre de la commune), pas d'un GPS. */
  approximate: boolean;
}

export interface MapLegPoints {
  day: string;
  color: string;
  points: [number, number][];
}

/** Même endroit : moins de 1 km entre deux étapes consécutives. */
const SAME_PLACE_KM = 1;

/** Distance en km entre deux points (formule de haversine). */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export const dayKey = (iso: string) => format(workDay(parseISO(iso)), 'yyyy-MM-dd');

/** Couleur d'un jour : lundi bleu, mardi vert… */
export function dayColor(day: string): string {
  return DAY_COLORS[(parseISO(day).getDay() + 6) % 7];
}

/** « Lun 26 » */
export function shortDay(day: string): string {
  const s = format(parseISO(day), 'EEE d', { locale: fr }).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Lieux de la semaine, dans l'ordre chronologique.
 * `found` : positions retrouvées d'après le nom de la ville pour les étapes sans coordonnées.
 * Les étapes sans position (ni GPS, ni ville retrouvée) sont renvoyées à part dans `missing`.
 */
export function buildStops(
  events: TripEvent[],
  found: Map<string, Place> = new Map(),
): { stops: Stop[]; missing: TripEvent[] } {
  const stops: Stop[] = [];
  const missing: TripEvent[] = [];
  const ordered = events.filter((e) => !e.deleted_at).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  for (const e of ordered) {
    const resolved = e.lat != null && e.lon != null ? null : found.get(e.id);
    const lat = e.lat ?? resolved?.lat;
    const lon = e.lon ?? resolved?.lon;
    if (lat == null || lon == null) {
      missing.push(e);
      continue;
    }
    const last = stops.at(-1);
    if (last && distanceKm([last.lat, last.lon], [lat, lon]) < SAME_PLACE_KM) {
      last.events.push(e);
      continue;
    }
    const day = dayKey(e.occurred_at);
    stops.push({
      number: stops.length + 1,
      lat,
      lon,
      day,
      color: dayColor(day),
      events: [e],
      approximate: !!resolved,
    });
  }
  return { stops, missing };
}

/** Tronçons par jour : chaque jour part du dernier lieu de la veille. */
export function dayLegs(stops: Stop[]): MapLegPoints[] {
  const legs: MapLegPoints[] = [];
  let previous: Stop | null = null;
  for (const stop of stops) {
    let leg = legs.at(-1);
    if (!leg || leg.day !== stop.day) {
      leg = { day: stop.day, color: stop.color, points: previous ? [[previous.lat, previous.lon]] : [] };
      legs.push(leg);
    }
    leg.points.push([stop.lat, stop.lon]);
    previous = stop;
  }
  return legs.filter((l) => l.points.length >= 2);
}

/** Empreinte des lieux et de leur ordre : si elle change, la carte est à régénérer. */
export function stopsHash(stops: Stop[]): string {
  const text = stops.map((s) => `${s.day}:${s.lat.toFixed(4)},${s.lon.toFixed(4)}`).join('|');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${stops.length}-${h.toString(16)}`;
}
