import { addDays, format, isSunday, parseISO, set, startOfDay } from 'date-fns';
import type { Place, TripEvent } from '../types';
import { workDay } from './dates';
import { normalize } from './search';

/**
 * Frais de déplacement (indemnités de route), calculés d'après l'heure et le lieu
 * des débuts et fins de journée :
 * - fin de journée hors des bases : grand déplacement (GD), 2 repas si la journée couvre le midi, sinon 1 ;
 * - fin de journée à une base : repas du midi et du soir selon les horaires ;
 * - casse-croûte : départ avant 5h, sauf après un découcher (il est compris dans le GD de la veille) ;
 * - repas unique de nuit : 4 h d'affilée entre 22h et 7h, sans casse-croûte ni découcher la veille ;
 * - prime de départ du lundi : départ le dimanche à partir de 22h ou le lundi avant 2h ;
 * - jour sans étape passé hors des bases (bloqué) : GD 2 repas, plus une prime le dimanche et les jours fériés ;
 *   compté quand la journée suivante est notée.
 */

export type AllowanceKind = 'gd2' | 'gd1' | 'repas' | 'casse_croute' | 'repas_nuit' | 'prime_lundi' | 'prime_bloque';

export const ALLOWANCE_KINDS: { kind: AllowanceKind; label: string }[] = [
  { kind: 'gd2', label: 'GD 2 repas + découcher' },
  { kind: 'gd1', label: 'GD 1 repas + découcher' },
  { kind: 'repas', label: 'Repas' },
  { kind: 'casse_croute', label: 'Casse-croûte' },
  { kind: 'repas_nuit', label: 'Repas unique de nuit' },
  { kind: 'prime_lundi', label: 'Prime départ du lundi' },
  { kind: 'prime_bloque', label: 'Prime dimanche ou férié bloqué' },
];

/** Indemnités qui ont un tarif France et un tarif étranger. */
export type MealKind = 'gd2' | 'gd1' | 'repas' | 'casse_croute' | 'repas_nuit';
export const MEAL_KINDS: MealKind[] = ['gd2', 'gd1', 'repas', 'casse_croute', 'repas_nuit'];

/** Tarifs applicables à partir d'une date. */
export interface Rates {
  /** « yyyy-MM-dd » */
  from: string;
  /** [France, étranger] */
  meals: Record<MealKind, [number, number]>;
  primeLundi: number;
  /** Montant pas encore connu : les jours sont comptés sans montant. */
  primeBloque: number | null;
}

export interface AllowanceSettings {
  /** Lieux où une fin de journée veut dire « rentré » (domicile, dépôt). */
  bases: Place[];
  rates: Rates[];
}

/** Tarifs de l'entreprise au 1er janvier 2026. */
export const DEFAULT_RATES: Rates = {
  from: '2026-01-01',
  meals: {
    gd2: [68.67, 81.03],
    gd1: [52.31, 61.73],
    repas: [17.68, 20.86],
    casse_croute: [8.87, 10.47],
    repas_nuit: [9.81, 11.58],
  },
  primeLundi: 25.76,
  primeBloque: null,
};

export const DEFAULT_ALLOWANCE_SETTINGS: AllowanceSettings = { bases: [], rates: [DEFAULT_RATES] };

export interface Allowance {
  /** Jour de travail (« yyyy-MM-dd ») auquel l'indemnité est rattachée. */
  day: string;
  kind: AllowanceKind;
  foreign: boolean;
  /** null : montant pas encore saisi. */
  amount: number | null;
  /** Jour sans étape passé hors des bases. */
  blocked?: boolean;
  /** Repas du midi ou du soir (feuille de remboursement). */
  meal?: 'midi' | 'soir';
}

/** Comparaison des noms de villes : sans accents, majuscules, tirets ni « Saint »/« St ». */
const cityKey = (city: string) =>
  normalize(city)
    .replace(/\bst\b/g, 'saint')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function isAtBase(place: Pick<Place, 'city' | 'department'>, bases: Place[]): boolean {
  const key = cityKey(place.city ?? '');
  if (!key) return false;
  return bases.some(
    (b) => cityKey(b.city) === key && (!b.department || !place.department || b.department === place.department),
  );
}

const isForeign = (e: Pick<Place, 'country_code'>) => !!e.country_code && e.country_code !== 'FR';

/** Jours fériés de l'année (« yyyy-MM-dd »), dont Pâques, l'Ascension et la Pentecôte. */
export function holidays(year: number): Set<string> {
  // Date de Pâques (algorithme de Meeus).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(year, month - 1, day);
  const iso = (dt: Date) => format(dt, 'yyyy-MM-dd');
  return new Set([
    `${year}-01-01`,
    iso(addDays(easter, 1)),
    `${year}-05-01`,
    `${year}-05-08`,
    iso(addDays(easter, 39)),
    iso(addDays(easter, 50)),
    `${year}-07-14`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-25`,
  ]);
}

const holidayCache = new Map<number, Set<string>>();
export function isHoliday(day: Date): boolean {
  const year = day.getFullYear();
  if (!holidayCache.has(year)) holidayCache.set(year, holidays(year));
  return holidayCache.get(year)!.has(format(day, 'yyyy-MM-dd'));
}

/** Tarifs en vigueur ce jour-là : les plus récents déjà commencés, sinon les plus anciens. */
export function ratesAt(rates: Rates[], day: string): Rates {
  const sorted = [...rates].sort((a, b) => a.from.localeCompare(b.from));
  return sorted.filter((r) => r.from <= day).pop() ?? sorted[0] ?? DEFAULT_RATES;
}

function amountOf(rates: Rates[], day: string, kind: AllowanceKind, foreign: boolean): number | null {
  const r = ratesAt(rates, day);
  if (kind === 'prime_lundi') return r.primeLundi;
  if (kind === 'prime_bloque') return r.primeBloque;
  return r.meals[kind][foreign ? 1 : 0];
}

/** La journée couvre entièrement la plage horaire de ce jour (heures et minutes). */
function covers(start: Date, end: Date, day: Date, from: [number, number], to: [number, number]) {
  const a = set(day, { hours: from[0], minutes: from[1] });
  const b = set(day, { hours: to[0], minutes: to[1] });
  return start <= a && end >= b;
}

/** Plus longue durée travaillée d'affilée dans une nuit (22h–7h), en minutes. */
function nightMinutes(start: Date, end: Date): number {
  let best = 0;
  for (let night = addDays(startOfDay(start), -1); night < end; night = addDays(night, 1)) {
    const from = Math.max(start.getTime(), set(night, { hours: 22 }).getTime());
    const to = Math.min(end.getTime(), set(addDays(night, 1), { hours: 7 }).getTime());
    best = Math.max(best, (to - from) / 60000);
  }
  return best;
}

interface WorkDay {
  start: TripEvent;
  end: TripEvent;
  events: TripEvent[];
}

/** Journées complètes : chaque début de journée avec la fin qui le suit. */
function workDays(events: TripEvent[]): { days: WorkDay[]; starts: TripEvent[] } {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const days: WorkDay[] = [];
  const starts: TripEvent[] = [];
  let current: { start: TripEvent; events: TripEvent[] } | null = null;
  for (const e of sorted) {
    if (e.type === 'debut_journee') {
      current = { start: e, events: [e] };
      starts.push(e);
    } else if (current) {
      current.events.push(e);
      if (e.type === 'fin_journee') {
        days.push({ ...current, end: e });
        current = null;
      }
    }
  }
  return { days, starts };
}

/** Toutes les indemnités de l'historique. Aucune sans base réglée : tout serait compté comme découcher. */
export function computeAllowances(events: TripEvent[], settings: AllowanceSettings): Allowance[] {
  if (settings.bases.length === 0) return [];
  const { days, starts } = workDays(events);
  const out: Allowance[] = [];
  const add = (dayDate: Date, kind: AllowanceKind, foreign: boolean, blocked = false, meal?: 'midi' | 'soir') => {
    const day = format(dayDate, 'yyyy-MM-dd');
    const amount = amountOf(settings.rates, day, kind, foreign);
    out.push({ day, kind, foreign, amount, ...(blocked && { blocked }), ...(meal && { meal }) });
  };

  days.forEach((wd, i) => {
    const start = parseISO(wd.start.occurred_at);
    const end = parseISO(wd.end.occurred_at);
    const day = workDay(start);
    const abroad = wd.events.some(isForeign);
    const away = !isAtBase(wd.end, settings.bases);
    const previous = days[i - 1];
    const sleptAway = !!previous && !isAtBase(previous.end, settings.bases);
    const hour = start.getHours();

    // Dimanche à partir de 22h (déjà la semaine du lundi) ou lundi avant 2h.
    if ((start.getDay() === 0 && hour >= 22) || (start.getDay() === 1 && hour < 2)) add(day, 'prime_lundi', false);

    const early = hour < 5 || day.getTime() !== startOfDay(start).getTime();
    const snack = early && !sleptAway;
    if (snack) add(day, 'casse_croute', abroad);
    else if (!sleptAway && nightMinutes(start, end) >= 240) add(day, 'repas_nuit', abroad);

    const noon = covers(start, end, day, [11, 45], [14, 15]);
    if (away) {
      add(day, noon ? 'gd2' : 'gd1', isForeign(wd.end));
    } else {
      if (noon) add(day, 'repas', abroad, false, 'midi');
      if (covers(start, end, day, [18, 45], [21, 15])) add(day, 'repas', abroad, false, 'soir');
    }

    // Jours sans étape passés là où la journée s'est terminée, comptés une fois la route reprise
    // (sans reprise notée, rien ne dit encore que la journée suivante n'a pas été oubliée).
    if (!away) return;
    const next = starts.find((s) => s.occurred_at > wd.end.occurred_at);
    if (!next) return;
    const until = workDay(parseISO(next.occurred_at));
    for (let d = addDays(day, 1); d < until; d = addDays(d, 1)) {
      add(d, 'gd2', isForeign(wd.end), true);
      if (isSunday(d) || isHoliday(d)) add(d, 'prime_bloque', false, true);
    }
  });
  return out;
}

export interface AllowanceLine {
  kind: AllowanceKind;
  foreign: boolean;
  count: number;
  /** Somme des montants connus. */
  amount: number;
  /** Indemnités comptées sans montant (prime pas encore saisie). */
  unpriced: number;
}

export interface AllowanceSummary {
  lines: AllowanceLine[];
  total: number;
  count: number;
  unpriced: number;
}

/** Indemnités d'une période : celles dont le jour (à midi) tombe entre ses bornes. */
export function summarizeAllowances(all: Allowance[], range?: { start: Date; end: Date }): AllowanceSummary {
  const list = range
    ? all.filter((a) => {
        const noon = set(parseISO(a.day), { hours: 12 });
        return noon >= range.start && noon < range.end;
      })
    : all;
  const lines: AllowanceLine[] = [];
  for (const { kind } of ALLOWANCE_KINDS) {
    for (const foreign of [false, true]) {
      const items = list.filter((a) => a.kind === kind && a.foreign === foreign);
      if (!items.length) continue;
      const priced = items.filter((a) => a.amount != null);
      lines.push({
        kind,
        foreign,
        count: items.length,
        amount: round(priced.reduce((s, a) => s + a.amount!, 0)),
        unpriced: items.length - priced.length,
      });
    }
  }
  return {
    lines,
    total: round(lines.reduce((s, l) => s + l.amount, 0)),
    count: list.length,
    unpriced: lines.reduce((s, l) => s + l.unpriced, 0),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

export const euros = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export const allowanceLabel = (kind: AllowanceKind) => ALLOWANCE_KINDS.find((k) => k.kind === kind)!.label;
