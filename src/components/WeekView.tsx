import { addHours, addWeeks, format, getISOWeek, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  FileText,
  MapPin,
  Plus,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Suspense, lazy, useMemo, useState } from 'react';
import { currentDay, dayLabel, groupWeek, summarizeWeek, weekStart } from '../lib/dates';
import { formatPlace } from '../lib/geo';
import { unfinishedStep } from '../lib/onSite';
import { useEvents } from '../lib/useEvents';
import { useNow } from '../lib/useNow';
import { waybillStatus, type TripEvent } from '../types';
import AllowancesSheet from './AllowancesSheet';
import DaySection from './DaySection';
import EventForm from './EventForm';
import FinishStepButton from './FinishStepButton';
import HomeNotices from './HomeNotices';
import type { WaybillFilter } from './WaybillsPage';
import WeekPage from './WeekPage';
import WeekPicker from './WeekPicker';

// Carte chargée seulement à son ouverture : ses contours de la France pèsent une centaine de Ko.
const WeekMap = lazy(() => import('./WeekMap'));
const MonthMap = lazy(() => import('./MonthMap'));
const StatsPage = lazy(() => import('./StatsPage'));
const SearchPage = lazy(() => import('./SearchPage'));
const Settings = lazy(() => import('./Settings'));
const WaybillsPage = lazy(() => import('./WaybillsPage'));

type Editing = { event: TripEvent | null } | null;

/** Accueil : la journée en cours (ou les LV du camion avant de commencer), la semaine s'ouvre depuis sa tuile. */
export default function WeekView() {
  const { events, waybills, pending, syncing, online, error, demo, store } = useEvents();
  const now = useNow();
  // Semaine ouverte dans la page « Semaine » (et utilisée par les cartes, frais et statistiques).
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [showWeek, setShowWeek] = useState(false);
  // Sens de l'animation au changement de semaine : glisse depuis la droite (suivante) ou la gauche (précédente).
  const [slide, setSlide] = useState<'next' | 'prev' | 'fade'>('fade');
  const [editing, setEditing] = useState<Editing>(null);
  // Options ouvertes, éventuellement sur une section (« reminders » : échéances).
  const [showSettings, setShowSettings] = useState<boolean | string>(false);
  const [showStats, setShowStats] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showAllowances, setShowAllowances] = useState(false);
  // Étape trouvée par la recherche : mise en évidence tant qu'on reste sur sa semaine.
  const [found, setFound] = useState<string | null>(null);
  const [waybillFilter, setWaybillFilter] = useState<WaybillFilter | null>(null);
  const [pickingWeek, setPickingWeek] = useState(false);
  // Carte de la semaine (true) ou d'une de ses journées (« 2026-10-20 »).
  const [showMap, setShowMap] = useState<boolean | string>(false);
  const [monthMap, setMonthMap] = useState<string | null>(null);

  // Heure réelle (et pas `now`, rafraîchi chaque minute) : une étape notée à l'instant compte tout de suite.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useMemo(() => currentDay(events, new Date()), [events, now]);
  const thisWeek = weekStart(now);
  const weekKm = useMemo(
    () => summarizeWeek(groupWeek(events, thisWeek).flatMap((d) => d.events)).km,
    // thisWeek ne change qu'avec le jour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, thisWeek.getTime()],
  );
  const toComplete = waybills.filter((w) => waybillStatus(w) === 'a_completer').length;
  // Avant le début de journée : rappel des livraisons à faire.
  const inTruck = today.inProgress ? [] : store.inTruck(now);
  const finishing = unfinishedStep(events) != null;

  function goWeek(delta: number) {
    setFound(null);
    setSlide(delta > 0 ? 'next' : 'prev');
    setStart(addWeeks(start, delta));
  }

  function pickWeek(week: Date) {
    setFound(null);
    setSlide(week > start ? 'next' : week < start ? 'prev' : 'fade');
    setStart(week);
  }

  function openWeek() {
    setFound(null);
    setSlide('fade');
    setStart(thisWeek);
    setShowWeek(true);
  }

  return (
    <div className={`app${finishing ? ' finishing' : ''}`}>
      <header className="home-head">
        <div className="home-title">
          <span className="home-date">{dayLabel(now)}</span>
          <h1>{today.inProgress ? 'Bonne route' : 'Bonjour'}</h1>
        </div>
        {demo ? (
          <span className="sync-demo" title="Données de test dans ce navigateur, jamais envoyées en ligne">
            Démo
          </span>
        ) : (
          <SyncBadge pending={pending} syncing={syncing} online={online} error={error} onRetry={() => store.sync()} />
        )}
        <button className="tile-btn" aria-label="Options" onClick={() => setShowSettings(true)}>
          <SettingsIcon size={22} />
        </button>
      </header>

      <main className="home">
        <HomeNotices onOpenReminders={() => setShowSettings('reminders')} />

        <button className="week-tile" onClick={openWeek} aria-label="Ouvrir la semaine">
          <span className="week-tile-text">
            <span className="week-tile-label">Semaine {getISOWeek(addHours(thisWeek, 2))}</span>
            <span className="week-tile-km">{weekKm != null ? `${weekKm.toLocaleString('fr-FR')} km` : 'Aucun km'}</span>
          </span>
          <ArrowUpRight size={28} strokeWidth={2.2} aria-hidden />
        </button>

        {inTruck.length > 0 && (
          <section className="in-truck">
            <h2 className="home-h2">
              Dans le camion <span>{inTruck.length} LV</span>
            </h2>
            {inTruck.map((w) => {
              const loading = store.event(w.loading_event_id);
              const from = loading && formatPlace(loading);
              return (
                <button key={w.id} className="in-truck-lv" onClick={() => setWaybillFilter('dans_camion')}>
                  <span className="in-truck-top">
                    <span className="card-icon">
                      <MapPin size={22} aria-hidden />
                    </span>
                    <span className="in-truck-where">
                      <span className="in-truck-label">Livraison prévue à</span>
                      <span className="in-truck-city">{w.planned_city || 'Ville non renseignée'}</span>
                    </span>
                  </span>
                  <span className="in-truck-sub">
                    {[
                      w.goods,
                      loading &&
                        `chargée ${format(parseISO(loading.occurred_at), 'EEEE', { locale: fr })}${from ? ` à ${from}` : ''}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              );
            })}
          </section>
        )}

        {today.events.length > 0 ? (
          <div className="days">
            <DaySection
              day={today}
              title={today.inProgress ? 'Journée en cours' : 'Aujourd’hui'}
              index={0}
              onOpen={(event) => setEditing({ event })}
              onMap={() => {
                setStart(weekStart(today.date));
                setShowMap(format(today.date, 'yyyy-MM-dd'));
              }}
            />
          </div>
        ) : (
          inTruck.length === 0 && (
            <div className="empty">
              <p>Aucune étape aujourd’hui.</p>
              <p className="muted">Appuie sur « + » pour commencer ta journée.</p>
            </div>
          )
        )}
      </main>

      <FinishStepButton />
      <nav className="bottom-nav" aria-label="Navigation">
        <button aria-label="Semaine" onClick={openWeek}>
          <CalendarDays size={22} />
        </button>
        <button
          className="has-badge"
          aria-label={toComplete ? `Lettres de voiture, ${toComplete} à compléter` : 'Lettres de voiture'}
          onClick={() => setWaybillFilter(toComplete ? 'a_completer' : 'dans_camion')}
        >
          <FileText size={22} />
          {toComplete > 0 && <span className="icon-badge">{toComplete}</span>}
        </button>
        <button aria-label="Statistiques" onClick={() => setShowStats(true)}>
          <ChartColumn size={22} />
        </button>
        <button aria-label="Rechercher" onClick={() => setSearching(true)}>
          <Search size={22} />
        </button>
      </nav>
      <button className="fab" aria-label="Nouvelle étape" onClick={() => setEditing({ event: null })}>
        <Plus size={30} strokeWidth={2.6} />
      </button>

      {showWeek && (
        <WeekPage
          start={start}
          slide={slide}
          found={found}
          onWeek={goWeek}
          onPickWeek={() => setPickingWeek(true)}
          onOpen={(event) => setEditing({ event })}
          onMap={(day) => setShowMap(day ?? true)}
          onAllowances={() => setShowAllowances(true)}
          onInTruck={() => setWaybillFilter('dans_camion')}
          onClose={() => setShowWeek(false)}
        />
      )}
      {editing && <EventForm event={editing.event} onClose={() => setEditing(null)} />}
      {searching && (
        <Suspense fallback={null}>
          <SearchPage
            onShowWeek={(event) => {
              setSearching(false);
              pickWeek(weekStart(parseISO(event.occurred_at)));
              setFound(event.id);
              setShowWeek(true);
            }}
            onClose={() => setSearching(false)}
          />
        </Suspense>
      )}
      {showAllowances && (
        <AllowancesSheet
          start={start}
          onOpenSettings={() => {
            setShowAllowances(false);
            setShowSettings(true);
          }}
          onClose={() => setShowAllowances(false)}
        />
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <Settings
            section={typeof showSettings === 'string' ? showSettings : undefined}
            onClose={() => setShowSettings(false)}
          />
        </Suspense>
      )}
      {showStats && (
        <Suspense fallback={null}>
          <StatsPage
            week={start}
            onEdit={(event) => {
              setShowStats(false);
              setEditing({ event });
            }}
            onClose={() => setShowStats(false)}
          />
        </Suspense>
      )}
      {waybillFilter && (
        <Suspense fallback={null}>
          <WaybillsPage initialFilter={waybillFilter} onClose={() => setWaybillFilter(null)} />
        </Suspense>
      )}
      {pickingWeek && (
        <WeekPicker
          current={start}
          onPick={pickWeek}
          onMonthMap={(month) => {
            setPickingWeek(false);
            setMonthMap(month);
          }}
          onWeekMap={(week) => {
            setPickingWeek(false);
            pickWeek(week);
            setShowMap(true);
          }}
          onClose={() => setPickingWeek(false)}
        />
      )}
      {monthMap && (
        <Suspense fallback={null}>
          <MonthMap
            month={monthMap}
            onPickWeek={(week) => {
              setMonthMap(null);
              pickWeek(week);
              setShowWeek(true);
            }}
            onEdit={(event) => {
              setMonthMap(null);
              setEditing({ event });
            }}
            onClose={() => setMonthMap(null)}
          />
        </Suspense>
      )}
      {showMap && (
        <Suspense fallback={null}>
          <WeekMap
            start={start}
            events={groupWeek(events, start).flatMap((d) => d.events)}
            day={typeof showMap === 'string' ? showMap : undefined}
            onEdit={(event) => {
              setShowMap(false);
              setEditing({ event });
            }}
            onClose={() => setShowMap(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

/** Pastille de synchro : la toucher relance l'envoi, son libellé dit l'état aux lecteurs d'écran. */
function SyncBadge(props: {
  pending: number;
  syncing: boolean;
  online: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { pending, syncing, online, error } = props;
  const waiting = pending ? ` · ${pending} en attente` : '';
  const [tone, label] = !online
    ? ['sync-off', `Hors ligne${waiting}`]
    : syncing
      ? ['sync-off sync-busy', 'Synchro en cours…']
      : error
        ? ['sync-err', `Erreur de synchro${waiting} · toucher pour réessayer`]
        : pending
          ? ['sync-off', `${pending} en attente d’envoi`]
          : ['sync-ok', 'À jour'];
  return (
    <button
      type="button"
      className={`sync ${tone}`}
      title={error ? `${label} (${error})` : label}
      aria-label={label}
      onClick={() => {
        if (error) props.onRetry();
        else alert(label);
      }}
    >
      <span className={`sync-dot${pending ? ' has-count' : ''}`}>{pending > 0 && pending}</span>
    </button>
  );
}
