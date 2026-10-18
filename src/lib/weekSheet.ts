import { addDays, addHours, getDay, getISOWeek, parseISO, startOfDay } from 'date-fns';
import type { TripEvent, Waybill } from '../types';
import { workDay } from './dates';
import { isFullTank } from './fuel';

/** Réglages de la feuille de semaine (Options), partagés entre les appareils. */
export interface SheetSettings {
  /** Nom du conducteur, écrit tel quel (« DUPONT Jean »). */
  driver: string;
  /** Agence de rattachement. */
  agency: string;
  /** Colonnes « Dépôts » de la page carburant (5 au plus). */
  depots: SheetDepot[];
}

export interface SheetDepot {
  /** Titre de la colonne. */
  label: string;
  /** Villes des pleins rangés dans cette colonne, séparées par des virgules (vide : le titre lui-même). */
  cities: string;
}

/** Nombre de colonnes « Dépôts » sur la feuille. */
export const DEPOT_COUNT = 5;
/** Colonnes « Sur route », après les dépôts. */
export const ROAD_COLUMNS = ['AS 24', 'DKV', 'Divers'] as const;
const AS24 = DEPOT_COUNT;
const DKV = DEPOT_COUNT + 1;
const DIVERS = DEPOT_COUNT + 2;

export const DEFAULT_SHEET_SETTINGS: SheetSettings = { driver: '', agency: '', depots: [] };

/** Page 1 : départ d'une journée. */
export interface Departure {
  date: Date;
  place: string;
  km: number | null;
}

/** Pages 2-3 : une ligne (chargement, livraison, ou livraison de plus sous la même ligne). */
export interface OpRow {
  trailer: string;
  shipper: string;
  shipperPlace: string;
  shipperKm: number | null;
  consignee: string;
  consigneePlace: string;
  consigneeKm: number | null;
  goods: string;
  weightKg: number | null;
  number: string;
}

/** Page 4 : une prise de carburant. */
export interface FuelLine {
  date: Date;
  tractor: string;
  km: number | null;
  /** Plein complet (croix OUI ou NON) ; vide si seulement de l'AdBlue. */
  full: boolean | null;
  /** Colonne des litres : 0-4 dépôts, puis AS 24, DKV, Divers. */
  column: number;
  litres: number | null;
  adblue: number | null;
}

export interface WeekSheet {
  week: number;
  monday: Date;
  saturday: Date;
  driver: string;
  agency: string;
  tractor: string;
  /** Page 1 : Dimanche, Lundi … Samedi. */
  departures: (Departure | null)[];
  /** Pages 2-3 : Lundi … Samedi. */
  operations: OpRow[][];
  /** Page 4. */
  startPlace: string;
  endPlace: string;
  startKm: number | null;
  endKm: number | null;
  totalKm: number | null;
  depotLabels: string[];
  /** Lundi … Dimanche. */
  fuel: FuelLine[][];
  totalLitres: number;
}

/** Plaque écrite comme sur papier : « AB-123-CD » → « AB 123 CD ». */
export const sheetPlate = (plate: string | null | undefined) => (plate ?? '').trim().replace(/-/g, ' ');

/** Lieu écrit comme sur papier : « Narbonne 11 », ou le pays hors de France (« Irun ES »). */
export function sheetPlace(e: Pick<TripEvent, 'city' | 'department' | 'country_code'>): string {
  if (!e.city) return '';
  const suffix = !e.country_code || e.country_code === 'FR' ? e.department : e.country_code;
  return suffix ? `${e.city} ${suffix}` : e.city;
}

/** Sans accents, majuscules ni tirets, pour comparer des noms de villes. */
const plain = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

/** Colonne des litres : AS24 et DKV ont la leur, sinon le dépôt de la ville du plein, sinon Divers. */
export function fuelColumn(e: Pick<TripEvent, 'station' | 'city'>, depots: SheetDepot[]): number {
  if (e.station === 'AS24') return AS24;
  if (e.station === 'DKV') return DKV;
  const city = ` ${plain(e.city ?? '')} `;
  const index = depots.slice(0, DEPOT_COUNT).findIndex((d) =>
    (d.cities.trim() || d.label)
      .split(',')
      .map(plain)
      .some((name) => name && city.includes(` ${name} `)),
  );
  return index >= 0 ? index : DIVERS;
}

const names = (list: Waybill[], side: 'shipper' | 'consignee' | 'goods' | 'number') =>
  [...new Set(list.map((w) => w[side]?.trim()).filter(Boolean))].join(', ');

/** Nature, poids et n° des LV d'une étape : plusieurs LV sont réunies (natures et n° à la suite, poids additionnés). */
function lvInfo(list: Waybill[], e: TripEvent): Pick<OpRow, 'goods' | 'weightKg' | 'number'> {
  const weights = list.map((w) => w.weight_kg).filter((w): w is number => w != null);
  return {
    goods: names(list, 'goods'),
    weightKg: weights.length ? weights.reduce((a, b) => a + b, 0) : null,
    number: names(list, 'number') || e.cmr_number?.trim() || '',
  };
}

const emptyRow = (): OpRow => ({
  trailer: '',
  shipper: '',
  shipperPlace: '',
  shipperKm: null,
  consignee: '',
  consigneePlace: '',
  consigneeKm: null,
  goods: '',
  weightKg: null,
  number: '',
});

/**
 * Lignes d'une journée (pages 2-3), dans l'ordre des heures : chaque chargement ouvre une ligne ; une livraison
 * va sur la ligne de son chargement s'il a eu lieu le même jour (LV, ou à défaut le dernier chargement du jour
 * pour les anciennes étapes sans LV), sinon sur sa propre ligne. Les livraisons suivantes d'une même ligne
 * s'ajoutent dessous, sans remorque ni expéditeur. Chaque ligne de livraison reprend la nature, le poids et le n°
 * de ses LV.
 */
function dayRows(events: TripEvent[], loaded: Map<string, Waybill[]>, delivered: Map<string, Waybill[]>): OpRow[] {
  const rows: OpRow[] = [];
  // Ligne de chaque chargement du jour, et dernière ligne de son groupe (pour ajouter dessous).
  const loadingRow = new Map<string, OpRow>();
  const groupEnd = new Map<OpRow, OpRow>();
  let lastLoading: OpRow | null = null;
  // Livraisons qui se suivent sans chargement du jour : une seule ligne avec remorque, les autres dessous.
  let ownGroup: OpRow | null = null;

  const addUnder = (head: OpRow, row: OpRow) => {
    rows.splice(rows.indexOf(groupEnd.get(head) ?? head) + 1, 0, row);
    groupEnd.set(head, row);
  };

  for (const e of events) {
    if (e.type === 'chargement') {
      const list = loaded.get(e.id) ?? [];
      const row: OpRow = {
        ...emptyRow(),
        trailer: sheetPlate(e.trailer_plate),
        shipper: names(list, 'shipper') || e.client?.trim() || '',
        shipperPlace: sheetPlace(e),
        shipperKm: e.odometer_km,
        ...lvInfo(list, e),
      };
      rows.push(row);
      loadingRow.set(e.id, row);
      lastLoading = row;
      ownGroup = null;
    } else if (e.type === 'livraison') {
      const list = delivered.get(e.id) ?? [];
      const delivery = {
        consignee: names(list, 'consignee') || e.client?.trim() || '',
        consigneePlace: sheetPlace(e),
        consigneeKm: e.odometer_km,
      };
      // Une ligne de livraison répète la nature, le poids et le n° de ses LV (sauf sur la ligne de son chargement).
      const ownLine = { ...emptyRow(), ...lvInfo(list, e), ...delivery };
      const loadingId = list.map((w) => w.loading_event_id).find((id) => id && loadingRow.has(id));
      const head = loadingId ? loadingRow.get(loadingId)! : list.length === 0 ? lastLoading : null;
      if (head) {
        if (!head.consignee && !head.consigneePlace && head.consigneeKm == null) Object.assign(head, delivery);
        else addUnder(head, ownLine);
        ownGroup = null;
      } else if (ownGroup) {
        addUnder(ownGroup, ownLine);
      } else {
        ownGroup = { ...ownLine, trailer: sheetPlate(e.trailer_plate) };
        rows.push(ownGroup);
      }
    }
  }
  return rows;
}

/** Plaque la plus fréquente de la semaine (la feuille est faite pour un tracteur). */
function mainTractor(events: TripEvent[]): string {
  const count = new Map<string, number>();
  for (const e of events) if (e.tractor_plate) count.set(e.tractor_plate, (count.get(e.tractor_plate) ?? 0) + 1);
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return sheetPlate(best?.[0]);
}

/** Feuille de semaine de la semaine qui commence à `start` (dimanche 22h). */
export function buildWeekSheet(
  allEvents: TripEvent[],
  waybills: Waybill[],
  start: Date,
  settings: SheetSettings,
): WeekSheet {
  const end = addDays(start, 7);
  const events = allEvents
    .filter((e) => {
      if (e.deleted_at) return false;
      const d = parseISO(e.occurred_at);
      return d >= start && d < end;
    })
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const monday = startOfDay(addHours(start, 2));

  const loaded = new Map<string, Waybill[]>();
  const delivered = new Map<string, Waybill[]>();
  for (const w of waybills) {
    if (w.deleted_at) continue;
    if (w.loading_event_id) loaded.set(w.loading_event_id, [...(loaded.get(w.loading_event_id) ?? []), w]);
    if (w.delivery_event_id) delivered.set(w.delivery_event_id, [...(delivered.get(w.delivery_event_id) ?? []), w]);
  }

  // Page 1 : premier début de journée de chaque jour ; un départ le dimanche soir va sur la ligne Dimanche.
  const departures: (Departure | null)[] = Array(7).fill(null);
  for (const e of events) {
    if (e.type !== 'debut_journee') continue;
    const date = parseISO(e.occurred_at);
    const i = getDay(date);
    departures[i] ??= { date, place: sheetPlace(e), km: e.odometer_km };
  }

  // Pages 2-3 : Lundi … Samedi (un dimanche en fin de semaine reste avec le samedi).
  const byDay: TripEvent[][] = Array.from({ length: 6 }, () => []);
  // Page 4 : Lundi … Dimanche.
  const fuel: FuelLine[][] = Array.from({ length: 7 }, () => []);
  for (const e of events) {
    const weekday = getDay(workDay(parseISO(e.occurred_at)));
    if (e.type === 'chargement' || e.type === 'livraison') byDay[weekday === 0 ? 5 : weekday - 1].push(e);
    if (e.type === 'carburant' && (e.diesel_l != null || e.adblue_l != null)) {
      fuel[weekday === 0 ? 6 : weekday - 1].push({
        date: parseISO(e.occurred_at),
        tractor: sheetPlate(e.tractor_plate),
        km: e.odometer_km,
        full: e.diesel_l != null ? isFullTank(e) : null,
        column: fuelColumn(e, settings.depots),
        litres: e.diesel_l,
        adblue: e.adblue_l,
      });
    }
  }

  const first = events.find((e) => e.type === 'debut_journee');
  const last = [...events].reverse().find((e) => e.type === 'fin_journee');
  const startKm = first?.odometer_km ?? null;
  const endKm = last?.odometer_km ?? null;

  return {
    week: getISOWeek(monday),
    monday,
    saturday: addDays(monday, 5),
    driver: settings.driver.trim(),
    agency: settings.agency.trim(),
    tractor: mainTractor(events),
    departures,
    operations: byDay.map((list) => dayRows(list, loaded, delivered)),
    startPlace: first ? (first.city ?? '') : '',
    endPlace: last ? (last.city ?? '') : '',
    startKm,
    endKm,
    totalKm: startKm != null && endKm != null && endKm >= startKm ? endKm - startKm : null,
    depotLabels: Array.from({ length: DEPOT_COUNT }, (_, i) => settings.depots[i]?.label.trim() ?? ''),
    fuel,
    totalLitres: fuel.flat().reduce((sum, f) => sum + (f.litres ?? 0), 0),
  };
}
