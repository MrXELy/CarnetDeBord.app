import { durationLabel } from '../../lib/dates';
import { euros, type AllowanceSummary } from '../../lib/allowances';
import { formatRate } from '../../lib/fuel';
import type { Period, PeriodStats } from '../../lib/stats';
import { num, liters } from './format';
import { Evolution, Tile } from './shared';

export default function Tiles(props: {
  period: Period;
  stats: PeriodStats;
  before: PeriodStats;
  fees: { cur: AllowanceSummary; prev: AllowanceSummary } | null;
}) {
  const { period, stats, before, fees } = props;
  const fuel = stats.fuel;
  const used = fuel.used != null ? `≈ ${liters(fuel.used)}` : '—';
  const perDay = (s: PeriodStats) => (s.days ? Math.round(s.km / s.days) : null);
  const hours = (n: number) => durationLabel(Math.round(n));
  // Rien à comparer si la période d'avant n'a aucune étape (début de l'historique).
  const Delta: typeof Evolution = before.days > 0 ? Evolution : () => null;
  return (
    <div className="st-tiles">
      {period.kind === 'jour' ? (
        <>
          <Tile label="Amplitude" value={stats.fullDays ? durationLabel(stats.amplitude) : '—'}>
            <Delta cur={stats.amplitude || null} prev={before.amplitude || null} better="none" format={hours} />
          </Tile>
          <Tile label="Étapes" value={stats.steps} />
        </>
      ) : (
        <>
          <Tile label="Heures" value={durationLabel(stats.amplitude)}>
            <Delta cur={stats.amplitude} prev={before.amplitude} better="none" format={hours} />
          </Tile>
          <Tile
            label="Moyenne par jour"
            value={
              <>
                {num(perDay(stats) ?? 0)} <small>km</small>
              </>
            }
          >
            <Delta cur={perDay(stats)} prev={perDay(before)} />
          </Tile>
        </>
      )}
      <Tile label="Chargements" value={stats.loads} tone="chargement">
        <Delta cur={stats.loads} prev={before.loads} />
      </Tile>
      <Tile label="Livraisons" value={stats.deliveries} tone="livraison">
        <Delta cur={stats.deliveries} prev={before.deliveries} />
      </Tile>
      <Tile label="Gasoil consommé" value={used} tone="carburant">
        acheté {liters(fuel.bought)}
      </Tile>
      <Tile
        label="Consommation"
        value={
          fuel.rate != null ? (
            <>
              {formatRate(fuel.rate)} <small>L/100</small>
            </>
          ) : (
            '—'
          )
        }
        tone="carburant"
      >
        <Delta cur={fuel.rate} prev={before.fuel.rate} better="down" digits={1} />
      </Tile>
      {fees && (
        <Tile label="Frais de route" value={euros(fees.cur.total)} wide>
          <Delta cur={fees.cur.total} prev={fees.prev.total} digits={2} format={euros} />
        </Tile>
      )}
    </div>
  );
}
