export type EventType = 'debut_journee' | 'chargement' | 'livraison' | 'carburant' | 'fin_journee';

export const EVENT_TYPES: { value: EventType; label: string; icon: string }[] = [
  { value: 'debut_journee', label: 'Début de journée', icon: '☀️' },
  { value: 'chargement', label: 'Chargement', icon: '📦' },
  { value: 'livraison', label: 'Livraison', icon: '🏁' },
  { value: 'carburant', label: 'Carburant', icon: '⛽' },
  { value: 'fin_journee', label: 'Fin de journée', icon: '🌙' },
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
  client: string | null;
  cmr_number: string | null;
  station: Station | null;
  diesel_l: number | null;
  adblue_l: number | null;
  updated_at: string;
  deleted_at: string | null;
}

export function eventTypeInfo(type: EventType) {
  return EVENT_TYPES.find((t) => t.value === type)!;
}
