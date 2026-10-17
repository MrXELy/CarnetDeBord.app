import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import Login from './components/Login';
import WeekView from './components/WeekView';
import { supabase } from './lib/supabase';
import { EventStore } from './lib/sync';
import { StoreContext } from './lib/useEvents';

export default function App() {
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
