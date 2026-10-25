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
  const city = (p.type === 'city' ? p.name : (p.city ?? p.locality ?? p.name)) ?? '';
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
  // Pays absent (anciennes étapes) : la France, comme sur la feuille de semaine.
  const suffix = !place.country_code || place.country_code === 'FR' ? place.department : place.country_code;
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
    return {
      ...place,
      department: commune.codeDepartement,
      postcode: place.postcode ?? commune.codesPostaux[0] ?? null,
    };
  } catch {
    return place;
  }
}

/** Nom de la commune où se trouve un point (France seulement, sinon null) : nomme un point placé sur la carte. */
export async function communeAt(lat: number, lon: number, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`https://geo.api.gouv.fr/communes?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&fields=nom`, {
      signal,
    });
    const [commune]: { nom?: string }[] = res.ok ? await res.json() : [];
    return commune?.nom ?? null;
  } catch {
    return null;
  }
}

export interface Commune {
  nom: string;
  codeDepartement: string;
  codesPostaux: string[];
  centre?: { coordinates: [number, number] };
  population?: number;
}

export function placeFromCommune(c: Commune, postcode?: string): Place {
  return {
    city: c.nom,
    postcode: postcode ?? c.codesPostaux[0] ?? null,
    department: c.codeDepartement,
    country_code: 'FR',
    lat: c.centre?.coordinates[1] ?? null,
    lon: c.centre?.coordinates[0] ?? null,
  };
}

/** « Saint-Étienne » → « saint etienne », pour comparer sans accents ni tirets. */
const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’\s]+/g, ' ')
    .trim();

/**
 * Classe les communes : nom exact d'abord, puis celles dont le nom commence par la saisie,
 * puis les autres ; à égalité, la plus peuplée d'abord.
 */
export function rankCommunes(communes: Commune[], query: string): Commune[] {
  const q = normalize(query);
  const rank = (c: Commune) => {
    const name = normalize(c.nom);
    return name === q ? 0 : name.startsWith(q) ? 1 : 2;
  };
  return [...communes].sort((a, b) => rank(a) - rank(b) || (b.population ?? 0) - (a.population ?? 0));
}

/** Communes françaises (base officielle), par nom ou par code postal. */
async function searchFrenchCities(query: string, signal?: AbortSignal): Promise<Place[]> {
  const isPostcode = /^\d{5}$/.test(query);
  // L'API favorise les noms courts : on demande large, puis on classe nous-mêmes.
  const filter = isPostcode ? `codePostal=${query}` : `nom=${encodeURIComponent(query)}&boost=population&limit=50`;
  const url = `https://geo.api.gouv.fr/communes?${filter}&fields=nom,codeDepartement,codesPostaux,centre,population`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Recherche de lieu impossible');
  const communes: Commune[] = await res.json();
  return rankCommunes(communes, query)
    .slice(0, 6)
    .map((c) => placeFromCommune(c, isPostcode ? query : undefined));
}

/** Rectangle couvrant l'Europe (ouest, sud, est, nord), pour écarter les homonymes du reste du monde. */
const EUROPE_BBOX = '-25,34,45,72';

export async function searchCities(query: string, europe: boolean, signal?: AbortSignal): Promise<Place[]> {
  if (!europe) return searchFrenchCities(query, signal);
  const url = `${PHOTON}/api/?q=${encodeURIComponent(query)}&lang=fr&limit=6&layer=city&bbox=${EUROPE_BBOX}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Recherche de lieu impossible');
  const data: { features: PhotonFeature[] } = await res.json();
  const places = data.features.map(placeFromPhoton).filter((p) => p.city);
  // Supprime les doublons (même ville, même code postal).
  const unique = places.filter((p, i) => places.findIndex((q) => q.city === p.city && q.postcode === p.postcode) === i);
  return Promise.all(unique.map((p) => completeFrench(p, signal)));
}

/**
 * Retrouve une ville lue sur un document dans la même base que l'autocomplétion, comme si
 * on l'avait choisie dans les suggestions (vrai code postal, vrai département).
 * Le département lu ne sert qu'à départager les homonymes : la base officielle fait foi.
 * Renvoie null si aucune ville ne correspond au nom lu.
 */
export async function resolveCity(city: string, department: string | null): Promise<Place | null> {
  const name = normalize(city);
  if (!name) return null;
  const french = await searchFrenchCities(city).catch(() => []);
  const sameName = french.filter((p) => normalize(p.city) === name);
  const found = sameName.find((p) => p.department === department) ?? sameName[0];
  if (found) return found;
  // Ville étrangère (Espagne, Italie…) : recherche européenne, nom identique exigé.
  const european = await searchCities(city, true).catch(() => []);
  return european.find((p) => normalize(p.city) === name) ?? null;
}

/** « Toulouse (31) » → ville + département ; « Barcelona (ES) » → ville + pays (inverse de formatPlace). */
export function placeFromLabel(label: string): Place {
  const empty = { postcode: null, department: null, country_code: null, lat: null, lon: null };
  const match = /^(.+?)\s*\(([0-9]{2,3}|2[AB]|[A-Z]{2})\)$/.exec(label.trim());
  if (!match) return { ...empty, city: label };
  const [, city, code] = match;
  return /^[A-Z]{2}$/.test(code) && !/^2[AB]$/.test(code)
    ? { ...empty, city, country_code: code }
    : { ...empty, city, department: code, country_code: 'FR' };
}

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Géolocalisation non disponible'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60000,
    });
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
