import { addDays, format, isSameDay } from 'date-fns';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileText,
  LoaderCircle,
  Map as MapIcon,
  ReceiptEuro,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { euros, summarizeAllowances } from '../lib/allowances';
import { durationLabel, groupWeek, summarizeDay, summarizeWeek, weekLabel, weekStart } from '../lib/dates';
import { shareFile } from '../lib/share';
import { useEvents } from '../lib/useEvents';
import { useSheet } from '../lib/useSheet';
import { useSwipe } from '../lib/useSwipe';
import { buildWeekSheet } from '../lib/weekSheet';
import { isDayBoundary, type TripEvent } from '../types';
import DaySection from './DaySection';

interface Props {
  /** Début de la semaine affichée (dimanche 22h). */
  start: Date;
  /** Sens de l'animation au changement de semaine. */
  slide: 'next' | 'prev' | 'fade';
  /** Étape trouvée par la recherche, mise en évidence. */
  found: string | null;
  onWeek: (delta: number) => void;
  onPickWeek: () => void;
  onOpen: (event: TripEvent) => void;
  /** Carte de la semaine, ou d'une de ses journées (« 2026-10-20 »). */
  onMap: (day?: string) => void;
  onAllowances: () => void;
  onInTruck: () => void;
  onClose: () => void;
}

/** Page d'une semaine : ses km, ses raccourcis (frais, carte, feuille) et tous ses jours. */
export default function WeekPage(props: Props) {
  const { start, slide, found } = props;
  const { events, waybills, store, allowanceSettings, sheetSettings } = useEvents();
  const sheet = useSheet(props.onClose);
  const panel = useRef<HTMLDivElement>(null);
  // Feuille de semaine en cours de fabrication : bouton occupé, pas de double fabrication.
  const [makingSheet, setMakingSheet] = useState(false);
  const days = useMemo(() => groupWeek(events, start), [events, start]);
  const week = useMemo(() => summarizeWeek(days.flatMap((d) => d.events)), [days]);
  // Amplitude totale des journées complètes, et nombre d'opérations (sans les débuts et fins de journée).
  const amplitude = days.reduce((sum, d) => sum + (summarizeDay(d.events).amplitude ?? 0), 0);
  const steps = days.reduce((n, d) => n + d.events.filter((e) => !isDayBoundary(e.type)).length, 0);
  const isCurrentWeek = isSameDay(start, weekStart(new Date()));
  const inTruck = store.inTruck(new Date()).length;
  const showInTruck = isCurrentWeek && inTruck > 0;
  // Frais de la semaine : dès qu'elle a des étapes.
  const allowances = useMemo(
    () => summarizeAllowances(store.allowances(), { start, end: addDays(start, 7) }),
    // store.allowances() ne change qu'avec les étapes ou les réglages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, allowanceSettings, start],
  );
  const hasDays = days.length > 0;
  const swipe = useSwipe((direction) => props.onWeek(direction));

  // Nouvelle semaine : la page repart du haut (l'étape trouvée par la recherche est rejointe juste après).
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [start]);

  // Recherche : fait défiler jusqu'à l'étape choisie, une fois la page montée et la semaine glissée.
  useEffect(() => {
    if (!found) return;
    const timer = setTimeout(() => {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      document
        .querySelector(`[data-event-id="${found}"]`)
        ?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }, 450);
    return () => clearTimeout(timer);
  }, [found]);

  /** Feuille de semaine en PDF : partagée sur téléphone, téléchargée sur ordinateur. */
  async function weekSheet() {
    if (makingSheet) return;
    setMakingSheet(true);
    try {
      // Le dessin du PDF (et sa bibliothèque) n'est chargé qu'ici.
      const { weekSheetPdf } = await import('../lib/weekSheetPdf');
      const built = buildWeekSheet(events, waybills, start, sheetSettings, store.allowances());
      const name = `feuille-semaine-${built.week}-${built.monday.getFullYear()}.pdf`;
      await shareFile(weekSheetPdf(built), name, `Feuille de semaine ${built.week}`);
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        alert(`Feuille de semaine impossible : ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setMakingSheet(false);
    }
  }

  return (
    <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
      <div className="modal week-page" ref={panel} onClick={(e) => e.stopPropagation()} {...swipe}>
        <header className="modal-header" {...sheet.handle}>
          <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Semaine</h2>
        </header>

        <div className="modal-body">
          <nav className="week-nav">
            <button className="round-btn" aria-label="Semaine précédente" onClick={() => props.onWeek(-1)}>
              <ChevronLeft size={22} />
            </button>
            <button className="week-title" onClick={props.onPickWeek} aria-label="Choisir une semaine">
              {weekLabel(start)}
              <ChevronDown size={16} className="week-title-chevron" aria-hidden />
            </button>
            <button className="round-btn" aria-label="Semaine suivante" onClick={() => props.onWeek(1)}>
              <ChevronRight size={22} />
            </button>
          </nav>

          <div className={`week-hero slide-${slide}`} key={start.getTime()}>
            <span className={`week-km${week.km == null ? ' empty-km' : ''}`}>
              {week.km != null ? `${week.km.toLocaleString('fr-FR')} km` : 'Aucun km'}
            </span>
            <span className="week-sub">
              {week.inProgress && isCurrentWeek && 'En cours · '}
              {amplitude > 0 && `${durationLabel(amplitude)} d’amplitude · `}
              {steps} étape{steps > 1 ? 's' : ''}
            </span>
          </div>

          {(showInTruck || hasDays) && (
            <div className="week-links">
              {showInTruck && (
                <button className="pill" onClick={props.onInTruck}>
                  <FileText size={18} aria-hidden />
                  {inTruck} LV<span className="pill-long"> dans le camion</span>
                </button>
              )}
              {hasDays && (
                <button
                  className="pill"
                  onClick={props.onAllowances}
                  aria-label={
                    allowanceSettings.bases.length ? `Frais de route, ${euros(allowances.total)}` : 'Frais de route'
                  }
                >
                  <ReceiptEuro size={18} aria-hidden />
                  {allowanceSettings.bases.length > 0 ? euros(allowances.total) : 'Frais'}
                </button>
              )}
              {hasDays && (
                <button className="pill" onClick={() => props.onMap()} aria-label="Carte de la semaine">
                  <MapIcon size={18} aria-hidden />
                  Carte
                </button>
              )}
              {hasDays && (
                <button
                  className="pill"
                  onClick={weekSheet}
                  disabled={makingSheet}
                  aria-busy={makingSheet}
                  aria-label="Feuille de semaine en PDF"
                >
                  {makingSheet ? (
                    <LoaderCircle size={18} className="spin" aria-hidden />
                  ) : (
                    <FileDown size={18} aria-hidden />
                  )}
                  Feuille
                </button>
              )}
            </div>
          )}

          <div className={`days slide-${slide}`} key={`days-${start.getTime()}`}>
            {hasDays ? (
              days.map((day, i) => (
                <DaySection
                  key={day.date.getTime()}
                  day={day}
                  index={i}
                  found={found}
                  onOpen={props.onOpen}
                  onMap={() => props.onMap(format(day.date, 'yyyy-MM-dd'))}
                />
              ))
            ) : (
              <div className="empty">
                <p>Aucune étape cette semaine.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
