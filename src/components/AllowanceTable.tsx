import { allowanceLabel, euros, type AllowanceSummary } from '../lib/allowances';

/** Détail des frais d'une période : nombre, indemnité, montant, puis le total. */
export default function AllowanceTable({ summary }: { summary: AllowanceSummary }) {
  if (summary.count === 0) return <p className="muted fr-empty">Aucun frais sur cette période.</p>;
  return (
    <div className="fr-table">
      {summary.lines.map((l) => (
        <div className="fr-row" key={`${l.kind}-${l.foreign}`}>
          <span className="fr-count">{l.count}×</span>
          <span className="fr-label">
            {allowanceLabel(l.kind)}
            {l.foreign && <small>étranger</small>}
          </span>
          <span className={`fr-amount${l.unpriced === l.count ? ' muted' : ''}`}>
            {l.unpriced === l.count ? 'à saisir' : euros(l.amount)}
            {l.unpriced > 0 && l.unpriced < l.count && ' + ?'}
          </span>
        </div>
      ))}
      <div className="fr-row fr-total">
        <span className="fr-label">Total</span>
        <span className="fr-amount">{euros(summary.total)}</span>
      </div>
      {summary.unpriced > 0 && (
        <p className="hint">Montant de la prime bloqué à saisir dans les Options : non compté dans le total.</p>
      )}
    </div>
  );
}
