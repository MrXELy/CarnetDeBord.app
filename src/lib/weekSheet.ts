import { addDays, addHours, getDay, getISOWeek, parseISO, startOfDay } from 'date-fns';
import type { TripEvent, Waybill } from '../types';
import type { Allowance } from './allowances';
import { workDay } from './dates';
import { isFullTank, plainCity as plain } from './fuel';

/** Réglages de la feuille de semaine (Options), partagés entre les appareils. */
export interface SheetSettings {
  /** Nom du conducteur, écrit tel quel (« DUPONT Jean »). */
  driver: string;
  /** Agence de rattachement. */
  agency: string;
  /** Matricule et date d'embauche (« 05/21 »), pour la feuille de remboursement de frais. */
  matricule?: string;
  hireDate?: string;
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

/** Page 5 : une ligne de la feuille de remboursement de frais. */
export interface ExpenseDay {
  start: Date;
  startPlace: string;
  end: Date;
  endPlace: string;
}

/** Page 5 : indemnités, dans l'ordre de la feuille. */
export const EXPENSE_LINES = [
  { label: 'Casse-croûte', test: (a: Allowance) => a.kind === 'casse_croute' },
  { label: 'Repas midi', test: (a: Allowance) => a.kind === 'repas' && a.meal !== 'soir' },
  { label: 'Repas soir', test: (a: Allowance) => a.kind === 'repas' && a.meal === 'soir' },
  { label: 'Grand déplacement (1 repas + 1 découcher)', test: (a: Allowance) => a.kind === 'gd1' },
  { label: 'Grand déplacement (2 repas + 1 découcher)', test: (a: Allowance) => a.kind === 'gd2' },
  { label: 'Repas unique de nuit', test: (a: Allowance) => a.kind === 'repas_nuit' },
] as const;

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
  /** Page 5 : en-tête, journées (Dimanche … Samedi, au jour de leur fin), indemnités et date de signature. */
  matricule: string;
  hireDate: string;
  expenseDays: (ExpenseDay | null)[];
  expenses: { count: number; amount: number }[];
  expenseTotal: number;
  signedOn: Date | null;
}

/** Plaque écrite comme sur papier : « AB-123-CD » → « AB 123 CD ». */
export const sheetPlate = (plate: string | null | undefined) => (plate ?? '').trim().replace(/-/g, ' ');

/** Lieu écrit sur la feuille : « Narbonne (11) », ou le pays hors de France (« Irun (ES) »). */
export function sheetPlace(e: Pick<TripEvent, 'city' | 'department' | 'country_code'>): string {
  if (!e.city) return '';
  const suffix = !e.country_code || e.country_code === 'FR' ? e.department : e.country_code;
  return suffix ? `${e.city} (${suffix})` : e.city;
}

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

/** Nature, poids et n° d'une LV. */
function lvInfo(w: Waybill | undefined): Pick<OpRow, 'goods' | 'weightKg' | 'number'> {
  return {
    goods: w?.goods?.trim() ?? '',
    weightKg: w?.weight_kg ?? null,
    number: w?.number?.trim() ?? '',
  };
}

/** LV d'une étape dans l'ordre de leur n° ; au moins un élément (vide sans LV) pour avoir une ligne. */
const byNumber = (list: Waybill[]): (Waybill | undefined)[] =>
  list.length
    ? [...list].sort((a, b) => (a.number ?? '').localeCompare(b.number ?? '', 'fr', { numeric: true }))
    : [undefined];

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

const hasDelivery = (row: OpRow) => !!row.consignee || !!row.consigneePlace || row.consigneeKm != null;

/**
 * Lignes d'une journée (pages 2-3), dans l'ordre des heures, **une ligne par LV**. Un chargement ouvre une ligne
 * par LV (remorque, expéditeur, ville et km sur la première seulement). Une livraison va sur la ligne de sa LV si
 * celle-ci a été chargée le même jour (à défaut de LV, sur le dernier chargement du jour, pour les anciennes étapes),
 * sinon sur ses propres lignes, une par LV livrée, la remorque sur la première. Les livraisons qui se suivent
 * sans chargement du jour se rangent dessous, sans remorque. Chaque ligne porte la nature, le poids et le n° de sa LV.
 */
function dayRows(events: TripEvent[], loaded: Map<string, Waybill[]>, delivered: Map<string, Waybill[]>): OpRow[] {
  const rows: OpRow[] = [];
  // Groupe de lignes : sa première ligne, et la dernière (pour ajouter dessous).
  const headOf = new Map<OpRow, OpRow>();
  const groupEnd = new Map<OpRow, OpRow>();
  // Ligne de chaque LV chargée ce jour-là.
  const lvRow = new Map<string, OpRow>();
  let lastLoading: OpRow | null = null;
  // Livraisons qui se suivent sans chargement du jour : un seul groupe, remorque sur la première ligne.
  let ownGroup: OpRow | null = null;

  const open = (row: OpRow) => {
    rows.push(row);
    headOf.set(row, row);
    groupEnd.set(row, row);
  };
  const addUnder = (head: OpRow, row: OpRow) => {
    rows.splice(rows.indexOf(groupEnd.get(head)!) + 1, 0, row);
    groupEnd.set(head, row);
    headOf.set(row, head);
  };

  for (const e of events) {
    if (e.type === 'chargement') {
      const lvs = byNumber(loaded.get(e.id) ?? []);
      const head: OpRow = {
        ...emptyRow(),
        ...lvInfo(lvs[0]),
        trailer: sheetPlate(e.trailer_plate),
        shipper: names(loaded.get(e.id) ?? [], 'shipper'),
        shipperPlace: sheetPlace(e),
        shipperKm: e.odometer_km,
      };
      open(head);
      lvs.forEach((w, i) => {
        const row = i === 0 ? head : { ...emptyRow(), ...lvInfo(w) };
        if (i > 0) addUnder(head, row);
        if (w) lvRow.set(w.id, row);
      });
      lastLoading = head;
      ownGroup = null;
    } else if (e.type === 'livraison') {
      const list = delivered.get(e.id) ?? [];
      const delivery = {
        consignee: names(list, 'consignee'),
        consigneePlace: sheetPlace(e),
        consigneeKm: e.odometer_km,
      };
      const sameDay = list.filter((w) => lvRow.has(w.id));
      if (sameDay.length || (list.length === 0 && lastLoading)) {
        // Sur la ligne de sa LV chargée le jour même (ou du dernier chargement), sinon juste dessous.
        const targets = sameDay.length
          ? sameDay.map((w) => [w, lvRow.get(w.id)!] as const)
          : [[undefined, lastLoading!] as const];
        for (const [w, row] of targets) {
          if (!hasDelivery(row)) Object.assign(row, delivery);
          else addUnder(headOf.get(row)!, { ...emptyRow(), ...lvInfo(w), ...delivery });
        }
        const head = headOf.get(targets[0][1])!;
        for (const w of list.filter((w) => !lvRow.has(w.id))) addUnder(head, { ...emptyRow(), ...lvInfo(w) });
        ownGroup = null;
      } else {
        byNumber(list).forEach((w, i) => {
          const row = { ...emptyRow(), ...lvInfo(w), ...(i === 0 ? delivery : {}) };
          if (ownGroup) addUnder(ownGroup, row);
          else open((ownGroup = { ...row, trailer: sheetPlate(e.trailer_plate) }));
        });
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
  allowances: Allowance[] = [],
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
  // Page 5 : chaque journée sur la ligne du jour où elle finit (départ la veille au soir compris).
  const expenseDays: (ExpenseDay | null)[] = Array(7).fill(null);
  let dayStart: TripEvent | null = null;
  for (const e of events) {
    if (e.type === 'debut_journee') dayStart = e;
    else if (e.type === 'fin_journee' && dayStart) {
      const finished = parseISO(e.occurred_at);
      const i = getDay(finished);
      expenseDays[i] = {
        start: expenseDays[i]?.start ?? parseISO(dayStart.occurred_at),
        startPlace: expenseDays[i]?.startPlace ?? sheetPlace(dayStart),
        end: finished,
        endPlace: sheetPlace(e),
      };
      dayStart = null;
    }
  }
  // Indemnités dont le jour (à midi) tombe dans la semaine, comme le récap des frais.
  const weekAllowances = allowances.filter((a) => {
    const noon = addHours(parseISO(a.day), 12);
    return noon >= start && noon < end;
  });
  const expenses = EXPENSE_LINES.map((line) => {
    const list = weekAllowances.filter(line.test);
    return { count: list.length, amount: Math.round(list.reduce((s, a) => s + (a.amount ?? 0), 0) * 100) / 100 };
  });

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
    startPlace: first ? sheetPlace(first) : '',
    endPlace: last ? sheetPlace(last) : '',
    startKm,
    endKm,
    totalKm: startKm != null && endKm != null && endKm >= startKm ? endKm - startKm : null,
    depotLabels: Array.from({ length: DEPOT_COUNT }, (_, i) => settings.depots[i]?.label.trim() ?? ''),
    fuel,
    totalLitres: fuel.flat().reduce((sum, f) => sum + (f.litres ?? 0), 0),
    matricule: settings.matricule?.trim() ?? '',
    hireDate: settings.hireDate?.trim() ?? '',
    expenseDays,
    expenses,
    expenseTotal: Math.round(expenses.reduce((s, x) => s + x.amount, 0) * 100) / 100,
    signedOn: last ? parseISO(last.occurred_at) : null,
  };
}
