import type { WaybillReading } from './photos';

/** Champs d'une fiche LV que la lecture peut remplir. */
export interface ReadableFields {
  number: string;
  shipper: string;
  consignee: string;
  planned_city: string;
  goods: string;
  weight_kg: string;
}

export const FIELD_LABELS: Record<keyof ReadableFields, string> = {
  number: 'numéro',
  shipper: 'client chargeur',
  consignee: 'destinataire',
  planned_city: 'ville de livraison',
  goods: 'marchandise',
  weight_kg: 'poids',
};

const text = (v: string | null | undefined) => v?.trim() || '';

/**
 * Noms usuels des clients dont la raison sociale imprimée sur la lettre diffère
 * (ex. les CMR « ETEX France Building Performance SA » sont des chargements Siniat).
 */
const CLIENT_ALIASES: [RegExp, string][] = [[/\betex\b/i, 'Siniat']];

export function clientName(name: string | null | undefined): string {
  const n = text(name);
  return CLIENT_ALIASES.find(([pattern]) => pattern.test(n))?.[1] ?? n;
}

/** « Malemort » + « 19 » → « Malemort (19) ». */
export function cityLabel(city: string | null, department: string | null): string {
  const c = text(city);
  const d = text(department);
  return c && d ? `${c} (${d})` : c;
}

/**
 * Remplit les champs encore vides avec ce qui a été lu sur la photo : rien de ce que
 * l'utilisateur a saisi n'est écrasé. Pour une relecture, `previous` contient les valeurs
 * posées par la lecture précédente : un champ qui les garde encore peut être remplacé.
 */
export function applyReading(
  current: ReadableFields,
  reading: WaybillReading,
  previous: Partial<ReadableFields> = {},
): { fields: ReadableFields; filled: (keyof ReadableFields)[] } {
  const found: ReadableFields = {
    number: text(reading.number).replace(/\s+/g, ''),
    shipper: clientName(reading.shipper_name),
    consignee: clientName(reading.consignee_name),
    planned_city: cityLabel(reading.consignee_city, reading.consignee_department),
    goods: text(reading.goods),
    weight_kg: reading.weight_kg != null && reading.weight_kg > 0 ? String(reading.weight_kg).replace('.', ',') : '',
  };
  const fields = { ...current };
  const filled: (keyof ReadableFields)[] = [];
  for (const key of Object.keys(found) as (keyof ReadableFields)[]) {
    const fromReading = previous[key] !== undefined && current[key] === previous[key];
    if ((!current[key].trim() || fromReading) && found[key]) {
      fields[key] = found[key];
      filled.push(key);
    }
  }
  return { fields, filled };
}
