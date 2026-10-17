import { compressPhoto, invokeReader } from './photos';

/** Au-delà, l'écart avec le relevé précédent est suspect (chiffre mal lu ?). */
const MAX_GAP_KM = 2000;

/** Kilométrage lu → km entiers comme au compteur (les dixièmes du chrono sont ignorés), ou null. */
export function kmFromReading(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0 || value >= 10_000_000) return null;
  return Math.floor(value);
}

/** Message de vérification d'un kilométrage lu, comparé au dernier relevé du tracteur. */
export function odometerMessage(km: number, lastKm: number | null): { text: string; suspect: boolean } {
  const read = `Lu : ${km.toLocaleString('fr-FR')} km.`;
  if (lastKm != null && km < lastKm) {
    return { text: `${read} Inférieur au dernier relevé : vérifie.`, suspect: true };
  }
  if (lastKm != null && km - lastKm > MAX_GAP_KM) {
    const gap = (km - lastKm).toLocaleString('fr-FR');
    return { text: `${read} ${gap} km depuis le dernier relevé : vérifie.`, suspect: true };
  }
  return { text: `${read} Vérifie avant d’enregistrer.`, suspect: false };
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // « data:image/jpeg;base64,xxxx » → « xxxx »
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Lit le kilométrage sur une photo du chronotachygraphe ou du compteur.
 * La photo est réduite puis envoyée directement : elle n'est pas conservée.
 */
export async function readOdometerPhoto(file: Blob): Promise<number | null> {
  const image = await toBase64(await compressPhoto(file));
  const { reading } = await invokeReader<{ reading: { odometer_km: number | null } }>({
    kind: 'odometer',
    id: crypto.randomUUID(),
    image,
  });
  return kmFromReading(reading.odometer_km);
}
