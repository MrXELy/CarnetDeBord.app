import { describe, expect, it } from 'vitest';
import { project } from '../components/MapSvg';
import type { TripEvent } from '../types';
import { cameraAt, cameraTrack, OUTRO_SECONDS } from './replayCamera';
import { replayBox } from './replayDraw';
import { buildReplay } from './weekReplay';
import { buildStops } from './weekStops';

// Centres de villes publiques.
const NARBONNE: [number, number] = [43.184, 3.004];
const TOULOUSE: [number, number] = [43.605, 1.444];
const PERIGUEUX: [number, number] = [45.185, 0.721];

function ev(id: string, occurred: string, at: [number, number], km: number, type: TripEvent['type']): TripEvent {
  return {
    id, type, occurred_at: new Date(occurred).toISOString(), tractor_plate: 'AB-123-CD', trailer_plate: '',
    odometer_km: km, notes: null, client: null, cmr_number: null, station: null, diesel_l: null, adblue_l: null,
    city: 'Ville', postcode: null, department: null, country_code: 'FR', lat: at[0], lon: at[1], updated_at: '', deleted_at: null,
  };
}

const week = [
  ev('deb', '2026-02-03T06:00', NARBONNE, 1000, 'debut_journee'),
  ev('liv', '2026-02-03T08:30', TOULOUSE, 1150, 'livraison'),
  ev('fin', '2026-02-03T12:00', PERIGUEUX, 1420, 'fin_journee'),
];
const replay = buildReplay(buildStops(week).stops, [], 20);
const full = replayBox(replay, 'square');
const ratio = 1080 / 760;
const track = cameraTrack(replay, full, ratio);
const centre = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2];

describe('cameraAt', () => {
  it('commence près du camion, plus serré que toute la semaine, à la forme de la carte', () => {
    const view = cameraAt(track, 0);
    const [cx, cy] = centre(view);
    const [nx, ny] = project(NARBONNE);
    expect(Math.hypot(cx - nx, cy - ny)).toBeLessThan(view.width / 2);
    expect(view.width).toBeLessThan(full.width);
    expect(view.width).toBeGreaterThan(2.49);
    expect(view.width / view.height).toBeCloseTo(ratio);
  
  });

  it('bouge en douceur : pas de saut d’une image à la suivante', () => {
    let previous = cameraAt(track, 0);
    for (let s = 1 / 30; s <= replay.total + OUTRO_SECONDS; s += 1 / 30) {
      const view = cameraAt(track, s);
      const [a, b] = [centre(previous), centre(view)];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.08 * view.width);
      expect(Math.abs(Math.log(view.width / previous.width))).toBeLessThan(0.05);
      previous = view;
    }
  });

  it('finit sur toute la semaine', () => {
    const end = cameraAt(track, replay.total + OUTRO_SECONDS);
    expect(end.x).toBeCloseTo(full.x);
    expect(end.y).toBeCloseTo(full.y);
    expect(end.width).toBeCloseTo(full.width);
  });

  it('suit la largeur de vue choisie', () => {
    const wide = cameraTrack(replay, full, ratio, 600);
    expect(cameraAt(wide, 0).width).toBeCloseTo(Math.min(600 / 111, full.width));
    expect(cameraAt(wide, 0).width).toBeGreaterThan(cameraAt(track, 0).width);
  });
});
