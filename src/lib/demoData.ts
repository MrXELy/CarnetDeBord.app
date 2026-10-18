import type { TripEvent, Waybill } from '../types';
import type { AllowanceSettings } from './allowances';
import type { SyncState } from './sync';
import type { SheetSettings } from './weekSheet';

/**
 * Contenu de data/demo-events.json pour le mode démo. L'ancien format (la liste des étapes seule) est encore lu.
 * Les photos des LV n'y sont pas : elles restent dans le navigateur.
 */
export interface DemoData {
  events: TripEvent[];
  waybills?: Waybill[];
  settings?: { allowances?: AllowanceSettings | null; week_sheet?: SheetSettings | null };
}

export const readDemoData = (data: TripEvent[] | DemoData): DemoData => (Array.isArray(data) ? { events: data } : data);

/** Données de démo actuelles (étapes, LV, réglages), à recopier dans data/demo-events.json pour les garder. */
export const demoSnapshot = (state: SyncState): DemoData => ({
  events: state.events,
  waybills: state.waybills,
  settings: { allowances: state.allowanceSettings, week_sheet: state.sheetSettings },
});
