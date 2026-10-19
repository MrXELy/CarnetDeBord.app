/**
 * Services publics de calcul d'itinéraire :
 * - Valhalla (FOSSGIS), profil voiture, qui propose d'autres itinéraires ;
 * - OSRM, profil voiture, en secours : son serveur public ne propose jamais d'autre itinéraire.
 */
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

type Point = [number, number];

/**
 * Règle des serveurs publics (FOSSGIS : « une requête par seconde au maximum ») :
 * au moins `gapMs` entre deux demandes à un même serveur. Modifiable pour les tests.
 */
export const routing = { gapMs: 1100 };
const lastSent = new Map<string, number>();
const queues = new Map<string, Promise<void>>();

/** Demande à un serveur d'itinéraires, chacune à son tour, au moins `gapMs` après l'envoi de la précédente. */
async function politeFetch(server: string, url: string, signal?: AbortSignal): Promise<Response> {
  const turn = (queues.get(server) ?? Promise.resolve()).then(async () => {
    const wait = (lastSent.get(server) ?? 0) + routing.gapMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastSent.set(server, Date.now());
  });
  queues.set(server, turn);
  await turn;
  return fetch(url, { signal });
}

/** Un itinéraire possible entre deux étapes. */
export interface RouteOption {
  coords: Point[];
  /** Longueur de l'itinéraire, en km. */
  km: number;
  minutes: number;
}

/** Décode un tracé Valhalla (« polyline » à 6 décimales) en points [latitude, longitude]. */
export function decodePolyline6(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lat / 1e6, lon / 1e6]);
  }
  return points;
}

/** Point de passage Valhalla (coordonnées arrondies à 1 m). */
const location = ([lat, lon]: Point) => ({ lat: +lat.toFixed(5), lon: +lon.toFixed(5) });

/** Itinéraires Valhalla (profil voiture) : le principal puis les autres proposés. */
async function valhallaOptions(locations: object[], alternates: number, signal?: AbortSignal) {
  const request = { locations, costing: 'auto', alternates, units: 'kilometers', directions_type: 'none' };
  try {
    // Requête GET (paramètre json) : pas de demande préalable du navigateur.
    const res = await politeFetch(VALHALLA, `${VALHALLA}?json=${encodeURIComponent(JSON.stringify(request))}`, signal);
    if (!res.ok) return null;
    const data = await res.json();
    const trips: unknown[] = [
      data?.trip,
      ...(Array.isArray(data?.alternates) ? data.alternates.map((a: { trip?: unknown }) => a?.trip) : []),
    ];
    const options: RouteOption[] = [];
    for (const trip of trips as { legs?: { shape?: unknown }[]; summary?: { length?: unknown; time?: unknown } }[]) {
      const shapes = trip?.legs?.map((l) => l?.shape) ?? [];
      const km = trip?.summary?.length;
      if (!shapes.length || shapes.some((sh) => typeof sh !== 'string') || typeof km !== 'number') continue;
      // Un tracé par étape d'arrêt : mis bout à bout (le point de jonction une seule fois).
      const coords = (shapes as string[]).flatMap((sh, i) => decodePolyline6(sh).slice(i ? 1 : 0));
      if (coords.length < 2) continue;
      const time = trip.summary?.time;
      options.push({ coords, km, minutes: typeof time === 'number' ? time / 60 : 0 });
    }
    return options.length ? options : null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/** Itinéraire OSRM (profil voiture) passant par ces points dans l'ordre, un seul. */
async function osrmOptions(points: Point[], signal?: AbortSignal): Promise<RouteOption[] | null> {
  const path = points.map(([lat, lon]) => `${lon.toFixed(5)},${lat.toFixed(5)}`).join(';');
  try {
    const res = await politeFetch(OSRM, `${OSRM}/${path}?overview=full&geometries=geojson`, signal);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    const coords: unknown = route?.geometry?.coordinates;
    if (data?.code !== 'Ok' || !Array.isArray(coords) || coords.length < 2 || typeof route.distance !== 'number') {
      return null;
    }
    return [
      {
        coords: (coords as [number, number][]).map(([lon, lat]) => [lat, lon]),
        km: route.distance / 1000,
        minutes: (route.duration ?? 0) / 60,
      },
    ];
  } catch {
    return null;
  }
}

/**
 * Jusqu'à 3 itinéraires entre deux points (le premier est le plus rapide) : Valhalla, sinon OSRM.
 * Les autres itinéraires ne sont proposés qu'entre deux points, d'où un appel par tronçon.
 * Renvoie null si aucun service ne répond ou ne trouve d'itinéraire.
 */
export async function routeOptions(from: Point, to: Point, signal?: AbortSignal): Promise<RouteOption[] | null> {
  return (await valhallaOptions([location(from), location(to)], 2, signal)) ?? (await osrmOptions([from, to], signal));
}

/**
 * Façon de passer par une ville : par son centre (la rue la plus proche du centre de la commune),
 * ou par la grande route la plus proche (autoroute, voie rapide, nationale : contournement, rocade).
 */
export type ViaMode = 'centre' | 'road';

/**
 * Itinéraire qui passe par ces villes, dans l'ordre. Par le centre : Valhalla, sinon OSRM.
 * Par la grande route : Valhalla seulement (OSRM ne sait pas choisir le type de route).
 */
export async function routeVia(
  from: Point,
  to: Point,
  vias: Point[],
  mode: ViaMode,
  signal?: AbortSignal,
): Promise<RouteOption | null> {
  const through = vias.map((v) => ({
    ...location(v),
    type: 'through', // passage sans arrêt : pas de demi-tour imposé
    ...(mode === 'road' && { search_filter: { min_road_class: 'trunk' } }),
  }));
  const found = await valhallaOptions([location(from), ...through, location(to)], 0, signal);
  if (found) return found[0];
  return mode === 'centre' ? ((await osrmOptions([from, ...vias, to], signal))?.[0] ?? null) : null;
}

/** Distance d'un point au segment [a, b] (en degrés, suffisant pour simplifier un tracé). */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Simplifie un tracé (Douglas-Peucker) pour l'enregistrer en quelques Ko :
 * tolérance en degrés (0,002 ≈ 200 m), coordonnées arrondies à 4 décimales (≈ 10 m).
 */
export function simplify(coords: Point[], tolerance = 0.002): Point[] {
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let max = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(coords[i], coords[first], coords[last]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index >= 0 && max > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return coords.filter((_, i) => keep[i]).map(([lat, lon]) => [round(lat), round(lon)]);
}
