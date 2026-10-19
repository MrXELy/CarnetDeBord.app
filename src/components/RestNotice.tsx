import { BedDouble, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { RestAdvice } from '../lib/rest';

/** Repos (RSE) : discret s'il est correct, orange ou rouge sinon. */
export default function RestNotice({ check, icon }: { check: RestAdvice; icon?: LucideIcon }) {
  const Icon = check.level === 'ok' ? (icon ?? BedDouble) : TriangleAlert;
  return (
    <div className={`rest-notice rest-${check.level}`}>
      <Icon size={18} aria-hidden />
      <ul>
        {check.lines.map((line, i) => (
          <li key={i} className={`rest-line-${line.level}`}>
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
