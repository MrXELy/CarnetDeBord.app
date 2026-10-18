import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { averageRate, formatRate, intervalKm, intervalRate, recentIntervals, type FuelInterval } from '../../lib/fuel';
import type { Period, PeriodStats, Range } from '../../lib/stats';
import { num, liters } from './format';
import { Section, KV, RankList } from './shared';

export default function FuelSection(props: {
  period: Period;
  stats: PeriodStats;
  intervals: FuelInterval[];
  range: Range;
}) {
  const { fuel, stations, adblue } = props.stats;
  const recent = recentIntervals(props.intervals, props.range.end, undefined, 8);
  const estimated = fuel.km - fuel.measuredKm;
  const total = stations.reduce((s, x) => s + x.liters, 0);
  const avgKm = recent.length ? Math.round(recent.reduce((s, i) => s + intervalKm(i), 0) / recent.length) : null;
  return (
    <Section title="Gasoil">
      {recent.length >= 2 && <RateChart intervals={recent} />}
      <div className="st-kv">
        <KV
          label="Consommé"
          value={fuel.used != null ? `≈ ${liters(fuel.used)}` : '—'}
          note={`pour ${num(fuel.km)} km`}
        />
        <KV label="Acheté" value={liters(fuel.bought)} note={`AdBlue ${liters(adblue)}`} />
        {avgKm != null && <KV label="Entre deux pleins" value={`${num(avgKm)} km`} note="en moyenne" />}
        {adblue > 0 && fuel.used && (props.period.kind === 'mois' || props.period.kind === 'annee') && (
          <KV label="AdBlue" value={`${num((adblue / fuel.used) * 100, 1)} %`} note="du gasoil consommé" />
        )}
      </div>
      {total > 0 && (
        <div>
          <h3 className="st-h3">Par station</h3>
          <RankList
            tone="carburant"
            unit=" %"
            items={stations.map((s) => ({ name: s.station, count: Math.round((s.liters / total) * 100) }))}
          />
        </div>
      )}
      <p className="hint">
        Consommation mesurée d’un plein complet au suivant, compléments compris.
        {estimated > 0 &&
          fuel.used != null &&
          ` ${num(estimated)} km estimés avec ta consommation habituelle (pas encore de plein complet après).`}
      </p>
    </Section>
  );
}

/** Courbe de la consommation des derniers pleins complets, avec la moyenne en pointillés. */
function RateChart({ intervals }: { intervals: FuelInterval[] }) {
  const rates = intervals.map((i) => intervalRate(i)!);
  const avg = averageRate(intervals)!;
  const lo = Math.floor(Math.min(...rates, avg) - 1);
  const hi = Math.ceil(Math.max(...rates, avg) + 1);
  const W = 340;
  const H = 96;
  const pad = 14;
  const x = (i: number) => pad + ((W - pad * 2) * i) / (rates.length - 1);
  const y = (v: number) => pad + (H - pad * 2 - 12) * (1 - (v - lo) / (hi - lo));
  const points = rates.map((r, i) => `${x(i)},${y(r)}`).join(' ');
  const last = rates.length - 1;
  const day = (iso: string) => format(parseISO(iso), 'd MMM', { locale: fr });
  return (
    <div>
      <h3 className="st-h3">Derniers pleins complets, L/100 km</h3>
      <svg className="st-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Consommation des derniers pleins">
        <defs>
          <linearGradient id="st-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fbbf24" stopOpacity="0.3" />
            <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad} x2={W - pad} y1={y(avg)} y2={y(avg)} className="st-avg" />
        <text x={pad} y={y(avg) - 5}>
          moyenne {formatRate(avg)}
        </text>
        <polygon points={`${x(0)},${H - 26} ${points} ${x(last)},${H - 26}`} fill="url(#st-area)" />
        <polyline points={points} fill="none" stroke="#fbbf24" strokeWidth="2.2" strokeLinejoin="round" />
        {rates.map((r, i) => (
          <circle key={i} cx={x(i)} cy={y(r)} r={i === last ? 4.5 : 2.5} fill="#fbbf24" className="st-dot" />
        ))}
        <text x={x(last)} y={y(rates[last]) - 9} textAnchor="end" className="st-value">
          {formatRate(rates[last])}
        </text>
        <text x={pad} y={H - 4}>
          {day(intervals[0].end)}
        </text>
        <text x={W - pad} y={H - 4} textAnchor="end">
          {day(intervals[last].end)}
        </text>
      </svg>
    </div>
  );
}
