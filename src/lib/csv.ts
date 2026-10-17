import { format, parseISO } from 'date-fns';
import { eventTypeInfo, type TripEvent } from '../types';

const COLUMNS: [string, (e: TripEvent) => string | number | null][] = [
  ['Date', (e) => format(parseISO(e.occurred_at), 'dd/MM/yyyy')],
  ['Heure', (e) => format(parseISO(e.occurred_at), 'HH:mm')],
  ['Type', (e) => eventTypeInfo(e.type).label],
  ['Tracteur', (e) => e.tractor_plate],
  ['Remorque', (e) => e.trailer_plate],
  ['Kilométrage', (e) => e.odometer_km],
  ['Ville', (e) => e.city],
  ['Code postal', (e) => e.postcode],
  ['Département', (e) => e.department],
  ['Pays', (e) => e.country_code],
  ['Client', (e) => e.client],
  ['N° lettre de voiture', (e) => e.cmr_number],
  ['Station', (e) => e.station],
  ['Gasoil (L)', (e) => e.diesel_l],
  ['AdBlue (L)', (e) => e.adblue_l],
  ['Remarques', (e) => e.notes],
];

function cell(value: string | number | null): string {
  if (value == null) return '';
  // Virgule décimale, comme l'attend Excel en français.
  const text = typeof value === 'number' ? String(value).replace('.', ',') : value;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV prêt pour Excel en français : séparateur « ; », BOM UTF-8 pour les accents,
 * étapes dans l'ordre chronologique.
 */
export function eventsToCsv(events: TripEvent[]): string {
  const rows = events
    .filter((e) => !e.deleted_at)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .map((e) => COLUMNS.map(([, get]) => cell(get(e))).join(';'));
  return '﻿' + [COLUMNS.map(([name]) => name).join(';'), ...rows].join('\r\n') + '\r\n';
}

export function downloadCsv(events: TripEvent[]) {
  const blob = new Blob([eventsToCsv(events)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `carnetdebord-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
