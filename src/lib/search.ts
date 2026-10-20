import { eventTypeInfo, type TripEvent, type Waybill } from '../types';
import { formatPlace } from './geo';

/** Minuscules et sans accents : « Périgueux » et « perigueux » se retrouvent. */
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Mots de la recherche, normalisés. */
export const searchTerms = (query: string) => normalize(query).split(/\s+/).filter(Boolean);

/** Plaque sans tirets ni espaces : « AB123 » retrouve « AB-123-CD ». */
const compact = (s: string) => s.replace(/[\s-]/g, '');

export interface SearchResult {
  event: TripEvent;
  /** LV de l'étape (chargées ou livrées ici) qui contiennent un des mots cherchés. */
  waybills: Waybill[];
}

function waybillText(w: Waybill): string {
  return normalize(
    [w.number && `lv ${w.number}`, w.number, w.shipper, w.consignee, w.planned_city, w.goods, w.notes]
      .filter(Boolean)
      .join(' '),
  );
}

function eventText(e: TripEvent): string {
  return normalize(
    [
      eventTypeInfo(e.type).label,
      formatPlace(e),
      e.postcode,
      e.notes,
      e.station,
      e.tractor_plate,
      compact(e.tractor_plate),
      e.trailer_plate,
      compact(e.trailer_plate),
      e.odometer_km?.toString(),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * Étapes qui contiennent tous les mots cherchés, dans l'étape elle-même ou dans ses LV
 * (« livraison toulouse », « plâtre », « LV 1234 », une plaque…). Les plus récentes en premier.
 */
export function searchEvents(events: TripEvent[], waybills: Waybill[], query: string): SearchResult[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  // LV rattachées à chaque étape, par son chargement et par sa livraison.
  const byEvent = new Map<string, { waybill: Waybill; text: string }[]>();
  for (const w of waybills) {
    const entry = { waybill: w, text: waybillText(w) };
    for (const id of new Set([w.loading_event_id, w.delivery_event_id])) {
      if (!id) continue;
      const list = byEvent.get(id);
      if (list) list.push(entry);
      else byEvent.set(id, [entry]);
    }
  }

  const results: SearchResult[] = [];
  for (const event of events) {
    const own = eventText(event);
    const linked = byEvent.get(event.id) ?? [];
    const text = [own, ...linked.map((l) => l.text)].join(' ');
    if (!terms.every((t) => text.includes(t))) continue;
    results.push({
      event,
      waybills: linked.filter((l) => terms.some((t) => l.text.includes(t))).map((l) => l.waybill),
    });
  }
  return results.sort((a, b) => b.event.occurred_at.localeCompare(a.event.occurred_at));
}
