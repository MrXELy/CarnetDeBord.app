import { addHours, format, isSameDay, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { dayLabel, durationLabel, timeLabel, weekLabel } from '../lib/dates';
import { averageRate, formatRate, intervalKm, intervalRate, recentIntervals, type FuelInterval } from '../lib/fuel';
import { formatPlace } from '../lib/geo';
import {
  inRange,
  kmByDay,
  kmByTractor,
  periodAt,
  periodRange,
  periodStats,
  periodTitle,
  previousRange,
  records,
  restBefore,
  shiftPeriod,
  shortLabel,
  subPeriods,
  topPlaces,
  workTimes,
  type Period,
  type PeriodKind,
  type PeriodStats,
  type Range,
  type Ranked,
} from '../lib/stats';
import { useEvents } from '../lib/useEvents';
import { useModal } from '../lib/useModal';
import { eventTypeInfo, isDayBoundary, type TripEvent, type Waybill } from '../types';

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

const num = (n: number, digits = 0) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const liters = (n: number) => `${num(Math.round(n))} L`;

/** Heure de la journée à partir des minutes après minuit (−60 → 23:00). */
const clock = (minutes: number | null) => {
  if (minutes == null) return '—';
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const kmOf = (events: TripEvent[], range: Range) =>
  [...kmByTractor(inRange(events, range)).values()].reduce((a, b) => a + b, 0);

interface Props {
  /** Semaine affichée à l'ouverture (dimanche 22h). */
  week: Date;
  onClose: () => void;
}

export default function StatsPage({ week, onClose }: Props) {
  const { events, waybills, store } = useEvents();
  const [period, setPeriod] = useState<Period>({ kind: 'semaine', anchor: week });
  const [slide, setSlide] = useState<'next' | 'prev' | 'fade'>('fade');
  const touch = useRef<{ x: number; y: number } | null>(null);
  const intervals = store.fuelIntervals();
  const now = new Date();

  useModal(onClose);

  const range = periodRange(period);
  const previous = previousRange(period, now);
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

  const stats = periodStats(events, waybills, range, intervals);
  const before = periodStats(events, waybills, previous.range, intervals);

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

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  }

  function onTouchEnd(e: TouchEvent) {
    const from = touch.current;
    touch.current = null;
    if (!from) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - from.x;
    const dy = t.clientY - from.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) move(dx > 0 ? -1 : 1);
  }

  const compared = `par rapport à ${PREVIOUS[period.kind]}${previous.partial ? ' au même moment' : ''}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal stats" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Statistiques</h2>
        </header>

        <div className="modal-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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

          {!isCurrent && (
            <button type="button" className="pill st-today" onClick={() => go(periodAt(period.kind, now), 'next')}>
              <CalendarCheck size={14} aria-hidden />
              {TODAY[period.kind]}
            </button>
          )}

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
                  {before.km > 0 && (
                    <span className="st-compare">
                      <Delta cur={stats.km} prev={before.km} mode="pct" />
                      {compared} ({num(before.km)} km)
                    </span>
                  )}
                </section>

                <Tiles period={period} stats={stats} before={before} />

                {period.kind === 'jour' ? (
                  <DayDetail events={events} range={range} stats={stats} />
                ) : (
                  <KmChart period={period} events={events} now={now} onPick={(p) => go(p, 'fade')} />
                )}

                <FuelSection period={period} stats={stats} intervals={intervals} range={range} />

                {period.kind !== 'jour' && (
                  <>
                    <WorkSection events={events} range={range} />
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
  );
}

function subtitle(period: Period, stats: PeriodStats, range: Range, now: Date): string {
  if (period.kind === 'jour') return stats.steps ? `${stats.steps} étape${stats.steps > 1 ? 's' : ''}` : '';
  const days = stats.days ? `${stats.days} jour${stats.days > 1 ? 's' : ''} travaillé${stats.days > 1 ? 's' : ''}` : '';
  const running = range.start <= now && now < range.end ? 'En cours' : '';
  return [running, days].filter(Boolean).join(' · ');
}

/** Pastille d'évolution : verte si c'est mieux, rouge si c'est moins bien, grise si ni l'un ni l'autre. */
function Delta(props: {
  cur: number | null;
  prev: number | null;
  mode?: 'pct' | 'abs';
  better?: 'up' | 'down' | 'none';
  digits?: number;
  format?: (n: number) => string;
}) {
  const { cur, prev, mode = 'abs', better = 'up', digits = 0 } = props;
  if (cur == null || prev == null || (mode === 'pct' && prev === 0)) return null;
  const diff = mode === 'pct' ? ((cur - prev) / prev) * 100 : cur - prev;
  const shown = Number(diff.toFixed(digits));
  if (shown === 0) return <span className="st-chip flat">=</span>;
  const tone = better === 'none' ? 'flat' : shown > 0 === (better === 'up') ? 'good' : 'bad';
  const value = props.format ? props.format(Math.abs(shown)) : num(Math.abs(shown), digits);
  return (
    <span className={`st-chip ${tone}`}>
      {shown > 0 ? '▲' : '▼'} {value}
      {mode === 'pct' ? ' %' : ''}
    </span>
  );
}

function Tile(props: { label: string; value: ReactNode; tone?: string; children?: ReactNode }) {
  return (
    <div className={`st-tile${props.tone ? ` tone-${props.tone}` : ''}`}>
      <span className="st-tile-label">
        {props.tone && <i aria-hidden />}
        {props.label}
      </span>
      <span className="st-tile-value">{props.value}</span>
      <span className="st-tile-sub">{props.children}</span>
    </div>
  );
}

function Tiles({ period, stats, before }: { period: Period; stats: PeriodStats; before: PeriodStats }) {
  const fuel = stats.fuel;
  const used = fuel.used != null ? `≈ ${liters(fuel.used)}` : '—';
  const perDay = (s: PeriodStats) => (s.days ? Math.round(s.km / s.days) : null);
  const hours = (n: number) => durationLabel(Math.round(n));
  return (
    <div className="st-tiles">
      {period.kind === 'jour' ? (
        <>
          <Tile label="Amplitude" value={stats.fullDays ? durationLabel(stats.amplitude) : '—'}>
            <Delta cur={stats.amplitude || null} prev={before.amplitude || null} better="none" format={hours} />
          </Tile>
          <Tile label="Étapes" value={stats.steps} />
        </>
      ) : (
        <>
          <Tile label="Heures" value={durationLabel(stats.amplitude)}>
            <Delta cur={stats.amplitude} prev={before.amplitude} better="none" format={hours} />
          </Tile>
          <Tile
            label="Moyenne par jour"
            value={
              <>
                {num(perDay(stats) ?? 0)} <small>km</small>
              </>
            }
          >
            <Delta cur={perDay(stats)} prev={perDay(before)} />
          </Tile>
        </>
      )}
      <Tile label="Chargements" value={stats.loads} tone="chargement">
        <Delta cur={stats.loads} prev={before.loads} />
      </Tile>
      <Tile label="Livraisons" value={stats.deliveries} tone="livraison">
        <Delta cur={stats.deliveries} prev={before.deliveries} />
      </Tile>
      <Tile label="Gasoil consommé" value={used} tone="carburant">
        acheté {liters(fuel.bought)}
      </Tile>
      <Tile
        label="Consommation"
        value={
          fuel.rate != null ? (
            <>
              {formatRate(fuel.rate)} <small>L/100</small>
            </>
          ) : (
            '—'
          )
        }
        tone="carburant"
      >
        <Delta cur={fuel.rate} prev={before.fuel.rate} better="down" digits={1} />
      </Tile>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="st-section" open>
      <summary>
        {title}
        <ChevronDown size={18} className="st-chevron" aria-hidden />
      </summary>
      <div className="st-section-body">{children}</div>
    </details>
  );
}

/** Barres des km : jours d'une semaine, semaines d'un mois, mois d'une année. Toucher une barre l'ouvre. */
function KmChart(props: { period: Period; events: TripEvent[]; now: Date; onPick: (p: Period) => void }) {
  const bars = subPeriods(props.period).map((p) => {
    const range = periodRange(p);
    return { period: p, km: range.start > props.now ? null : kmOf(props.events, range) };
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

  return (
    <Section title={title}>
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
                <rect
                  x={cx - width / 2}
                  y={y(b.km!)}
                  width={width}
                  height={y(0) - y(b.km!)}
                  rx={6}
                  fill={i === best ? 'url(#st-best)' : 'url(#st-bar)'}
                />
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
      <p className="hint">En doré, la plus grosse. Touche une barre pour l’ouvrir.</p>
    </Section>
  );
}

/** Vue d'un jour : ses étapes dans l'ordre et le repos qui l'a précédé. */
function DayDetail({ events, range, stats }: { events: TripEvent[]; range: Range; stats: PeriodStats }) {
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

function KV({
  label,
  value,
  note,
  onClick,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="st-kv-label">{label}</span>
      <b>{value}</b>
      {note && <em>{note}</em>}
    </>
  );
  return onClick ? (
    <button type="button" className="st-kv-item" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="st-kv-item">{content}</div>
  );
}

function RankList({ items, unit = '', tone }: { items: Ranked[]; unit?: string; tone?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className={`st-rank${tone ? ` tone-${tone}` : ''}`}>
      {items.map((i) => (
        <li key={`${i.name}|${i.detail ?? ''}`}>
          <span className="st-rank-name">
            {i.name}
            {i.detail && <span> {i.detail}</span>}
          </span>
          <span className="st-rank-count">
            {num(i.count)}
            {unit}
          </span>
          <span className="st-rank-bar">
            <i style={{ width: `${(i.count / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function FuelSection(props: { period: Period; stats: PeriodStats; intervals: FuelInterval[]; range: Range }) {
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

function WorkSection({ events, range }: { events: TripEvent[]; range: Range }) {
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

function PlacesSection(props: { events: TripEvent[]; waybills: Waybill[]; range: Range; weightKg: number }) {
  const places = topPlaces(props.events, props.waybills, props.range);
  const { weightKg } = props;
  return (
    <Section title="Clients et lieux">
      {places.shippers.length > 0 && (
        <div>
          <h3 className="st-h3">Chargeurs les plus fréquents</h3>
          <RankList items={places.shippers} tone="chargement" />
        </div>
      )}
      {places.consignees.length > 0 && (
        <div>
          <h3 className="st-h3">Destinataires les plus fréquents</h3>
          <RankList items={places.consignees} tone="livraison" />
        </div>
      )}
      {places.departments.length > 0 && (
        <div>
          <h3 className="st-h3">Départements traversés</h3>
          <RankList items={places.departments} />
        </div>
      )}
      {weightKg > 0 && (
        <div className="st-kv">
          <KV label="Tonnage" value={`${num(weightKg / 1000, weightKg < 100000 ? 1 : 0)} t`} note="poids des LV" />
        </div>
      )}
      {!places.shippers.length && !places.consignees.length && !places.departments.length && (
        <p className="hint">Aucun client ni lieu sur cette période.</p>
      )}
    </Section>
  );
}

/** Calendrier du mois : une case par jour, plus dorée quand il y a eu plus de km. */
function Calendar(props: { period: Period; events: TripEvent[]; now: Date; onPick: (p: Period) => void }) {
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
      <p className="hint">Plus la case est dorée, plus tu as roulé. Touche un jour pour l’ouvrir.</p>
    </Section>
  );
}

function RecordsSection(props: { events: TripEvent[]; stats: PeriodStats; onPick: (p: Period) => void }) {
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
