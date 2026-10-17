import { Download, X } from 'lucide-react';
import { useEffect } from 'react';
import { downloadCsv } from '../lib/csv';
import { updateSettings, useSettings } from '../lib/settings';
import { useEvents } from '../lib/useEvents';

export default function Settings({ onClose }: { onClose: () => void }) {
  const { events } = useEvents();
  const { europe } = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.body.classList.add('no-scroll');
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('no-scroll');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

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
                <span className="setting-title">Exporter en CSV</span>
                <span className="hint">
                  {events.length} étape{events.length > 1 ? 's' : ''}, à ouvrir avec Excel ou LibreOffice.
                </span>
              </span>
              <button
                type="button"
                className="btn-secondary btn-icon"
                onClick={() => downloadCsv(events)}
                disabled={events.length === 0}
              >
                <Download size={18} />
                Exporter
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
