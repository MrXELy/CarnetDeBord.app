import type { TripEvent } from '../types';

/**
 * Consommation de gasoil.
 *
 * Seul un intervalle entre deux pleins complets donne une mesure juste : le réservoir est plein au départ
 * et à l'arrivée, donc tout ce qui a été mis entre les deux (compléments compris) a été consommé.
 * Les compléments AS24 ou DKV ne faussent rien, ils sont comptés au plein suivant.
 */

/** Plein complet : choisi à la saisie ; pour les anciennes étapes, toujours chez Doumen, jamais ailleurs. */
export const isFullTank = (e: TripEvent) => e.full_tank ?? e.station === 'Doumen';

/** Conso crédible d'un poids lourd (L/100 km) : en dehors, l'intervalle est écarté. */
export const MIN_RATE = 15;
export const MAX_RATE = 50;

/** Nombre de pleins récents utilisés pour la moyenne (le pistolet ne coupe jamais au même niveau). */
export const AVERAGE_COUNT = 4;

/** Trajet d'un tracteur entre deux pleins complets. */
export interface FuelInterval {
  tractor: string;
  /** Plein complet de départ, puis d'arrivée. */
  fromId: string;
  toId: string;
  start: string;
  end: string;
  fromKm: number | null;
  toKm: number | null;
  /** Litres mis après le plein de départ, plein d'arrivée compris. */
  liters: number;
  /** Raison pour laquelle l'intervalle est écarté, ou null s'il est fiable. */
  problem: string | null;
}

/** Km parcourus (0 si inconnus). */
export const intervalKm = (i: FuelInterval) => (i.fromKm != null && i.toKm != null ? i.toKm - i.fromKm : 0);

/** Conso de l'intervalle en L/100 km, ou null si les km manquent. */
export function intervalRate(i: FuelInterval): number | null {
  const km = intervalKm(i);
  return km > 0 ? (i.liters / km) * 100 : null;
}

const fuelLog = (events: TripEvent[]) =>
  events
    .filter((e) => !e.deleted_at && e.type === 'carburant')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

/** Intervalles entre pleins complets, tracteur par tracteur, du plus ancien au plus récent. */
export function fuelIntervals(events: TripEvent[]): FuelInterval[] {
  const byTractor = new Map<string, TripEvent[]>();
  for (const e of fuelLog(events)) {
    const tractor = e.tractor_plate.trim();
    byTractor.set(tractor, [...(byTractor.get(tractor) ?? []), e]);
  }

  const intervals: FuelInterval[] = [];
  byTractor.forEach((list, tractor) => {
    let from: TripEvent | null = null;
    let liters = 0;
    let missingLiters = false;
    for (const e of list) {
      if (from) {
        if (e.diesel_l == null) missingLiters = true;
        else liters += e.diesel_l;
      }
      if (!isFullTank(e)) continue;
      if (from) {
        const interval: FuelInterval = {
          tractor,
          fromId: from.id,
          toId: e.id,
          start: from.occurred_at,
          end: e.occurred_at,
          fromKm: from.odometer_km,
          toKm: e.odometer_km,
          liters,
          problem: null,
        };
        interval.problem = problemOf(interval, missingLiters);
        intervals.push(interval);
      }
      from = e;
      liters = 0;
      missingLiters = false;
    }
  });
  return intervals.sort((a, b) => a.end.localeCompare(b.end));
}

function problemOf(i: FuelInterval, missingLiters: boolean): string | null {
  if (i.fromKm == null || i.toKm == null) return 'kilométrage manquant';
  if (i.toKm <= i.fromKm) return 'kilométrage incohérent';
  if (missingLiters) return 'litres manquants';
  const rate = intervalRate(i)!;
  if (rate < MIN_RATE || rate > MAX_RATE) return `conso improbable (${formatRate(rate)} L/100)`;
  return null;
}

/** Moyenne pondérée par les km : total des litres ÷ total des km. */
export function averageRate(intervals: FuelInterval[]): number | null {
  let liters = 0;
  let km = 0;
  for (const i of intervals) {
    if (i.problem) continue;
    liters += i.liters;
    km += intervalKm(i);
  }
  return km > 0 ? (liters / km) * 100 : null;
}

/**
 * Conso habituelle à une date : les derniers pleins fiables avant cette date, ceux d'après si aucun,
 * d'abord pour ce tracteur, sinon tous tracteurs confondus.
 */
export function recentIntervals(
  intervals: FuelInterval[],
  at: Date,
  tractor?: string,
  count = AVERAGE_COUNT,
): FuelInterval[] {
  const iso = at.toISOString();
  const pick = (list: FuelInterval[]) => {
    const before = list.filter((i) => i.end <= iso);
    return before.length ? before.slice(-count) : list.slice(0, count);
  };
  const valid = intervals.filter((i) => !i.problem);
  const own = tractor == null ? [] : pick(valid.filter((i) => i.tractor === tractor));
  return own.length ? own : pick(valid);
}

/** Bilan du gasoil sur une période (jour, semaine, mois…). */
export interface FuelReport {
  /** Litres mis dans le réservoir pendant la période. */
  bought: number;
  /** Km parcourus pendant la période. */
  km: number;
  /** Litres consommés : mesurés entre deux pleins, ou estimés avec la conso habituelle. */
  used: number | null;
  /** Km dont la consommation est mesurée ; le reste est estimé. */
  measuredKm: number;
  /** Conso de la période en L/100 km. */
  rate: number | null;
}

/**
 * Bilan sur [from, to[ : une semaine sans plein a quand même consommé.
 * Chaque km parcouru prend la conso de l'intervalle entre pleins qui le contient ;
 * les km hors intervalle fiable (depuis le dernier plein, par exemple) prennent la conso habituelle.
 */
export function fuelReport(
  events: TripEvent[],
  from: Date,
  to: Date,
  intervals: FuelInterval[] = fuelIntervals(events),
): FuelReport {
  const start = from.toISOString();
  const end = to.toISOString();
  const inPeriod = events.filter((e) => !e.deleted_at && e.occurred_at >= start && e.occurred_at < end);

  const report: FuelReport = { bought: 0, km: 0, used: 0, measuredKm: 0, rate: null };
  for (const e of inPeriod) if (e.type === 'carburant' && e.diesel_l != null) report.bought += e.diesel_l;

  // Km de la période, tracteur par tracteur : du plus petit au plus grand relevé.
  const ranges = new Map<string, [number, number]>();
  for (const e of inPeriod) {
    if (e.odometer_km == null) continue;
    const tractor = e.tractor_plate.trim();
    const [lo, hi] = ranges.get(tractor) ?? [e.odometer_km, e.odometer_km];
    ranges.set(tractor, [Math.min(lo, e.odometer_km), Math.max(hi, e.odometer_km)]);
  }

  ranges.forEach(([lo, hi], tractor) => {
    report.km += hi - lo;
    let measured = 0;
    for (const i of intervals) {
      if (i.problem || i.tractor !== tractor) continue;
      const overlap = Math.min(hi, i.toKm!) - Math.max(lo, i.fromKm!);
      if (overlap <= 0) continue;
      measured += overlap;
      report.used! += (i.liters * overlap) / intervalKm(i);
    }
    report.measuredKm += measured;
    const rest = hi - lo - measured;
    if (rest <= 0 || report.used == null) return;
    const usual = averageRate(recentIntervals(intervals, to, tractor));
    report.used = usual == null ? null : report.used + (rest * usual) / 100;
  });

  if (report.used != null) report.used = Math.round(report.used);
  report.rate = report.used != null && report.km > 0 ? (report.used / report.km) * 100 : null;
  return report;
}

export const formatRate = (rate: number) =>
  rate.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
