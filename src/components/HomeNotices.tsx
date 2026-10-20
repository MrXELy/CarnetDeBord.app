import { CalendarClock, Clock } from 'lucide-react';
import { useMemo } from 'react';
import { dueReminders, snooze } from '../lib/reminders';
import { useEvents } from '../lib/useEvents';
import { useNow } from '../lib/useNow';

/** Haut de l'accueil : échéances proches. */
export default function HomeNotices({ onOpenReminders }: { onOpenReminders: () => void }) {
  const { reminderSettings, store } = useEvents();
  const now = useNow();
  const due = useMemo(() => dueReminders(reminderSettings, now), [reminderSettings, now]);
  if (due.length === 0) return null;

  return (
    <div className="home-notices">
      {due.map((r) => (
        <div key={r.kind} className={`rest-notice reminder rest-${r.level}`}>
          <button type="button" className="reminder-text" onClick={onOpenReminders}>
            <CalendarClock size={18} aria-hidden />
            <span>{r.text}</span>
          </button>
          <button
            type="button"
            className="reminder-snooze"
            onClick={() => store.saveReminderSettings(snooze(reminderSettings, r.kind, new Date()))}
            title="Me le rappeler dans une semaine"
            aria-label="Me le rappeler dans une semaine"
          >
            <Clock size={18} />
          </button>
        </div>
      ))}
    </div>
  );
}
