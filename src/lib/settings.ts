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
}

const KEY = 'cdb.settings';
const DEFAULTS: Settings = { europe: false, mapRoutes: true, mapCities: true, mapDepartments: true };
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
