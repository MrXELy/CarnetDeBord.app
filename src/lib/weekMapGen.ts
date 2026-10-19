import type { MapLeg, Place, TripEvent, WeekMap } from '../types';
import { resolveCity } from './geo';
import { routeOptions, simplify, type RouteOption } from './route';
import type { EventStore } from './sync';
import { buildStops, closestRoute, segmentKey, stopSegments, stopsHash } from './weekStops';

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
 * 2. itinéraires, tronçon par tronçon : parmi ceux proposés, le plus proche des km relevés au compteur
 *    (un itinéraire choisi à la main est gardé, sans nouveau calcul) ;
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
  const previous = store.weekMap(start);
  const chosen = new Map(previous?.legs.filter((l) => l.manual && l.key).map((l) => [l.key!, l]));
  const legs: MapLeg[] = [];
  for (const [i, segment] of segments.entries()) {
    const key = segmentKey(segment);
    const kept = chosen.get(key);
    if (kept) {
      legs.push({ ...kept, day: segment.day });
      continue;
    }
    onProgress(`Calcul des itinéraires (${i + 1}/${segments.length})…`);
    const options = await routeOptions([segment.from.lat, segment.from.lon], [segment.to.lat, segment.to.lon]);
    if (!options) throw new Error('Itinéraire indisponible');
    legs.push(routeLegOf(segment.day, key, closestRoute(options, segment.odometerKm)));
  }

  store.saveWeekMap({
    id: previous?.id ?? weekMapId(store.userId, start),
    week_start: start.toISOString(),
    stops_hash: stopsHash(stops),
    legs,
    generated_at: new Date().toISOString(),
    updated_at: '',
    deleted_at: null,
  });
}

/** Tronçon enregistré : tracé simplifié et longueur arrondie à 100 m (et villes de passage, s'il y en a). */
function routeLegOf(day: string, key: string, option: RouteOption, manual = false): MapLeg {
  return {
    day,
    key,
    km: Math.round(option.km * 10) / 10,
    coords: simplify(option.coords),
    ...(manual && { manual }),
    ...(manual && option.label && { via: option.label }),
  };
}

/** Carte où le tronçon `key` prend l'itinéraire choisi à la main (gardé ensuite à la régénération). */
export function withChosenRoute(map: WeekMap, key: string, option: RouteOption): WeekMap {
  return { ...map, legs: map.legs.map((l) => (l.key === key ? routeLegOf(l.day, key, option, true) : l)) };
}
