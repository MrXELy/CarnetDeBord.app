import { format, parseISO } from 'date-fns';
import type { TripEvent, Waybill } from '../types';
import { formatPlace } from './geo';

/** « Cognac (16) · 12/10 02:00 » */
export function stepLabel(event: TripEvent | null): string {
  if (!event) return 'inconnu';
  const when = format(parseISO(event.occurred_at), 'dd/MM HH:mm');
  const place = formatPlace(event);
  return place ? `${place} · ${when}` : when;
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
