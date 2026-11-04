import { TriangleAlert } from 'lucide-react';
import { timeLabel } from '../lib/dates';
import { hoursLabel } from '../lib/rest';
import { formatRate, intervalRate, isFullTank, type FuelInterval } from '../lib/fuel';
import { formatPlace } from '../lib/geo';
import { useStore } from '../lib/useEvents';
import { namesOf } from '../lib/waybills';
import EventIcon from './EventIcon';
import { eventTypeInfo, isDayBoundary, waybillStatus, type TripEvent } from '../types';

const litres = (n: number) => `${n.toLocaleString('fr-FR')} L`;

/** `clients` : nom des clients sous le lieu (recherche, où l'on cherche souvent par client). */
export default function EventCard({
  event: e,
  onOpen,
  clients,
}: {
  event: TripEvent;
  onOpen: () => void;
  clients?: boolean;
}) {
  const store = useStore();
  const info = eventTypeInfo(e.type);
  const pending = store.isPending(e.id) && <span className="card-pending" title="Pas encore synchronisé" />;

  // Début et fin de journée : simple ligne de repère, plus discrète qu'une tuile.
  if (isDayBoundary(e.type)) {
    // Repos trop court ou à vérifier (RSE) : pictogramme, le détail est dans la fiche.
    const rest = e.type === 'debut_journee' ? store.restChecks().get(e.id) : undefined;
    const problem = rest?.lines.find((l) => l.level === rest.level);
    const restAlert = rest && rest.level !== 'ok' && (
      <span className={`marker-alert rest-${rest.level}`} title={problem?.text} role="img" aria-label={problem?.text}>
        <TriangleAlert size={15} aria-hidden />
        {rest.minutes != null && <span aria-hidden>Repos {hoursLabel(rest.minutes)}</span>}
      </span>
    );
    return (
      <button className={`marker tone-${e.type}`} onClick={onOpen}>
        <span className="dot" aria-hidden />
        <span className="marker-type">{info.short}</span>
        <span className="marker-time">{timeLabel(e.occurred_at)}</span>
        <span className="marker-place">{formatPlace(e)}</span>
        {restAlert}
        {pending}
      </button>
    );
  }

  const waybills =
    e.type === 'chargement' ? store.loadedAt(e.id) : e.type === 'livraison' ? store.deliveredAt(e.id) : [];
  const toComplete = waybills.filter((w) => waybillStatus(w) === 'a_completer').length;

  const consumption = e.type === 'carburant' && isFullTank(e) ? consumptionLabel(store.fuelIntervals(), e.id) : null;

  // Tuile basse : lieu et l'essentiel sur une ligne ; le reste (clients, compteur, station…) dans la fiche.
  const sub = [formatPlace(e) || 'Lieu non renseigné'];
  if (e.type === 'carburant') sub.push(isFullTank(e) ? 'Plein' : 'Complément');
  if (e.diesel_l != null) sub.push(litres(e.diesel_l));
  if (consumption) sub.push(consumption);
  const names = clients && namesOf(waybills, e.type === 'chargement' ? 'shipper' : 'consignee');

  return (
    <button className={`card tone-${e.type}`} onClick={onOpen}>
      <span className="card-icon">
        <EventIcon type={e.type} size={20} strokeWidth={2} />
      </span>
      <span className="card-body">
        <span className="card-top">
          <span className="card-type">{info.label}</span>
          <span className="card-time">{timeLabel(e.occurred_at)}</span>
        </span>
        <span className="card-place">{sub.join(' · ')}</span>
        {names && <span className="card-place">{names}</span>}
        {toComplete > 0 && <span className="badge">{toComplete} LV à compléter</span>}
        {e.notes && <span className="card-notes">{e.notes}</span>}
      </span>
      {pending}
    </button>
  );
}

/** Plein complet : consommation depuis le plein précédent (« 31,8 L/100 »), null si elle n'est pas calculée. */
function consumptionLabel(intervals: FuelInterval[], eventId: string): string | null {
  const interval = intervals.find((i) => i.toId === eventId);
  if (!interval || interval.problem) return null;
  return `${formatRate(intervalRate(interval)!)} L/100`;
}
