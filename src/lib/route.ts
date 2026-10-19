/**
 * Services publics de calcul d'itinéraire :
 * - Valhalla (FOSSGIS), profil voiture, qui propose d'autres itinéraires ;
 * - OSRM, profil voiture, en secours : son serveur public ne propose jamais d'autre itinéraire.
 */
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

type Point = [number, number];

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

/** Itinéraires Valhalla (profil voiture) : le principal puis jusqu'à 2 autres. */
async function valhallaOptions(from: Point, to: Point, signal?: AbortSignal): Promise<RouteOption[] | null> {
  const request = {
    locations: [from, to].map(([lat, lon]) => ({ lat: +lat.toFixed(5), lon: +lon.toFixed(5) })),
    costing: 'auto',
    alternates: 2,
    units: 'kilometers',
    directions_type: 'none',
  };
  try {
    // Requête GET (paramètre json) : pas de demande préalable du navigateur.
    const res = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(request))}`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const trips: unknown[] = [
      data?.trip,
      ...(Array.isArray(data?.alternates) ? data.alternates.map((a: { trip?: unknown }) => a?.trip) : []),
    ];
    const options: RouteOption[] = [];
    for (const trip of trips as { legs?: { shape?: unknown }[]; summary?: { length?: unknown; time?: unknown } }[]) {
      const shape = trip?.legs?.[0]?.shape;
      const km = trip?.summary?.length;
      if (typeof shape !== 'string' || typeof km !== 'number') continue;
      const coords = decodePolyline6(shape);
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

/** Itinéraire OSRM (profil voiture), un seul. */
async function osrmOptions(from: Point, to: Point, signal?: AbortSignal): Promise<RouteOption[] | null> {
  const path = [from, to].map(([lat, lon]) => `${lon.toFixed(5)},${lat.toFixed(5)}`).join(';');
  try {
    const res = await fetch(`${OSRM}/${path}?overview=full&geometries=geojson`, { signal });
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
  return (await valhallaOptions(from, to, signal)) ?? (await osrmOptions(from, to, signal));
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
