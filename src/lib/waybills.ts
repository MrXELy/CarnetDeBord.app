import type { Waybill } from '../types';

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
