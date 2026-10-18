import { useState } from 'react';
import { useEvents } from '../lib/useEvents';
import { DEPOT_COUNT, type SheetDepot, type SheetSettings } from '../lib/weekSheet';

/** Réglages de la feuille de semaine en PDF : nom, agence et colonnes des dépôts de la page carburant. */
export default function WeekSheetSettingsSection() {
  const { sheetSettings: settings, store } = useEvents();
  const save = (patch: Partial<SheetSettings>) => store.saveSheetSettings({ ...settings, ...patch });
  const depots: SheetDepot[] = Array.from(
    { length: DEPOT_COUNT },
    (_, i) => settings.depots[i] ?? { label: '', cities: '' },
  );
  const saveDepot = (i: number, patch: Partial<SheetDepot>) =>
    save({ depots: depots.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  return (
    <section className="settings-group">
      <h3>Feuille de semaine</h3>
      <div className="setting-row usage">
        <label className="ws-field">
          <span className="setting-title">Nom du conducteur</span>
          <Text value={settings.driver} label="Nom du conducteur" onCommit={(driver) => save({ driver })} />
        </label>
        <label className="ws-field">
          <span className="setting-title">Agence de rattachement</span>
          <Text value={settings.agency} label="Agence de rattachement" onCommit={(agency) => save({ agency })} />
        </label>
        <span className="hint">Écrits tels quels sur la feuille.</span>
      </div>

      <div className="setting-row usage">
        <span className="setting-title">Dépôts de la page carburant</span>
        <div className="ws-depots">
          <span className="fr-col">Colonne</span>
          <span className="fr-col">Villes des pleins</span>
          {depots.map((d, i) => (
            <DepotRow key={i} index={i} depot={d} onCommit={(patch) => saveDepot(i, patch)} />
          ))}
        </div>
        <span className="hint">
          Un plein AS24 va dans la colonne AS 24, un plein DKV dans DKV. Les autres vont dans le dépôt de leur ville
          (villes séparées par des virgules ; vide : le nom de la colonne), sinon dans Divers.
        </span>
      </div>
    </section>
  );
}

function DepotRow(props: { index: number; depot: SheetDepot; onCommit: (patch: Partial<SheetDepot>) => void }) {
  const n = props.index + 1;
  return (
    <>
      <Text
        value={props.depot.label}
        label={`Dépôt ${n}, nom de la colonne`}
        onCommit={(label) => props.onCommit({ label })}
      />
      <Text
        value={props.depot.cities}
        label={`Dépôt ${n}, villes des pleins`}
        placeholder={props.depot.label}
        onCommit={(cities) => props.onCommit({ cities })}
      />
    </>
  );
}

/** Texte enregistré en quittant le champ. */
function Text(props: { value: string; label: string; placeholder?: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(props.value);
  return (
    <input
      type="text"
      className="ws-input"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== props.value && props.onCommit(text.trim())}
    />
  );
}
