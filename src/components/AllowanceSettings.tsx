import { format, parseISO } from 'date-fns';
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { MEAL_KINDS, allowanceLabel, type AllowanceSettings, type Rates } from '../lib/allowances';
import { formatPlace } from '../lib/geo';
import { numText, parseNum } from '../lib/numbers';
import { useEvents } from '../lib/useEvents';
import type { Place } from '../types';
import PlaceField, { EMPTY_PLACE } from './PlaceField';

/** Réglages des frais de déplacement : bases (domicile, dépôt) et tarifs avec leur date d'effet. */
export default function AllowanceSettingsSection() {
  const { allowanceSettings: settings, store } = useEvents();
  const [draft, setDraft] = useState<Place>(EMPTY_PLACE);
  // Change à chaque ajout pour vider le champ de recherche de ville.
  const [fieldKey, setFieldKey] = useState(0);
  // Tarifs affichés : les plus récents par défaut.
  const latest = settings.rates.reduce((best, r, i) => (r.from > settings.rates[best].from ? i : best), 0);
  const [selected, setSelected] = useState(latest);
  const index = Math.min(selected, settings.rates.length - 1);
  const rates = settings.rates[index];

  const save = (patch: Partial<AllowanceSettings>) => store.saveAllowanceSettings({ ...settings, ...patch });
  const saveRates = (next: Rates) => save({ rates: settings.rates.map((r, i) => (i === index ? next : r)) });

  function addBase() {
    if (!draft.city.trim()) return;
    save({ bases: [...settings.bases, { ...draft, city: draft.city.trim() }] });
    setDraft(EMPTY_PLACE);
    setFieldKey((k) => k + 1);
  }

  function newRates() {
    save({ rates: [...settings.rates, { ...rates, from: format(new Date(), 'yyyy-MM-dd') }] });
    setSelected(settings.rates.length);
  }

  function removeRates() {
    if (!confirm('Supprimer ces tarifs ?')) return;
    save({ rates: settings.rates.filter((_, i) => i !== index) });
    setSelected(0);
  }

  const periods = settings.rates.map((r, i) => ({ from: r.from, i })).sort((a, b) => b.from.localeCompare(a.from));

  return (
    <section className="settings-group">
      <h3>Frais de déplacement</h3>

      <div className="setting-row usage">
        <span className="setting-text">
          <span className="setting-title">Mes bases</span>
          <span className="hint">
            Une fin de journée ici veut dire « rentré » ; ailleurs, c’est un découcher (grand déplacement).
          </span>
        </span>
        {settings.bases.length > 0 && (
          <ul className="fr-bases">
            {settings.bases.map((b, i) => (
              <li key={i}>
                <span>{formatPlace(b)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Retirer ${b.city}`}
                  onClick={() => save({ bases: settings.bases.filter((_, j) => j !== i) })}
                >
                  <X size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <PlaceField key={fieldKey} value={draft} onChange={setDraft} />
        <button type="button" className="btn-secondary btn-icon" onClick={addBase} disabled={!draft.city.trim()}>
          <Plus size={18} />
          Ajouter cette base
        </button>
      </div>

      <div className="setting-row usage">
        <span className="usage-head">
          <span className="setting-title">Tarifs</span>
          {periods.length > 1 && (
            <select
              className="fr-period"
              value={index}
              onChange={(e) => setSelected(Number(e.target.value))}
              aria-label="Tarifs affichés"
            >
              {periods.map((p) => (
                <option key={p.i} value={p.i}>
                  depuis le {format(parseISO(p.from), 'dd/MM/yyyy')}
                </option>
              ))}
            </select>
          )}
        </span>
        <label className="fr-from">
          À partir du
          <input
            type="date"
            value={rates.from}
            onChange={(e) => e.target.value && saveRates({ ...rates, from: e.target.value })}
          />
        </label>

        <div className="fr-rates">
          <span />
          <span className="fr-col">France</span>
          <span className="fr-col">Étranger</span>
          {MEAL_KINDS.map((kind) => (
            <Row key={`${index}-${kind}`} label={allowanceLabel(kind)}>
              {[0, 1].map((col) => (
                <Money
                  key={col}
                  value={rates.meals[kind][col]}
                  label={`${allowanceLabel(kind)}, ${col ? 'étranger' : 'France'}`}
                  onCommit={(v) => {
                    if (v == null) return;
                    const pair: [number, number] = [...rates.meals[kind]];
                    pair[col] = v;
                    saveRates({ ...rates, meals: { ...rates.meals, [kind]: pair } });
                  }}
                />
              ))}
            </Row>
          ))}
          <Row key={`${index}-lundi`} label={allowanceLabel('prime_lundi')}>
            <Money
              value={rates.primeLundi}
              label={allowanceLabel('prime_lundi')}
              onCommit={(v) => v != null && saveRates({ ...rates, primeLundi: v })}
            />
            <span />
          </Row>
          <Row key={`${index}-bloque`} label={allowanceLabel('prime_bloque')}>
            <Money
              value={rates.primeBloque}
              label={allowanceLabel('prime_bloque')}
              placeholder="à saisir"
              onCommit={(v) => saveRates({ ...rates, primeBloque: v })}
            />
            <span />
          </Row>
        </div>
        <span className="hint">
          En euros. Les anciens tarifs restent appliqués aux dates d’avant : quand les tarifs changent, ajoute-les avec
          leur date.
        </span>
        <div className="fr-actions">
          <button type="button" className="btn-secondary btn-icon" onClick={newRates}>
            <Plus size={18} />
            Nouveaux tarifs
          </button>
          {settings.rates.length > 1 && (
            <button type="button" className="btn-danger btn-icon" onClick={removeRates}>
              <Trash2 size={18} />
              Supprimer
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="fr-rate-label">{label}</span>
      {children}
    </>
  );
}

/** Montant saisi, enregistré en quittant le champ (vide → null). */
function Money(props: {
  value: number | null;
  label: string;
  placeholder?: string;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(numText(props.value));
  return (
    <input
      type="text"
      inputMode="decimal"
      className="fr-money"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseNum(text);
        if (v == null && text.trim()) return setText(numText(props.value)); // saisie invalide : on revient
        if (v !== props.value) props.onCommit(v);
      }}
    />
  );
}
