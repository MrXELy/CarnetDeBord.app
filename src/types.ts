export type EventType = 'debut_journee' | 'chargement' | 'livraison' | 'carburant' | 'fin_journee';

export const EVENT_TYPES: { value: EventType; label: string; short: string }[] = [
  { value: 'debut_journee', label: 'Début de journée', short: 'Début' },
  { value: 'chargement', label: 'Chargement', short: 'Chargement' },
  { value: 'livraison', label: 'Livraison', short: 'Livraison' },
  { value: 'carburant', label: 'Carburant', short: 'Carburant' },
  { value: 'fin_journee', label: 'Fin de journée', short: 'Fin' },
];

export const STATIONS = ['Doumen', 'AS24', 'DKV'] as const;
export type Station = (typeof STATIONS)[number];

export interface Place {
  city: string;
  postcode: string | null;
  department: string | null;
  country_code: string | null;
  lat: number | null;
  lon: number | null;
}

export interface TripEvent extends Place {
  id: string;
  type: EventType;
  occurred_at: string;
  tractor_plate: string;
  trailer_plate: string;
  odometer_km: number | null;
  notes: string | null;
  /** Ancien champ, remplacé par les lettres de voiture (conservé pour les anciennes données). */
  client: string | null;
  /** Ancien champ, remplacé par les lettres de voiture (conservé pour les anciennes données). */
  cmr_number: string | null;
  station: Station | null;
  diesel_l: number | null;
  adblue_l: number | null;
  /** Plein complet (réservoir rempli) ou simple complément ; absent sur les anciennes étapes. */
  full_tank?: boolean | null;
  updated_at: string;
  deleted_at: string | null;
}

/** Lettre de voiture : un chargement → une livraison. */
export interface Waybill {
  id: string;
  /** Étape de chargement (vide si la LV a été créée depuis une livraison). */
  loading_event_id: string | null;
  /** Étape de livraison (vide tant que la LV est dans le camion). */
  delivery_event_id: string | null;
  number: string | null;
  shipper: string | null;
  consignee: string | null;
  planned_city: string | null;
  goods: string | null;
  weight_kg: number | null;
  notes: string | null;
  /** Photos de la lettre, chemins dans le stockage Supabase (« <utilisateur>/<lv>/<photo>.jpg »). */
  photo_paths: string[];
  updated_at: string;
  deleted_at: string | null;
}

export type WaybillStatus = 'a_completer' | 'dans_camion' | 'livree';

export const WAYBILL_STATUS_LABEL: Record<WaybillStatus, string> = {
  a_completer: 'À compléter',
  dans_camion: 'Dans le camion',
  livree: 'Livrée',
};

/** « À compléter » tant qu'il manque le numéro, puis « dans le camion » jusqu'à la livraison. */
export function waybillStatus(w: Waybill): WaybillStatus {
  if (!w.number?.trim()) return 'a_completer';
  return w.delivery_event_id ? 'livree' : 'dans_camion';
}

export const isInTruck = (w: Waybill) => !w.delivery_event_id;

export function newWaybill(extra: Partial<Waybill> = {}): Waybill {
  return {
    id: crypto.randomUUID(),
    loading_event_id: null,
    delivery_event_id: null,
    number: null,
    shipper: null,
    consignee: null,
    planned_city: null,
    goods: null,
    weight_kg: null,
    notes: null,
    photo_paths: [],
    updated_at: '',
    deleted_at: null,
    ...extra,
  };
}

export function eventTypeInfo(type: EventType) {
  return EVENT_TYPES.find((t) => t.value === type)!;
}

export const isDayBoundary = (type: EventType) => type === 'debut_journee' || type === 'fin_journee';

/** Tronçon de la carte : le trajet d'un jour, en points [latitude, longitude]. */
export interface MapLeg {
  /** Jour (« 2026-01-26 »). */
  day: string;
  coords: [number, number][];
}

/** Carte d'une semaine : itinéraires calculés une fois puis enregistrés. */
export interface WeekMap {
  id: string;
  /** Début de la semaine de travail (dimanche 22h). */
  week_start: string;
  /** Empreinte des étapes utilisées : si elle change, la carte est à régénérer. */
  stops_hash: string;
  legs: MapLeg[];
  generated_at: string;
  updated_at: string;
  deleted_at: string | null;
}
