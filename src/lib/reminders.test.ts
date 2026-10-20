import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_TYPES,
  dueReminders,
  reminderLevel,
  setEntry,
  snooze,
  type ReminderSettings,
} from './reminders';

const now = new Date('2026-10-19T10:00');
const settings = (items: ReminderSettings['items'], plates = { tractor: '', trailer: '' }): ReminderSettings => ({
  ...DEFAULT_REMINDER_SETTINGS,
  ...plates,
  items,
});

describe('échéances', () => {
  it('rappelle un contrôle technique un mois avant, avec la plaque', () => {
    const s = settings({ ct_remorque: { last: '2025-11-12' } }, { tractor: '', trailer: 'XX-000-XX' });
    expect(dueReminders(s, now)).toEqual([
      {
        kind: 'ct_remorque',
        level: 'warn',
        text: 'Contrôle technique de la remorque XX-000-XX avant le 12 nov. 2026 · dans 24 jours',
      },
    ]);
  });

  it('rien trop tôt ; délai selon le document', () => {
    expect(dueReminders(settings({ ct_tracteur: { last: '2025-12-01' } }), now)).toEqual([]);
    // FCO : 3 mois avant.
    expect(dueReminders(settings({ fco: { last: '2021-12-20' } }), now)).toHaveLength(1);
  });

  it('visite médicale : périodicité choisie', () => {
    expect(dueReminders(settings({ medical: { last: '2024-11-01' } }), now)).toEqual([]);
    expect(dueReminders(settings({ medical: { last: '2024-11-01', years: 2 } }), now)[0].text).toBe(
      'Visite médicale du permis avant le 1 nov. 2026 · dans 13 jours',
    );
  });

  it('échéance dépassée en rouge, la plus urgente d’abord', () => {
    const s = settings({ chrono: { last: '2024-11-01' }, carte: { last: '2021-10-01' } });
    expect(dueReminders(s, now)).toEqual([
      { kind: 'carte', level: 'error', text: 'Carte conducteur : échéance dépassée (1 oct. 2026, depuis 18 jours)' },
      { kind: 'chrono', level: 'warn', text: 'Étalonnage du chronotachygraphe avant le 1 nov. 2026 · dans 13 jours' },
    ]);
  });

  it('repoussé d’une semaine ; une nouvelle date efface le report', () => {
    const s = snooze(settings({ ct_tracteur: { last: '2025-11-01' } }), 'ct_tracteur', now);
    expect(s.items.ct_tracteur!.snoozedUntil).toBe('2026-10-26');
    expect(dueReminders(s, now)).toEqual([]);
    expect(dueReminders(s, new Date('2026-10-26T08:00'))).toHaveLength(1);
    expect(setEntry(s, 'ct_tracteur', { last: '2025-11-02' }).items.ct_tracteur!.snoozedUntil).toBeNull();
  });

  it('couleur dans les Options, même repoussé', () => {
    const ct = REMINDER_TYPES.find((t) => t.kind === 'ct_tracteur')!;
    expect(reminderLevel(ct, { last: '2025-12-01' }, now)).toBeNull();
    expect(reminderLevel(ct, { last: '2025-11-01', snoozedUntil: '2026-10-26' }, now)).toBe('warn');
    expect(reminderLevel(ct, { last: '2025-10-01' }, now)).toBe('error');
    expect(reminderLevel(ct, undefined, now)).toBeNull();
  });
});
