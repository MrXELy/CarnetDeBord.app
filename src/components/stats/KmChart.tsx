import { emptyReport, type KmTimeline } from '../../lib/emptyKm';
import { periodRange, shortLabel, subPeriods, type Period } from '../../lib/stats';
import type { TripEvent } from '../../types';
import { num, kmOf } from './format';
import { Section } from './shared';

/** Barres des km : jours d'une semaine, semaines d'un mois, mois d'une année. Toucher une barre l'ouvre. */
export default function KmChart(props: {
  period: Period;
  events: TripEvent[];
  timeline: KmTimeline;
  now: Date;
  onPick: (p: Period) => void;
  /** Dans la grande tuile des km : sans titre de section, barres sombres sur le fond bleu clair. */
  bare?: boolean;
}) {
  const bars = subPeriods(props.period).map((p) => {
    const range = periodRange(p);
    if (range.start > props.now) return { period: p, km: null, empty: 0 };
    const km = kmOf(props.events, range);
    return { period: p, km, empty: Math.min(km, emptyReport(props.timeline, range.start, range.end).empty) };
  });
  const max = Math.max(1, ...bars.map((b) => b.km ?? 0));
  const step = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find((s) => max / s <= 4) ?? 10000;
  const top = Math.ceil(max / step) * step;
  const W = 340;
  const H = 170;
  const pad = { top: 22, bottom: 22, left: 36, right: 4 };
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / top);
  const slot = (W - pad.left - pad.right) / bars.length;
  const width = Math.min(30, slot * 0.62);
  const short = (v: number) => (v >= 10000 ? `${num(v / 1000, v % 1000 ? 1 : 0)}k` : num(v));
  const best = bars.reduce((b, x, i) => ((x.km ?? 0) > (bars[b].km ?? 0) ? i : b), 0);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const title = { jour: '', semaine: 'Km par jour', mois: 'Km par semaine', annee: 'Km par mois' }[props.period.kind];

  const chart = (
    <>
      <svg className="st-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <defs>
          <linearGradient id="st-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#60a5fa" stopOpacity="0.9" />
            <stop offset="1" stopColor="#60a5fa" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="st-best" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="1" stopColor="#f59e0b" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} className={v ? 'st-grid' : 'st-axis'} />
            <text x={pad.left - 6} y={y(v) + 3} textAnchor="end">
              {short(v)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const empty = !b.km;
          return (
            <g
              key={i}
              className={b.km == null ? 'st-bar future' : 'st-bar'}
              role="button"
              tabIndex={b.km == null ? -1 : 0}
              aria-label={`${shortLabel(b.period)} : ${b.km ?? 0} km`}
              onClick={() => b.km != null && props.onPick(b.period)}
              onKeyDown={(e) => e.key === 'Enter' && b.km != null && props.onPick(b.period)}
            >
              <rect x={cx - slot / 2} y={pad.top} width={slot} height={H - pad.top} fill="transparent" />
              {empty ? (
                <rect x={cx - width / 2} y={y(0) - 3} width={width} height={3} rx={1.5} className="st-bar-empty" />
              ) : (
                <>
                  <rect
                    x={cx - width / 2}
                    y={y(b.km!)}
                    width={width}
                    height={y(0) - y(b.km!)}
                    rx={6}
                    fill={i === best ? 'url(#st-best)' : 'url(#st-bar)'}
                  />
                  {b.empty > 0 && (
                    <rect
                      x={cx - width / 2}
                      y={y(b.empty)}
                      width={width}
                      height={y(0) - y(b.empty)}
                      rx={Math.min(6, (y(0) - y(b.empty)) / 2)}
                      className="st-bar-vide"
                    />
                  )}
                </>
              )}
              {!empty && (bars.length <= 7 || i === best) && (
                <text x={cx} y={y(b.km!) - 6} textAnchor="middle" className="st-value">
                  {short(b.km!)}
                </text>
              )}
              <text x={cx} y={H - 6} textAnchor="middle">
                {shortLabel(b.period)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="hint">
        {props.bare ? 'En plus foncé, la plus grosse barre' : 'En doré, la plus grosse barre'} ; en clair, la part à
        vide. Touche une barre pour l’ouvrir.
      </p>
    </>
  );
  return props.bare ? chart : <Section title={title}>{chart}</Section>;
}
