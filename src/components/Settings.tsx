import { Download, LogOut, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { downloadCsv, eventsToCsv, waybillsToCsv } from '../lib/csv';
import { averageRate, formatRate, intervalKm, recentIntervals } from '../lib/fuel';
import { monthUsage } from '../lib/photos';
import { updateSettings, useSettings } from '../lib/settings';
import { supabase } from '../lib/supabase';
import { useEvents, useStore } from '../lib/useEvents';
import { useModal } from '../lib/useModal';

/** Lectures automatiques permises par mois (limite imposée par la fonction read-waybill). */
const MONTH_LIMIT = 300;

export default function Settings({ onClose }: { onClose: () => void }) {
  const { events, waybills, demo } = useEvents();
  const { europe } = useSettings();
  const store = useStore();
  const intervals = store.fuelIntervals();
  const recent = recentIntervals(intervals, new Date());
  const rate = averageRate(recent);
  const recentKm = recent.reduce((sum, i) => sum + intervalKm(i), 0);
  const rejected = intervals.filter((i) => i.problem).length;

  useModal(onClose);

  // Nombre et coût des lectures du mois (undefined : chargement ; null : hors ligne ou indisponible).
  const [usage, setUsage] = useState<{ count: number; cost: number } | null | undefined>(undefined);
  useEffect(() => {
    // Mode démo : rien n'est demandé à Supabase.
    if (demo) return setUsage(null);
    monthUsage().then(setUsage, () => setUsage(null));
  }, [demo]);

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
                  {europe ? 'Suggestions dans toute l’Europe.' : 'Suggestions en France uniquement.'}
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
            <h3>Gasoil</h3>
            <div className="setting-row usage">
              <span className="setting-title">Consommation moyenne</span>
              {rate != null ? (
                <span className="usage-count">
                  <strong>{formatRate(rate)}</strong> L/100 km
                </span>
              ) : (
                <span className="hint">Il faut au moins deux pleins complets avec leur kilométrage.</span>
              )}
              <span className="hint">
                {rate != null &&
                  `Sur les ${recent.length} derniers pleins complets (${recentKm.toLocaleString('fr-FR')} km). `}
                Calculée d’un plein complet au suivant, compléments compris.
                {rejected > 0 &&
                  ` ${rejected} intervalle${rejected > 1 ? 's' : ''} écarté${rejected > 1 ? 's' : ''} (km ou litres manquants).`}
              </span>
            </div>
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
            <div className="setting-row usage">
              <span className="usage-head">
                <span className="setting-title">Lectures ce mois-ci</span>
                {usage && (
                  <span className="hint">
                    ≈{' '}
                    {usage.cost.toLocaleString('fr-FR', {
                      style: 'currency',
                      currency: 'USD',
                      maximumFractionDigits: 2,
                    })}
                  </span>
                )}
              </span>
              {usage ? (
                <>
                  <span className="usage-count">
                    <strong>{usage.count}</strong> sur {MONTH_LIMIT}
                  </span>
                  <span className="usage-bar" role="img" aria-label={`${usage.count} lectures sur ${MONTH_LIMIT}`}>
                    <i style={{ width: `${Math.min(100, (usage.count / MONTH_LIMIT) * 100)}%` }} />
                  </span>
                </>
              ) : (
                <span className="hint">{usage === undefined ? 'Chargement…' : 'Indisponible'}</span>
              )}
              <span className="hint">
                Limites : 2 lectures par photo, 30 par jour, {MONTH_LIMIT} par mois. Compte aussi les lectures de km.
              </span>
            </div>
          </section>

          <section className="settings-group">
            <h3>Compte</h3>
            <div className="setting-row">
              <span className="setting-text">
                <span className="setting-title">{demo ? 'Quitter la démo' : 'Se déconnecter'}</span>
                <span className="hint">
                  {demo ? 'Revient à la version normale.' : 'Il faudra te reconnecter pour revoir ton carnet.'}
                </span>
              </span>
              <button
                type="button"
                className="btn-danger btn-icon"
                onClick={() =>
                  demo
                    ? location.assign(location.pathname) // quitte le mode démo
                    : confirm('Se déconnecter ?') && supabase.auth.signOut()
                }
              >
                <LogOut size={18} />
                {demo ? 'Quitter' : 'Déconnexion'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
