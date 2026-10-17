import { format, parseISO } from 'date-fns';
import { ArrowRight, Camera } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatPlace } from '../lib/geo';
import { useStore } from '../lib/useEvents';
import type { Waybill } from '../types';

/** Lieu et date d'une étape, tels qu'affichés sur une fiche. */
export interface Stop {
  place: string;
  at: string | null;
}

interface Props {
  waybill: Waybill;
  /** Chargement à afficher quand il n'est pas encore enregistré (formulaire en cours). */
  loading?: Stop;
  onClick: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
}

const date = (iso: string | null) => (iso ? format(parseISO(iso), 'dd/MM HH:mm') : null);

function Pair({ from, to, toMuted }: { from: string | null; to: string | null; toMuted?: boolean }) {
  return (
    <span className="lv-pair">
      <span>{from || '?'}</span>
      <ArrowRight size={14} className="lv-arrow" aria-label="vers" />
      <span className={toMuted ? 'muted' : undefined}>{to || '?'}</span>
    </span>
  );
}

/**
 * Une lettre de voiture :
 *   LV 13
 *   Placoplâtre → BigMat
 *   Val-de-Cognac (16) → Toulouse (31)
 *   16/10 06:30 → à livrer
 */
export default function WaybillLine({ waybill: w, loading, onClick, leading, trailing, selected }: Props) {
  const store = useStore();
  const loadingEvent = store.event(w.loading_event_id);
  const deliveryEvent = store.event(w.delivery_event_id);
  const from: Stop = loading ?? {
    place: loadingEvent ? formatPlace(loadingEvent) : '',
    at: loadingEvent?.occurred_at ?? null,
  };
  const toPlace = deliveryEvent ? formatPlace(deliveryEvent) : w.planned_city;

  return (
    <div className={`lv-row${selected ? ' selected' : ''}`}>
      {leading}
      <button type="button" className="lv-main" onClick={onClick}>
        <span className="lv-title">
          {w.number ? `LV ${w.number}` : <span className="badge">LV à compléter</span>}
          {w.photo_paths.length > 0 && <Camera size={15} className="lv-photo" aria-label="Avec photo" />}
        </span>
        <Pair from={w.shipper} to={w.consignee} />
        <Pair from={from.place} to={toPlace} />
        <Pair from={date(from.at)} to={deliveryEvent ? date(deliveryEvent.occurred_at) : 'à livrer'} toMuted={!deliveryEvent} />
      </button>
      {trailing}
    </div>
  );
}
