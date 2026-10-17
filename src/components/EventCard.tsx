import { timeLabel } from '../lib/dates';
import { formatPlace } from '../lib/geo';
import { useStore } from '../lib/useEvents';
import { eventTypeInfo, type TripEvent } from '../types';

const litres = (n: number) => `${n.toLocaleString('fr-FR')} L`;

export default function EventCard({ event: e, onOpen }: { event: TripEvent; onOpen: () => void }) {
  const store = useStore();
  const info = eventTypeInfo(e.type);
  const details: string[] = [];
  if (e.client) details.push(e.client);
  if (e.cmr_number) details.push(`LV ${e.cmr_number}`);
  if (e.station) details.push(e.station);
  if (e.diesel_l != null) details.push(`Gasoil ${litres(e.diesel_l)}`);
  if (e.adblue_l != null) details.push(`AdBlue ${litres(e.adblue_l)}`);

  return (
    <button className={`card tone-${e.type}`} onClick={onOpen}>
      <span className="card-icon" aria-hidden>
        {info.icon}
      </span>
      <span className="card-body">
        <span className="card-top">
          <span className="card-type">{info.label}</span>
          <span className="card-time">{timeLabel(e.occurred_at)}</span>
        </span>
        <span className="card-place">
          {formatPlace(e) || 'Lieu non renseigné'}
          {e.odometer_km != null && <span className="card-km">{e.odometer_km.toLocaleString('fr-FR')} km</span>}
        </span>
        {details.length > 0 && <span className="card-details">{details.join(' · ')}</span>}
        {e.notes && <span className="card-notes">{e.notes}</span>}
      </span>
      {store.isPending(e.id) && <span className="card-pending" title="Pas encore synchronisé" />}
    </button>
  );
}
