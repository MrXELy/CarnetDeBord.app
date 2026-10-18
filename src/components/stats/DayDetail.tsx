import { durationLabel, timeLabel } from '../../lib/dates';
import { formatPlace } from '../../lib/geo';
import { inRange, restBefore, type PeriodStats, type Range } from '../../lib/stats';
import { eventTypeInfo, isDayBoundary, type TripEvent } from '../../types';
import { num, liters } from './format';
import { Section, KV } from './shared';

/** Vue d'un jour : ses étapes dans l'ordre et le repos qui l'a précédé. */
export default function DayDetail({ events, range, stats }: { events: TripEvent[]; range: Range; stats: PeriodStats }) {
  const steps = inRange(events, range).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const start = steps.find((e) => e.type === 'debut_journee');
  const rest = start ? restBefore(events, start) : null;
  return (
    <Section title="La journée">
      <ul className="st-steps">
        {steps.map((e) => (
          <li key={e.id} className={`tone-${e.type}`}>
            <span className="st-step-time">{timeLabel(e.occurred_at)}</span>
            <span className={`st-step-dot${isDayBoundary(e.type) ? ' ring' : ''}`} aria-hidden />
            <span className="st-step-place">
              <b>{eventTypeInfo(e.type).short}</b> · {formatPlace(e) || 'Lieu non renseigné'}
            </span>
            <span className="st-step-extra">
              {e.type === 'carburant' && e.diesel_l != null
                ? liters(e.diesel_l)
                : e.odometer_km != null && isDayBoundary(e.type)
                  ? `${num(e.odometer_km)} km`
                  : ''}
            </span>
          </li>
        ))}
      </ul>
      <div className="st-kv">
        <KV label="Amplitude" value={stats.fullDays ? durationLabel(stats.amplitude) : '—'} note="du début à la fin" />
        <KV label="Repos avant" value={rest != null ? durationLabel(rest) : '—'} note="repère, le chrono fait foi" />
      </div>
    </Section>
  );
}
