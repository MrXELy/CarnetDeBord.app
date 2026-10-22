import { Check } from 'lucide-react';
import { timeLabel } from '../lib/dates';
import { formatPlace } from '../lib/geo';
import { unfinishedStep } from '../lib/onSite';
import { useEvents } from '../lib/useEvents';
import EventIcon from './EventIcon';

/** Bouton flottant « Fin du chargement / de la livraison » : reste tant que la fin n'est pas validée. */
export default function FinishStepButton() {
  const { events, store } = useEvents();
  const step = unfinishedStep(events);
  if (!step) return null;
  const label = step.type === 'chargement' ? 'Fin du chargement' : 'Fin de la livraison';
  return (
    <button
      className={`finish-btn tone-${step.type}`}
      onClick={() => store.finishStep(step.id, new Date().toISOString())}
    >
      <EventIcon type={step.type} className="finish-icon" />
      <span className="finish-text">
        <span className="finish-title">{label}</span>
        <span className="finish-sub">
          {[formatPlace(step), `arrivé à ${timeLabel(step.occurred_at)}`].filter(Boolean).join(' · ')}
        </span>
      </span>
      <Check size={22} strokeWidth={2.5} aria-hidden />
    </button>
  );
}
