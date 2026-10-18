import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useMemo } from 'react';
import { durationLabel, weekLabel } from '../../lib/dates';
import { periodAt, records, type Period, type PeriodStats } from '../../lib/stats';
import type { TripEvent } from '../../types';
import { num } from './format';
import { Section, KV, RankList } from './shared';

export default function RecordsSection(props: {
  events: TripEvent[];
  stats: PeriodStats;
  onPick: (p: Period) => void;
}) {
  const r = useMemo(() => records(props.events), [props.events]);
  const short = (d: Date) => format(d, 'd MMM yyyy', { locale: fr });
  const tractors = props.stats.tractors;
  return (
    <Section title="Records et camions">
      <div className="st-kv">
        {r.bestDay && (
          <KV
            label="Plus grosse journée"
            value={`${num(r.bestDay.km)} km`}
            note={short(r.bestDay.day)}
            onClick={() => props.onPick(periodAt('jour', r.bestDay!.day))}
          />
        )}
        {r.bestWeek && (
          <KV
            label="Plus grosse semaine"
            value={`${num(r.bestWeek.km)} km`}
            note={weekLabel(r.bestWeek.start).replace(/^Semaine \d+ · /, '')}
            onClick={() => props.onPick({ kind: 'semaine', anchor: r.bestWeek!.start })}
          />
        )}
        {r.longestDay && (
          <KV
            label="Plus longue amplitude"
            value={durationLabel(r.longestDay.minutes)}
            note={short(r.longestDay.day)}
            onClick={() => props.onPick(periodAt('jour', r.longestDay!.day))}
          />
        )}
      </div>
      {tractors.length > 0 && (
        <div>
          <h3 className="st-h3">Km par tracteur sur la période</h3>
          <RankList
            items={tractors.map((t) => ({ name: t.plate || 'Sans immatriculation', count: t.km }))}
            unit=" km"
          />
        </div>
      )}
    </Section>
  );
}
