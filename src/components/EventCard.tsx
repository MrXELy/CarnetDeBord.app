import { timeLabel } from '../lib/dates';
import { formatPlace } from '../lib/geo';
import { useStore } from '../lib/useEvents';
import { namesOf } from '../lib/waybills';
import { eventTypeInfo, isDayBoundary, waybillStatus, type TripEvent } from '../types';
import EventIcon from './EventIcon';

const litres = (n: number) => `${n.toLocaleString('fr-FR')} L`;

export default function EventCard({ event: e, onOpen }: { event: TripEvent; onOpen: () => void }) {
  const store = useStore();
  const info = eventTypeInfo(e.type);
  const pending = store.isPending(e.id) && <span className="card-pending" title="Pas encore synchronisé" />;

  // Début et fin de journée : simple ligne de repère, plus discrète qu'une tuile.
  if (isDayBoundary(e.type)) {
    return (
      <button className={`marker tone-${e.type}`} onClick={onOpen}>
        <EventIcon type={e.type} size={16} className="event-icon" />
        <span className="marker-type">{info.short}</span>
        <span className="marker-time">{timeLabel(e.occurred_at)}</span>
        <span className="marker-place">{formatPlace(e)}</span>
        {e.odometer_km != null && <span className="marker-km">{e.odometer_km.toLocaleString('fr-FR')} km</span>}
        {pending}
      </button>
    );
  }

  const waybills =
    e.type === 'chargement' ? store.loadedAt(e.id) : e.type === 'livraison' ? store.deliveredAt(e.id) : [];
  const toComplete = waybills.filter((w) => waybillStatus(w) === 'a_completer').length;

  const details: string[] = [];
  if (waybills.length > 0) {
    // Chargement : le client chargeur ; livraison : le client destinataire.
    const names = namesOf(waybills, e.type === 'chargement' ? 'shipper' : 'consignee');
    if (names) details.push(names);
  } else {
    // Anciennes étapes, saisies avant les lettres de voiture.
    if (e.client) details.push(e.client);
    if (e.cmr_number) details.push(`LV ${e.cmr_number}`);
  }
  if (e.station) details.push(e.station);
  if (e.diesel_l != null) details.push(`Gasoil ${litres(e.diesel_l)}`);
  if (e.adblue_l != null) details.push(`AdBlue ${litres(e.adblue_l)}`);

  return (
    <button className={`card tone-${e.type}`} onClick={onOpen}>
      <EventIcon type={e.type} className="event-icon card-icon" />
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
        {toComplete > 0 && (
          <span className="badge">
            {toComplete} LV à compléter
          </span>
        )}
        {e.notes && <span className="card-notes">{e.notes}</span>}
      </span>
      {pending}
    </button>
  );
}
