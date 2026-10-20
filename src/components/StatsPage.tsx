import { addHours, format, parseISO } from 'date-fns';
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Map as MapIcon, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { summarizeAllowances } from '../lib/allowances';
import { monthLabel, weekStart } from '../lib/dates';
import {
  inRange,
  nowIsStale,
  periodAt,
  periodRange,
  periodStats,
  periodTitle,
  previousRange,
  shiftPeriod,
  type Period,
  type PeriodKind,
  type PeriodStats,
  type Range,
} from '../lib/stats';
import { useEvents } from '../lib/useEvents';
import { useSwipe } from '../lib/useSwipe';
import { useSheet } from '../lib/useSheet';
import AllowanceTable from './AllowanceTable';
import { num, percent } from './stats/format';
import { Evolution, Section } from './stats/shared';
import Tiles from './stats/Tiles';
import KmChart from './stats/KmChart';
import EmptySection from './stats/EmptySection';
import DayDetail from './stats/DayDetail';
import FuelSection from './stats/FuelSection';
import WorkSection from './stats/WorkSection';
import RestSection from './stats/RestSection';
import PlacesSection from './stats/PlacesSection';
import Calendar from './stats/Calendar';
import RecordsSection from './stats/RecordsSection';
import type { TripEvent } from '../types';

// Cartes chargées seulement à leur ouverture.
const WeekMap = lazy(() => import('./WeekMap'));
const MonthMap = lazy(() => import('./MonthMap'));

/** Carte ouverte depuis les statistiques : d'une journée (« 2026-10-20 »), d'une semaine ou d'un mois. */
type OpenMap =
  { kind: 'jour'; start: Date; day: string } | { kind: 'semaine'; start: Date } | { kind: 'mois'; month: string };

/** « Carte du jour », etc. */
const MAP_LABEL: Partial<Record<PeriodKind, string>> = {
  jour: 'Carte du jour',
  semaine: 'Carte de la semaine',
  mois: 'Carte du mois',
};

const KINDS: { value: PeriodKind; label: string }[] = [
  { value: 'jour', label: 'Jour' },
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
  { value: 'annee', label: 'Année' },
];

/** Bouton de retour à la période en cours. */
const TODAY: Record<PeriodKind, string> = {
  jour: 'Aujourd’hui',
  semaine: 'Cette semaine',
  mois: 'Ce mois-ci',
  annee: 'Cette année',
};

/** « par rapport à la semaine dernière », selon la période. */
const PREVIOUS: Record<PeriodKind, string> = {
  jour: 'la veille',
  semaine: 'la semaine d’avant',
  mois: 'le mois d’avant',
  annee: 'l’année d’avant',
};

interface Props {
  /** Semaine affichée à l'ouverture (dimanche 22h). */
  week: Date;
  /** Corriger une étape sans position depuis une carte (ferme les statistiques). */
  onEdit: (event: TripEvent) => void;
  onClose: () => void;
}

export default function StatsPage({ week, onEdit, onClose }: Props) {
  const { events, waybills, store, allowanceSettings } = useEvents();
  const [period, setPeriod] = useState<Period>({ kind: 'semaine', anchor: week });
  const [slide, setSlide] = useState<'next' | 'prev' | 'fade'>('fade');
  const [map, setMap] = useState<OpenMap | null>(null);
  const intervals = store.fuelIntervals();
  const timeline = store.kmTimeline();
  // « Maintenant » ne change que si les données ou la période changent, ou si `tick` monte (voir plus bas) :
  // les calculs ci-dessous restent mémorisés.
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [events, waybills, period, tick]);

  // Page laissée ouverte : une fois par minute, et au retour sur la page (un téléphone en veille suspend la minuterie),
  // on remplace `now` seulement s'il est périmé (limite de période franchie ou plus de 10 min), pas à chaque minute.
  const shownNow = useRef(now);
  shownNow.current = now;
  useEffect(() => {
    const check = () => {
      if (nowIsStale(shownNow.current, new Date(), period)) setTick((t) => t + 1);
    };
    const timer = setInterval(check, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [period]);

  const sheet = useSheet(onClose);

  const range = useMemo(() => periodRange(period), [period]);
  const previous = useMemo(() => previousRange(period, now), [period, now]);
  const isFuture = range.start > now;
  const hasNext = periodRange(shiftPeriod(period, 1)).start <= now;
  const isCurrent = range.start <= now && now < range.end;
  const datePicker = useRef<HTMLInputElement>(null);

  // Ouvre directement le calendrier du téléphone ; à défaut, simple clic sur le champ.
  function openDatePicker() {
    const input = datePicker.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') input.showPicker();
    else input.click();
  }

  const stats = useMemo(
    () => periodStats(events, waybills, range, intervals, timeline),
    [events, waybills, range, intervals, timeline],
  );
  const before = useMemo(
    () => periodStats(events, waybills, previous.range, intervals, timeline),
    [events, waybills, previous, intervals, timeline],
  );
  // Frais de déplacement : par semaine, mois ou année (pas par jour), une fois les bases réglées.
  const fees = useMemo(
    () =>
      period.kind !== 'jour' && allowanceSettings.bases.length > 0
        ? {
            cur: summarizeAllowances(store.allowances(), range),
            prev: summarizeAllowances(store.allowances(), previous.range),
          }
        : null,
    // `events` : store.allowances() se recalcule quand les étapes changent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, allowanceSettings, period.kind, range, previous, store],
  );

  function go(next: Period, direction: 'next' | 'prev' | 'fade') {
    setSlide(direction);
    setPeriod(next);
  }

  const move = (delta: number) => {
    if (delta > 0 && !hasNext) return;
    go(shiftPeriod(period, delta), delta > 0 ? 'next' : 'prev');
  };

  // Garde la même date en changeant de type de période (semaine → son mois, etc.) :
  // aujourd'hui si la période est en cours, sinon le dernier jour travaillé de la période.
  function changeKind(kind: PeriodKind) {
    if (kind === period.kind) return;
    const last = inRange(events, range)[0];
    const ref =
      range.start <= now && now < range.end ? now : last ? parseISO(last.occurred_at) : addHours(range.start, 2);
    go(periodAt(kind, ref), 'fade');
  }

  const swipe = useSwipe(move);

  /** Carte de la période affichée (pas pour une année). */
  function openMap() {
    if (period.kind === 'jour') {
      setMap({ kind: 'jour', start: weekStart(addHours(range.start, 2)), day: format(period.anchor, 'yyyy-MM-dd') });
    } else if (period.kind === 'semaine') setMap({ kind: 'semaine', start: range.start });
    else if (period.kind === 'mois') setMap({ kind: 'mois', month: monthLabel(range.start) });
  }

  // Étapes de la semaine de la carte ouverte (une journée prend les itinéraires de sa semaine).
  const mapStart = map && map.kind !== 'mois' ? map.start.getTime() : null;
  const mapEvents = useMemo(
    () =>
      mapStart == null
        ? []
        : events.filter((e) => !e.deleted_at && weekStart(parseISO(e.occurred_at)).getTime() === mapStart),
    [events, mapStart],
  );

  const compared = `par rapport à ${PREVIOUS[period.kind]}${previous.partial ? ' au même moment' : ''}`;

  return (
    <>
      <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
        <div className="modal stats" onClick={(e) => e.stopPropagation()}>
          <header className="modal-header" {...sheet.handle}>
            <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
              <X size={22} />
            </button>
            <h2>Statistiques</h2>
          </header>

          <div className="modal-body" {...swipe}>
            <div className="segmented st-kinds" role="group" aria-label="Période">
              {KINDS.map((k) => (
                <button
                  type="button"
                  key={k.value}
                  className={period.kind === k.value ? 'selected' : ''}
                  aria-pressed={period.kind === k.value}
                  onClick={() => changeKind(k.value)}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <nav className="st-nav">
              <button type="button" className="round-btn" aria-label="Période précédente" onClick={() => move(-1)}>
                <ChevronLeft size={22} />
              </button>
              <div className="st-when">
                <button type="button" className="st-title" onClick={openDatePicker} aria-label="Aller à une date">
                  {periodTitle(period, now)}
                  <ChevronDown size={16} className="st-title-chevron" aria-hidden />
                </button>
                <span>{subtitle(period, stats, range, now)}</span>
                <input
                  ref={datePicker}
                  type="date"
                  className="date-jump"
                  aria-label="Aller à une date"
                  tabIndex={-1}
                  max={format(now, 'yyyy-MM-dd')}
                  value={format(addHours(range.start, 2), 'yyyy-MM-dd')}
                  onChange={(e) => {
                    if (e.target.value) go(periodAt(period.kind, new Date(`${e.target.value}T12:00`)), 'fade');
                  }}
                />
              </div>
              <button
                type="button"
                className="round-btn"
                aria-label="Période suivante"
                onClick={() => move(1)}
                disabled={!hasNext}
              >
                <ChevronRight size={22} />
              </button>
            </nav>

            <div className="st-pills">
              {!isCurrent && (
                <button type="button" className="pill st-today" onClick={() => go(periodAt(period.kind, now), 'next')}>
                  <CalendarCheck size={14} aria-hidden />
                  {TODAY[period.kind]}
                </button>
              )}
              {MAP_LABEL[period.kind] && !isFuture && stats.days > 0 && (
                <button type="button" className="pill st-today" onClick={openMap}>
                  <MapIcon size={14} aria-hidden />
                  {MAP_LABEL[period.kind]}
                </button>
              )}
            </div>

            <div className={`st-content slide-${slide}`} key={`${period.kind}-${period.anchor.getTime()}`}>
              {isFuture || stats.days === 0 ? (
                <p className="empty muted">{isFuture ? 'Période à venir.' : 'Aucune étape sur cette période.'}</p>
              ) : (
                <>
                  <section className="st-hero">
                    <span className="st-eyebrow">Kilomètres</span>
                    <span className="st-big">
                      {num(stats.km)} <small>km</small>
                    </span>
                    {stats.empty.share != null && (
                      <span className="st-hero-empty">
                        dont <b>{num(stats.empty.empty)} km à vide</b> · {percent(stats.empty.share)} %
                      </span>
                    )}
                    {before.km > 0 && (
                      <span className="st-compare">
                        <Evolution cur={stats.km} prev={before.km} mode="pct" />
                        {compared} ({num(before.km)} km)
                      </span>
                    )}
                  </section>

                  <Tiles period={period} stats={stats} before={before} fees={fees} />

                  {period.kind === 'jour' ? (
                    <DayDetail events={events} range={range} stats={stats} />
                  ) : (
                    <KmChart
                      period={period}
                      events={events}
                      timeline={timeline}
                      now={now}
                      onPick={(p) => go(p, 'fade')}
                    />
                  )}

                  {period.kind !== 'jour' && (
                    <EmptySection
                      stats={stats}
                      before={before.days > 0 ? before : null}
                      previous={PREVIOUS[period.kind]}
                      onPick={(p) => go(p, 'fade')}
                    />
                  )}

                  <FuelSection period={period} stats={stats} intervals={intervals} range={range} />

                  {fees && (
                    <Section title="Frais de route">
                      <AllowanceTable summary={fees.cur} />
                    </Section>
                  )}

                  {period.kind !== 'jour' && (
                    <>
                      <WorkSection events={events} range={range} />
                      <RestSection events={events} range={range} now={now} onPick={(p) => go(p, 'fade')} />
                      <PlacesSection events={events} waybills={waybills} range={range} weightKg={stats.weightKg} />
                      {period.kind === 'mois' && (
                        <Calendar period={period} events={events} now={now} onPick={(p) => go(p, 'fade')} />
                      )}
                      <RecordsSection events={events} stats={stats} onPick={(p) => go(p, 'fade')} />
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {map?.kind === 'mois' && (
        <Suspense fallback={null}>
          <MonthMap
            month={map.month}
            onPickWeek={(start) => setMap({ kind: 'semaine', start })}
            onEdit={onEdit}
            onClose={() => setMap(null)}
          />
        </Suspense>
      )}
      {map && map.kind !== 'mois' && (
        <Suspense fallback={null}>
          <WeekMap
            start={map.start}
            events={mapEvents}
            day={map.kind === 'jour' ? map.day : undefined}
            onEdit={onEdit}
            onClose={() => setMap(null)}
          />
        </Suspense>
      )}
    </>
  );
}

function subtitle(period: Period, stats: PeriodStats, range: Range, now: Date): string {
  if (period.kind === 'jour') return stats.steps ? `${stats.steps} étape${stats.steps > 1 ? 's' : ''}` : '';
  const days = stats.days ? `${stats.days} jour${stats.days > 1 ? 's' : ''} travaillé${stats.days > 1 ? 's' : ''}` : '';
  const running = range.start <= now && now < range.end ? 'En cours' : '';
  return [running, days].filter(Boolean).join(' · ');
}
