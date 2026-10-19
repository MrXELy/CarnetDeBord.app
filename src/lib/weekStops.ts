import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { plateKey, type MapLeg, type Place, type TripEvent } from '../types';
import { workDay } from './dates';
import type { RouteOption } from './route';

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

/** Tronçon entre deux lieux qui se suivent, rangé au jour du lieu d'arrivée (comme dayLegs). */
export interface StopSegment {
  day: string;
  from: Stop;
  to: Stop;
  /** Km au compteur entre les deux lieux, null si inconnu. */
  odometerKm: number | null;
}

/** Clé d'un tronçon : positions de départ et d'arrivée (à 10 m près), pour retrouver son itinéraire enregistré. */
export function segmentKey(segment: { from: Stop; to: Stop }): string {
  const at = (s: Stop) => `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
  return `${at(segment.from)}>${at(segment.to)}`;
}

/** Tracés à dessiner : les tronçons d'un même jour mis bout à bout (le point de jonction une seule fois). */
export function joinDayLegs(legs: MapLeg[]): { day: string; coords: [number, number][] }[] {
  const days: { day: string; coords: [number, number][] }[] = [];
  for (const leg of legs) {
    const last = days.at(-1);
    if (last?.day === leg.day) last.coords.push(...leg.coords.slice(1));
    else days.push({ day: leg.day, coords: [...leg.coords] });
  }
  return days;
}

/** Au-delà, l'écart entre deux relevés est jugé incohérent (même règle que les statistiques). */
const MAX_JUMP_KM = 2000;

/**
 * Km au compteur entre deux lieux : dernier relevé du départ, premier relevé de l'arrivée,
 * avec le même tracteur. Null s'il manque un relevé ou si l'écart est incohérent.
 */
export function odometerKm(from: Stop, to: Stop): number | null {
  const start = [...from.events].reverse().find((e) => e.odometer_km != null);
  const end = to.events.find((e) => e.odometer_km != null);
  if (!start || !end || plateKey(start.tractor_plate) !== plateKey(end.tractor_plate)) return null;
  const km = end.odometer_km! - start.odometer_km!;
  return km > 0 && km <= MAX_JUMP_KM ? km : null;
}

/** Tronçons entre chaque lieu et le suivant, avec les km relevés au compteur. */
export function stopSegments(stops: Stop[]): StopSegment[] {
  return stops.slice(1).map((to, i) => ({ day: to.day, from: stops[i], to, odometerKm: odometerKm(stops[i], to) }));
}

/**
 * Itinéraire le plus proche des km relevés au compteur.
 * Sans relevé : le premier proposé (le plus rapide), comme avant.
 */
export function closestRoute(options: RouteOption[], km: number | null): RouteOption {
  if (km == null) return options[0];
  return options.reduce((best, o) => (Math.abs(o.km - km) < Math.abs(best.km - km) ? o : best));
}

/** Empreinte des lieux et de leur ordre : si elle change, la carte est à régénérer. */
export function stopsHash(stops: Stop[]): string {
  const text = stops.map((s) => `${s.day}:${s.lat.toFixed(4)},${s.lon.toFixed(4)}`).join('|');
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${stops.length}-${h.toString(16)}`;
}
