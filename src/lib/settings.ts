import { useSyncExternalStore } from 'react';

export interface Settings {
  /** Autocomplétion des villes dans toute l'Europe (sinon France uniquement). */
  europe: boolean;
  /** Carte de la semaine : vrais itinéraires (sinon lignes droites entre les étapes). */
  mapRoutes: boolean;
  /** Carte de la semaine : villes repères affichées. */
  mapCities: boolean;
  /** Carte de la semaine : frontières des départements affichées. */
  mapDepartments: boolean;
  /** Carte de la semaine : numéros des étapes dans les pastilles (sinon simples points). */
  mapNumbers: boolean;
  /** Carte de la semaine : boutons d'itinéraire entre les lieux de la liste (cachés au départ). */
  mapRouteButtons: boolean;
  /** Semaine rejouée : format (carré ou vertical) et durée de l'animation en secondes. */
  replayFormat: 'square' | 'vertical';
  replayDuration: number;
  /** Cartes de la semaine et du mois : cadrées sur les trajets, ou sur toute la France. */
  mapFrame: 'trips' | 'france';
}

const KEY = 'cdb.settings';
const DEFAULTS: Settings = {
  europe: false,
  mapRoutes: true,
  mapCities: true,
  mapDepartments: true,
  mapNumbers: true,
  mapRouteButtons: false,
  replayFormat: 'vertical',
  replayDuration: 30,
  mapFrame: 'trips',
};
const listeners = new Set<() => void>();

let current = read();

function read(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Stockage indisponible : le réglage reste valable jusqu'à la fermeture de l'appli.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => current);
}
