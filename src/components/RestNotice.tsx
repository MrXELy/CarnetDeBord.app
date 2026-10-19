import { BedDouble, TriangleAlert } from 'lucide-react';
import type { RestCheck } from '../lib/rest';

/** Repos depuis la fin de journée d'avant (RSE) : discret s'il est correct, orange ou rouge sinon. */
export default function RestNotice({ check }: { check: RestCheck }) {
  const Icon = check.level === 'ok' ? BedDouble : TriangleAlert;
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
