import { describe, expect, it } from 'vitest';
import type { TripEvent } from '../types';
import { hoursLabel, restChecks } from './rest';

let n = 0;
type Ev = Pick<TripEvent, 'id' | 'type' | 'occurred_at' | 'country_code'>;
const ev = (type: TripEvent['type'], at: string, country: string | null = 'FR'): Ev => ({
  id: `e${n++}`,
  type,
  occurred_at: new Date(at).toISOString(),
  country_code: country,
});

/** Une journée : début et fin (heures locales). */
const day = (start: string, end: string, country: string | null = 'FR') => [
  ev('debut_journee', start, country),
  ev('fin_journee', end, country),
];

/** Du mardi 13 au samedi 17 oct., repos de 13 h, fin le samedi à 12:00. */
const workWeek = (country: string | null = 'FR') => [
  ...[13, 14, 15, 16].flatMap((d) => day(`2026-10-${d}T05:00`, `2026-10-${d}T16:00`, country)),
  ...day('2026-10-17T05:00', '2026-10-17T12:00', country),
];

const checkOf = (events: Ev[], id: string) => restChecks(events).get(id)!;
const texts = (events: Ev[], id: string) => checkOf(events, id).lines.map((l) => l.text);

describe('repos journalier', () => {
  it('11 h et plus : repos normal, discret', () => {
    const events = [...day('2026-10-13T05:00', '2026-10-13T18:00')];
    const next = ev('debut_journee', '2026-10-14T05:20');
    const c = checkOf([...events, next], next.id);
    expect(c.level).toBe('ok');
    expect(c.minutes).toBe(11 * 60 + 20);
    expect(c.lines[0].text).toBe('Repos : 11 h 20 depuis la fin de journée la veille à 18:00.');
  });

  it('moins de 9 h : repos trop court', () => {
    const events = [...day('2026-10-13T05:00', '2026-10-13T21:30')];
    const next = ev('debut_journee', '2026-10-14T05:00');
    const c = checkOf([...events, next], next.id);
    expect(c.level).toBe('error');
    expect(c.lines[0].text).toContain('Repos trop court : 7 h 30');
  });

  it('compte les repos réduits depuis le repos hebdomadaire, 3 au plus', () => {
    const events = [
      ...day('2026-10-12T05:00', '2026-10-12T19:00'),
      ...day('2026-10-13T05:00', '2026-10-13T19:00'), // 10 h avant
      ...day('2026-10-14T05:00', '2026-10-14T19:00'), // 10 h
      ...day('2026-10-15T05:00', '2026-10-15T19:00'), // 10 h
      ...day('2026-10-16T05:00', '2026-10-16T19:00'), // 10 h
    ];
    const starts = events.filter((e) => e.type === 'debut_journee');
    const checks = restChecks(events);
    expect(checks.get(starts[1].id)!.lines[0].text).toContain('1er sur 3');
    expect(checks.get(starts[1].id)!.level).toBe('ok');
    expect(checks.get(starts[2].id)!.lines[0].text).toContain('2e sur 3');
    expect(checks.get(starts[3].id)!.level).toBe('warn');
    expect(checks.get(starts[3].id)!.lines[0].text).toContain('les suivants devront faire 11 h');
    expect(checks.get(starts[4].id)!.level).toBe('error');
    expect(checks.get(starts[4].id)!.lines[0].text).toContain('4e repos réduit');
  });

  it('le compteur repart après un repos hebdomadaire', () => {
    const events = [
      ...day('2026-10-14T05:00', '2026-10-14T19:00'),
      ...day('2026-10-15T05:00', '2026-10-15T19:00'),
      ...day('2026-10-16T05:00', '2026-10-16T19:00'),
      ...day('2026-10-17T05:00', '2026-10-17T12:00'),
      ...day('2026-10-19T05:00', '2026-10-19T19:00'), // 41 h : hebdo réduit
    ];
    const next = ev('debut_journee', '2026-10-20T05:00');
    expect(texts([...events, next], next.id)[0]).toContain('1er sur 3');
  });

  it('repos pris trop tard : moins de 9 h dans les 24 h après le début de la veille', () => {
    // Début 05:00, fin 21:00 (16 h), reprise 07:00 : 10 h de repos, mais 8 h avant 05:00.
    const events = [...day('2026-10-13T05:00', '2026-10-13T21:00')];
    const next = ev('debut_journee', '2026-10-14T07:00');
    const c = checkOf([...events, next], next.id);
    expect(c.level).toBe('error');
    expect(c.lines[0].text).toContain('Repos pris trop tard : la journée d’avant a duré 16 h');
    expect(c.lines[0].text).toContain('s’arrêter avant 20:00');
  });

  it('long repos commencé tard : compté réduit pour sa part dans les 24 h', () => {
    // Début 05:00, fin 19:00, reprise 07:00 : 12 h, mais 10 h avant 05:00.
    const events = [...day('2026-10-13T05:00', '2026-10-13T19:00')];
    const next = ev('debut_journee', '2026-10-14T07:00');
    expect(texts([...events, next], next.id)[0]).toBe(
      'Repos : 12 h depuis la fin de journée la veille à 19:00, dont 10 h dans les 24 h après le début de la journée d’avant (la veille à 05:00) : compte comme réduit · 1er sur 3 depuis le repos hebdomadaire.',
    );
  });

  it('fin de journée oubliée : prévient, sans calcul', () => {
    const events = [ev('debut_journee', '2026-10-13T05:00'), ev('livraison', '2026-10-13T15:00')];
    const next = ev('debut_journee', '2026-10-14T05:00');
    const c = checkOf([...events, next], next.id);
    expect(c.level).toBe('warn');
    expect(c.minutes).toBeNull();
    expect(c.lines[0].text).toContain('Pas de fin de journée notée depuis le début de journée la veille à 05:00');
  });

  it('étape notée pendant le repos', () => {
    const events = [...day('2026-10-13T05:00', '2026-10-13T17:00'), ev('livraison', '2026-10-13T22:00')];
    const next = ev('debut_journee', '2026-10-14T05:00');
    expect(texts([...events, next], next.id)).toContain(
      'Étape « Livraison » notée pendant le repos (la veille à 22:00) : vérifie les heures.',
    );
  });

  it('étape à la même heure que le début de journée : pas pendant le repos', () => {
    const events = [...day('2026-10-13T05:00', '2026-10-13T17:00'), ev('chargement', '2026-10-14T05:00')];
    const next = ev('debut_journee', '2026-10-14T05:00');
    expect(checkOf([...events, next], next.id).level).toBe('ok');
  });

  it('première journée : rien à dire', () => {
    const first = ev('debut_journee', '2026-10-13T05:00');
    expect(restChecks([first]).has(first.id)).toBe(false);
  });
});

describe('repos hebdomadaire', () => {
  it('45 h et plus : repos normal', () => {
    const events = [...day('2026-10-16T05:00', '2026-10-16T12:00')];
    const next = ev('debut_journee', '2026-10-19T04:00');
    const c = checkOf([...events, next], next.id);
    expect(c.level).toBe('ok');
    expect(c.lines[0].text).toBe('Repos hebdomadaire : 64 h depuis la fin de journée ven. 16 oct. à 12:00.');
  });

  it('réduit : à rattraper avant la fin de la 3e semaine', () => {
    const events = [...day('2026-10-17T05:00', '2026-10-17T12:00')]; // samedi, semaine du 12 oct.
    const next = ev('debut_journee', '2026-10-18T22:00'); // 34 h
    const lines = checkOf([...events, next], next.id).lines;
    expect(lines[0]).toEqual({
      level: 'warn',
      text: 'Repos hebdomadaire réduit : 34 h depuis la fin de journée la veille à 12:00 (45 h normalement).',
    });
    expect(lines[1].text).toBe(
      '11 h à rattraper en une fois, accolées à un repos d’au moins 9 h, avant la fin du dim. 8 nov.',
    );
  });

  it('deux réduits de suite en France : interdit', () => {
    const events = [
      ...day('2026-10-10T05:00', '2026-10-10T12:00'),
      ...day('2026-10-11T22:00', '2026-10-12T08:00'), // 34 h
      ...workWeek(),
    ];
    const next = ev('debut_journee', '2026-10-18T22:00'); // 34 h
    const c = checkOf([...events, next], next.id);
    expect(c.level).toBe('error');
    expect(c.lines.map((l) => l.text)).toContain(
      'Deuxième repos hebdomadaire réduit de suite : il faut au moins un repos normal (45 h) sur deux semaines.',
    );
  });

  it('deux réduits de suite hors de France : permis, avec rappel', () => {
    const events = [
      ...day('2026-10-10T05:00', '2026-10-10T12:00', 'ES'),
      ...day('2026-10-11T22:00', '2026-10-12T08:00', 'ES'),
      ...workWeek('IT'),
    ];
    const next = ev('debut_journee', '2026-10-18T22:00', 'IT');
    const c = checkOf([...events, next], next.id);
    expect(c.level).toBe('warn');
    expect(c.lines.map((l) => l.text)).toContain(
      'Deuxième repos réduit de suite, permis en international hors de France : les 2 suivants doivent être normaux (45 h).',
    );
  });

  it('rattrapage pris avec un repos plus long, sinon signalé en retard', () => {
    const reduced = [
      ...day('2026-10-17T05:00', '2026-10-17T12:00'),
      ...day('2026-10-18T22:00', '2026-10-19T08:00'), // 34 h : 11 h à rattraper
    ];
    // Repos de 22 h (11 h + 11 h) : rattrapage fait.
    const paid = ev('debut_journee', '2026-10-20T06:00');
    expect(texts([...reduced, paid], paid.id)).toContain(
      'Ce repos rattrape les 11 h du repos hebdomadaire réduit du sam. 17 oct.',
    );

    // Sinon rappel, puis retard après le dim. 8 nov.
    const reminder = ev('debut_journee', '2026-10-20T05:00');
    expect(texts([...reduced, reminder], reminder.id)).toContain(
      'Reste à rattraper : 11 h (repos réduit du sam. 17 oct.) avant la fin du dim. 8 nov.',
    );
    const late = [...reduced, ...day('2026-10-20T05:00', '2026-11-09T18:00')];
    const after = ev('debut_journee', '2026-11-10T05:00');
    const c = checkOf([...late, after], after.id);
    expect(c.level).toBe('error');
    expect(c.lines.map((l) => l.text)).toContain(
      '11 h du repos hebdomadaire réduit du sam. 17 oct. pas rattrapées à temps (avant la fin du dim. 8 nov.).',
    );
  });
});

describe('hoursLabel', () => {
  it('écrit les heures et minutes', () => {
    expect(hoursLabel(9 * 60)).toBe('9 h');
    expect(hoursLabel(11 * 60 + 5)).toBe('11 h 05');
  });
});
