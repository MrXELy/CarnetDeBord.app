import type { Place, TripEvent } from '../types';
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

/** Étapes d'une LV modifiables depuis sa fiche : lieu et date du chargement, date de la livraison (ISO). */
export interface LinkedSteps {
  loading?: { place: Place; at: string | null };
  delivery?: { at: string | null };
}

/** Ce qui a été changé sur ces étapes depuis la fiche LV (dates en ISO). */
export interface StepChanges {
  loadingPlace?: Place;
  loadingAt?: string;
  deliveryAt?: string;
  /** LV sans étape de chargement : chargement à créer (son id est déjà dans la LV). */
  newLoading?: NewLoading;
}

export interface NewLoading {
  id: string;
  place: Place;
  /** ISO */
  at: string;
}

/** Étape de chargement créée depuis la fiche d'une LV qui n'en avait pas (sans km). */
export function addLoadingStep(store: EventStore, step: NewLoading, plates: { tractor: string; trailer: string }) {
  const event: TripEvent = {
    ...placeOf(step.place),
    id: step.id,
    type: 'chargement',
    occurred_at: step.at,
    tractor_plate: plates.tractor,
    trailer_plate: plates.trailer,
    odometer_km: null,
    notes: null,
    station: null,
    diesel_l: null,
    adblue_l: null,
    full_tank: null,
    updated_at: '',
    deleted_at: null,
  };
  store.save(event);
  locateLater(store, step.id, step.place);
}

/**
 * Enregistre sur des étapes déjà enregistrées les changements faits depuis une fiche LV,
 * et crée l'étape de chargement demandée (avant la LV qui y fait référence).
 */
export function applyStepChanges(
  store: EventStore,
  loadingId: string | null | undefined,
  deliveryId: string | null | undefined,
  changes: StepChanges,
  plates = store.lastPlates(),
) {
  if (changes.newLoading) addLoadingStep(store, changes.newLoading, plates);
  if (loadingId && changes.loadingPlace) {
    store.setEventPlace(loadingId, changes.loadingPlace);
    locateLater(store, loadingId, changes.loadingPlace);
  }
  if (loadingId && changes.loadingAt) store.setEventTime(loadingId, changes.loadingAt);
  if (deliveryId && changes.deliveryAt) store.setEventTime(deliveryId, changes.deliveryAt);
}
