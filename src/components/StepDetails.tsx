import { ArrowRight, Factory, MapPin, MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { durationLabel, timeLabel } from '../lib/dates';
import { isFullTank } from '../lib/fuel';
import { formatPlace } from '../lib/geo';
import { hasEnd, onSiteMinutes } from '../lib/onSite';
import { namesOf } from '../lib/waybills';
import type { TripEvent, Waybill } from '../types';

const kmText = (km: number | null | undefined) => (km == null ? '—' : `${km.toLocaleString('fr-FR')} km`);
const litres = (n: number) => `${n.toLocaleString('fr-FR')} L`;

/**
 * Fiche d'une étape en lecture seule (maquette « Tuiles ») : heures en grand, client et lieu, compteur, camion,
 * lettres de voiture et remarque. Tout doit tenir sur un écran de téléphone.
 * `waybills` : LV chargées ou livrées ici ; `lvTile` : tuile d'une LV (ouvre sa fiche) ; `rest` : avis de repos.
 */
export default function StepDetails({
  event: e,
  waybills,
  lvTile,
  rest,
}: {
  event: TripEvent;
  waybills: Waybill[];
  lvTile: (w: Waybill) => ReactNode;
  rest?: ReactNode;
}) {
  const withEnd = hasEnd(e.type);
  const onSite = onSiteMinutes(e);
  const clients = withEnd ? namesOf(waybills, e.type === 'chargement' ? 'shipper' : 'consignee') : '';
  const place = formatPlace(e) || 'Lieu non renseigné';

  return (
    <>
      <div className={`step-hero tone-${e.type}`}>
        {withEnd ? (
          <>
            <div className="step-times">
              <span>
                <small>Arrivée</small>
                <b>{timeLabel(e.occurred_at)}</b>
              </span>
              <ArrowRight size={30} aria-hidden />
              <span className="step-end">
                <small>Fin</small>
                <b>{e.finished_at ? timeLabel(e.finished_at) : '—'}</b>
              </span>
            </div>
            <span className="step-hero-note">
              {onSite ? `${durationLabel(onSite)} sur place` : 'Fin pas encore notée'}
            </span>
          </>
        ) : (
          <div className="step-times">
            <span>
              <small>Heure</small>
              <b>{timeLabel(e.occurred_at)}</b>
            </span>
          </div>
        )}
      </div>

      <div className="step-grid">
        <div className="step-tile step-wide">
          <span className={`step-place-icon tone-${e.type}`} aria-hidden>
            {clients ? <Factory size={20} /> : <MapPin size={20} />}
          </span>
          <div>
            <b>{clients || place}</b>
            {clients && <span>{place}</span>}
          </div>
        </div>

        {e.type === 'carburant' && (
          <>
            <div className="step-tile">
              <small>Station</small>
              <b>{e.station ?? '—'}</b>
              <span>{isFullTank(e) ? 'Plein complet' : 'Complément'}</span>
            </div>
            <div className="step-tile">
              <small>Gasoil</small>
              <b>{e.diesel_l != null ? litres(e.diesel_l) : '—'}</b>
              {e.adblue_l != null && <span>AdBlue {litres(e.adblue_l)}</span>}
            </div>
          </>
        )}

        {e.type === 'changement_camion' && (
          <div className="step-tile step-wide">
            <div>
              <small>Camion rendu</small>
              <b>
                <span className="plate">{e.prev_tractor_plate || '—'}</span>
                {e.prev_trailer_plate && <> · {e.prev_trailer_plate}</>}
              </b>
              <span>{kmText(e.prev_odometer_km)}</span>
            </div>
          </div>
        )}

        <div className="step-tile">
          <small>Compteur</small>
          <b>{kmText(e.odometer_km)}</b>
        </div>
        <div className="step-tile">
          <small>{e.type === 'changement_camion' ? 'Camion pris' : 'Camion'}</small>
          <b className="plate">{e.tractor_plate || '—'}</b>
          {e.trailer_plate && <span className="plate">{e.trailer_plate}</span>}
        </div>
      </div>

      {rest}

      {withEnd && waybills.length > 0 && (
        <div className="lv-group">
          <span className="field-name">{e.type === 'chargement' ? 'Lettres chargées' : 'Lettres livrées'}</span>
          {waybills.map(lvTile)}
        </div>
      )}

      {e.notes && (
        <p className="step-notes">
          <MessageSquare size={18} aria-hidden />
          {e.notes}
        </p>
      )}
    </>
  );
}
