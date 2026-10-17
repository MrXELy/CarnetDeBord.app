/** Service public de calcul d'itinéraire (OSRM, profil voiture). */
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

type Point = [number, number];

/**
 * Itinéraire réel passant par ces points, dans l'ordre ([latitude, longitude]).
 * Renvoie null si le service ne répond pas ou ne trouve pas d'itinéraire.
 */
export async function routeLeg(points: Point[], signal?: AbortSignal): Promise<Point[] | null> {
  if (points.length < 2) return null;
  const path = points.map(([lat, lon]) => `${lon.toFixed(5)},${lat.toFixed(5)}`).join(';');
  try {
    const res = await fetch(`${OSRM}/${path}?overview=full&geometries=geojson`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    const coords: unknown = data?.routes?.[0]?.geometry?.coordinates;
    if (data?.code !== 'Ok' || !Array.isArray(coords) || coords.length < 2) return null;
    return (coords as [number, number][]).map(([lon, lat]) => [lat, lon]);
  } catch {
    return null;
  }
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
