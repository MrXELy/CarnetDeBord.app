import { useSyncExternalStore } from 'react';

// Version PC en 3 colonnes à partir de cette largeur.
const query = '(min-width: 1024px)';

const subscribe = (onChange: () => void) => {
  const media = matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

/** Vrai sur un grand écran (PC) : l'accueil passe en 3 colonnes. */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
