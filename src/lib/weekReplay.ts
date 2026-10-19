import { parseISO } from 'date-fns';
import { eventTypeInfo, type MapLeg, type TripEvent } from '../types';
import { formatPlace } from './geo';
import { dayColor, dayKey, distanceKm, segmentKey, stopSegments, type Stop } from './weekStops';

type Point = [number, number];

/**
 * Semaine rejouée : une suite de moments (trajets, arrêts, repos) dans l'ordre chronologique.
 * Le temps de l'animation n'est pas le temps réel : chaque moment a un poids (trajets selon leur durée,
 * arrêts et repos courts), ramené ensuite à la durée choisie pour l'animation.
 */
export interface Replay {
  phases: Phase[];
  /** Somme des poids : l'animation va de 0 à `total`. */
  total: number;
  /** Tracés des trajets, dans l'ordre, avec leurs longueurs cumulées. */
  drives: Drive[];
  stops: Stop[];
}

interface Drive {
  color: string;
  coords: Point[];
  /** Longueur cumulée (km) à chaque point du tracé. */
  cum: number[];
  /** Km du trajet : au compteur si relevés, sinon longueur de l'itinéraire. */
  km: number;
}

type Phase = {
  /** Début et fin dans le temps de l'animation (poids cumulés). */
  from: number;
  to: number;
  /** Heures réelles de début et de fin (ms). */
  realFrom: number;
  realTo: number;
  day: string;
  /** Km parcourus au début du moment. */
  kmBefore: number;
  /** Nombre de lieux atteints pendant ce moment. */
  stopsReached: number;
} & (
  | { kind: 'drive'; drive: number; caption: string }
  | { kind: 'stop'; stop: number; caption: string }
  | { kind: 'rest'; stop: number; caption: string }
);

/** Moment à ajouter : sans sa place dans l'animation, calculée à l'ajout. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type PhaseInput = DistributiveOmit<Phase, 'from' | 'to' | 'kmBefore'>;

/** Image de l'animation à un instant donné. */
export interface ReplayFrame {
  kind: 'drive' | 'stop' | 'rest';
  day: string;
  clock: Date;
  km: number;
  /** Tracés déjà parcourus (le dernier peut être en cours). */
  lines: { color: string; coords: Point[] }[];
  /** Nombre de lieux atteints (les premiers de `stops`). */
  stopsReached: number;
  /** Position du camion. */
  truck: Point;
  caption: string;
}

/** Poids d'un arrêt et d'un repos dans l'animation (un trajet d'une heure pèse 1). */
const STOP_WEIGHT = 0.45;
const REST_WEIGHT = 1.1;
/** Trajet compté au moins 20 minutes : un trajet très court reste visible. */
const MIN_DRIVE_HOURS = 1 / 3;
/** Vitesse supposée quand l'heure réelle du trajet n'est pas fiable (repos compris dedans). */
const ASSUMED_KMH = 70;

const time = (e: TripEvent) => parseISO(e.occurred_at).getTime();
const placeOf = (stop: Stop) => formatPlace(stop.events[0]) || stop.events[0].city;
const hours = (ms: number) => ms / 3_600_000;

/** « 9 h », « 9 h 30 » */
function restLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000 / 15) * 15;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `Repos · ${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}

/** « Fin · Début — Villeneuve-sur-Lot (47) » (sans nom de client). */
function stopCaption(events: TripEvent[], place: string): string {
  const types = [...new Set(events.map((e) => eventTypeInfo(e.type).short))];
  return `${types.join(' · ')} — ${place}`;
}

/** Longueurs cumulées d'un tracé, en km. */
function cumulative(coords: Point[]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distanceKm(coords[i - 1], coords[i]));
  return cum;
}

/**
 * Prépare l'animation d'une semaine : lieux (`buildStops`) et itinéraires enregistrés (un par tronçon ;
 * à défaut, ligne droite). Les nuits (fin de journée puis début de journée) deviennent un court « repos ».
 */
export function buildReplay(stops: Stop[], legs: MapLeg[] = []): Replay {
  const byKey = new Map(legs.filter((l) => l.key).map((l) => [l.key!, l]));
  const phases: Phase[] = [];
  const drives: Drive[] = [];
  let total = 0;
  let km = 0;
  const push = (weight: number, phase: PhaseInput) => {
    phases.push({ ...phase, from: total, to: total + weight, kmBefore: km } as Phase);
    total += weight;
  };

  /** Arrêts d'un lieu : ses étapes, coupées en deux par un repos (fin de journée puis début de journée). */
  function addStop(index: number) {
    const stop = stops[index];
    let group: TripEvent[] = [];
    const flush = () => {
      if (!group.length) return;
      push(STOP_WEIGHT, {
        kind: 'stop',
        stop: index,
        caption: stopCaption(group, placeOf(stop)),
        realFrom: time(group[0]),
        realTo: time(group.at(-1)!),
        day: dayKey(group[0].occurred_at),
        stopsReached: index + 1,
      });
    };
    for (const e of stop.events) {
      const last = group.at(-1);
      if (last?.type === 'fin_journee' && e.type === 'debut_journee') {
        flush();
        push(REST_WEIGHT, {
          kind: 'rest',
          stop: index,
          caption: restLabel(time(e) - time(last)),
          realFrom: time(last),
          realTo: time(e),
          day: dayKey(last.occurred_at),
          stopsReached: index + 1,
        });
        group = [];
      }
      group.push(e);
    }
    flush();
  }

  if (stops.length) addStop(0);
  for (const segment of stopSegments(stops)) {
    const leg = byKey.get(segmentKey(segment));
    const coords: Point[] = leg?.coords.length
      ? leg.coords
      : [
          [segment.from.lat, segment.from.lon],
          [segment.to.lat, segment.to.lon],
        ];
    const cum = cumulative(coords);
    const driveKm = segment.odometerKm ?? leg?.km ?? cum.at(-1)!;
    const departure = segment.from.events.at(-1)!;
    const arrival = segment.to.events[0];
    let realFrom = time(departure);
    const realTo = time(arrival);
    // Départ après une fin de journée (lieu de repos différent du lieu de reprise) ou trajet de plus de 12 h :
    // repos d'abord, puis trajet à vitesse supposée.
    const estimated = (driveKm / ASSUMED_KMH) * 3_600_000;
    if (departure.type === 'fin_journee' || hours(realTo - realFrom) > 12) {
      const restEnd = Math.max(realFrom, realTo - estimated);
      if (restEnd > realFrom) {
        push(REST_WEIGHT, {
          kind: 'rest',
          stop: stops.indexOf(segment.from),
          caption: restLabel(restEnd - realFrom),
          realFrom,
          realTo: restEnd,
          day: dayKey(departure.occurred_at),
          stopsReached: stops.indexOf(segment.from) + 1,
        });
        realFrom = restEnd;
      }
    }
    drives.push({ color: dayColor(segment.day), coords, cum, km: driveKm });
    push(Math.max(hours(realTo - realFrom), MIN_DRIVE_HOURS), {
      kind: 'drive',
      drive: drives.length - 1,
      caption: `Vers ${placeOf(segment.to)}`,
      realFrom,
      realTo,
      day: segment.day,
      stopsReached: stops.indexOf(segment.from) + 1,
    });
    km += driveKm;
    addStop(stops.indexOf(segment.to));
  }
  return { phases, total, drives, stops };
}

/** Partie d'un tracé parcourue à la fraction `f` de sa longueur, et la position atteinte. */
function partial(drive: Drive, f: number): { coords: Point[]; at: Point } {
  const target = drive.cum.at(-1)! * f;
  let i = drive.cum.findIndex((c) => c >= target);
  if (i <= 0) i = Math.max(i, 1);
  const [a, b] = [drive.coords[i - 1], drive.coords[i]];
  const span = drive.cum[i] - drive.cum[i - 1];
  const t = span ? (target - drive.cum[i - 1]) / span : 1;
  const at: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { coords: [...drive.coords.slice(0, i), at], at };
}

/** Image de l'animation à l'instant `t` (de 0 au début à 1 à la fin). */
export function replayFrame(replay: Replay, t: number): ReplayFrame | null {
  const { phases, drives, stops } = replay;
  if (!phases.length) return null;
  const w = Math.min(Math.max(t, 0), 1) * replay.total;
  const phase = phases.find((p) => w <= p.to) ?? phases.at(-1)!;
  const f = phase.to > phase.from ? Math.min(Math.max((w - phase.from) / (phase.to - phase.from), 0), 1) : 1;
  const clock = new Date(phase.realFrom + (phase.realTo - phase.realFrom) * f);
  // Trajets déjà faits : ceux d'avant le trajet en cours, ou tous ceux d'avant cet arrêt.
  const before = phase.kind === 'drive' ? phase.drive : drives.length;
  const finished = phases.filter((p) => p.kind === 'drive' && p.drive < before && p.to <= phase.from);
  const lines = finished.map((p) => {
    const d = drives[(p as { drive: number }).drive];
    return { color: d.color, coords: d.coords };
  });
  let truck: Point;
  let km = phase.kmBefore;
  if (phase.kind === 'drive') {
    const drive = drives[phase.drive];
    const part = partial(drive, f);
    lines.push({ color: drive.color, coords: part.coords });
    truck = part.at;
    km += drive.km * f;
  } else {
    const stop = stops[phase.stop];
    truck = [stop.lat, stop.lon];
  }
  return {
    kind: phase.kind,
    // Pendant un repos, le jour suit l'horloge (la nuit passe au lendemain).
    day: phase.kind === 'rest' ? dayKey(clock.toISOString()) : phase.day,
    clock,
    km,
    lines,
    stopsReached: phase.kind === 'drive' && f >= 1 ? phase.stopsReached + 1 : phase.stopsReached,
    truck,
    caption: phase.caption,
  };
}
