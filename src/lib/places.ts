import type { Place } from '../types';
import { resolveCity } from './geo';
import type { EventStore } from './sync';

/** Les seuls champs de lieu d'une étape. */
export const placeOf = (p: Place): Place => ({
  city: p.city,
  postcode: p.postcode,
  department: p.department,
  country_code: p.country_code,
  lat: p.lat,
  lon: p.lon,
});

/** Vrai si le lieu a changé (autre ville, ou même ville choisie à une autre position). */
export const placeChanged = (a: Place, b: Place) =>
  a.city.trim() !== b.city.trim() || a.lat !== b.lat || a.lon !== b.lon;

/**
 * Ville tapée sans choisir de suggestion : retrouve sa position (centre de la commune)
 * pour la carte, puis complète l'étape.
 */
export function locateLater(store: EventStore, eventId: string, place: Place) {
  const city = place.city.trim();
  if ((place.lat == null || place.lon == null) && city && navigator.onLine) {
    resolveCity(city, place.department)
      .then((found) => found?.lat != null && found.lon != null && store.completePlace(eventId, found))
      .catch(() => {});
  }
}
