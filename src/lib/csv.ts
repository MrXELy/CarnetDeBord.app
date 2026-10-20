import { format, parseISO } from 'date-fns';
import { WAYBILL_STATUS_LABEL, eventTypeInfo, waybillStatus, type TripEvent, type Waybill } from '../types';
import { isFullTank } from './fuel';
import { formatPlace } from './geo';

type Value = string | number | null;
type Columns<T> = [string, (item: T) => Value][];

const day = (iso: string) => format(parseISO(iso), 'dd/MM/yyyy');
const hour = (iso: string) => format(parseISO(iso), 'HH:mm');

function cell(value: Value): string {
  if (value == null) return '';
  // Virgule décimale, comme l'attend Excel en français.
  const text = typeof value === 'number' ? String(value).replace('.', ',') : value;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV prêt pour Excel en français : séparateur « ; » et BOM UTF-8 pour les accents. */
function toCsv<T>(columns: Columns<T>, items: T[]): string {
  const rows = items.map((item) => columns.map(([, get]) => cell(get(item))).join(';'));
  return '﻿' + [columns.map(([name]) => name).join(';'), ...rows].join('\r\n') + '\r\n';
}

/** LV d'une étape : chargées (chargement) ou livrées (livraison). */
function waybillsOf(e: TripEvent, waybills: Waybill[]): Waybill[] {
  return waybills.filter(
    (w) =>
      !w.deleted_at &&
      ((e.type === 'chargement' && w.loading_event_id === e.id) ||
        (e.type === 'livraison' && w.delivery_event_id === e.id)),
  );
}

const joined = (values: (string | null)[]) => values.filter(Boolean).join(', ') || null;

/** Une ligne par étape, dans l'ordre chronologique. */
export function eventsToCsv(events: TripEvent[], waybills: Waybill[] = []): string {
  const columns: Columns<TripEvent> = [
    ['Date', (e) => day(e.occurred_at)],
    ['Heure', (e) => hour(e.occurred_at)],
    ['Type', (e) => eventTypeInfo(e.type).label],
    ['Tracteur', (e) => e.tractor_plate],
    ['Remorque', (e) => e.trailer_plate],
    ['Kilométrage', (e) => e.odometer_km],
    ['Ville', (e) => e.city],
    ['Code postal', (e) => e.postcode],
    ['Département', (e) => e.department],
    ['Pays', (e) => e.country_code],
    ['Client', (e) => joined(waybillsOf(e, waybills).map((w) => w.consignee))],
    ['N° lettre de voiture', (e) => joined(waybillsOf(e, waybills).map((w) => w.number))],
    ['Station', (e) => e.station],
    ['Gasoil (L)', (e) => e.diesel_l],
    ['Plein complet', (e) => (e.type === 'carburant' ? (isFullTank(e) ? 'Oui' : 'Non') : null)],
    ['AdBlue (L)', (e) => e.adblue_l],
    ['Remarques', (e) => e.notes],
  ];
  return toCsv(
    columns,
    events.filter((e) => !e.deleted_at).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
  );
}

/** Une ligne par lettre de voiture, triées par date de chargement. */
export function waybillsToCsv(waybills: Waybill[], events: TripEvent[]): string {
  const byId = new Map(events.filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  const loading = (w: Waybill) => (w.loading_event_id ? byId.get(w.loading_event_id) : undefined);
  const delivery = (w: Waybill) => (w.delivery_event_id ? byId.get(w.delivery_event_id) : undefined);
  const columns: Columns<Waybill> = [
    ['N° lettre de voiture', (w) => w.number],
    ['Expéditeur', (w) => w.shipper],
    ['Client', (w) => w.consignee],
    ['Marchandise', (w) => w.goods],
    ['Poids (kg)', (w) => w.weight_kg],
    ['Date chargement', (w) => (loading(w) ? day(loading(w)!.occurred_at) : null)],
    ['Heure chargement', (w) => (loading(w) ? hour(loading(w)!.occurred_at) : null)],
    ['Lieu chargement', (w) => (loading(w) ? formatPlace(loading(w)!) : null)],
    ['Ville prévue', (w) => w.planned_city],
    ['Date livraison', (w) => (delivery(w) ? day(delivery(w)!.occurred_at) : null)],
    ['Heure livraison', (w) => (delivery(w) ? hour(delivery(w)!.occurred_at) : null)],
    ['Lieu livraison', (w) => (delivery(w) ? formatPlace(delivery(w)!) : null)],
    ['Statut', (w) => WAYBILL_STATUS_LABEL[waybillStatus(w)]],
    ['Remarque', (w) => w.notes],
  ];
  const dateOf = (w: Waybill) => loading(w)?.occurred_at ?? delivery(w)?.occurred_at ?? '';
  return toCsv(
    columns,
    waybills.filter((w) => !w.deleted_at).sort((a, b) => dateOf(a).localeCompare(dateOf(b))),
  );
}

export function downloadCsv(content: string, name: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
