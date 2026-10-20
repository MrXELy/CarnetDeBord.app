import { describe, expect, it } from 'vitest';
import { placeLabels } from './replayDraw';

// Largeur d'un texte : 10 pixels par lettre.
const measure = (text: string) => text.length * 10;
const area = { width: 1000, top: 0, bottom: 1000 };

describe('placeLabels', () => {
  it('écrit chaque ville une seule fois, au passage le plus récent', () => {
    const labels = placeLabels(
      [
        { name: 'Narbonne', at: [100, 100] },
        { name: 'Toulouse', at: [500, 500] },
        { name: 'NARBONNE', at: [102, 300] },
      ],
      measure,
      area,
    );
    expect(labels.map((l) => [l.name, l.at])).toEqual([
      ['NARBONNE', [102, 300]],
      ['Toulouse', [500, 500]],
    ]);
  });

  it('passe à gauche du point au bord de l’image, ou si la place est prise', () => {
    const [edge] = placeLabels([{ name: 'Périgueux', at: [950, 500] }], measure, area);
    expect(edge.left).toBe(true);
    // Deux villes côte à côte : la plus récente à droite, l'autre à gauche.
    const near = placeLabels(
      [
        { name: 'Toulouse', at: [480, 500] },
        { name: 'Colomiers', at: [500, 500] },
      ],
      measure,
      area,
    );
    expect(near.map((l) => [l.name, l.left])).toEqual([
      ['Colomiers', false],
      ['Toulouse', true],
    ]);
  });

  it('laisse tomber un nom qui chevaucherait un nom plus récent', () => {
    const labels = placeLabels(
      [
        { name: 'Toulouse', at: [100, 500] },
        { name: 'Colomiers', at: [130, 505] },
      ],
      measure,
      area,
    );
    expect(labels.map((l) => l.name)).toEqual(['Colomiers']);
  });

  it('évite quand même le point d’un lieu sans nom', () => {
    const labels = placeLabels(
      [
        { name: '', at: [340, 500] },
        { name: 'Toulouse', at: [300, 500] },
      ],
      measure,
      area,
    );
    expect(labels.map((l) => [l.name, l.left])).toEqual([['Toulouse', true]]);
  });

  it('ignore les lieux hors de la carte et les lieux sans nom', () => {
    const labels = placeLabels(
      [
        { name: 'Narbonne', at: [100, 1200] },
        { name: '', at: [300, 300] },
      ],
      measure,
      area,
    );
    expect(labels).toEqual([]);
  });
});
