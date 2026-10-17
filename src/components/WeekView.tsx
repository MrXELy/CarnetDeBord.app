import { addWeeks, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight, FileText, LogOut, Plus, Settings as SettingsIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { groupWeek, summarizeWeek, weekLabel, weekStart } from '../lib/dates';
import { supabase } from '../lib/supabase';
import { useEvents } from '../lib/useEvents';
import { waybillStatus, type TripEvent } from '../types';
import DaySection from './DaySection';
import EventForm from './EventForm';
import Settings from './Settings';
import WaybillsPage, { type WaybillFilter } from './WaybillsPage';

type Editing = { event: TripEvent | null } | null;

export default function WeekView() {
  const { events, waybills, pending, syncing, online, error, store } = useEvents();
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [editing, setEditing] = useState<Editing>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [waybillFilter, setWaybillFilter] = useState<WaybillFilter | null>(null);
  const days = useMemo(() => groupWeek(events, start), [events, start]);
  const week = useMemo(() => summarizeWeek(days.flatMap((d) => d.events)), [days]);
  const isCurrentWeek = isSameDay(start, weekStart(new Date()));
  const toComplete = waybills.filter((w) => waybillStatus(w) === 'a_completer').length;
  const inTruck = store.inTruck(new Date()).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <span className="brand">CarnetDeBord</span>
          <SyncBadge pending={pending} syncing={syncing} online={online} error={error} onRetry={() => store.sync()} />
          <button
            className="icon-btn has-badge"
            title="Lettres de voiture"
            aria-label={toComplete ? `Lettres de voiture, ${toComplete} à compléter` : 'Lettres de voiture'}
            onClick={() => setWaybillFilter(toComplete ? 'a_completer' : 'dans_camion')}
          >
            <FileText size={20} />
            {toComplete > 0 && <span className="icon-badge">{toComplete}</span>}
          </button>
          <button className="icon-btn" title="Options" aria-label="Options" onClick={() => setShowSettings(true)}>
            <SettingsIcon size={20} />
          </button>
          <button
            className="icon-btn"
            title="Se déconnecter"
            aria-label="Se déconnecter"
            onClick={() => confirm('Se déconnecter ?') && supabase.auth.signOut()}
          >
            <LogOut size={20} />
          </button>
        </div>
        <nav className="week-nav">
          <button className="icon-btn" aria-label="Semaine précédente" onClick={() => setStart(addWeeks(start, -1))}>
            <ChevronLeft size={24} />
          </button>
          <button className="week-title" onClick={() => setStart(weekStart(new Date()))} disabled={isCurrentWeek}>
            {weekLabel(start)}
            {!isCurrentWeek && <small>Revenir à cette semaine</small>}
          </button>
          <button className="icon-btn" aria-label="Semaine suivante" onClick={() => setStart(addWeeks(start, 1))}>
            <ChevronRight size={24} />
          </button>
        </nav>
        <p className="week-recap">
          {week.km != null ? (
            <>
              <strong>{week.km.toLocaleString('fr-FR')} km</strong> parcourus
              {week.inProgress && isCurrentWeek && ' · en cours'}
            </>
          ) : (
            'Aucun kilométrage cette semaine'
          )}
          {isCurrentWeek && inTruck > 0 && (
            <>
              {' · '}
              <button className="recap-link" onClick={() => setWaybillFilter('dans_camion')}>
                {inTruck} LV dans le camion
              </button>
            </>
          )}
        </p>
      </header>

      <main className="days">
        {days.length === 0 ? (
          <div className="empty">
            <p>Aucune étape cette semaine.</p>
            {isCurrentWeek && <p className="muted">Appuie sur « + » pour commencer ta journée.</p>}
          </div>
        ) : (
          days.map((day) => (
            <DaySection key={day.date.getTime()} day={day} onOpen={(event) => setEditing({ event })} />
          ))
        )}
      </main>

      <button className="fab" aria-label="Nouvelle étape" onClick={() => setEditing({ event: null })}>
        <Plus size={32} strokeWidth={2.5} />
      </button>

      {editing && <EventForm event={editing.event} onClose={() => setEditing(null)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {waybillFilter && <WaybillsPage initialFilter={waybillFilter} onClose={() => setWaybillFilter(null)} />}
    </div>
  );
}

function SyncBadge(props: { pending: number; syncing: boolean; online: boolean; error: string | null; onRetry: () => void }) {
  if (!props.online) return <span className="sync sync-off">Hors ligne{props.pending ? ` · ${props.pending} en attente` : ''}</span>;
  if (props.syncing) return <span className="sync">Synchro…</span>;
  if (props.error)
    return (
      <button className="sync sync-err" onClick={props.onRetry} title={props.error}>
        Erreur · réessayer
      </button>
    );
  if (props.pending) return <span className="sync sync-off">{props.pending} en attente</span>;
  return <span className="sync sync-ok">À jour</span>;
}
