import { Clock } from 'lucide-react';
import { useMemo } from 'react';
import { dayLimit } from '../lib/rest';
import { useEvents } from '../lib/useEvents';
import { useNow } from '../lib/useNow';
import RestNotice from './RestNotice';

/** Sous le jour de la journée en cours (RSE) : heure limite de fin, tant que la fin de journée n'est pas notée. */
export default function DayLimitNotice({ startIds }: { startIds: string[] }) {
  const { events } = useEvents();
  const now = useNow();
  const limit = useMemo(() => dayLimit(events, now), [events, now]);
  if (!limit || !startIds.includes(limit.startId)) return null;
  return (
    <div className="day-limit">
      <RestNotice check={limit} icon={Clock} />
    </div>
  );
}
