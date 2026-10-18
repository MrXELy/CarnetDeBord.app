import {
  addDays,
  addHours,
  addMonths,
  addYears,
  differenceInMinutes,
  format,
  getISOWeek,
  isMonday,
  nextMonday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
  subHours,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { isDayBoundary, type Station, type TripEvent, type Waybill } from '../types';
import { dayLabel, summarizeDay, weekLabel, weekStart, workDay } from './dates';
import { DEPARTMENTS } from './departments';
import { emptyReport, kmSegments, type EmptyReport, type KmTimeline } from './emptyKm';
import { fuelReport, type FuelInterval, type FuelReport } from './fuel';

/**
 * Statistiques par jour, semaine, mois ou année.
 * Mêmes règles que le reste de l'appli : la semaine commence le dimanche à 22h, et un mois (ou une année)
 * regroupe les semaines entières dont le lundi tombe dans ce mois, comme la liste des semaines.
 */

export type PeriodKind = 'jour' | 'semaine' | 'mois' | 'annee';

export interface Period {
  kind: PeriodKind;
  /** Jour : le jour (minuit) ; semaine : le dimanche à 22h ; mois et année : le 1er à minuit. */
  anchor: Date;
}

export interface Range {
  start: Date;
  end: Date;
}

/** Premier lundi à partir de cette date (minuit). */
const firstMonday = (d: Date) => (isMonday(d) ? startOfDay(d) : nextMonday(startOfDay(d)));

/** Début d'un jour de travail : minuit, sauf le lundi qui commence le dimanche à 22h. */
const dayStart = (day: Date) => (isMonday(day) ? subHours(day, 2) : day);

/** Lundi de la semaine qui commence à cette date (dimanche 22h). */
const mondayOf = (start: Date) => addHours(start, 2);

export function periodAt(kind: PeriodKind, date: Date): Period {
  const monday = mondayOf(weekStart(date));
  switch (kind) {
    case 'jour':
      return { kind, anchor: workDay(date) };
    case 'semaine':
      return { kind, anchor: weekStart(date) };
    case 'mois':
      return { kind, anchor: startOfMonth(monday) };
    case 'annee':
      return { kind, anchor: startOfYear(monday) };
  }
}

export function periodRange({ kind, anchor }: Period): Range {
  switch (kind) {
    case 'jour':
      return { start: dayStart(anchor), end: dayStart(addDays(anchor, 1)) };
    case 'semaine':
      return { start: anchor, end: addDays(anchor, 7) };
    case 'mois':
      return { start: subHours(firstMonday(anchor), 2), end: subHours(firstMonday(addMonths(anchor, 1)), 2) };
    case 'annee':
      return { start: subHours(firstMonday(anchor), 2), end: subHours(firstMonday(addYears(anchor, 1)), 2) };
  }
}

export function shiftPeriod({ kind, anchor }: Period, delta: number): Period {
  switch (kind) {
    case 'jour':
      return { kind, anchor: addDays(anchor, delta) };
    case 'semaine':
      return { kind, anchor: weekStart(addDays(mondayOf(anchor), 7 * delta)) };
    case 'mois':
      return { kind, anchor: addMonths(anchor, delta) };
    case 'annee':
      return { kind, anchor: addYears(anchor, delta) };
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function periodTitle({ kind, anchor }: Period, now = new Date()): string {
  switch (kind) {
    case 'jour':
      return dayLabel(anchor) + (anchor.getFullYear() !== now.getFullYear() ? ` ${anchor.getFullYear()}` : '');
    case 'semaine':
      return weekLabel(anchor);
    case 'mois':
      return capitalize(format(anchor, 'MMMM yyyy', { locale: fr }));
    case 'annee':
      return `Année ${anchor.getFullYear()}`;
  }
}

/** Découpage pour le graphique : jours d'une semaine, semaines d'un mois, mois d'une année. */
export function subPeriods(period: Period): Period[] {
  const { start, end } = periodRange(period);
  const list: Period[] = [];
  if (period.kind === 'semaine') {
    for (let i = 0; i < 7; i++) list.push({ kind: 'jour', anchor: addDays(mondayOf(start), i) });
  } else if (period.kind === 'mois') {
    for (let w = start; w < end; w = weekStart(addDays(mondayOf(w), 7))) list.push({ kind: 'semaine', anchor: w });
  } else if (period.kind === 'annee') {
    for (let i = 0; i < 12; i++) list.push({ kind: 'mois', anchor: addMonths(period.anchor, i) });
  }
  return list;
}

/** Étiquette courte sous une barre du graphique. */
export function shortLabel({ kind, anchor }: Period): string {
  if (kind === 'jour') return capitalize(format(anchor, 'EEEEEE', { locale: fr }));
  if (kind === 'semaine') return `S${getISOWeek(mondayOf(anchor))}`;
  if (kind === 'mois') return capitalize(format(anchor, 'MMMMM', { locale: fr }));
  return String(anchor.getFullYear());
}

/**
 * Plage de comparaison : la période précédente, coupée au même moment si la période en cours n'est pas finie
 * (mercredi soir comparé au mercredi soir d'avant, pas à une semaine entière).
 */
export function previousRange(period: Period, now = new Date()): { range: Range; partial: boolean } {
  const current = periodRange(period);
  const prev = periodRange(shiftPeriod(period, -1));
  if (now <= current.start || now >= current.end) return { range: prev, partial: false };
  const elapsed = now.getTime() - current.start.getTime();
  return {
    range: { start: prev.start, end: new Date(Math.min(prev.end.getTime(), prev.start.getTime() + elapsed)) },
    partial: true,
  };
}

/** Au bout de ce temps, « maintenant » est rafraîchi même sans changement de période (coupe « au même moment »). */
export const NOW_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Faut-il remplacer le « maintenant » mémorisé (`shown`) par l'heure actuelle ? Oui si une limite de la période
 * affichée ou de la suivante a été franchie (la période devient passée, la flèche suivante apparaît : la semaine
 * change le dimanche à 22h), ou si `shown` a plus de `NOW_MAX_AGE_MS`. Sinon on garde le même, et les calculs
 * mémorisés ne sont pas refaits.
 */
export function nowIsStale(shown: Date, current: Date, period: Period): boolean {
  if (Math.abs(current.getTime() - shown.getTime()) >= NOW_MAX_AGE_MS) return true;
  const { start, end } = periodRange(period);
  const next = periodRange(shiftPeriod(period, 1)).start;
  return [start, end, next].some((limit) => shown < limit !== current < limit);
}

export const inRange = (events: TripEvent[], { start, end }: Range) => {
  const s = start.toISOString();
  const e = end.toISOString();
  return events.filter((x) => !x.deleted_at && x.occurred_at >= s && x.occurred_at < e);
};

/** Étapes regroupées par jour de travail (clé : minuit du jour). */
function byWorkDay(events: TripEvent[]): Map<number, TripEvent[]> {
  const days = new Map<number, TripEvent[]>();
  for (const e of events) {
    const key = workDay(parseISO(e.occurred_at)).getTime();
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  return days;
}

/**
 * Km par tracteur de ces étapes : somme des tronçons entre deux relevés qui se suivent avec le même tracteur
 * (sans le repos, les changements de tracteur sans relevé ni les relevés incohérents, voir emptyKm.ts).
 * Clé : la plaque telle que saisie le plus récemment ; « AB-123-CD » et « AB123CD » sont le même tracteur.
 */
export function kmByTractor(events: TripEvent[]): Map<string, number> {
  const tractors = new Map<string, { plate: string; km: number }>();
  for (const s of kmSegments(events)) {
    const t = tractors.get(s.tractor) ?? { plate: s.plate, km: 0 };
    t.plate = s.plate || t.plate;
    t.km += s.km;
    tractors.set(s.tractor, t);
  }
  return new Map([...tractors.values()].map((t) => [t.plate, t.km]));
}

/** Km de ces étapes, tous tracteurs confondus. */
export const totalKm = (events: TripEvent[]) => [...kmByTractor(events).values()].reduce((a, b) => a + b, 0);

export interface PeriodStats {
  km: number;
  /** Jours avec au moins une étape. */
  days: number;
  /** Amplitude totale des journées complètes (minutes) et nombre de ces journées. */
  amplitude: number;
  fullDays: number;
  loads: number;
  deliveries: number;
  /** Étapes hors débuts et fins de journée. */
  steps: number;
  fuel: FuelReport;
  adblue: number;
  /** Litres achetés par station. */
  stations: { station: Station; liters: number }[];
  /** Poids des LV chargées (kg). */
  weightKg: number;
  tractors: { plate: string; km: number }[];
  /** Km à vide et en charge. */
  empty: EmptyReport;
}

export function periodStats(
  all: TripEvent[],
  waybills: Waybill[],
  range: Range,
  intervals: FuelInterval[],
  timeline: KmTimeline,
): PeriodStats {
  const events = inRange(all, range);
  const days = byWorkDay(events);
  let amplitude = 0;
  let fullDays = 0;
  days.forEach((list) => {
    const a = summarizeDay(list).amplitude;
    if (a == null) return;
    amplitude += a;
    fullDays++;
  });

  const stations = new Map<Station, number>();
  let adblue = 0;
  for (const e of events) {
    if (e.type !== 'carburant') continue;
    if (e.station && e.diesel_l) stations.set(e.station, (stations.get(e.station) ?? 0) + e.diesel_l);
    adblue += e.adblue_l ?? 0;
  }

  const ids = new Set(events.map((e) => e.id));
  const weightKg = waybills
    .filter((w) => !w.deleted_at && ids.has(w.loading_event_id ?? w.delivery_event_id ?? ''))
    .reduce((sum, w) => sum + (w.weight_kg ?? 0), 0);

  const tractors = [...kmByTractor(events)]
    .map(([plate, km]) => ({ plate, km }))
    .filter((t) => t.km > 0)
    .sort((a, b) => b.km - a.km);

  return {
    km: tractors.reduce((sum, t) => sum + t.km, 0),
    days: days.size,
    amplitude,
    fullDays,
    loads: events.filter((e) => e.type === 'chargement').length,
    deliveries: events.filter((e) => e.type === 'livraison').length,
    steps: events.filter((e) => !isDayBoundary(e.type)).length,
    fuel: fuelReport(all, range.start, range.end, intervals),
    adblue,
    stations: [...stations].map(([station, liters]) => ({ station, liters })).sort((a, b) => b.liters - a.liters),
    weightKg,
    tractors,
    empty: emptyReport(timeline, range.start, range.end),
  };
}

/** Heures de la journée en minutes après minuit (une prise de poste le dimanche à 23h donne -60). */
const minutesOfDay = (iso: string) => {
  const d = parseISO(iso);
  return differenceInMinutes(d, workDay(d));
};

export interface WorkTimes {
  /** Heures en minutes après minuit. */
  avgStart: number | null;
  earliestStart: number | null;
  avgEnd: number | null;
  latestEnd: number | null;
  /** Amplitudes en minutes. */
  avgAmplitude: number | null;
  longestAmplitude: number | null;
  /** Repos le plus court entre une fin de journée et le début suivant (minutes). */
  shortestRest: number | null;
}

const average = (values: number[]) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

export function workTimes(all: TripEvent[], range: Range): WorkTimes {
  const events = inRange(all, range);
  const starts = events.filter((e) => e.type === 'debut_journee').map((e) => minutesOfDay(e.occurred_at));
  const ends = events.filter((e) => e.type === 'fin_journee').map((e) => minutesOfDay(e.occurred_at));
  const amplitudes = [...byWorkDay(events).values()]
    .map((list) => summarizeDay(list).amplitude)
    .filter((a): a is number => a != null);
  const rests = events
    .filter((e) => e.type === 'debut_journee')
    .map((e) => restBefore(all, e))
    .filter((r): r is number => r != null);
  return {
    avgStart: average(starts),
    earliestStart: starts.length ? Math.min(...starts) : null,
    avgEnd: average(ends),
    latestEnd: ends.length ? Math.max(...ends) : null,
    avgAmplitude: average(amplitudes),
    longestAmplitude: amplitudes.length ? Math.max(...amplitudes) : null,
    shortestRest: rests.length ? Math.min(...rests) : null,
  };
}

/** Repos avant un début de journée : depuis la fin de journée précédente (minutes). */
export function restBefore(all: TripEvent[], start: TripEvent): number | null {
  let previous: TripEvent | null = null;
  for (const e of all) {
    if (e.deleted_at || e.type !== 'fin_journee' || e.occurred_at >= start.occurred_at) continue;
    if (!previous || e.occurred_at > previous.occurred_at) previous = e;
  }
  return previous ? differenceInMinutes(parseISO(start.occurred_at), parseISO(previous.occurred_at)) : null;
}

export interface Ranked {
  name: string;
  /** Précision affichée en plus discret : nom du département ou du pays. */
  detail?: string | null;
  count: number;
}

type Entry = { name: string | null | undefined; detail?: string | null };

/** Entrées les plus fréquentes (sans tenir compte des majuscules), de la plus à la moins fréquente. */
export function topNames(entries: (Entry | string | null | undefined)[], limit = 5): Ranked[] {
  const counts = new Map<string, Ranked>();
  for (const raw of entries) {
    const entry = typeof raw === 'object' && raw ? raw : { name: raw };
    const name = entry.name?.trim();
    if (!name) continue;
    const detail = entry.detail?.trim() || null;
    const key = `${name}|${detail ?? ''}`.toLocaleLowerCase('fr');
    const ranked = counts.get(key) ?? (detail ? { name, detail, count: 0 } : { name, count: 0 });
    ranked.count++;
    counts.set(key, ranked);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface Places {
  shippers: Ranked[];
  consignees: Ranked[];
  departments: Ranked[];
}

const countries = new Intl.DisplayNames(['fr'], { type: 'region' });

/** Département d'une étape (« 11 », « Aude »), ou son pays hors de France (« ES », « Espagne »). */
function areaOf(e: TripEvent): Entry {
  if (e.country_code && e.country_code !== 'FR') {
    return { name: e.country_code, detail: countries.of(e.country_code) ?? null };
  }
  return { name: e.department, detail: e.department ? (DEPARTMENTS[e.department] ?? null) : null };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regroupe un client sous le nom d'un autre client connu qu'il contient comme mot entier :
 * « Usine (Client A) » et « Dépôt Nord (Groupe Client A) » comptent pour « Client A » si « Client A » existe.
 * Le nom le plus court gagne. Aucun nom n'est écrit dans le code : la règle part des noms saisis.
 */
export function clientGrouper(
  names: (string | null | undefined)[],
): (name: string | null | undefined) => string | null {
  const known = new Map<string, string>();
  for (const raw of names) {
    const name = raw?.trim();
    if (name && !known.has(name.toLocaleLowerCase('fr'))) known.set(name.toLocaleLowerCase('fr'), name);
  }
  const patterns = [...known]
    .sort(([a], [b]) => a.length - b.length)
    .map(([key, name]) => ({
      key,
      name,
      re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(key)}(?![\\p{L}\\p{N}])`, 'u'),
    }));
  const cache = new Map<string, string>();
  return (raw) => {
    const name = raw?.trim();
    if (!name) return null;
    const key = name.toLocaleLowerCase('fr');
    if (!cache.has(key)) {
      const parent = patterns.find((p) => p.key !== key && p.re.test(key));
      cache.set(key, parent?.name ?? known.get(key) ?? name);
    }
    return cache.get(key)!;
  };
}

/**
 * Chargeurs et destinataires (un client compte une fois par LV, quelle que soit la ville),
 * et départements des chargements et livraisons de la plage.
 * Les noms viennent des LV ; pour les anciennes étapes saisies sans LV, du champ « client » de l'étape.
 */
export function topPlaces(all: TripEvent[], waybills: Waybill[], range: Range): Places {
  const events = inRange(all, range);
  const alive = waybills.filter((w) => !w.deleted_at);
  // Regroupement calculé sur tous les noms connus, pas seulement ceux de la période.
  const group = clientGrouper([
    ...alive.flatMap((w) => [w.shipper, w.consignee]),
    ...all.filter((e) => !e.deleted_at).map((e) => e.client),
  ]);
  const clients = (type: 'chargement' | 'livraison'): Entry[] =>
    events
      .filter((e) => e.type === type)
      .flatMap((e) => {
        const names = alive
          .filter((w) => (type === 'chargement' ? w.loading_event_id : w.delivery_event_id) === e.id)
          .map((w) => (type === 'chargement' ? w.shipper : w.consignee)?.trim())
          .filter(Boolean);
        return (names.length ? names : [e.client]).map((name) => ({ name: group(name) }));
      });
  return {
    shippers: topNames(clients('chargement')),
    consignees: topNames(clients('livraison')),
    departments: topNames(events.filter((e) => e.type === 'chargement' || e.type === 'livraison').map(areaOf)),
  };
}

export interface Records {
  bestDay: { day: Date; km: number } | null;
  bestWeek: { start: Date; km: number } | null;
  longestDay: { day: Date; minutes: number } | null;
}

/** Records depuis le début : plus grosse journée, plus grosse semaine, plus longue amplitude. */
export function records(all: TripEvent[]): Records {
  const result: Records = { bestDay: null, bestWeek: null, longestDay: null };
  const events = all.filter((e) => !e.deleted_at);
  byWorkDay(events).forEach((list, key) => {
    const { amplitude } = summarizeDay(list);
    const km = totalKm(list);
    if (km > (result.bestDay?.km ?? 0)) result.bestDay = { day: new Date(key), km };
    if (amplitude != null && amplitude > (result.longestDay?.minutes ?? 0)) {
      result.longestDay = { day: new Date(key), minutes: amplitude };
    }
  });
  const weeks = new Map<number, TripEvent[]>();
  for (const e of events) {
    const key = weekStart(parseISO(e.occurred_at)).getTime();
    weeks.set(key, [...(weeks.get(key) ?? []), e]);
  }
  weeks.forEach((list, key) => {
    const km = totalKm(list);
    if (km > (result.bestWeek?.km ?? 0)) result.bestWeek = { start: new Date(key), km };
  });
  return result;
}

/** Km de chaque jour (clé : minuit du jour de travail), pour le calendrier. */
export function kmByDay(all: TripEvent[], range: Range): Map<number, number> {
  const result = new Map<number, number>();
  byWorkDay(inRange(all, range)).forEach((list, key) => result.set(key, totalKm(list)));
  return result;
}
