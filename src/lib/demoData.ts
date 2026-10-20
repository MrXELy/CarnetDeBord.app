import { newWaybill, type TripEvent, type Waybill } from '../types';
import type { AllowanceSettings } from './allowances';
import type { ReminderSettings } from './reminders';
import type { SyncState } from './sync';
import type { SheetSettings } from './weekSheet';

/**
 * Contenu de data/demo-events.json pour le mode démo. L'ancien format (la liste des étapes seule) est encore lu.
 * Les photos des LV n'y sont pas : elles restent dans le navigateur.
 */
export interface DemoData {
  events: TripEvent[];
  waybills?: Waybill[];
  settings?: {
    allowances?: AllowanceSettings | null;
    week_sheet?: SheetSettings | null;
    reminders?: ReminderSettings | null;
  };
}

/** Étape d'avant les LV : client et n° de LV notés sur l'étape (colonnes retirées par la migration 011). */
type LegacyEvent = TripEvent & { client?: string | null; cmr_number?: string | null };

export function readDemoData(data: LegacyEvent[] | DemoData): DemoData {
  const demo: DemoData = Array.isArray(data) ? { events: data } : data;
  const legacy = legacyWaybills(demo.events, demo.waybills ?? []);
  return legacy.length ? { ...demo, waybills: [...(demo.waybills ?? []), ...legacy] } : demo;
}

/**
 * LV faites d'après les anciennes étapes sans LV (client et n° notés sur l'étape) : une par chargement,
 * avec le client comme chargeur ; chaque livraison livre la plus ancienne de ces LV encore dans le camion
 * (son client devient le destinataire), ou à défaut une LV à elle. Les étapes déjà reliées à une LV sont laissées.
 */
export function legacyWaybills(events: LegacyEvent[], waybills: Waybill[]): Waybill[] {
  const linked = new Set(
    waybills.filter((w) => !w.deleted_at).flatMap((w) => [w.loading_event_id, w.delivery_event_id]),
  );
  const text = (v: string | null | undefined) => v?.trim() || null;
  const inTruck: Waybill[] = [];
  const made: Waybill[] = [];
  const steps = events
    .filter((e) => !e.deleted_at && !linked.has(e.id))
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  for (const e of steps) {
    const client = text(e.client);
    const number = text(e.cmr_number);
    if (e.type === 'chargement' && (client || number)) {
      const w = newWaybill({ loading_event_id: e.id, shipper: client, number });
      inTruck.push(w);
      made.push(w);
    } else if (e.type === 'livraison') {
      const w = inTruck.shift();
      if (w) Object.assign(w, { delivery_event_id: e.id, consignee: client, number: w.number ?? number });
      else if (client || number) made.push(newWaybill({ delivery_event_id: e.id, consignee: client, number }));
    }
  }
  return made;
}

/** Données de démo actuelles (étapes, LV, réglages), à recopier dans data/demo-events.json pour les garder. */
export const demoSnapshot = (state: SyncState): DemoData => ({
  events: state.events,
  waybills: state.waybills,
  settings: {
    allowances: state.allowanceSettings,
    week_sheet: state.sheetSettings,
    reminders: state.reminderSettings,
  },
});
