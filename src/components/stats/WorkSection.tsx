import { durationLabel } from '../../lib/dates';
import { workTimes, type Range } from '../../lib/stats';
import type { TripEvent } from '../../types';
import { clock } from './format';
import { Section, KV } from './shared';

export default function WorkSection({ events, range }: { events: TripEvent[]; range: Range }) {
  const t = workTimes(events, range);
  return (
    <Section title="Temps de travail">
      <div className="st-kv">
        <KV label="Début moyen" value={clock(t.avgStart)} note={`le plus tôt : ${clock(t.earliestStart)}`} />
        <KV label="Fin moyenne" value={clock(t.avgEnd)} note={`la plus tard : ${clock(t.latestEnd)}`} />
        <KV
          label="Amplitude moyenne"
          value={t.avgAmplitude != null ? durationLabel(t.avgAmplitude) : '—'}
          note={t.longestAmplitude != null ? `la plus longue : ${durationLabel(t.longestAmplitude)}` : undefined}
        />
        <KV
          label="Repos le plus court"
          value={t.shortestRest != null ? durationLabel(t.shortestRest) : '—'}
          note="repère, le chrono fait foi"
        />
      </div>
    </Section>
  );
}
