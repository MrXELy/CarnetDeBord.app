import { dayLabel, durationLabel, summarizeDay, type Day } from '../lib/dates';
import type { TripEvent } from '../types';
import EventCard from './EventCard';

export default function DaySection({ day, onOpen }: { day: Day; onOpen: (e: TripEvent) => void }) {
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
        {day.events.map((e) => (
          <li key={e.id}>
            <EventCard event={e} onOpen={() => onOpen(e)} />
          </li>
        ))}
      </ol>
    </section>
  );
}
