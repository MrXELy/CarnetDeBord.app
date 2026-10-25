/** Nombre affiché avec une virgule décimale, ou vide. */
export const numText = (n: number | null) => (n == null ? '' : String(n).replace('.', ','));

/** Nombre saisi (virgule ou point, espaces tolérés), ou null si vide, invalide ou négatif (km, litres, poids, tarifs). */
export function parseNum(s: string): number | null {
  const n = Number(s.replace(',', '.').replace(/\s/g, ''));
  return s.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
}
