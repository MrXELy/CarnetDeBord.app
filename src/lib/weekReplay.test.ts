import { describe, expect, it } from 'vitest';
import type { TripEvent } from '../types';
import { buildReplay, replayFrame } from './weekReplay';
import { buildStops } from './weekStops';

// Centres de villes publiques.
const NARBONNE: [number, number] = [43.184, 3.004];
const CARCASSONNE: [number, number] = [43.213, 2.349];
const TOULOUSE: [number, number] = [43.605, 1.444];
const PERIGUEUX: [number, number] = [45.185, 0.721];

function ev(id: string, occurred: string, at: [number, number], city: string, km: number, type: TripEvent['type']): TripEvent {
  return {
    id, type, occurred_at: new Date(occurred).toISOString(), tractor_plate: 'AB-123-CD', trailer_plate: '',
    odometer_km: km, notes: null, client: 'Client secret', cmr_number: null, station: null, diesel_l: null, adblue_l: null,
    city, postcode: null, department: null, country_code: 'FR', lat: at[0], lon: at[1], updated_at: '', deleted_at: null,
  };
}

// Mardi : Narbonne → Carcassonne → Toulouse (fin) ; mercredi : Toulouse → Périgueux.
const week = [
  ev('deb3', '2026-02-03T06:00', NARBONNE, 'Narbonne', 1000, 'debut_journee'),
  ev('cha3', '2026-02-03T08:00', CARCASSONNE, 'Carcassonne', 1062, 'chargement'),
  ev('fin3', '2026-02-03T12:00', TOULOUSE, 'Toulouse', 1160, 'fin_journee'),
  ev('deb4', '2026-02-04T06:00', TOULOUSE, 'Toulouse', 1160, 'debut_journee'),
  ev('liv4', '2026-02-04T10:00', PERIGUEUX, 'Périgueux', 1400, 'livraison'),
  ev('fin4', '2026-02-04T18:00', PERIGUEUX, 'Périgueux', 1400, 'fin_journee'),
];

describe('buildReplay', () => {
  it('suit la semaine dans l’ordre : arrêts, trajets et repos de la nuit', () => {
    const replay = buildReplay(buildStops(week).stops);
    expect(replay.phases.map((p) => [p.kind, p.caption])).toEqual([
      ['stop', 'Début — Narbonne'],
      ['drive', 'Vers Carcassonne'],
      ['stop', 'Chargement — Carcassonne'],
      ['drive', 'Vers Toulouse'],
      ['stop', 'Fin — Toulouse'],
      ['rest', 'Repos · 18 h'],
      ['stop', 'Début — Toulouse'],
      ['drive', 'Vers Périgueux'],
      ['stop', 'Livraison · Fin — Périgueux'],
    ]);
    // Pas de nom de client dans les textes.
    expect(JSON.stringify(replay.phases)).not.toContain('Client');
  });

  it('fait rouler le camion à vitesse constante, arrêts et repos à durée fixe', () => {
    const replay = buildReplay(buildStops(week).stops, [], 30);
    expect(replay.total).toBeCloseTo(30);
    const drives = replay.phases.filter((p) => p.kind === 'drive');
    // Secondes par km de tracé : les mêmes pour chaque trajet.
    const speeds = drives.map((p) => (p.to - p.from) / replay.drives[(p as { drive: number }).drive].cum.at(-1)!);
    for (const v of speeds) expect(v).toBeCloseTo(speeds[0]);
    const pauses = replay.phases.filter((p) => p.kind !== 'drive').map((p) => +(p.to - p.from).toFixed(2));
    expect(pauses).toEqual([1.6, 1.6, 1.6, 2.6, 1.6, 1.6]);
    expect(replay.readableDuration).toBe(18); // 10,6 s d'arrêts ÷ 60 %
  });

  it('raccourcit arrêts et repos si l’animation est trop courte', () => {
    const replay = buildReplay(buildStops(week).stops, [], 10);
    const pauses = replay.phases.filter((p) => p.kind !== 'drive').reduce((sum, p) => sum + p.to - p.from, 0);
    expect(pauses).toBeCloseTo(6); // 60 % des 10 s
    expect(replay.total).toBeCloseTo(10);
  });

  it('met un repos avant un trajet qui part après une fin de journée', () => {
    // Fin de journée à Carcassonne, reprise le lendemain à Toulouse (repos ailleurs, non noté).
    const events = [
      ev('fin', '2026-02-03T18:00', CARCASSONNE, 'Carcassonne', 1062, 'fin_journee'),
      ev('deb', '2026-02-04T08:00', TOULOUSE, 'Toulouse', 1160, 'debut_journee'),
    ];
    const replay = buildReplay(buildStops(events).stops);
    expect(replay.phases.map((p) => p.kind)).toEqual(['stop', 'rest', 'drive', 'stop']);
    const drive = replay.phases[2];
    // Trajet de 98 km à 70 km/h : 1 h 24 avant l'arrivée.
    expect(new Date(drive.realFrom).toISOString()).toBe(new Date('2026-02-04T06:36').toISOString());
  });
});

describe('replayFrame', () => {
  const replay = buildReplay(buildStops(week).stops);

  it('commence au premier lieu, sans trajet ni km', () => {
    const f = replayFrame(replay, 0)!;
    expect(f).toMatchObject({ kind: 'stop', km: 0, lines: [], truck: NARBONNE, stopsReached: 1, caption: 'Début — Narbonne' });
    expect(f.clock.toISOString()).toBe(new Date('2026-02-03T06:00').toISOString());
  });

  it('finit au dernier lieu avec tous les trajets et les km au compteur', () => {
    const f = replayFrame(replay, 1)!;
    expect(f).toMatchObject({ kind: 'stop', km: 400, truck: PERIGUEUX, stopsReached: 4 });
    expect(f.lines).toHaveLength(3);
  });

  it('passe au lendemain pendant le repos de la nuit', () => {
    const rest = replay.phases[5];
    expect(replayFrame(replay, (rest.from + 0.1 * (rest.to - rest.from)) / replay.total)!.day).toBe('2026-02-03');
    expect(replayFrame(replay, (rest.from + 0.9 * (rest.to - rest.from)) / replay.total)!.day).toBe('2026-02-04');
  });

  it('fait avancer le camion le long du trajet en cours', () => {
    const drive = replay.phases[1];
    const f = replayFrame(replay, ((drive.from + drive.to) / 2) / replay.total)!;
    expect(f.kind).toBe('drive');
    expect(f.km).toBeCloseTo(31, 0); // moitié des 62 km
    expect(f.lines).toHaveLength(1);
    expect(f.truck[1]).toBeGreaterThan(CARCASSONNE[1]);
    expect(f.truck[1]).toBeLessThan(NARBONNE[1]);
    expect(f.clock.toISOString()).toBe(new Date('2026-02-03T07:00').toISOString());
  });
});
