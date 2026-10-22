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
        <label className="ws-field">
          <span className="setting-title">Matricule</span>
          <Text value={settings.matricule ?? ''} label="Matricule" onCommit={(matricule) => save({ matricule })} />
        </label>
        <label className="ws-field">
          <span className="setting-title">Date d’embauche</span>
          <Text
            value={settings.hireDate ?? ''}
            label="Date d’embauche"
            placeholder="mm/aa"
            onCommit={(hireDate) => save({ hireDate })}
          />
        </label>
        <span className="hint">
          Écrits tels quels sur la feuille (matricule et date d’embauche : page « Remboursement de frais »).
        </span>
      </div>

      <div className="setting-row usage">
        <span className="setting-title">Dépôts de la page carburant</span>
        <div className="ws-depots">
          <span className="fr-col">Nom sur la feuille</span>
          <span className="fr-col">Ville du plein, si différente</span>
          {depots.map((d, i) => (
            <DepotRow key={i} index={i} depot={d} onCommit={(patch) => saveDepot(i, patch)} />
          ))}
        </div>
        <span className="hint">
          À gauche, recopie les noms écrits en haut des colonnes « Dépôts » de ta feuille, dans l’ordre. À droite, rien
          à mettre si la ville de tes pleins porte déjà ce nom ; sinon, écris la ville telle qu’elle apparaît dans tes
          étapes (par exemple colonne « Toulouse », ville « Blagnac » ; plusieurs villes : séparées par des virgules).
        </span>
        <span className="hint">
          Un plein AS24 va toujours dans « AS 24 », un plein DKV dans « DKV », et un plein ailleurs dans « Divers ».
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
        label={`Dépôt ${n}, nom sur la feuille`}
        placeholder={`Dépôt ${n}`}
        onCommit={(label) => props.onCommit({ label })}
      />
      <Text
        value={props.depot.cities}
        label={`Dépôt ${n}, ville du plein si différente`}
        placeholder={props.depot.label || '—'}
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
