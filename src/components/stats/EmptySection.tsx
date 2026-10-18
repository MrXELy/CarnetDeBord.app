import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { periodAt, type Period, type PeriodStats } from '../../lib/stats';
import { num, percent } from './format';
import { Evolution, Section, KV, RankList } from './shared';

/** Km à vide : part de la période, trajets, détail par tracteur. */
export default function EmptySection(props: {
  stats: PeriodStats;
  /** Période d'avant, ou null si elle n'a aucune étape. */
  before: PeriodStats | null;
  previous: string;
  onPick: (p: Period) => void;
}) {
  const r = props.stats.empty;
  const total = r.empty + r.loaded;
  const avg = r.legs.length ? Math.round(r.legs.reduce((sum, l) => sum + l.km, 0) / r.legs.length) : null;
  const longest = r.longest?.loading ? { leg: r.longest, loading: r.longest.loading } : null;
  const prevShare = props.before ? percent(props.before.empty.share) : null;
  const short = (iso: string) => format(parseISO(iso), 'EEE d MMM', { locale: fr });
  const incomplete = r.incomplete;
  return (
    <Section title="Km à vide">
      {total > 0 && (
        <div>
          <div className="st-split-bar" aria-hidden>
            <i className="charge" style={{ width: `${(r.loaded / total) * 100}%` }} />
            <i className="vide" style={{ width: `${(r.empty / total) * 100}%` }} />
          </div>
          <div className="st-split-legend">
            <span className="charge">En charge {num(r.loaded)} km</span>
            <span className="vide">À vide {num(r.empty)} km</span>
          </div>
        </div>
      )}
      <div className="st-kv">
        <KV
          label="Part à vide"
          value={r.share != null ? `${percent(r.share)} %` : '—'}
          note={
            prevShare != null && r.share != null ? (
              <>
                <Evolution cur={percent(r.share)} prev={prevShare} better="down" format={(n) => `${num(n)} pt`} /> vs{' '}
                {props.previous}
              </>
            ) : undefined
          }
        />
        <KV label="Trajets à vide" value={r.legs.length} note={avg != null ? `en moyenne ${num(avg)} km` : undefined} />
        {longest && (
          <KV
            label="Le plus long"
            value={`${num(longest.leg.km)} km`}
            note={`${short(longest.loading.occurred_at)} · ${longest.leg.delivery.city || '?'} → ${longest.loading.city || '?'}`}
            onClick={() => props.onPick(periodAt('jour', parseISO(longest.loading.occurred_at)))}
          />
        )}
      </div>
      {r.tractors.length > 1 && (
        <div>
          <h3 className="st-h3">À vide par tracteur</h3>
          <RankList
            items={r.tractors.map((t) => ({
              name: t.plate || 'Sans immatriculation',
              detail: t.empty + t.loaded > 0 ? `${percent(t.empty / (t.empty + t.loaded))} %` : null,
              count: t.empty,
            }))}
            unit=" km"
          />
        </div>
      )}
      <p className="hint">
        De la dernière livraison au chargement suivant, retour à la maison compris, tracteur par tracteur : les
        compteurs de deux tracteurs ne sont jamais soustraits.
        {incomplete > 0 &&
          ` ${incomplete} trajet${incomplete > 1 ? 's' : ''} incomplet${incomplete > 1 ? 's' : ''} (changement de tracteur sans km noté, étape sans km ou relevé incohérent) : la partie inconnue n’est pas comptée.`}
      </p>
    </Section>
  );
}
