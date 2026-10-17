import { describe, expect, it } from 'vitest';
import { kmFromReading, odometerMessage } from './odometer';

describe('kmFromReading', () => {
  it('garde les km entiers, sans les dixièmes du chrono', () => {
    expect(kmFromReading(123456.7)).toBe(123456);
    expect(kmFromReading(250000)).toBe(250000);
  });

  it('rejette les valeurs absentes ou impossibles', () => {
    expect(kmFromReading(null)).toBeNull();
    expect(kmFromReading(undefined)).toBeNull();
    expect(kmFromReading(0)).toBeNull();
    expect(kmFromReading(-5)).toBeNull();
    expect(kmFromReading(Number.NaN)).toBeNull();
    expect(kmFromReading(12_000_000)).toBeNull();
  });
});

describe('odometerMessage', () => {
  const nbsp = (s: string) => s.replace(/\s/g, ' ');

  it('demande une simple vérification quand la valeur est plausible', () => {
    const m = odometerMessage(123456, 123100);
    expect(m.suspect).toBe(false);
    expect(nbsp(m.text)).toContain('123 456 km');
  });

  it('signale un km inférieur au dernier relevé', () => {
    expect(odometerMessage(122000, 123100).suspect).toBe(true);
  });

  it('signale un écart trop grand (chiffre mal lu ?)', () => {
    const m = odometerMessage(133456, 123100);
    expect(m.suspect).toBe(true);
    expect(nbsp(m.text)).toContain('10 356 km');
  });

  it('accepte toute valeur sans relevé précédent', () => {
    expect(odometerMessage(123456, null).suspect).toBe(false);
  });
});
