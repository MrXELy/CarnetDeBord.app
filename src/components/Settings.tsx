import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { downloadCsv, eventsToCsv, waybillsToCsv } from '../lib/csv';
import { monthUsage } from '../lib/photos';
import { updateSettings, useSettings } from '../lib/settings';
import { useEvents } from '../lib/useEvents';
import { useModal } from '../lib/useModal';

export default function Settings({ onClose }: { onClose: () => void }) {
  const { events, waybills } = useEvents();
  const { europe } = useSettings();

  useModal(onClose);

  // Nombre et coût des lectures du mois (undefined : chargement ; null : hors ligne ou indisponible).
  const [usage, setUsage] = useState<{ count: number; cost: number } | null | undefined>(undefined);
  useEffect(() => {
    monthUsage().then(setUsage, () => setUsage(null));
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Options</h2>
        </header>

        <div className="modal-body">
          <section className="settings-group">
            <h3>Recherche de villes</h3>
            <label className="setting-row">
              <span className="setting-text">
                <span className="setting-title">Mode Europe</span>
                <span className="hint">
                  {europe
                    ? 'Suggestions dans toute l’Europe.'
                    : 'Suggestions en France uniquement (recherche aussi par code postal).'}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={europe}
                onChange={(e) => updateSettings({ europe: e.target.checked })}
              />
            </label>
          </section>

          <section className="settings-group">
            <h3>Données</h3>
            <div className="setting-row">
              <span className="setting-text">
                <span className="setting-title">Exporter les étapes</span>
                <span className="hint">
                  {events.length} étape{events.length > 1 ? 's' : ''}, à ouvrir avec Excel ou LibreOffice.
                </span>
              </span>
              <button
                type="button"
                className="btn-secondary btn-icon"
                onClick={() => downloadCsv(eventsToCsv(events, waybills), 'carnetdebord-etapes')}
                disabled={events.length === 0}
              >
                <Download size={18} />
                Exporter
              </button>
            </div>
            <div className="setting-row">
              <span className="setting-text">
                <span className="setting-title">Exporter les lettres de voiture</span>
                <span className="hint">
                  {waybills.length} lettre{waybills.length > 1 ? 's' : ''} de voiture, une ligne par lettre.
                </span>
              </span>
              <button
                type="button"
                className="btn-secondary btn-icon"
                onClick={() => downloadCsv(waybillsToCsv(waybills, events), 'carnetdebord-lettres-de-voiture')}
                disabled={waybills.length === 0}
              >
                <Download size={18} />
                Exporter
              </button>
            </div>
          </section>

          <section className="settings-group">
            <h3>Lecture automatique des LV</h3>
            <div className="setting-row">
              <span className="setting-text">
                <span className="setting-title">
                  {usage === undefined
                    ? 'Lectures ce mois-ci…'
                    : usage === null
                      ? 'Lectures ce mois-ci : indisponible'
                      : `Lectures ce mois-ci : ${usage.count} · ≈ ${usage.cost.toLocaleString('fr-FR', {
                          style: 'currency',
                          currency: 'USD',
                          maximumFractionDigits: 2,
                        })}`}
                </span>
                <span className="hint">Limites : 2 lectures par photo, 30 par jour, 300 par mois.</span>
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
