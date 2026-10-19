import { addDays } from 'date-fns';
import { Settings as SettingsIcon, X } from 'lucide-react';
import { summarizeAllowances } from '../lib/allowances';
import { weekLabel } from '../lib/dates';
import { formatPlace } from '../lib/geo';
import { useEvents } from '../lib/useEvents';
import { useSheet } from '../lib/useSheet';
import AllowanceTable from './AllowanceTable';

interface Props {
  /** Début de la semaine (dimanche 22h). */
  start: Date;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** Frais de déplacement d'une semaine. */
export default function AllowancesSheet({ start, onOpenSettings, onClose }: Props) {
  const { allowanceSettings, store } = useEvents();
  const summary = summarizeAllowances(store.allowances(), { start, end: addDays(start, 7) });
  const { bases } = allowanceSettings;

  const sheet = useSheet(onClose);

  return (
    <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header" {...sheet.handle}>
          <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Frais de route</h2>
        </header>

        <div className="modal-body">
          <p className="fr-week">{weekLabel(start)}</p>
          {bases.length === 0 ? (
            <div className="fr-setup">
              <p>Pour calculer les frais, indique d’abord tes bases (domicile, dépôt) dans les Options.</p>
              <button type="button" className="btn-secondary btn-icon" onClick={onOpenSettings}>
                <SettingsIcon size={18} />
                Régler mes bases
              </button>
            </div>
          ) : (
            <>
              <AllowanceTable summary={summary} />
              <p className="hint">
                Calculés d’après l’heure et le lieu des débuts et fins de journée. Bases :{' '}
                {bases.map((b) => formatPlace(b)).join(', ')}. Une journée sans fin n’est pas encore comptée.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
