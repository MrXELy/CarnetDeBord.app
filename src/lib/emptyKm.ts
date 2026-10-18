import { plateKey, type EventType, type TripEvent, type Waybill } from '../types';

/**
 * Km à vide et en charge.
 *
 * Le camion est à vide de la dernière livraison jusqu'au chargement suivant (retour à la maison compris),
 * en charge le reste du temps (un chargement le vendredi livré le lundi reste en charge tout le week-end).
 *
 * Les km sont comptés par tronçons, entre deux relevés qui se suivent avec le même tracteur :
 * on ne soustrait jamais les compteurs de deux tracteurs différents. Ne sont pas comptés :
 * le repos (fin de journée → début suivant, le camion ne roule pas avec toi), un changement de tracteur
 * sans relevé entre les deux, et les relevés incohérents (km qui baisse, saut de plus de 2000 km).
 */

/** Au-delà, l'écart entre deux relevés est suspect (chiffre mal saisi ou mal lu ?). */
export const MAX_GAP_KM = 2000;

export type Load = 'vide' | 'charge' | 'inconnu';

/** Km parcourus entre deux relevés qui se suivent, avec le même tracteur. */
export interface KmSegment {
  /** Plaque comparable (voir plateKey) et plaque telle que saisie. */
  tractor: string;
  plate: string;
  start: string;
  end: string;
  km: number;
  /** « inconnu » avant le premier chargement ou livraison, ou si une étape sans km a changé l'état en route. */
  load: Load;
}

/** Trajet à vide : de la dernière livraison au chargement suivant. */
export interface EmptyLeg {
  delivery: TripEvent;
  /** Chargement qui le termine (null tant que le trajet est en cours). */
  loading: TripEvent | null;
  km: number;
  /** Faux si une partie des km n'a pas pu être comptée (changement de tracteur sans relevé, étape sans km…). */
  complete: boolean;
}

export interface KmTimeline {
  segments: KmSegment[];
  legs: EmptyLeg[];
}

/** Ordre de deux étapes à la même heure : livraison avant chargement, début en premier, fin en dernier. */
const ORDER: Record<EventType, number> = {
  debut_journee: 0,
  livraison: 1,
  carburant: 2,
  chargement: 3,
  fin_journee: 4,
};

const chronological = (events: TripEvent[]) =>
  events
    .filter((e) => !e.deleted_at)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || ORDER[a.type] - ORDER[b.type]);

const isOperation = (e: TripEvent) => e.type === 'chargement' || e.type === 'livraison';

/** Pourquoi deux relevés qui se suivent ne donnent pas un tronçon comptable (null s'ils en donnent un). */
function pairProblem(from: TripEvent, to: TripEvent): 'repos' | 'tracteur' | 'incoherent' | null {
  if (from.type === 'fin_journee' && to.type === 'debut_journee') return 'repos';
  if (plateKey(from.tractor_plate) !== plateKey(to.tractor_plate)) return 'tracteur';
  const km = to.odometer_km! - from.odometer_km!;
  return km < 0 || km > MAX_GAP_KM ? 'incoherent' : null;
}

/**
 * État du camion après chaque chargement ou livraison.
 * Après une livraison : en charge si une autre livraison suit, à vide si c'est un chargement,
 * sauf si une LV prouve qu'il restait de la marchandise (chargée avant, livrée plus tard).
 * Après la dernière livraison notée : à vide, sauf s'il reste une LV dans le camion.
 */
function operationStates(ops: TripEvent[], waybills: Waybill[]): Map<string, Load> {
  const position = new Map(ops.map((e, i) => [e.id, i]));
  const alive = waybills.filter((w) => !w.deleted_at && w.loading_event_id && position.has(w.loading_event_id));
  const states = new Map<string, Load>();
  ops.forEach((e, i) => {
    if (e.type === 'chargement') return states.set(e.id, 'charge');
    const next = ops[i + 1];
    if (next?.type === 'livraison') return states.set(e.id, 'charge');
    const remains = alive.some((w) => {
      if (position.get(w.loading_event_id!)! >= i) return false;
      const delivered = w.delivery_event_id ? position.get(w.delivery_event_id) : undefined;
      // Trajet terminé : seule une LV livrée plus tard compte (une LV oubliée « dans le camion » ne bloque rien).
      return next ? delivered != null && delivered > i : delivered == null || delivered > i;
    });
    states.set(e.id, remains ? 'charge' : 'vide');
  });
  return states;
}

/** Tronçons de km et trajets à vide de tout l'historique, du plus ancien au plus récent. */
export function kmTimeline(events: TripEvent[], waybills: Waybill[] = []): KmTimeline {
  const list = chronological(events);
  const states = operationStates(list.filter(isOperation), waybills);
  const segments: KmSegment[] = [];
  const legs: EmptyLeg[] = [];
  let load: Load = 'inconnu';
  let leg: EmptyLeg | null = null;
  let previous: TripEvent | null = null;
  // Vrai si une étape sans km a changé l'état depuis le dernier relevé : le tronçon suivant est mélangé.
  let mixed = false;

  for (const e of list) {
    if (e.odometer_km != null && previous) {
      const problem = pairProblem(previous, e);
      if (problem && problem !== 'repos' && load === 'vide' && leg) leg.complete = false;
      if (!problem) {
        const km = e.odometer_km - previous.odometer_km!;
        const segmentLoad = mixed ? 'inconnu' : load;
        segments.push({
          tractor: plateKey(e.tractor_plate),
          plate: e.tractor_plate.trim(),
          start: previous.occurred_at,
          end: e.occurred_at,
          km,
          load: segmentLoad,
        });
        if (segmentLoad === 'vide' && leg) leg.km += km;
      }
    }
    if (isOperation(e)) {
      if (e.odometer_km == null) {
        mixed = true;
        if (leg) leg.complete = false;
      }
      if (leg && e.type === 'chargement') {
        leg.loading = e;
        leg = null;
      }
      load = states.get(e.id)!;
      if (load === 'vide') {
        leg = { delivery: e, loading: null, km: 0, complete: e.odometer_km != null };
        legs.push(leg);
      }
    }
    if (e.odometer_km != null) {
      previous = e;
      mixed = false;
    }
  }
  return { segments, legs };
}

/** Tronçons comptables d'une liste d'étapes, sans tenir compte de l'état du camion. */
export const kmSegments = (events: TripEvent[]) => kmTimeline(events).segments;

export interface TractorLoad {
  plate: string;
  empty: number;
  loaded: number;
}

export interface EmptyReport {
  /** Km à vide et en charge de la période (tronçons dont les deux relevés sont dans la période). */
  empty: number;
  loaded: number;
  /** Part des km à vide (0 à 1), sur les km dont l'état est connu. */
  share: number | null;
  /** Trajets à vide terminés (chargement) pendant la période, du plus ancien au plus récent. */
  legs: EmptyLeg[];
  /** Le plus long de ces trajets. */
  longest: EmptyLeg | null;
  /** Trajets de la période dont une partie des km n'a pas pu être comptée (y compris celui en cours). */
  incomplete: number;
  tractors: TractorLoad[];
}

export function emptyReport({ segments, legs }: KmTimeline, start: Date, end: Date): EmptyReport {
  const s = start.toISOString();
  const e = end.toISOString();
  const tractors = new Map<string, TractorLoad>();
  let empty = 0;
  let loaded = 0;
  for (const seg of segments) {
    if (seg.start < s || seg.end >= e || seg.load === 'inconnu') continue;
    const t = tractors.get(seg.tractor) ?? { plate: seg.plate, empty: 0, loaded: 0 };
    t.plate = seg.plate || t.plate;
    if (seg.load === 'vide') {
      empty += seg.km;
      t.empty += seg.km;
    } else {
      loaded += seg.km;
      t.loaded += seg.km;
    }
    tractors.set(seg.tractor, t);
  }
  const ended = legs.filter((l) => l.loading && l.loading.occurred_at >= s && l.loading.occurred_at < e);
  const running = legs.filter((l) => !l.loading && l.delivery.occurred_at >= s && l.delivery.occurred_at < e);
  const longest = ended.reduce<EmptyLeg | null>((best, l) => (!best || l.km > best.km ? l : best), null);
  return {
    empty,
    loaded,
    share: empty + loaded > 0 ? empty / (empty + loaded) : null,
    legs: ended,
    longest,
    incomplete: [...ended, ...running].filter((l) => !l.complete).length,
    tractors: [...tractors.values()].sort((a, b) => b.empty + b.loaded - (a.empty + a.loaded)),
  };
}
