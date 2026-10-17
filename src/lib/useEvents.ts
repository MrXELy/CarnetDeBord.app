import { createContext, useContext, useSyncExternalStore } from 'react';
import type { EventStore } from './sync';

export const StoreContext = createContext<EventStore | null>(null);

export function useStore(): EventStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreContext manquant');
  return store;
}

/** Événements (non supprimés, du plus récent au plus ancien) et état de la synchro. */
export function useEvents() {
  const store = useStore();
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, store };
}
