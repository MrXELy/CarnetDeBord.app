import { CalendarClock, Clock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { dueReminders, snooze } from '../lib/reminders';
import { dayLimit } from '../lib/rest';
import { useEvents } from '../lib/useEvents';
import RestNotice from './RestNotice';

/** Heure actuelle, rafraîchie chaque minute et au retour sur la page. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = setInterval(tick, 60_000);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

/** Haut de l'accueil : heure limite de fin de la journée en cours (RSE) et échéances proches. */
export default function HomeNotices({ onOpenReminders }: { onOpenReminders: () => void }) {
  const { events, reminderSettings, store } = useEvents();
  const now = useNow();
  const limit = useMemo(() => dayLimit(events, now), [events, now]);
  const due = useMemo(() => dueReminders(reminderSettings, now), [reminderSettings, now]);
  if (!limit && due.length === 0) return null;

  return (
    <div className="home-notices">
      {limit && <RestNotice check={limit} icon={Clock} />}
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
