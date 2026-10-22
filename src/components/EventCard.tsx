import { format, parseISO } from 'date-fns';
import { TriangleAlert } from 'lucide-react';
import { fr } from 'date-fns/locale';
import { timeLabel } from '../lib/dates';
import { formatRate, intervalRate, isFullTank, type FuelInterval } from '../lib/fuel';
import { formatPlace } from '../lib/geo';
import { useStore } from '../lib/useEvents';
import { namesOf } from '../lib/waybills';
import { eventTypeInfo, isDayBoundary, waybillStatus, type TripEvent } from '../types';

const litres = (n: number) => `${n.toLocaleString('fr-FR')} L`;

export default function EventCard({ event: e, onOpen }: { event: TripEvent; onOpen: () => void }) {
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
      </span>
    );
    return (
      <button className={`marker tone-${e.type}`} onClick={onOpen}>
        <span className="dot" aria-hidden />
        <span className="marker-type">{info.short}</span>
        <span className="marker-time">{timeLabel(e.occurred_at)}</span>
        <span className="marker-place">{formatPlace(e)}</span>
        {e.odometer_km != null && <span className="marker-km">{e.odometer_km.toLocaleString('fr-FR')} km</span>}
        {restAlert}
        {pending}
      </button>
    );
  }

  const waybills =
    e.type === 'chargement' ? store.loadedAt(e.id) : e.type === 'livraison' ? store.deliveredAt(e.id) : [];
  const toComplete = waybills.filter((w) => waybillStatus(w) === 'a_completer').length;

  const consumption = e.type === 'carburant' && isFullTank(e) ? consumptionLabel(store.fuelIntervals(), e.id) : null;

  const end = e.finished_at && timeLabel(e.finished_at);
  const details: string[] = [];
  if (waybills.length > 0) {
    // Chargement : le client chargeur ; livraison : le client destinataire.
    const names = namesOf(waybills, e.type === 'chargement' ? 'shipper' : 'consignee');
    if (names) details.push(names);
  }
  if (e.station) details.push(e.station);
  if (e.type === 'carburant') details.push(isFullTank(e) ? 'Plein' : 'Complément');
  if (e.diesel_l != null) details.push(`Gasoil ${litres(e.diesel_l)}`);
  if (e.adblue_l != null) details.push(`AdBlue ${litres(e.adblue_l)}`);

  return (
    <button className={`card tone-${e.type}`} onClick={onOpen}>
      <span className="dot" aria-hidden />
      <span className="card-body">
        <span className="card-top">
          <span className="card-type">{info.label}</span>
          <span className="card-time">
            {timeLabel(e.occurred_at)}
            {end && end !== timeLabel(e.occurred_at) && ` → ${end}`}
          </span>
        </span>
        <span className="card-place">
          {formatPlace(e) || 'Lieu non renseigné'}
          {e.odometer_km != null && <span className="card-km">{e.odometer_km.toLocaleString('fr-FR')} km</span>}
        </span>
        {details.length > 0 && <span className="card-details">{details.join(' · ')}</span>}
        {consumption && <span className="card-details">{consumption}</span>}
        {toComplete > 0 && <span className="badge">{toComplete} LV à compléter</span>}
        {e.notes && <span className="card-notes">{e.notes}</span>}
      </span>
      {pending}
    </button>
  );
}

/** Plein complet : consommation depuis le plein précédent, ou pourquoi elle n'est pas calculée. */
function consumptionLabel(intervals: FuelInterval[], eventId: string): string | null {
  const interval = intervals.find((i) => i.toId === eventId);
  if (!interval) return null;
  if (interval.problem) return `Conso non calculée : ${interval.problem}`;
  const since = format(parseISO(interval.start), 'd MMM', { locale: fr });
  return `${formatRate(intervalRate(interval)!)} L/100 km depuis le plein du ${since}`;
}
