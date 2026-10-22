import { differenceInMinutes, parseISO } from 'date-fns';
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
