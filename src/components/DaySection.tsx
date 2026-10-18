import type { CSSProperties } from 'react';
import { dayLabel, durationLabel, summarizeDay, type Day } from '../lib/dates';
import type { TripEvent } from '../types';
import EventCard from './EventCard';

interface Props {
  day: Day;
  /** Rang du jour dans la semaine : décale l'apparition de ses étapes. */
  index: number;
  /** Étape trouvée par la recherche, mise en évidence. */
  found?: string | null;
  onOpen: (e: TripEvent) => void;
}

export default function DaySection({ day, index, found, onOpen }: Props) {
  const { km, amplitude } = summarizeDay(day.events);
  return (
    <section className="day">
      <h2 className="day-header">
        <span>{dayLabel(day.date)}</span>
        <span className="day-summary">
          {km != null && <span>{km.toLocaleString('fr-FR')} km</span>}
          {amplitude != null && <span>{durationLabel(amplitude)}</span>}
        </span>
      </h2>
      <ol className="timeline">
        {day.events.map((e, i) => (
          <li
            key={e.id}
            className={e.id === found ? 'rise found' : 'rise'}
            data-event-id={e.id}
            style={{ '--i': index * 3 + i } as CSSProperties}
          >
            <EventCard event={e} onOpen={() => onOpen(e)} />
          </li>
        ))}
      </ol>
    </section>
  );
}
