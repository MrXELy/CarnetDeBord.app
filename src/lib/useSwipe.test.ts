import { describe, expect, it } from 'vitest';
import { swipeDirection } from './useSwipe';

describe('swipeDirection', () => {
  it('vers la droite : précédent ; vers la gauche : suivant', () => {
    expect(swipeDirection(100, 0)).toBe(-1);
    expect(swipeDirection(-100, 10)).toBe(1);
  });

  it('ignore un geste trop court', () => {
    expect(swipeDirection(60, 0)).toBe(0);
    expect(swipeDirection(-30, 0)).toBe(0);
  });

  it('ignore un glissement surtout vertical (défilement de la page)', () => {
    expect(swipeDirection(80, 80)).toBe(0);
    expect(swipeDirection(90, 60)).toBe(0); // il faut plus de 1,5 fois le geste vertical
    expect(swipeDirection(91, 60)).toBe(-1);
  });
});
