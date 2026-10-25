import { format, isSameDay } from 'date-fns';
import { dayLabel } from '../../lib/dates';
import { kmByDay, periodRange, subPeriods, type Period } from '../../lib/stats';
import type { TripEvent } from '../../types';
import { num } from './format';
import { Section } from './shared';

/** Calendrier du mois : une case par jour, plus soutenue quand il y a eu plus de km. */
export default function Calendar(props: {
  period: Period;
  events: TripEvent[];
  now: Date;
  onPick: (p: Period) => void;
}) {
  const range = periodRange(props.period);
  const km = kmByDay(props.events, range);
  const max = Math.max(1, ...km.values());
  const weeks = subPeriods(props.period);
  const level = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  return (
    <Section title="Calendrier">
      <div className="st-cal">
        {['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'].map((d) => (
          <span key={d} className="st-cal-head">
            {d}
          </span>
        ))}
        {weeks.flatMap((w) =>
          subPeriods(w).map((day) => {
            const value = km.get(day.anchor.getTime());
            const future = day.anchor > props.now;
            return (
              <button
                type="button"
                key={day.anchor.getTime()}
                className={`st-cal-day l${level(value ?? 0)}${future ? ' future' : ''}${isSameDay(day.anchor, props.now) ? ' today' : ''}`}
                title={value ? `${num(value)} km` : undefined}
                aria-label={`${dayLabel(day.anchor)}${value ? ` : ${num(value)} km` : ''}`}
                disabled={future || value == null}
                onClick={() => props.onPick(day)}
              >
                {format(day.anchor, 'd')}
              </button>
            );
          }),
        )}
      </div>
      <p className="hint">Plus la case est claire, plus tu as roulé. Touche un jour pour l’ouvrir.</p>
    </Section>
  );
}
