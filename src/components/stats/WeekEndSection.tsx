import { addHours, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useMemo } from 'react';
import { periodAt, type Period, type Range } from '../../lib/stats';
import { weekEnds } from '../../lib/weekEnds';
import type { TripEvent } from '../../types';
import { Section } from './shared';

/** Écart affiché jusqu'à 12 h de chaque côté ; au-delà, le point reste au bord. */
const SCALE = 12 * 60;

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** « −6 h 30 », « +5 h 15 », « pile ». */
function gap(diff: number): string {
  if (diff === 0) return 'pile';
  const m = Math.abs(diff);
  return `${diff < 0 ? '−' : '+'}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/**
 * Heure de fin de chaque semaine, en écart avec l'heure habituelle du vendredi : à gauche si plus tôt, à droite si
 * plus tard ; jour écrit devant l'heure si ce n'est pas le vendredi. Toucher une ligne ouvre la semaine.
 */
export default function WeekEndSection(props: {
  events: TripEvent[];
  range: Range;
  now: Date;
  onPick: (p: Period) => void;
}) {
  const { events, range, now } = props;
  const data = useMemo(() => weekEnds(events, range, now), [events, range, now]);
  if (!data || data.weeks.length === 0) return null;

  return (
    <Section title="Fin de semaine">
      <div className="st-we-head">
        <span className="early">◂ plus tôt</span>
        <span>
          <small>d’habitude</small>
          <b>ven. {clock(data.usual)}</b>
        </span>
        <span className="late">plus tard ▸</span>
      </div>
      <ul className="st-we">
        {data.weeks.map((w) => {
          const pos = 50 + (Math.max(-SCALE, Math.min(SCALE, w.diff)) / SCALE) * 50;
          const tone = w.diff < 0 ? 'early' : 'late';
          return (
            <li key={w.week.getTime()}>
              <button
                type="button"
                className={`st-we-row ${tone}`}
                onClick={() => props.onPick(periodAt('semaine', addHours(w.week, 2)))}
              >
                <span className="st-we-date">{format(w.end, 'd MMM', { locale: fr })}</span>
                <span className="st-we-track" aria-hidden>
                  <span
                    className="st-we-bar"
                    style={{ left: `${Math.min(50, pos)}%`, width: `${Math.abs(pos - 50)}%` }}
                  />
                  <span className="st-we-dot" style={{ left: `${pos}%` }} />
                </span>
                <span className="st-we-time">
                  <b>
                    {w.other && format(w.end, 'EEE ', { locale: fr })}
                    {format(w.end, 'HH:mm')}
                  </b>
                  <small>{gap(w.diff)}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="st-we-axis" aria-hidden>
        <div>
          <span>−12 h</span>
          <span>−6 h</span>
          <span>0</span>
          <span>+6 h</span>
          <span>+12 h</span>
        </div>
      </div>
      <p className="hint">
        Dernière fin de journée de chaque semaine, comparée à l’heure habituelle du vendredi ; au-delà de 12 h d’écart,
        le point reste au bord.
      </p>
    </Section>
  );
}
