import { addDays, differenceInMinutes, format, parseISO } from 'date-fns';
import type { EventType, TripEvent, Waybill } from '../types';
import { clientGrouper, inRange, type Range } from './stats';

/** Au-delà, l'heure de fin est sûrement une erreur de saisie : pas comptée. */
const MAX_ON_SITE_MIN = 24 * 60;

/** Étapes qui ont une heure de fin : chargement et livraison. */
export const hasEnd = (type: EventType) => type === 'chargement' || type === 'livraison';

/**
 * Chargement ou livraison en cours : la dernière étape notée, tant que sa fin n'est pas validée.
 * Une autre étape notée après fait disparaître le bouton (la fin reste vide). `events` : le plus récent en premier.
 */
export function unfinishedStep(events: TripEvent[]): TripEvent | null {
  const last = events.find((e) => !e.deleted_at);
  return last && hasEnd(last.type) && !last.finished_at ? last : null;
}

/**
 * Fin d'un chargement ou d'une livraison d'après sa seule heure (« 15:20 ») : le jour de l'arrivée, ou le lendemain
 * si l'heure est plus tôt (fin après minuit). `arrival` : « 2026-10-21T14:35 ». Null si l'une des deux est incomplète.
 */
export function endFromTime(arrival: string, time: string): Date | null {
  const start = new Date(arrival);
  if (Number.isNaN(start.getTime()) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const day = time < arrival.slice(11, 16) ? addDays(start, 1) : start;
  return new Date(`${format(day, 'yyyy-MM-dd')}T${time}`);
}

/** Minutes entre l'arrivée (heure de l'étape) et la fin, ou null si inconnue, nulle (fin = arrivée) ou incohérente. */
export function onSiteMinutes(e: TripEvent): number | null {
  if (!hasEnd(e.type) || !e.finished_at) return null;
  const minutes = differenceInMinutes(parseISO(e.finished_at), parseISO(e.occurred_at));
  return minutes > 0 && minutes <= MAX_ON_SITE_MIN ? minutes : null;
}

export interface ClientTime {
  name: string;
  /** Temps moyen sur place, en minutes. */
  average: number;
  count: number;
}

export interface OnSite {
  /** Temps moyen de tous les chargements et livraisons avec une fin, en minutes. */
  average: number | null;
  count: number;
  /** Clients où l'on reste le plus longtemps en moyenne. */
  clients: ClientTime[];
}

/**
 * Temps passé sur place aux chargements (chargeur) et livraisons (destinataire) de la plage.
 * Une étape compte une fois par client (plusieurs LV du même client : une seule fois).
 */
export function onSiteTimes(all: TripEvent[], waybills: Waybill[], range: Range, limit = 5): OnSite {
  const alive = waybills.filter((w) => !w.deleted_at);
  const group = clientGrouper(alive.flatMap((w) => [w.shipper, w.consignee]));
  const sums = new Map<string, ClientTime & { total: number }>();
  let total = 0;
  let count = 0;
  for (const e of inRange(all, range)) {
    const minutes = onSiteMinutes(e);
    if (minutes == null) continue;
    total += minutes;
    count++;
    const names = alive
      .filter((w) => (e.type === 'chargement' ? w.loading_event_id : w.delivery_event_id) === e.id)
      .map((w) => group(e.type === 'chargement' ? w.shipper : w.consignee))
      .filter((n): n is string => !!n);
    for (const name of new Set(names)) {
      const s = sums.get(name) ?? { name, average: 0, count: 0, total: 0 };
      s.total += minutes;
      s.count++;
      sums.set(name, s);
    }
  }
  const clients = [...sums.values()]
    .map(({ name, total: t, count: c }) => ({ name, average: Math.round(t / c), count: c }))
    .sort((a, b) => b.average - a.average || a.name.localeCompare(b.name))
    .slice(0, limit);
  return { average: count ? Math.round(total / count) : null, count, clients };
}

/** Au-delà de cet écart avec la dernière étape, on suppose un repos journalier (9 h minimum en RSE). */
const NEW_DAY_GAP_MIN = 9 * 60;

/**
 * Type proposé pour une nouvelle étape, d'après la dernière notée (on saute les pleins) : début de journée après une fin
 * ou un long arrêt, livraison après un chargement ou s'il reste des LV dans le camion, sinon chargement.
 * `events` : le plus récent en premier ; `loaded` : des LV sont dans le camion.
 */
export function suggestedType(events: TripEvent[], now: Date, loaded: boolean): EventType {
  const live = events.filter((e) => !e.deleted_at);
  if (!live.length || differenceInMinutes(now, parseISO(live[0].occurred_at)) >= NEW_DAY_GAP_MIN)
    return 'debut_journee';
  const last = live.find((e) => e.type !== 'carburant') ?? live[0];
  if (last.type === 'fin_journee') return 'debut_journee';
  return last.type === 'chargement' || loaded ? 'livraison' : 'chargement';
}
