import { describe, expect, it } from 'vitest';
import { project, stopPins, viewBox, type Box, type NumberedStop, type Point } from './MapSvg';

// Centres de grandes villes (positions publiques).
const NARBONNE: Point = [43.184, 3.004];
const CARCASSONNE: Point = [43.213, 2.349];
const TOULOUSE: Point = [43.605, 1.444];
const MUNICH: Point = [48.137, 11.575]; // hors de France

const stop = ([lat, lon]: Point, number: number, color = '#60a5fa'): NumberedStop => ({
  lat,
  lon,
  number,
  color,
  approximate: false,
});

/** Le point projeté est-il dans le cadre ? */
const inside = (box: Box, point: Point) => {
  const [x, y] = project(point);
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
};

describe('viewBox', () => {
  it('cadre sur les trajets : serré autour des points', () => {
    const box = viewBox([NARBONNE, TOULOUSE]);
    expect(inside(box, NARBONNE) && inside(box, TOULOUSE)).toBe(true);
    expect(inside(box, [48.857, 2.352])).toBe(false); // Paris hors du cadre
  });

  it('cadre France : toute la métropole, même pour un seul trajet', () => {
    const box = viewBox([NARBONNE, TOULOUSE], true);
    for (const p of [
      [48.857, 2.352],
      [51.03, 2.37],
      [43.7, 7.27],
      [48.39, -4.49],
    ] as Point[]) {
      expect(inside(box, p)).toBe(true); // Paris, Dunkerque, Nice, Brest
    }
  });

  it('cadre France agrandi pour un point hors de France', () => {
    const box = viewBox([NARBONNE, MUNICH], true);
    expect(inside(box, MUNICH)).toBe(true);
    expect(inside(box, [48.39, -4.49])).toBe(true); // Brest
  });
});

describe('stopPins', () => {
  const stops = [stop(NARBONNE, 1), stop(CARCASSONNE, 2, '#34d399'), stop(TOULOUSE, 3)];

  it('avec les numéros : les lieux voisins partagent une pastille', () => {
    // Narbonne et Carcassonne se touchent à cette échelle, Toulouse est plus loin.
    const pins = stopPins(stops, 0.5, true);
    expect(pins.map((p) => p.label)).toEqual(['1·2', '3']);
  });

  it('sans les numéros : un point par lieu, de sa couleur, sans étiquette', () => {
    const pins = stopPins(stops, 1, false);
    expect(pins).toHaveLength(3);
    expect(pins.every((p) => p.label === undefined)).toBe(true);
    expect(pins[1].color).toBe('#34d399');
  });
});
