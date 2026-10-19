import type { Place, TripEvent, WeekMap } from '../types';
import { resolveCity } from './geo';
import { routeOptions, simplify } from './route';
import type { EventStore } from './sync';
import { buildStops, closestRoute, stopSegments, stopsHash } from './weekStops';

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
 * 2. itinéraires, tronçon par tronçon : parmi ceux proposés, le plus proche des km relevés au compteur ;
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
  const segments = stopSegments(stops);
  const days: WeekMap['legs'] = [];
  for (const [i, segment] of segments.entries()) {
    onProgress(`Calcul des itinéraires (${i + 1}/${segments.length})…`);
    const options = await routeOptions([segment.from.lat, segment.from.lon], [segment.to.lat, segment.to.lon]);
    if (!options) throw new Error('Itinéraire indisponible');
    const { coords } = closestRoute(options, segment.odometerKm);
    // Tracés d'un même jour mis bout à bout (le point de jonction une seule fois).
    const day = days.at(-1);
    if (day?.day === segment.day) day.coords.push(...coords.slice(1));
    else days.push({ day: segment.day, coords: [...coords] });
  }
  const routed = days.map((d) => ({ day: d.day, coords: simplify(d.coords) }));

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
