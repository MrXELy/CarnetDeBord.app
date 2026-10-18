import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Ranked } from '../../lib/stats';
import { num } from './format';

/** Pastille d'évolution : verte si c'est mieux, rouge si c'est moins bien, grise si ni l'un ni l'autre. */
export function Evolution(props: {
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

export function Tile(props: { label: string; value: ReactNode; tone?: string; wide?: boolean; children?: ReactNode }) {
  return (
    <div className={`st-tile${props.tone ? ` tone-${props.tone}` : ''}${props.wide ? ' wide' : ''}`}>
      <span className="st-tile-label">
        {props.tone && <i aria-hidden />}
        {props.label}
      </span>
      <span className="st-tile-value">{props.value}</span>
      <span className="st-tile-sub">{props.children}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
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

export function KV({
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

export function RankList({ items, unit = '', tone }: { items: Ranked[]; unit?: string; tone?: string }) {
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
