import type { Place } from '../types';

const PHOTON = 'https://photon.komoot.io';

/** Numéro de département français à partir du code postal (2A/2B pour la Corse, 3 chiffres pour l'outre-mer). */
export function departmentFromPostcode(postcode: string | null | undefined): string | null {
  const cp = postcode?.trim();
  if (!cp || !/^\d{5}$/.test(cp)) return null;
  if (cp.startsWith('20')) return Number(cp.slice(0, 3)) <= 201 ? '2A' : '2B';
  if (cp.startsWith('97') || cp.startsWith('98')) return cp.slice(0, 3);
  return cp.slice(0, 2);
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    city?: string;
    locality?: string;
    postcode?: string;
    countrycode?: string;
    type?: string;
  };
}

export function placeFromPhoton(f: PhotonFeature): Place {
  const p = f.properties;
  const city = (p.type === 'city' ? p.name : p.city ?? p.locality ?? p.name) ?? '';
  const postcode = p.postcode?.split(/[;,]/)[0].trim() || null;
  const country = p.countrycode?.toUpperCase() ?? null;
  return {
    city,
    postcode,
    department: country === 'FR' ? departmentFromPostcode(postcode) : null,
    country_code: country,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  };
}

/** Texte court du lieu : « Lyon (69) » en France, « Barcelona (ES) » ailleurs. */
export function formatPlace(place: Pick<Place, 'city' | 'department' | 'country_code'>): string {
  if (!place.city) return '';
  const suffix = place.country_code === 'FR' ? place.department : place.country_code;
  return suffix ? `${place.city} (${suffix})` : place.city;
}

/**
 * En France, les grandes villes n'ont pas de code postal dans OpenStreetMap :
 * on retrouve alors la commune et son département via l'API officielle geo.api.gouv.fr.
 */
async function completeFrench(place: Place, signal?: AbortSignal): Promise<Place> {
  if (place.country_code !== 'FR' || place.department || place.lat == null || place.lon == null) return place;
  try {
    const url = `https://geo.api.gouv.fr/communes?lat=${place.lat}&lon=${place.lon}&fields=codeDepartement,codesPostaux`;
    const res = await fetch(url, { signal });
    const [commune]: { codeDepartement: string; codesPostaux: string[] }[] = res.ok ? await res.json() : [];
    if (!commune) return place;
    return { ...place, department: commune.codeDepartement, postcode: place.postcode ?? commune.codesPostaux[0] ?? null };
  } catch {
    return place;
  }
}

export async function searchCities(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `${PHOTON}/api/?q=${encodeURIComponent(query)}&lang=fr&limit=6&layer=city`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Recherche de lieu impossible');
  const data: { features: PhotonFeature[] } = await res.json();
  const places = data.features.map(placeFromPhoton).filter((p) => p.city);
  // Supprime les doublons (même ville, même code postal).
  const unique = places.filter((p, i) => places.findIndex((q) => q.city === p.city && q.postcode === p.postcode) === i);
  return Promise.all(unique.map((p) => completeFrench(p, signal)));
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Géolocalisation non disponible'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

export async function locateMe(): Promise<Place> {
  const pos = await currentPosition();
  const { latitude, longitude } = pos.coords;
  const res = await fetch(`${PHOTON}/reverse?lat=${latitude}&lon=${longitude}&lang=fr`);
  if (!res.ok) throw new Error('Lieu introuvable');
  const data: { features: PhotonFeature[] } = await res.json();
  if (!data.features.length) throw new Error('Lieu introuvable');
  return completeFrench({ ...placeFromPhoton(data.features[0]), lat: latitude, lon: longitude });
}
