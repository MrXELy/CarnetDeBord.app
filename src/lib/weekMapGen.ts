import type { Place, TripEvent, WeekMap } from '../types';
import { resolveCity } from './geo';
import { routeLeg, simplify } from './route';
import type { EventStore } from './sync';
import { buildStops, dayLegs, stopsHash } from './weekStops';

/** Identifiant fixe de la carte d'une semaine : une seule carte par semaine, même sur deux appareils. */
export function weekMapId(userId: string, start: Date): string {
  const text = `${userId}|${start.toISOString()}`;
  let hex = '';
  for (let seed = 1; hex.length < 32; seed++) {
    let h = 2166136261 ^ seed;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    hex += (h >>> 0).toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Calcule et enregistre la carte d'une semaine :
 * 1. ville retrouvée pour les étapes sans position (centre de la commune) ;
 * 2. itinéraires, jour après jour ;
 * 3. enregistrement : la carte s'affichera ensuite sans aucun calcul, sur tous les appareils.
 * `found` est complétée avec les villes retrouvées. Lève une erreur si un itinéraire est indisponible.
 */
export async function generateWeekMap(
  store: EventStore,
  start: Date,
  events: TripEvent[],
  found: Map<string, Place>,
  onProgress: (message: string) => void,
): Promise<void> {
  const { missing } = buildStops(events, found);
  const toFind = missing.filter((e) => e.city.trim() && !found.has(e.id));
  for (const [i, e] of toFind.entries()) {
    onProgress(`Recherche des villes sans position (${i + 1}/${toFind.length})…`);
    const place = await resolveCity(e.city, e.department);
    if (place?.lat != null && place.lon != null) {
      found.set(e.id, place);
      store.completePlace(e.id, place); // enregistrée : pas de nouvelle recherche la prochaine fois
    }
  }

  const stops = buildStops(events, found).stops;
  const legs = dayLegs(stops);
  const routed: WeekMap['legs'] = [];
  for (const [i, leg] of legs.entries()) {
    onProgress(`Calcul des itinéraires (${i + 1}/${legs.length})…`);
    const coords = await routeLeg(leg.points);
    if (!coords) throw new Error('Itinéraire indisponible');
    routed.push({ day: leg.day, coords: simplify(coords) });
  }

  store.saveWeekMap({
    id: store.weekMap(start)?.id ?? weekMapId(store.userId, start),
    week_start: start.toISOString(),
    stops_hash: stopsHash(stops),
    legs: routed,
    generated_at: new Date().toISOString(),
    updated_at: '',
    deleted_at: null,
  });
}
