import { cityLabel } from './ocr';
import type { LetterKind, WaybillReading } from './photos';

/** Informations lues sur la LV, dans l'ordre où l'IA les écrit, avec leur nom pour le chauffeur. */
export const READING_LABELS: [Exclude<keyof WaybillReading, 'remarks'>, string][] = [
  ['number', 'N° de LV'],
  ['shipper_name', 'Chargeur'],
  ['shipper_city', 'Ville de chargement'],
  ['consignee_name', 'Destinataire'],
  ['consignee_city', 'Ville de livraison'],
  ['goods', 'Marchandise'],
  ['weight_kg', 'Poids'],
];

/** Ce que l'IA a déjà écrit : ses remarques terminées et les informations complètes (null = non trouvée). */
export interface LiveProgress {
  remarks: string[];
  /** `doubt` : l'IA a donné l'information mais n'en est pas sûre (connu seulement à la fin). */
  found: { label: string; value: string | null; doubt?: boolean }[];
}

/** Chaîne JSON complète (guillemets compris), commençant exactement à la position donnée. */
const JSON_STRING = /"(?:[^"\\]|\\.)*"/y;

/** Valeur lisible d'une information lue : poids en kg, texte tel quel. */
export function readingValue(key: string, value: unknown): string | null {
  if (value == null || value === '') return null;
  if (key === 'weight_kg' && typeof value === 'number') return `${value.toLocaleString('fr-FR')} kg`;
  return String(value);
}

/**
 * Lit la réponse inachevée de l'IA (du JSON coupé en plein milieu) : seules les remarques
 * et les informations entièrement écrites sont gardées, jamais une valeur à moitié reçue.
 */
export function liveProgress(text: string): LiveProgress {
  const remarks: string[] = [];
  const list = /"remarks"\s*:\s*\[/.exec(text);
  if (list) {
    let pos = list.index + list[0].length;
    for (;;) {
      while (/[\s,]/.test(text[pos] ?? '')) pos++;
      if (text[pos] !== '"') break; // fin de la liste, ou remarque pas encore commencée
      JSON_STRING.lastIndex = pos;
      const m = JSON_STRING.exec(text);
      if (!m) break; // remarque en cours d'écriture
      remarks.push(JSON.parse(m[0]));
      pos += m[0].length;
    }
  }
  const found: LiveProgress['found'] = [];
  for (const [key, label] of READING_LABELS) {
    // Texte entre guillemets fermés, nombre suivi d'une virgule ou d'une accolade, ou null.
    const m = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?(?=\\s*[,}])|null)`).exec(text);
    if (m) found.push({ label, value: readingValue(key, JSON.parse(m[1])) });
  }
  return { remarks: remarks.map((r) => r.trim()).filter(Boolean), found };
}

/** Lecture terminée : toutes les informations, trouvées ou non, avec le département des villes. */
export function finalProgress(reading: WaybillReading): LiveProgress {
  const value = (key: (typeof READING_LABELS)[number][0]) =>
    key === 'shipper_city'
      ? cityLabel(reading.shipper_city, reading.shipper_department) || null
      : key === 'consignee_city'
        ? cityLabel(reading.consignee_city, reading.consignee_department) || null
        : readingValue(key, reading[key]);
  return {
    remarks: (reading.remarks ?? []).map((r) => r.trim()).filter(Boolean),
    found: READING_LABELS.map(([key, label]) => {
      const v = value(key);
      return v && reading.uncertain?.includes(key) ? { label, value: v, doubt: true } : { label, value: v };
    }),
  };
}

/** Suivi d'une lecture pour le panneau « Détails » : en cours, terminée ou en échec. */
export interface ReadDetails {
  mode: LetterKind;
  progress: LiveProgress;
  /** Fin de la lecture : durée (ms) et coût estimé ($), ou raison de l'échec. */
  done?: { ms: number; cost_usd?: number; error?: string };
}

/** Étapes de la lecture, de la plus ancienne à la plus récente, pour la ligne en direct et les détails. */
export function liveSteps({ remarks, found }: LiveProgress): string[] {
  return [
    ...remarks.map((r) => `Remarque : ${r}`),
    ...found.map(({ label, value }) => (value ? `${label} : ${value}` : `${label} : non trouvé`)),
  ];
}

/** Mode démo : une lecture simulée, écrite petit à petit comme une vraie, sans appeler le serveur. */
export async function demoReading(
  onText: (text: string) => void,
): Promise<{ reading: WaybillReading; cost_usd: number }> {
  const reading: WaybillReading = {
    remarks: ['Lettre de voiture pré-imprimée, remplie à la main', 'Bas de la photo un peu flou'],
    number: '000123',
    shipper_name: 'Exemple Matériaux',
    shipper_city: 'Narbonne',
    shipper_department: '11',
    consignee_name: 'Dépôt Exemple',
    consignee_city: 'Toulouse',
    consignee_department: '31',
    goods: '12 pal plaques de plâtre',
    weight_kg: 18450,
    uncertain: ['weight_kg'],
  };
  const json = JSON.stringify(reading);
  for (let i = 12; i < json.length; i += 12) {
    await new Promise((r) => setTimeout(r, 120));
    onText(json.slice(0, i));
  }
  onText(json);
  return { reading, cost_usd: 0.0012 };
}
