import { format, parseISO } from 'date-fns';
import type { Place, TripEvent, Waybill } from '../types';
import { formatPlace } from './geo';

/** Lieu et date d'une étape, enregistrée ou en cours de saisie (date absente si le champ est vide). */
export interface StepStop {
  place: Pick<Place, 'city' | 'department' | 'country_code'>;
  at: string | null;
}

/** « Narbonne (11) · 12/10 02:00 » */
function stopLabel({ place, at }: StepStop): string {
  const when = at ? format(parseISO(at), 'dd/MM HH:mm') : '';
  const where = formatPlace(place);
  return [where, when].filter(Boolean).join(' · ') || 'inconnu';
}

/** Étape enregistrée vue comme un lieu et une date. */
export function stopOf(event: TripEvent | null): StepStop | null {
  return event ? { place: event, at: event.occurred_at } : null;
}

/**
 * Pastille en haut d'une fiche LV, la même d'où qu'on l'ouvre (page LV, chargement, livraison) :
 * « Chargée : Narbonne (11) · 16/10 06:30 », puis à la ligne « Livrée : Toulouse (31) · 19/10 10:23 » ou « À livrer ».
 */
export function waybillContext(loading: StepStop | null | undefined, delivery: StepStop | null | undefined): string {
  return [
    loading ? `Chargée : ${stopLabel(loading)}` : 'Chargement non renseigné',
    delivery ? `Livrée : ${stopLabel(delivery)}` : 'À livrer',
  ].join('\n');
}

/** LV encore vide : créée automatiquement au chargement, sans rien de saisi ni de photo. */
export function isBlankWaybill(w: Waybill): boolean {
  return (
    !w.number?.trim() &&
    !w.shipper?.trim() &&
    !w.consignee?.trim() &&
    !w.planned_city?.trim() &&
    !w.goods?.trim() &&
    w.weight_kg == null &&
    !w.notes?.trim() &&
    w.photo_paths.length === 0
  );
}

/** Nom court d'une LV : client, sinon expéditeur, sinon numéro. */
export function waybillTitle(w: Waybill): string {
  return w.consignee || w.shipper || (w.number ? `LV ${w.number}` : 'Client non renseigné');
}

/** Noms des LV d'une étape, sans doublon (« Placoplâtre, Knauf ») : chargeurs ou destinataires. */
export function namesOf(waybills: Waybill[], side: 'shipper' | 'consignee'): string {
  return [...new Set(waybills.map((w) => w[side]?.trim()).filter(Boolean))].join(', ');
}
