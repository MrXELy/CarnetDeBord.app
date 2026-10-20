import { addDays, addYears, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';

/*
 * Échéances administratives : date du dernier passage saisie dans les Options, prochaine échéance calculée,
 * rappel sur l'accueil quelque temps avant (selon le document), repoussable d'une semaine.
 */

export type ReminderKind = 'carte' | 'fco' | 'medical' | 'ct_tracteur' | 'ct_remorque' | 'chrono';

export interface ReminderEntry {
  /** Dernier passage (aaaa-mm-jj). */
  last: string | null;
  /** Périodicité choisie (visite médicale : selon l'âge). */
  years?: number;
  /** Rappel repoussé jusqu'à ce jour (aaaa-mm-jj). */
  snoozedUntil?: string | null;
}

export interface ReminderSettings {
  /** Ensemble routier principal : plaques affichées avec les contrôles techniques. */
  tractor: string;
  trailer: string;
  items: Partial<Record<ReminderKind, ReminderEntry>>;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { tractor: '', trailer: '', items: {} };

export interface ReminderType {
  kind: ReminderKind;
  label: string;
  /** Périodicité par défaut, en années. */
  years: number;
  /** Choix de périodicité proposés (sinon fixe). */
  choices?: number[];
  /** Prévenir tant de jours avant. */
  leadDays: number;
  hint: string;
}

export const REMINDER_TYPES: ReminderType[] = [
  {
    kind: 'carte',
    label: 'Carte conducteur',
    years: 5,
    leadDays: 60,
    hint: 'Valable 5 ans ; la demande de renouvellement doit partir au moins 15 jours ouvrés avant.',
  },
  { kind: 'fco', label: 'FCO', years: 5, leadDays: 90, hint: 'Tous les 5 ans ; stage à réserver à l’avance.' },
  {
    kind: 'medical',
    label: 'Visite médicale du permis',
    years: 5,
    choices: [5, 2, 1],
    leadDays: 60,
    hint: 'Tous les 5 ans jusqu’à 60 ans, puis tous les 2 ans, puis chaque année après 76 ans.',
  },
  { kind: 'ct_tracteur', label: 'Contrôle technique du tracteur', years: 1, leadDays: 30, hint: 'Chaque année.' },
  { kind: 'ct_remorque', label: 'Contrôle technique de la remorque', years: 1, leadDays: 30, hint: 'Chaque année.' },
  {
    kind: 'chrono',
    label: 'Étalonnage du chronotachygraphe',
    years: 2,
    leadDays: 30,
    hint: 'Tous les 2 ans.',
  },
];

const SNOOZE_DAYS = 7;

/** Prochaine échéance d'après le dernier passage ; null si pas de date. */
export function nextDue(type: ReminderType, entry: ReminderEntry | undefined): Date | null {
  if (!entry?.last) return null;
  const last = parseISO(entry.last);
  if (Number.isNaN(last.getTime())) return null;
  return addYears(last, entry.years ?? type.years);
}

export interface DueReminder {
  kind: ReminderKind;
  level: 'warn' | 'error';
  text: string;
}

/** Nom affiché : plaque de l'ensemble principal avec les contrôles techniques. */
export function reminderLabel(type: ReminderType, settings: ReminderSettings): string {
  const plate = type.kind === 'ct_tracteur' ? settings.tractor : type.kind === 'ct_remorque' ? settings.trailer : '';
  return plate ? `${type.label} ${plate}` : type.label;
}

/** « dans 24 jours », « demain », « aujourd’hui ». */
export function daysLeft(due: Date, now: Date): string {
  const days = differenceInCalendarDays(due, now);
  if (days === 0) return 'aujourd’hui';
  if (days === 1) return 'demain';
  if (days > 0) return `dans ${days} jours`;
  return days === -1 ? 'depuis hier' : `depuis ${-days} jours`;
}

const dateText = (date: Date) => format(date, 'd MMM yyyy', { locale: fr });

/** Échéance proche (orange) ou dépassée (rouge), même repoussée ; null si encore loin ou sans date. */
export function reminderLevel(
  type: ReminderType,
  entry: ReminderEntry | undefined,
  now: Date,
): DueReminder['level'] | null {
  const due = nextDue(type, entry);
  const today = startOfDay(now);
  if (!due || differenceInCalendarDays(due, today) > type.leadDays) return null;
  return due <= today ? 'error' : 'warn';
}

/** Échéances à rappeler aujourd'hui (proches ou dépassées, pas repoussées), la plus urgente d'abord. */
export function dueReminders(settings: ReminderSettings, now: Date): DueReminder[] {
  const today = startOfDay(now);
  const list: { due: Date; reminder: DueReminder }[] = [];
  for (const type of REMINDER_TYPES) {
    const entry = settings.items[type.kind];
    const due = nextDue(type, entry);
    const level = reminderLevel(type, entry, now);
    if (!due || !level) continue;
    if (entry?.snoozedUntil && parseISO(entry.snoozedUntil) > today) continue;
    const label = reminderLabel(type, settings);
    const past = level === 'error';
    list.push({
      due,
      reminder: {
        kind: type.kind,
        level,
        text: past
          ? `${label} : échéance dépassée (${dateText(due)}, ${daysLeft(due, today)})`
          : `${label} avant le ${dateText(due)} · ${daysLeft(due, today)}`,
      },
    });
  }
  return list.sort((a, b) => a.due.getTime() - b.due.getTime()).map((r) => r.reminder);
}

/** Réglages avec le rappel repoussé d'une semaine. */
export function snooze(settings: ReminderSettings, kind: ReminderKind, now: Date): ReminderSettings {
  const entry = settings.items[kind] ?? { last: null };
  const until = format(addDays(startOfDay(now), SNOOZE_DAYS), 'yyyy-MM-dd');
  return { ...settings, items: { ...settings.items, [kind]: { ...entry, snoozedUntil: until } } };
}

/** Réglages avec une échéance modifiée ; une nouvelle date efface le rappel repoussé. */
export function setEntry(
  settings: ReminderSettings,
  kind: ReminderKind,
  patch: Partial<ReminderEntry>,
): ReminderSettings {
  const entry = { last: null, ...settings.items[kind], ...patch };
  if ('last' in patch) entry.snoozedUntil = null;
  return { ...settings, items: { ...settings.items, [kind]: entry } };
}
