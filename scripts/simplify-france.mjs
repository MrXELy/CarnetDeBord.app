// Réduit les contours de la France et des départements (IGN Admin Express, via
// github.com/gregoiredavid/france-geojson, Licence Ouverte) pour le fond de la carte de la semaine.
//
//   curl -sLO https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/metropole-version-simplifiee.geojson
//   node scripts/simplify-france.mjs metropole-version-simplifiee.geojson src/assets/france.json 0.008
//   curl -sLO https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-version-simplifiee.geojson
//   node scripts/simplify-france.mjs departements-version-simplifiee.geojson src/assets/departements.json 0.018
//
// Tolérance en degrés (0,008 ≈ 1 km) : assez précis pour une carte de France sur téléphone.

import { readFileSync, writeFileSync } from 'node:fs';
const [input, output, tolArg] = process.argv.slice(2);
const tol = Number(tolArg ?? 0.008);
const f = JSON.parse(readFileSync(input, 'utf8'));
// Une zone (contour de la France) ou plusieurs (départements).
const geometries = f.type === 'FeatureCollection' ? f.features.map((x) => x.geometry) : [f.geometry];
const polys = geometries.flatMap((g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]));
function dp(pts, t) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)];
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(dx, dy) || 1);
    if (d > max) { max = d; idx = i; }
  }
  return max > t ? [...dp(pts.slice(0, idx + 1), t).slice(0, -1), ...dp(pts.slice(idx), t)] : [a, b];
}
const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const rings = polys.map((p) => p[0]).filter((r) => area(r) > 0.004)
  .map((r) => { const m = Math.floor(r.length / 2); return [...dp(r.slice(0, m + 1), tol).slice(0, -1), ...dp(r.slice(m), tol)]; })
  .map((r) => r.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]));
writeFileSync(output, JSON.stringify({
  source: 'IGN Admin Express via github.com/gregoiredavid/france-geojson (Licence Ouverte), simplifié',
  rings,
}));
console.log(rings.length, 'contours,', rings.reduce((s, r) => s + r.length, 0), 'points');
