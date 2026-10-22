import { durationLabel } from '../../lib/dates';
import { onSiteTimes } from '../../lib/onSite';
import { topPlaces, type Range } from '../../lib/stats';
import type { TripEvent, Waybill } from '../../types';
import { num } from './format';
import { Section, KV, RankList } from './shared';

export default function PlacesSection(props: {
  events: TripEvent[];
  waybills: Waybill[];
  range: Range;
  weightKg: number;
}) {
  const places = topPlaces(props.events, props.waybills, props.range);
  const onSite = onSiteTimes(props.events, props.waybills, props.range);
  const { weightKg } = props;
  return (
    <Section title="Clients et lieux">
      {places.shippers.length > 0 && (
        <div>
          <h3 className="st-h3">Chargeurs les plus fréquents</h3>
          <RankList items={places.shippers} tone="chargement" />
        </div>
      )}
      {places.consignees.length > 0 && (
        <div>
          <h3 className="st-h3">Destinataires les plus fréquents</h3>
          <RankList items={places.consignees} tone="livraison" />
        </div>
      )}
      {places.departments.length > 0 && (
        <div>
          <h3 className="st-h3">Départements traversés</h3>
          <RankList items={places.departments} />
        </div>
      )}
      {onSite.average != null && (
        <div>
          <h3 className="st-h3">Temps sur place</h3>
          <div className="st-kv">
            <KV
              label="Moyenne"
              value={durationLabel(onSite.average)}
              note={`sur ${onSite.count} étape${onSite.count > 1 ? 's' : ''}`}
            />
          </div>
          {onSite.clients.length > 0 && (
            <RankList
              items={onSite.clients.map((c) => ({ name: c.name, detail: `· ${c.count} fois`, count: c.average }))}
              format={durationLabel}
            />
          )}
        </div>
      )}
      {weightKg > 0 && (
        <div className="st-kv">
          <KV label="Tonnage" value={`${num(weightKg / 1000, weightKg < 100000 ? 1 : 0)} t`} note="poids des LV" />
        </div>
      )}
      {!places.shippers.length && !places.consignees.length && !places.departments.length && (
        <p className="hint">Aucun client ni lieu sur cette période.</p>
      )}
    </Section>
  );
}
