import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useState } from 'react';
import { daysLeft, nextDue, REMINDER_TYPES, reminderLevel, setEntry, type ReminderType } from '../lib/reminders';
import { useEvents } from '../lib/useEvents';

/** Échéances : date du dernier passage de chaque document ou contrôle, et ensemble routier principal. */
export default function ReminderSettingsSection() {
  const { reminderSettings: settings, store } = useEvents();
  const [plates] = useState(() => store.lastPlates());
  const today = new Date();

  return (
    <section className="settings-group" id="reminders">
      <h3>Échéances</h3>
      <div className="setting-row usage">
        <span className="setting-title">Ensemble routier principal</span>
        <div className="row">
          <label className="ws-field">
            <span className="hint">Tracteur</span>
            <Plate
              value={settings.tractor}
              placeholder={plates.tractor || 'AB-123-CD'}
              label="Tracteur principal"
              onCommit={(tractor) => store.saveReminderSettings({ ...settings, tractor })}
            />
          </label>
          <label className="ws-field">
            <span className="hint">Remorque</span>
            <Plate
              value={settings.trailer}
              placeholder={plates.trailer || 'EF-456-GH'}
              label="Remorque principale"
              onCommit={(trailer) => store.saveReminderSettings({ ...settings, trailer })}
            />
          </label>
        </div>
        <span className="hint">Ses contrôles techniques sont rappelés avec la plaque.</span>
      </div>

      {REMINDER_TYPES.map((type) => (
        <ReminderRow key={type.kind} type={type} today={today} />
      ))}
      <span className="hint reminder-hint">
        Date du dernier passage : l’appli calcule la prochaine échéance et la rappelle en haut de l’accueil quelques
        semaines avant (horloge du rappel : le repousser d’une semaine).
      </span>
    </section>
  );
}

function ReminderRow({ type, today }: { type: ReminderType; today: Date }) {
  const { reminderSettings: settings, store } = useEvents();
  const entry = settings.items[type.kind];
  const due = nextDue(type, entry);
  // Même couleur que le rappel de l'accueil : orange si l'échéance approche, rouge si elle est dépassée.
  const level = reminderLevel(type, entry, today);
  const save = (patch: Parameters<typeof setEntry>[2]) =>
    store.saveReminderSettings(setEntry(settings, type.kind, patch));

  return (
    <div className={`setting-row usage${level ? ` reminder-${level}` : ''}`}>
      <span className="setting-title">{type.label}</span>
      <div className="reminder-fields">
        <label className="ws-field">
          <span className="hint">Dernier passage</span>
          <input
            type="date"
            value={entry?.last ?? ''}
            onChange={(e) => save({ last: e.target.value || null })}
            aria-label={`${type.label}, dernier passage`}
          />
        </label>
        {type.choices && (
          <label className="ws-field">
            <span className="hint">Tous les</span>
            <select
              value={entry?.years ?? type.years}
              onChange={(e) => save({ years: Number(e.target.value) })}
              aria-label={`${type.label}, périodicité`}
            >
              {type.choices.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? 'ans (chaque année)' : `${n} ans`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <span className="hint">
        {due ? `Prochaine échéance : ${format(due, 'd MMMM yyyy', { locale: fr })} (${daysLeft(due, today)}). ` : ''}
        {type.hint}
      </span>
    </div>
  );
}

/** Plaque enregistrée en quittant le champ. */
function Plate(props: { value: string; placeholder: string; label: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(props.value);
  return (
    <input
      className="plate ws-input"
      aria-label={props.label}
      placeholder={props.placeholder}
      value={text}
      onChange={(e) => setText(e.target.value.toUpperCase())}
      onBlur={() => text.trim() !== props.value && props.onCommit(text.trim())}
    />
  );
}
