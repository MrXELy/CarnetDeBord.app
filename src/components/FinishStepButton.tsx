import { Check } from 'lucide-react';
import { timeLabel } from '../lib/dates';
import { formatPlace } from '../lib/geo';
import { unfinishedStep } from '../lib/onSite';
import { useStepNotification } from '../lib/stepNotification';
import { useEvents } from '../lib/useEvents';
import EventIcon from './EventIcon';

/**
 * Bouton flottant « Fin du chargement / de la livraison » : reste tant que la fin n'est pas validée.
 * Le même bouton est dans une notification si elle est activée (Options).
 */
export default function FinishStepButton() {
  const { events, store } = useEvents();
  const step = unfinishedStep(events);
  useStepNotification(store, step);
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
        {formatPlace(step) && <span className="finish-sub">{formatPlace(step)}</span>}
        <span className="finish-sub">Arrivée à {timeLabel(step.occurred_at)}</span>
      </span>
      <Check size={22} strokeWidth={2.5} aria-hidden />
    </button>
  );
}
