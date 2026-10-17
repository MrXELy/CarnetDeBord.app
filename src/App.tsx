import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import Login from './components/Login';
import WeekView from './components/WeekView';
import { supabase } from './lib/supabase';
import { EventStore } from './lib/sync';
import { StoreContext } from './lib/useEvents';
import type { TripEvent } from './types';

// Mode démo : uniquement sur la version de test locale (npm run dev), avec « ?demo » dans l'adresse.
// Les données restent dans le navigateur et ne sont jamais envoyées à Supabase.
const demoParam = import.meta.env.DEV ? new URLSearchParams(location.search).get('demo') : null;
const DEMO = demoParam !== null;

export default function App() {
  return DEMO ? <DemoApp reset={demoParam === 'reset'} /> : <SignedInApp />;
}

function SignedInApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [store, setStore] = useState<EventStore | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return setStore(null);
    const s = new EventStore(userId);
    setStore(s);
    return () => s.dispose();
  }, [userId]);

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (!store) return null;

  return (
    <StoreContext.Provider value={store}>
      <WeekView />
    </StoreContext.Provider>
  );
}

const DEMO_KEY = 'cdb.demo.data';

/**
 * Charge les données de démo (data/demo-events.json, créé par scripts/import-legacy.mjs)
 * au premier lancement ou avec « ?demo=reset ». Fichier absent : historique vide.
 */
async function seedDemo(reset: boolean) {
  if (!reset && localStorage.getItem(DEMO_KEY)) return;
  const files = import.meta.glob<TripEvent[]>('../data/demo-events.json', { import: 'default' });
  const load = Object.values(files)[0];
  const events = load ? await load() : [];
  localStorage.setItem(DEMO_KEY, JSON.stringify({ events, outbox: [], cursor: null }));
  localStorage.removeItem('cdb.demo.waybills');
}

function DemoApp({ reset }: { reset: boolean }) {
  const [store, setStore] = useState<EventStore | null>(null);

  useEffect(() => {
    let s: EventStore | null = null;
    let alive = true;
    seedDemo(reset).then(() => {
      if (!alive) return;
      s = new EventStore('demo', { offline: true });
      setStore(s);
    });
    return () => {
      alive = false;
      s?.dispose();
    };
  }, [reset]);

  if (!store) return null;

  return (
    <StoreContext.Provider value={store}>
      <WeekView />
    </StoreContext.Provider>
  );
}
