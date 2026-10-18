import type { ReadDetails } from '../lib/liveReading';

/** Panneau « Détails » d'une lecture de LV : remarques de l'IA, ce qu'elle a lu, durée et coût, ou l'échec. */
export default function ReadingDetails({ details }: { details: ReadDetails }) {
  const { mode, progress, done } = details;
  const running = !done;
  return (
    <div className="reading-details">
      <section>
        <h3>Remarques de l’IA</h3>
        {progress.remarks.length ? (
          <ul>
            {progress.remarks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">{running ? 'En attente…' : 'Aucune remarque.'}</p>
        )}
      </section>

      <section>
        <h3>Ce qu’elle a lu</h3>
        {progress.found.length ? (
          <dl>
            {progress.found.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={value ? undefined : 'muted'}>{value ?? 'non trouvé'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">{running ? 'En attente…' : 'Rien de lu.'}</p>
        )}
      </section>

      <section>
        <h3>Lecture</h3>
        <p className="muted">
          {mode === 'handwritten' ? 'Mode fiable' : 'Mode normal'}
          {done ? ` · ${(done.ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s` : ' · en cours…'}
          {done?.cost_usd != null &&
            ` · ≈ ${done.cost_usd.toLocaleString('fr-FR', {
              style: 'currency',
              currency: 'USD',
              maximumSignificantDigits: 2,
            })}`}
        </p>
        {done?.error && <p className="hint-err">Échec : {done.error}</p>}
      </section>
    </div>
  );
}
