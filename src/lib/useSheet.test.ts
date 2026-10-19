import { describe, expect, it, vi } from 'vitest';

// useSheet reprend useModal, qui touche à l'historique du navigateur dès son chargement.
vi.stubGlobal('history', { scrollRestoration: 'auto', pushState() {}, back() {} });
vi.stubGlobal('window', { addEventListener() {} });
const { shouldDismiss } = await import('./useSheet');

describe('shouldDismiss', () => {
  it('ferme un panneau tiré de plus d’un quart de sa hauteur', () => {
    expect(shouldDismiss(201, 0, 800)).toBe(true);
    expect(shouldDismiss(199, 0, 800)).toBe(false);
  });

  it('ferme un panneau lancé vite vers le bas', () => {
    expect(shouldDismiss(60, 0.8, 800)).toBe(true);
  });

  it('ignore un petit geste, même rapide', () => {
    expect(shouldDismiss(20, 1.5, 800)).toBe(false);
  });
});
