import { addDays, addWeeks, isSameDay, parseISO } from 'date-fns';
import {
  ChartColumn,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileText,
  LoaderCircle,
  Map as MapIcon,
  Plus,
  ReceiptEuro,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { euros, summarizeAllowances } from '../lib/allowances';
import { durationLabel, groupWeek, summarizeDay, summarizeWeek, weekLabel, weekStart } from '../lib/dates';
import { shareFile } from '../lib/share';
import { useEvents } from '../lib/useEvents';
import { useSwipe } from '../lib/useSwipe';
import { buildWeekSheet } from '../lib/weekSheet';
import { isDayBoundary, waybillStatus, type TripEvent } from '../types';
import AllowancesSheet from './AllowancesSheet';
import DaySection from './DaySection';
import EventForm from './EventForm';
import type { WaybillFilter } from './WaybillsPage';
import WeekPicker from './WeekPicker';

// Carte chargée seulement à son ouverture : ses contours de la France pèsent une centaine de Ko.
const WeekMap = lazy(() => import('./WeekMap'));
const MonthMap = lazy(() => import('./MonthMap'));
const StatsPage = lazy(() => import('./StatsPage'));
const SearchPage = lazy(() => import('./SearchPage'));
const Settings = lazy(() => import('./Settings'));
const WaybillsPage = lazy(() => import('./WaybillsPage'));

type Editing = { event: TripEvent | null } | null;

export default function WeekView() {
  const { events, waybills, pending, syncing, online, error, demo, store, allowanceSettings, sheetSettings } =
    useEvents();
  const [start, setStart] = useState(() => weekStart(new Date()));
  // Sens de l'animation au changement de semaine : glisse depuis la droite (suivante) ou la gauche (précédente).
  const [slide, setSlide] = useState<'next' | 'prev' | 'fade'>('fade');
  const [editing, setEditing] = useState<Editing>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [searching, setSearching] = useState(false);
  const [showAllowances, setShowAllowances] = useState(false);
  // Étape trouvée par la recherche : mise en évidence tant qu'on reste sur sa semaine.
  const [found, setFound] = useState<string | null>(null);
  const [waybillFilter, setWaybillFilter] = useState<WaybillFilter | null>(null);
  const [pickingWeek, setPickingWeek] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [monthMap, setMonthMap] = useState<string | null>(null);
  // Feuille de semaine en cours de fabrication : bouton occupé, pas de double fabrication.
  const [makingSheet, setMakingSheet] = useState(false);
  const days = useMemo(() => groupWeek(events, start), [events, start]);
  const week = useMemo(() => summarizeWeek(days.flatMap((d) => d.events)), [days]);
  // Amplitude totale des journées complètes, et nombre d'opérations (sans les débuts et fins de journée).
  const amplitude = days.reduce((sum, d) => sum + (summarizeDay(d.events).amplitude ?? 0), 0);
  const steps = days.reduce((n, d) => n + d.events.filter((e) => !isDayBoundary(e.type)).length, 0);
  const isCurrentWeek = isSameDay(start, weekStart(new Date()));
  const toComplete = waybills.filter((w) => waybillStatus(w) === 'a_completer').length;
  const inTruck = store.inTruck(new Date()).length;
  const showInTruck = isCurrentWeek && inTruck > 0;
  // Frais de la semaine : dès qu'elle a des étapes.
  const allowances = useMemo(
    () => summarizeAllowances(store.allowances(), { start, end: addDays(start, 7) }),
    // store.allowances() ne change qu'avec les étapes ou les réglages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, allowanceSettings, start],
  );
  const showAllowancePill = days.length > 0;

  // Nouvelle semaine : la page repart du haut (l'étape trouvée par la recherche est rejointe juste après).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [start]);

  // Recherche : fait défiler jusqu'à l'étape choisie. On attend que la fenêtre fermée ait rendu
  // son entrée d'historique (le retour arrière replacerait la page en haut) et que la semaine ait glissé.
  useEffect(() => {
    if (!found) return;
    const timer = setTimeout(() => {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      document
        .querySelector(`[data-event-id="${found}"]`)
        ?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }, 350);
    return () => clearTimeout(timer);
  }, [found]);

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

  /** Feuille de semaine en PDF : partagée sur téléphone, téléchargée sur ordinateur. */
  async function weekSheet() {
    if (makingSheet) return;
    setMakingSheet(true);
    try {
      // Le dessin du PDF (et sa bibliothèque) n'est chargé qu'ici.
      const { weekSheetPdf } = await import('../lib/weekSheetPdf');
      const sheet = buildWeekSheet(events, waybills, start, sheetSettings);
      const name = `feuille-semaine-${sheet.week}-${sheet.monday.getFullYear()}.pdf`;
      await shareFile(weekSheetPdf(sheet), name, `Feuille de semaine ${sheet.week}`);
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        alert(`Feuille de semaine impossible : ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setMakingSheet(false);
    }
  }

  // Glisser du doigt sur les jours : vers la droite → semaine précédente, vers la gauche → suivante.
  const swipe = useSwipe(goWeek);

  return (
    <div className="app">
      <div className="halos" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <header className="topbar">
        <div className="topbar-row">
          <span className="brand-wrap">
            <span className="brand">CarnetDeBord</span>
            {demo ? (
              <span className="sync-demo" title="Données de test dans ce navigateur, jamais envoyées en ligne">
                Démo
              </span>
            ) : (
              <SyncBadge
                pending={pending}
                syncing={syncing}
                online={online}
                error={error}
                onRetry={() => store.sync()}
              />
            )}
          </span>
          <button className="icon-btn" title="Rechercher" aria-label="Rechercher" onClick={() => setSearching(true)}>
            <Search size={20} />
          </button>
          <button
            className="icon-btn has-badge"
            title="Lettres de voiture"
            aria-label={toComplete ? `Lettres de voiture, ${toComplete} à compléter` : 'Lettres de voiture'}
            onClick={() => setWaybillFilter(toComplete ? 'a_completer' : 'dans_camion')}
          >
            <FileText size={20} />
            {toComplete > 0 && <span className="icon-badge">{toComplete}</span>}
          </button>
          <button
            className="icon-btn"
            title="Statistiques"
            aria-label="Statistiques"
            onClick={() => setShowStats(true)}
          >
            <ChartColumn size={20} />
          </button>
          <button className="icon-btn" title="Options" aria-label="Options" onClick={() => setShowSettings(true)}>
            <SettingsIcon size={20} />
          </button>
        </div>
        <nav className="week-nav">
          <button className="round-btn" aria-label="Semaine précédente" onClick={() => goWeek(-1)}>
            <ChevronLeft size={22} />
          </button>
          <div className={`week-center slide-${slide}`} key={start.getTime()}>
            <button className="week-title" onClick={() => setPickingWeek(true)} aria-label="Choisir une semaine">
              {weekLabel(start)}
              {week.inProgress && isCurrentWeek && ' · en cours'}
              <ChevronDown size={16} className="week-title-chevron" aria-hidden />
            </button>
            <span className={`week-km${week.km == null ? ' empty-km' : ''}`}>
              {week.km != null ? `${week.km.toLocaleString('fr-FR')} km` : 'Aucun km'}
            </span>
            <span className="week-sub">
              {amplitude > 0 && `${durationLabel(amplitude)} d’amplitude · `}
              {steps} étape{steps > 1 ? 's' : ''}
            </span>
          </div>
          <button className="round-btn" aria-label="Semaine suivante" onClick={() => goWeek(1)}>
            <ChevronRight size={22} />
          </button>
        </nav>
      </header>

      {/* Raccourcis de la semaine : hors de la barre fixe, ils défilent avec les jours. */}
      {(showInTruck || showAllowancePill) && (
        <div className="week-links">
          {showInTruck && (
            <button className="pill" onClick={() => setWaybillFilter('dans_camion')}>
              <FileText size={14} aria-hidden />
              {inTruck} LV<span className="pill-long"> dans le camion</span>
            </button>
          )}
          {showAllowancePill && (
            // Icône et montant seulement, pour que les pastilles tiennent sur une ligne.
            <button
              className="pill"
              onClick={() => setShowAllowances(true)}
              title="Frais de route"
              aria-label={
                allowanceSettings.bases.length ? `Frais de route, ${euros(allowances.total)}` : 'Frais de route'
              }
            >
              <ReceiptEuro size={14} aria-hidden />
              {allowanceSettings.bases.length > 0 && euros(allowances.total)}
            </button>
          )}
          {showAllowancePill && (
            <button className="pill" onClick={() => setShowMap(true)} title="Carte" aria-label="Carte de la semaine">
              <MapIcon size={14} aria-hidden />
            </button>
          )}
          {showAllowancePill && (
            <button
              className="pill"
              onClick={weekSheet}
              disabled={makingSheet}
              aria-busy={makingSheet}
              title="Feuille de semaine (PDF)"
              aria-label="Feuille de semaine en PDF"
            >
              {makingSheet ? (
                <LoaderCircle size={14} className="spin" aria-hidden />
              ) : (
                <FileDown size={14} aria-hidden />
              )}
            </button>
          )}
        </div>
      )}

      <main className={`days slide-${slide}`} key={start.getTime()} {...swipe}>
        {days.length === 0 ? (
          <div className="empty">
            <p>Aucune étape cette semaine.</p>
            {isCurrentWeek && <p className="muted">Appuie sur « + » pour commencer ta journée.</p>}
          </div>
        ) : (
          days.map((day, i) => (
            <DaySection
              key={day.date.getTime()}
              day={day}
              index={i}
              found={found}
              onOpen={(event) => setEditing({ event })}
            />
          ))
        )}
      </main>

      <button className="fab" aria-label="Nouvelle étape" onClick={() => setEditing({ event: null })}>
        <Plus size={32} strokeWidth={2.5} />
      </button>

      {editing && <EventForm event={editing.event} onClose={() => setEditing(null)} />}
      {searching && (
        <Suspense fallback={null}>
          <SearchPage
            onShowWeek={(event) => {
              setSearching(false);
              pickWeek(weekStart(parseISO(event.occurred_at)));
              setFound(event.id);
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
          <Settings onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      {showStats && (
        <Suspense fallback={null}>
          <StatsPage week={start} onClose={() => setShowStats(false)} />
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
            events={days.flatMap((d) => d.events)}
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
