// Convertit une sauvegarde de l'ancien projet (truck-manager-backup-*.json) en étapes
// CarnetDeBord, pour le mode démo local (http://localhost:5173/CarnetDeBord.app/?demo).
//
//   node scripts/import-legacy.mjs <sauvegarde.json>
//
// Le résultat va dans data/demo-events.json (dossier exclu de GitHub). Les dates sont conservées.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Les dates et heures de l'ancien projet sont à l'heure de Paris.
process.env.TZ = 'Europe/Paris';

const input = process.argv[2];
if (!input) {
  console.error('Usage : node scripts/import-legacy.mjs <sauvegarde.json>');
  process.exit(1);
}

const TYPES = {
  PRISE_POSTE: 'debut_journee',
  CHARGEMENT: 'chargement',
  LIVRAISON: 'livraison',
  CARBURANT: 'carburant',
  FIN_JOURNEE: 'fin_journee',
};
const STATIONS = ['Doumen', 'AS24', 'DKV'];

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const positive = (v) => (typeof v === 'number' && v > 0 ? v : null);

const legacy = JSON.parse(readFileSync(input, 'utf8'));
const skipped = [];
const events = legacy.flatMap((e) => {
  const type = TYPES[e.type];
  if (!type) {
    skipped.push(e.type);
    return [];
  }
  const loc = e.location ?? {};
  const isFuel = type === 'carburant';
  const isStop = type === 'chargement' || type === 'livraison';
  return [
    {
      id: e.id,
      type,
      // Heure locale de Paris → instant UTC.
      occurred_at: new Date(`${e.date}T${e.time}:00`).toISOString(),
      tractor_plate: e.vehicle?.tractorPlate ?? '',
      trailer_plate: e.vehicle?.trailerPlate ?? '',
      odometer_km: e.vehicle?.km ?? null,
      city: loc.city ?? '',
      postcode: null,
      department: loc.department ?? null,
      country_code: loc.country === 'France' ? 'FR' : null,
      lat: loc.lat ?? null,
      lon: loc.lng ?? null,
      notes: text(e.notes),
      // Pas de lettre de voiture dans l'ancien projet : le client s'affiche sur l'étape.
      client: isStop ? text(e.clientName) : null,
      cmr_number: null,
      station: isFuel && STATIONS.includes(e.station) ? e.station : null,
      diesel_l: isFuel ? positive(e.quantityDiesel ?? e.quantity) : null,
      adblue_l: isFuel ? positive(e.quantityAdBlue) : null,
      updated_at: '',
      deleted_at: null,
    },
  ];
});

mkdirSync('data', { recursive: true });
writeFileSync('data/demo-events.json', JSON.stringify(events, null, 2));

const dates = events.map((e) => e.occurred_at).sort();
console.log(
  `${events.length} étapes converties → data/demo-events.json (${dates[0].slice(0, 10)} → ${dates.at(-1).slice(0, 10)})`,
);
if (skipped.length) console.log(`Ignorées (type inconnu) : ${skipped.join(', ')}`);
