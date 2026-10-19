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

export interface RestCheck {
  /** Le plus grave des messages. */
  level: RestLevel;
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

/** « 11 h 20 », « 9 h », « 52 h 05 ». */
export function hoursLabel(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
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
          lines.push(
            r < DAILY_REDUCED
              ? {
                  level: 'error',
                  text: `Repos trop court : ${hoursLabel(r)} depuis la fin de journée ${endText} (9 h au moins, 11 h normalement).`,
                }
              : lateLine(),
          );
        } else if (counted < DAILY) {
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
      const level = lines.reduce<RestLevel>((worst, l) => (RANK[l.level] > RANK[worst] ? l.level : worst), 'ok');
      checks.set(e.id, { level, minutes, lines });
    }
    lastBoundary = e;
    dayStart = e;
    workDuringRest = null;
  }
  return checks;
}
