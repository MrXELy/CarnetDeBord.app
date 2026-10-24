import { useState } from 'react';
import { updateSettings, useSettings } from '../lib/settings';
import { notificationsSupported } from '../lib/stepNotification';

/** Réglage de l'appareil : notification de l'étape en cours avec le bouton de fin (permission demandée à Chrome). */
export default function StepNotificationSetting() {
  const { stepNotifications } = useSettings();
  const supported = notificationsSupported();
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    supported ? Notification.permission : 'denied',
  );
  const on = stepNotifications && permission === 'granted';

  async function toggle(checked: boolean) {
    if (!checked) return updateSettings({ stepNotifications: false });
    const result = await Notification.requestPermission();
    setPermission(result);
    updateSettings({ stepNotifications: result === 'granted' });
  }

  const hint = !supported
    ? 'Impossible dans ce navigateur.'
    : permission === 'denied'
      ? 'Bloquées par Chrome : autorise les notifications du site dans ses réglages (cadenas à côté de l’adresse).'
      : on
        ? 'Le bouton « Fin de la livraison » est aussi dans les notifications de cet appareil.'
        : 'Pour noter la fin d’un chargement ou d’une livraison sans ouvrir l’appli.';

  return (
    <label className="field-row">
      <span className="options-row-text">
        Notification de fin d’étape
        <span className="hint">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={on}
        disabled={!supported || permission === 'denied'}
        onChange={(e) => void toggle(e.target.checked)}
      />
    </label>
  );
}
