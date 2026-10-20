import {
  addHours,
  addWeeks,
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  startOfISOWeek,
  subDays,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { eventTypeInfo, isDayBoundary, type TripEvent } from '../types';

/*
 * Temps de repos (RSE, règlement CE 561/2006), vérifiés à chaque début de journée.
 * Repos = de la fin de journée au début de journée suivant (les pauses ne sont pas notées :
 * un repos fractionné 3 h + 9 h compte comme réduit).
 * - Journalier : 11 h, ou 9 h « réduit », au plus 3 fois entre deux repos hebdomadaires ;
 *   pris dans les 24 h qui suivent la fin du repos précédent (le début de la journée d'avant).
 * - Hebdomadaire (24 h et plus) : 45 h, ou 24 h « réduit » ; pas deux réduits de suite, sauf en transport
 *   international si les deux sont pris hors de France (et alors pas plus de 2 réduits sur 4 repos) ;
 *   le manque (45 h − repos) se rattrape en une fois, accolé à un autre repos, avant la fin de la 3e semaine
 *   (lundi 0 h – dimanche 24 h) qui suit.
 */

export type RestLevel = 'ok' | 'warn' | 'error';

export interface RestLine {
  level: RestLevel;
  text: string;
}

export type RestKind = 'journalier' | 'journalier_reduit' | 'hebdo' | 'hebdo_reduit' | 'insuffisant';

export interface RestCheck {
  /** Le plus grave des messages. */
  level: RestLevel;
  /** Sorte de repos ; null si la fin de journée d'avant manque. */
  kind: RestKind | null;
  /** Durée du repos en minutes ; null si la fin de journée d'avant manque. */
  minutes: number | null;
  lines: RestLine[];
}

type RestEvent = Pick<TripEvent, 'id' | 'type' | 'occurred_at' | 'country_code'>;

const H = 60;
const DAILY = 11 * H;
const DAILY_REDUCED = 9 * H;
const WEEKLY = 45 * H;
const WEEKLY_REDUCED = 24 * H;
const MAX_REDUCED_DAILY = 3;

const RANK: Record<RestLevel, number> = { ok: 0, warn: 1, error: 2 };

/** « 11 h 20 », « 9 h », « 52 h 05 », « 30 min ». */
export function hoursLabel(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

/** Moment d'avant, dit depuis le début de journée : « la veille à 19:05 », « jeu. 16 oct. à 05:00 ». */
function since(date: Date, ref: Date): string {
  const days = differenceInCalendarDays(ref, date);
  const time = format(date, 'HH:mm');
  if (days === 0) return `à ${time}`;
  if (days === 1) return `la veille à ${time}`;
  return `${format(date, 'EEE d MMM', { locale: fr })} à ${time}`;
}

const dayDate = (date: Date) => format(date, 'EEE d MMM', { locale: fr });

/** Termine une phrase par un point, sans doubler celui d'une abréviation (« 8 nov. »). */
const sentence = (text: string) => (text.endsWith('.') ? text : `${text}.`);

const abroad = (e: RestEvent) => !!e.country_code && e.country_code !== 'FR';

interface Weekly {
  reduced: boolean;
  abroad: boolean;
}

interface Debt {
  /** Début du repos réduit. */
  from: Date;
  owed: number;
  /** Fin de la 3e semaine qui suit : lundi 0 h de la 4e. */
  deadline: Date;
}

/** Contrôle des repos de chaque début de journée de l'historique (clé : id de l'étape). */
export function restChecks(events: readonly RestEvent[]): Map<string, RestCheck> {
  return walk(events).checks;
}

/** Parcourt l'historique dans l'ordre : contrôle de chaque début de journée, et état à la fin. */
function walk(events: readonly RestEvent[]) {
  // Par heure (les dates ne sont pas toujours écrites pareil) ; à la même heure, le début de journée d'abord, la fin en dernier.
  const order = (e: RestEvent) => (e.type === 'debut_journee' ? 0 : e.type === 'fin_journee' ? 2 : 1);
  const sorted = [...events]
    .map((e) => ({ e, t: Date.parse(e.occurred_at) }))
    .sort((a, b) => a.t - b.t || order(a.e) - order(b.e))
    .map(({ e }) => e);
  const checks = new Map<string, RestCheck>();
  let lastBoundary: RestEvent | null = null;
  let dayStart: RestEvent | null = null;
  let workDuringRest: RestEvent | null = null;
  let reducedDaily = 0;
  const weeklies: Weekly[] = [];
  let debts: Debt[] = [];

  for (const e of sorted) {
    if (!isDayBoundary(e.type)) {
      if (lastBoundary?.type === 'fin_journee' && !workDuringRest) workDuringRest = e;
      continue;
    }
    if (e.type === 'fin_journee') {
      lastBoundary = e;
      workDuringRest = null;
      continue;
    }

    const start = new Date(e.occurred_at);
    const lines: RestLine[] = [];
    let minutes: number | null = null;
    let kind: RestKind | null = null;

    if (lastBoundary?.type === 'debut_journee') {
      lines.push({
        level: 'warn',
        text: `Pas de fin de journée notée depuis le début de journée ${since(new Date(lastBoundary.occurred_at), start)} : repos impossible à vérifier.`,
      });
    } else if (lastBoundary) {
      const end = new Date(lastBoundary.occurred_at);
      const r = differenceInMinutes(start, end);
      minutes = r;
      const endText = since(end, start);

      // Repos compté dans les 24 h qui suivent le début de la journée d'avant.
      const prevStart = dayStart ? new Date(dayStart.occurred_at) : null;
      const amplitude = prevStart ? differenceInMinutes(end, prevStart) : null;
      // Journée de plus de 24 h : sans doute une étape oubliée, pas de contrôle des 24 h.
      const longDay = amplitude != null && amplitude > 24 * H;
      const inWindow = prevStart && !longDay ? Math.min(r, differenceInMinutes(addHours(prevStart, 24), end)) : r;
      const lateLine = (): RestLine => ({
        level: 'error',
        text:
          `Repos pris trop tard : la journée d’avant a duré ${hoursLabel(amplitude!)} (début ${since(prevStart!, start)}). ` +
          `Il faut 9 h de repos dans les 24 h qui suivent ce début : s’arrêter avant ${format(addHours(prevStart!, 15), 'HH:mm')}.`,
      });

      if (r >= WEEKLY_REDUCED) {
        const reduced = r < WEEKLY;
        kind = reduced ? 'hebdo_reduit' : 'hebdo';
        const here = { reduced, abroad: abroad(lastBoundary) && abroad(e) };
        if (inWindow < DAILY_REDUCED) lines.push(lateLine());
        if (!reduced) {
          lines.push({
            level: 'ok',
            text: `Repos hebdomadaire : ${hoursLabel(r)} depuis la fin de journée ${endText}.`,
          });
        } else {
          lines.push({
            level: 'warn',
            text: `Repos hebdomadaire réduit : ${hoursLabel(r)} depuis la fin de journée ${endText} (45 h normalement).`,
          });
          const prev = weeklies[weeklies.length - 1];
          const reducedOf4 = [...weeklies.slice(-3), here].filter((w) => w.reduced).length;
          if (prev?.reduced && !(prev.abroad && here.abroad)) {
            lines.push({
              level: 'error',
              text: 'Deuxième repos hebdomadaire réduit de suite : il faut au moins un repos normal (45 h) sur deux semaines.',
            });
          } else if (reducedOf4 > 2) {
            lines.push({
              level: 'error',
              text: 'Plus de 2 repos hebdomadaires réduits sur les 4 derniers : il en faut au moins 2 normaux (45 h).',
            });
          } else if (prev?.reduced) {
            lines.push({
              level: 'warn',
              text: 'Deuxième repos réduit de suite, permis en international hors de France : les 2 suivants doivent être normaux (45 h).',
            });
          }
          const deadline = addWeeks(startOfISOWeek(end), 4);
          debts.push({ from: end, owed: WEEKLY - r, deadline });
          lines.push({
            level: 'warn',
            text: sentence(
              `${hoursLabel(WEEKLY - r)} à rattraper en une fois, accolées à un repos d’au moins 9 h, avant la fin du ${dayDate(subDays(deadline, 1))}`,
            ),
          });
        }
        weeklies.push(here);
        reducedDaily = 0;
      } else {
        const counted = Math.min(r, inWindow);
        if (counted < DAILY_REDUCED) {
          kind = 'insuffisant';
          lines.push(
            r < DAILY_REDUCED
              ? {
                  level: 'error',
                  text: `Repos trop court : ${hoursLabel(r)} depuis la fin de journée ${endText} (9 h au moins, 11 h normalement).`,
                }
              : lateLine(),
          );
        } else if (counted < DAILY) {
          kind = 'journalier_reduit';
          reducedDaily++;
          const n = reducedDaily;
          // Repos de 11 h et plus commencé tard : seule sa part dans les 24 h compte.
          const head =
            r >= DAILY
              ? `Repos : ${hoursLabel(r)} depuis la fin de journée ${endText}, dont ${hoursLabel(counted)} dans les 24 h après le début de la journée d’avant (${since(prevStart!, start)}) : compte comme réduit`
              : `Repos réduit : ${hoursLabel(r)} depuis la fin de journée ${endText}`;
          lines.push(
            n > MAX_REDUCED_DAILY
              ? { level: 'error', text: `${head}. ${n}e repos réduit depuis le repos hebdomadaire : 3 au plus.` }
              : {
                  level: n === MAX_REDUCED_DAILY ? 'warn' : 'ok',
                  text:
                    `${head} · ${n === 1 ? '1er' : `${n}e`} sur 3 depuis le repos hebdomadaire` +
                    (n === MAX_REDUCED_DAILY ? ' : les suivants devront faire 11 h.' : '.'),
                },
          );
        } else {
          kind = 'journalier';
          lines.push({ level: 'ok', text: `Repos : ${hoursLabel(r)} depuis la fin de journée ${endText}.` });
        }
      }

      if (longDay) {
        lines.push({
          level: 'warn',
          text: `Journée d’avant de plus de 24 h (début ${since(prevStart!, start)}) : vérifie les étapes.`,
        });
      }

      // Rattrapage des repos hebdomadaires réduits : en une fois, au-delà d'un repos normal.
      let surplus = r - (r >= WEEKLY_REDUCED ? WEEKLY : DAILY);
      const open: Debt[] = [];
      for (const debt of debts) {
        if (debt.from >= end) open.push(debt);
        else if (start <= debt.deadline && surplus >= debt.owed) {
          surplus -= debt.owed;
          lines.push({
            level: 'ok',
            text: sentence(
              `Ce repos rattrape les ${hoursLabel(debt.owed)} du repos hebdomadaire réduit du ${dayDate(debt.from)}`,
            ),
          });
        } else open.push(debt);
      }
      debts = open;
    }

    // Rattrapages en retard (dits une fois) ou encore à faire.
    const open: Debt[] = [];
    for (const debt of debts) {
      if (start > debt.deadline) {
        lines.push({
          level: 'error',
          text: `${hoursLabel(debt.owed)} du repos hebdomadaire réduit du ${dayDate(debt.from)} pas rattrapées à temps (avant la fin du ${dayDate(subDays(debt.deadline, 1))}).`,
        });
      } else {
        open.push(debt);
        if (minutes == null || debt.from < new Date(lastBoundary!.occurred_at)) {
          lines.push({
            level: 'ok',
            text: sentence(
              `Reste à rattraper : ${hoursLabel(debt.owed)} (repos réduit du ${dayDate(debt.from)}) avant la fin du ${dayDate(subDays(debt.deadline, 1))}`,
            ),
          });
        }
      }
    }
    debts = open;

    if (workDuringRest) {
      lines.push({
        level: 'warn',
        text: `Étape « ${eventTypeInfo(workDuringRest.type).label} » notée pendant le repos (${since(new Date(workDuringRest.occurred_at), start)}) : vérifie les heures.`,
      });
    }

    if (lines.length > 0) {
      checks.set(e.id, { level: worst(lines), kind, minutes, lines });
    }
    lastBoundary = e;
    dayStart = e;
    workDuringRest = null;
  }
  return { checks, lastBoundary, dayStart, reducedDaily, weeklies, debts };
}

export type RestAdvice = Pick<RestCheck, 'level' | 'lines'>;

/** Heure limite de la journée en cours, avec son début de journée (pour l'afficher sous son jour). */
export type DayLimit = RestAdvice & { startId: string };

const worst = (lines: RestLine[]): RestLevel =>
  lines.reduce<RestLevel>((w, l) => (RANK[l.level] > RANK[w] ? l.level : w), 'ok');

/** Heure dite depuis un moment de référence : « à 18:00 », « demain à 05:30 », « lun. 20 oct. à 04:00 ». */
function at(date: Date, ref: Date): string {
  const days = differenceInCalendarDays(date, ref);
  const time = format(date, 'HH:mm');
  if (days === 0) return `à ${time}`;
  if (days === 1) return `demain à ${time}`;
  return `${format(date, 'EEE d MMM', { locale: fr })} à ${time}`;
}

/** Heure limite : « avant 18:00 », « avant demain 01:00 ». */
function by(date: Date, ref: Date): string {
  const text = at(date, ref);
  return text.startsWith('à ') ? `avant ${text.slice(2)}` : `avant ${text.replace(' à ', ' ')}`;
}

const remainingText = (n: number) => `${n} restant${n > 1 ? 's' : ''} sur 3`;

/** Étapes jusqu'à ce moment compris (sans l'étape modifiée). */
const before = (events: readonly RestEvent[], date: Date, excludeId?: string) =>
  events.filter((e) => e.id !== excludeId && Date.parse(e.occurred_at) <= date.getTime());

/**
 * Fin de journée : heure de reprise possible (repos normal ou réduit ; hebdomadaire du vendredi au dimanche),
 * et rattrapage d'un repos hebdomadaire réduit à prendre.
 */
export function restartAdvice(events: readonly RestEvent[], end: RestEvent): RestAdvice | null {
  const endAt = new Date(end.occurred_at);
  if (Number.isNaN(endAt.getTime())) return null;
  const state = walk([...before(events, endAt, end.id), end]);
  const lines: RestLine[] = [];
  const remaining = Math.max(0, MAX_REDUCED_DAILY - state.reducedDaily);
  const plus = (minutes: number) => at(new Date(endAt.getTime() + minutes * 60_000), endAt);

  const start = state.dayStart ? new Date(state.dayStart.occurred_at) : null;
  const amplitude = start ? differenceInMinutes(endAt, start) : null;
  if (start && amplitude != null && amplitude >= 0 && amplitude <= 24 * H && amplitude > 24 * H - DAILY) {
    // Plus de 13 h : 11 h de repos ne tiennent plus dans les 24 h après le début de journée.
    const dayText = `Journée de ${hoursLabel(amplitude)} (début ${since(start, endAt)})`;
    if (amplitude > 24 * H - DAILY_REDUCED) {
      lines.push({
        level: 'error',
        text: `${dayText} : moins de 9 h de repos possibles dans les 24 h, il fallait s’arrêter ${by(addHours(start, 15), endAt)}.`,
      });
    } else if (remaining === 0) {
      lines.push({
        level: 'error',
        text: `${dayText} : il fallait s’arrêter ${by(addHours(start, 13), endAt)}, plus de repos réduit possible avant le repos hebdomadaire.`,
      });
    } else {
      lines.push({
        level: 'warn',
        text: `${dayText} : le repos comptera comme réduit (${remainingText(remaining)}). Reprise au plus tôt ${plus(DAILY_REDUCED)}.`,
      });
    }
  } else {
    lines.push({
      level: 'ok',
      text:
        `Reprise au plus tôt ${plus(DAILY)} (11 h de repos)` +
        (remaining > 0
          ? `, ou ${plus(DAILY_REDUCED)} avec un repos réduit (${remainingText(remaining)}).`
          : ' : plus de repos réduit possible avant le repos hebdomadaire.'),
    });
  }

  // Vendredi, samedi ou dimanche : repos hebdomadaire.
  const weekend = [0, 5, 6].includes(endAt.getDay());
  if (weekend) {
    const prev = state.weeklies[state.weeklies.length - 1];
    const reducedOf3 = state.weeklies.slice(-3).filter((w) => w.reduced).length;
    const regularOnly = (prev?.reduced && !(prev.abroad && abroad(end))) || reducedOf3 >= 2;
    lines.push({
      level: 'ok',
      text:
        `Repos hebdomadaire : reprise au plus tôt ${plus(WEEKLY)} (45 h)` +
        (regularOnly
          ? ' : repos normal obligatoire, le précédent était réduit.'
          : `, ou ${plus(WEEKLY_REDUCED)} avec un repos réduit (24 h, à rattraper).`),
    });
  }

  const debt = state.debts.find((d) => d.deadline > endAt);
  if (debt) {
    const base = weekend ? WEEKLY : DAILY;
    lines.push({
      level: 'ok',
      text: sentence(
        `Pour rattraper les ${hoursLabel(debt.owed)} du repos réduit du ${dayDate(debt.from)} (avant la fin du ${dayDate(subDays(debt.deadline, 1))}) : reprise ${plus(base + debt.owed)} (${hoursLabel(base)} + ${hoursLabel(debt.owed)})`,
      ),
    });
  }
  return { level: worst(lines), lines };
}

/** Journée en cours (début noté, pas encore de fin) : heure limite de fin pour garder le repos dans les 24 h. */
export function dayLimit(events: readonly RestEvent[], now: Date): DayLimit | null {
  const state = walk(before(events, now));
  if (state.lastBoundary?.type !== 'debut_journee' || !state.dayStart) return null;
  const start = new Date(state.dayStart.occurred_at);
  if (now.getTime() - start.getTime() >= 24 * 3600_000) return null; // fin de journée sans doute oubliée
  const remaining = Math.max(0, MAX_REDUCED_DAILY - state.reducedDaily);
  const normal = addHours(start, 13);
  const reduced = addHours(start, 15);
  const last = remaining > 0 ? reduced : normal;
  const lines: RestLine[] = [];

  if (now > last) {
    lines.push({
      level: 'error',
      text: `Limite dépassée de ${hoursLabel(differenceInMinutes(now, last))} : moins de ${remaining > 0 ? 9 : 11} h de repos possibles dans les 24 h après le début de journée (${format(start, 'HH:mm')}).`,
    });
  } else {
    const level: RestLevel = last.getTime() - now.getTime() <= 3600_000 ? 'warn' : 'ok';
    let text: string;
    if (remaining === 0) {
      text = `Fin de journée ${by(normal, now)} : plus de repos réduit possible avant le repos hebdomadaire.`;
    } else if (now > normal) {
      text = `Fin de journée ${by(reduced, now)} au plus tard (repos réduit, ${remainingText(remaining)}).`;
    } else {
      text = `Fin de journée ${by(normal, now)} pour 11 h de repos, ${by(reduced, now)} au plus tard (repos réduit, ${remainingText(remaining)}).`;
    }
    lines.push({ level, text });
  }
  return { level: worst(lines), lines, startId: state.dayStart.id };
}

export interface RestDebt {
  /** Début du repos hebdomadaire réduit. */
  from: Date;
  owed: number;
  /** Dernier jour pour le rattraper. */
  lastDay: Date;
}

/** Repos hebdomadaires réduits pas encore rattrapés à ce moment (et encore dans les temps). */
export function openDebts(events: readonly RestEvent[], now: Date): RestDebt[] {
  return walk(before(events, now))
    .debts.filter((d) => d.deadline > now)
    .map((d) => ({ from: d.from, owed: d.owed, lastDay: subDays(d.deadline, 1) }));
}

export interface RestSummary {
  daily: number;
  dailyReduced: number;
  weekly: number;
  weeklyReduced: number;
  /** Débuts de journée avec une alerte (orange ou rouge), dans l'ordre. */
  alerts: { id: string; at: Date; level: RestLevel; text: string }[];
}

/** Repos d'une période : comptés au début de journée qui les termine. */
export function restSummary(
  events: readonly RestEvent[],
  checks: Map<string, RestCheck>,
  range: { start: Date; end: Date },
): RestSummary {
  const summary: RestSummary = { daily: 0, dailyReduced: 0, weekly: 0, weeklyReduced: 0, alerts: [] };
  for (const e of events) {
    const at = new Date(e.occurred_at);
    if (e.type !== 'debut_journee' || at < range.start || at >= range.end) continue;
    const check = checks.get(e.id);
    if (!check) continue;
    if (check.kind === 'journalier' || check.kind === 'journalier_reduit' || check.kind === 'insuffisant')
      summary.daily++;
    if (check.kind === 'journalier_reduit') summary.dailyReduced++;
    if (check.kind === 'hebdo' || check.kind === 'hebdo_reduit') summary.weekly++;
    if (check.kind === 'hebdo_reduit') summary.weeklyReduced++;
    if (check.level !== 'ok') {
      const line = check.lines.find((l) => l.level === check.level)!;
      summary.alerts.push({ id: e.id, at, level: check.level, text: line.text });
    }
  }
  summary.alerts.sort((a, b) => a.at.getTime() - b.at.getTime());
  return summary;
}
