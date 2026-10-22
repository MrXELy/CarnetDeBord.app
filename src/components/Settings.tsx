import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, Eraser, LogOut, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { downloadCsv, eventsToCsv, waybillsToCsv } from '../lib/csv';
import { demoSnapshot } from '../lib/demoData';
import { averageRate, formatRate, intervalKm, recentIntervals } from '../lib/fuel';
import { monthUsage, photoStats } from '../lib/photos';
import { nextDue, REMINDER_TYPES, reminderLevel, shortDelay } from '../lib/reminders';
import { updateSettings, useSettings } from '../lib/settings';
import { shareFile } from '../lib/share';
import { signOutAndClear, type SignOutStep } from '../lib/signOut';
import { useEvents, useStore } from '../lib/useEvents';
import { useSheet } from '../lib/useSheet';
import AllowanceSettingsSection from './AllowanceSettings';
import ReminderSettingsSection from './ReminderSettings';
import WeekSheetSettingsSection from './WeekSheetSettings';

/** Lectures automatiques permises par mois (limite imposée par la fonction read-waybill). */
const MONTH_LIMIT = 300;

type Page = 'main' | 'reminders' | 'allowances' | 'sheet';

/** `section` : sous-page à montrer à l'ouverture (« reminders » : échéances). */
export default function Settings({ onClose, section }: { onClose: () => void; section?: string }) {
  const { events, waybills, demo, reminderSettings } = useEvents();
  const { europe } = useSettings();
  const store = useStore();
  const intervals = store.fuelIntervals();
  const recent = recentIntervals(intervals, new Date());
  const rate = averageRate(recent);
  const recentKm = recent.reduce((sum, i) => sum + intervalKm(i), 0);
  const rejected = intervals.filter((i) => i.problem).length;

  const sheet = useSheet(onClose);

  // Déconnexion en cours (envoi de ce qui attend, puis fermeture de la session) : bouton occupé, pas de double clic.
  const [signingOut, setSigningOut] = useState<SignOutStep>(null);

  // Nombre et coût des lectures du mois (undefined : chargement ; null : hors ligne ou indisponible).
  const [usage, setUsage] = useState<{ count: number; cost: number } | null | undefined>(undefined);
  useEffect(() => {
    // Mode démo : rien n'est demandé à Supabase.
    if (demo) return setUsage(null);
    monthUsage().then(setUsage, () => setUsage(null));
  }, [demo]);

  // Sous-page ouverte dans la même fenêtre : échéances, réglages des frais ou de la feuille de semaine.
  const [page, setPage] = useState<Page>(section === 'reminders' ? 'reminders' : 'main');
  const panel = useRef<HTMLDivElement>(null);
  // Autre sous-page : le panneau repart du haut (sinon il resterait descendu là où l'on a touché).
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [page]);
  const today = new Date();
  // Deux échéances les plus proches (avec une date), pour les tuiles du haut.
  const nextReminders = REMINDER_TYPES.map((type) => {
    const entry = reminderSettings.items[type.kind];
    return { type, due: nextDue(type, entry), level: reminderLevel(type, entry, today) };
  })
    .filter((r): r is typeof r & { due: Date } => r.due != null)
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .slice(0, 2);
  const titles: Record<Page, string> = {
    main: 'Options',
    reminders: 'Échéances',
    allowances: 'Frais de route',
    sheet: 'Feuille de semaine',
  };

  return (
    <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
      <div className="modal" ref={panel} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header" {...sheet.handle}>
          {page === 'main' ? (
            <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
              <X size={22} />
            </button>
          ) : (
            <button type="button" className="icon-btn" onClick={() => setPage('main')} aria-label="Retour aux Options">
              <ChevronLeft size={24} />
            </button>
          )}
          <h2>{titles[page]}</h2>
        </header>

        {page === 'reminders' && (
          <div className="modal-body slide-next">
            <ReminderSettingsSection />
          </div>
        )}
        {page === 'allowances' && (
          <div className="modal-body slide-next options-sub">
            <AllowanceSettingsSection />
          </div>
        )}
        {page === 'sheet' && (
          <div className="modal-body slide-next options-sub">
            <WeekSheetSettingsSection />
          </div>
        )}

        {page === 'main' && (
          <div className="modal-body">
            <section className="settings-group">
              <h3>Prochaines échéances</h3>
              <div className="options-tiles">
                {nextReminders.map(({ type, due, level }) => (
                  <button
                    type="button"
                    key={type.kind}
                    className={`options-tile${level ? ` reminder-${level}` : ''}`}
                    onClick={() => setPage('reminders')}
                  >
                    <span className="options-tile-label">{type.label}</span>
                    <span className="options-tile-value">{shortDelay(due, today)}</span>
                  </button>
                ))}
                {nextReminders.length < 2 && (
                  <button type="button" className="options-tile options-tile-add" onClick={() => setPage('reminders')}>
                    <span className="options-tile-label">
                      {nextReminders.length ? 'Toutes les échéances' : 'Indiquer mes échéances'}
                    </span>
                    <ChevronRight size={22} aria-hidden />
                  </button>
                )}
              </div>
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
              <h3>Exporter</h3>
              <div className="options-boxes">
                <button
                  type="button"
                  className="options-box"
                  onClick={() => downloadCsv(eventsToCsv(events, waybills), 'carnetdebord-etapes')}
                  disabled={events.length === 0}
                >
                  <Download size={24} aria-hidden />
                  Étapes
                  <small>{events.length} en CSV</small>
                </button>
                <button
                  type="button"
                  className="options-box"
                  onClick={() => downloadCsv(waybillsToCsv(waybills, events), 'carnetdebord-lettres-de-voiture')}
                  disabled={waybills.length === 0}
                >
                  <Download size={24} aria-hidden />
                  Lettres de voiture
                  <small>{waybills.length} en CSV</small>
                </button>
                {demo && (
                  <button
                    type="button"
                    className="options-box"
                    onClick={() => {
                      const json = JSON.stringify(demoSnapshot(store.getState()), null, 2);
                      void shareFile(new Blob([json], { type: 'application/json' }), 'demo-events.json', 'Démo');
                    }}
                  >
                    <Download size={24} aria-hidden />
                    Sauvegarder la démo
                    <small>à mettre dans data/</small>
                  </button>
                )}
              </div>
              <span className="hint">À ouvrir avec Excel ou LibreOffice, une ligne par étape ou par lettre.</span>
            </section>

            <section className="settings-group">
              <h3>Réglages</h3>
              <div className="field-group">
                <label className="field-row">
                  <span className="options-row-text">
                    Villes de toute l’Europe
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
                <button type="button" className="field-row options-link" onClick={() => setPage('reminders')}>
                  Échéances et ensemble routier
                  <ChevronRight size={20} aria-hidden />
                </button>
                <button type="button" className="field-row options-link" onClick={() => setPage('allowances')}>
                  Frais de route : bases et tarifs
                  <ChevronRight size={20} aria-hidden />
                </button>
                <button type="button" className="field-row options-link" onClick={() => setPage('sheet')}>
                  Feuille de semaine : nom, agence, dépôts
                  <ChevronRight size={20} aria-hidden />
                </button>
                <div className="field-stack">
                  <span className="field-row options-static">
                    Lectures LV du mois
                    <b>{usage ? `${usage.count} / ${MONTH_LIMIT}` : usage === undefined ? '…' : 'indisponible'}</b>
                  </span>
                  {usage && (
                    <span className="usage-bar" role="img" aria-label={`${usage.count} lectures sur ${MONTH_LIMIT}`}>
                      <i style={{ width: `${Math.min(100, (usage.count / MONTH_LIMIT) * 100)}%` }} />
                    </span>
                  )}
                  <span className="hint">
                    {usage &&
                      `≈ ${usage.cost.toLocaleString('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })} · `}
                    Limites : 2 lectures par photo, 30 par jour, {MONTH_LIMIT} par mois. Compte aussi les lectures de
                    km.
                  </span>
                </div>
                {!demo && <PhotoCleanup />}
              </div>
            </section>

            <button
              type="button"
              className="btn-danger btn-block btn-icon options-signout"
              onClick={() =>
                demo
                  ? location.assign(location.pathname) // quitte le mode démo
                  : void signOutAndClear(store, { progress: setSigningOut })
              }
              disabled={signingOut !== null}
            >
              <LogOut size={20} />
              {demo
                ? 'Quitter la démo'
                : signingOut === 'sending'
                  ? 'Envoi en cours…'
                  : signingOut === 'closing'
                    ? 'Déconnexion…'
                    : 'Se déconnecter'}
            </button>

            {/* Version installée : commit et heure de construction (serveur de test : heure de son démarrage). */}
            <p className="hint app-version">
              Version {__BUILD_COMMIT__} du {format(parseISO(__BUILD_DATE__), "dd/MM/yyyy 'à' HH:mm")}
              {import.meta.env.DEV && ' · test local'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Photos des LV stockées, et ménage de celles qui ne sont plus dans aucune LV. */
function PhotoCleanup() {
  const store = useStore();
  // undefined : chargement ; null : indisponible (hors ligne, migration 007 pas lancée).
  const [stats, setStats] = useState<{ photos: number; bytes: number } | null | undefined>(undefined);
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });

  useEffect(() => {
    photoStats().then(setStats, () => setStats(null));
  }, []);

  async function clean() {
    setState({ busy: true, message: null });
    try {
      const { deleted, waiting } = await store.cleanPhotos(true);
      const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
      const done = deleted
        ? `${plural(deleted, 'photo')} effacée${deleted > 1 ? 's' : ''}.`
        : 'Aucune photo à effacer.';
      const later = waiting
        ? ` ${plural(waiting, 'photo')} de moins d’1 h ${waiting > 1 ? 'seront effacées' : 'sera effacée'} plus tard.`
        : '';
      setState({ busy: false, message: done + later });
      setStats(await photoStats());
    } catch {
      setState({ busy: false, message: 'Ménage impossible (réseau, ou migration 007 pas lancée).' });
    }
  }

  const mb = (bytes: number) => `${(bytes / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;

  return (
    <div className="field-stack">
      <span className="field-row options-static">
        {stats ? `${stats.photos} photo${stats.photos > 1 ? 's' : ''} de LV · ${mb(stats.bytes)}` : 'Photos des LV'}
        <button type="button" className="btn-secondary btn-small btn-icon" onClick={clean} disabled={state.busy}>
          <Eraser size={18} />
          Nettoyer
        </button>
      </span>
      <span className="hint">
        {state.message ??
          (stats === undefined
            ? 'Chargement…'
            : 'Les photos qui ne sont plus dans aucune LV sont effacées chaque jour (après 24 h), ou ici (après 1 h).')}
      </span>
    </div>
  );
}
