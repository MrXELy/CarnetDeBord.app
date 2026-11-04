import { Map as MapIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { durationLabel, summarizeDay, type Day } from '../lib/dates';
import type { TripEvent } from '../types';
import DayLimitNotice from './DayLimitNotice';
import EventCard from './EventCard';

interface Props {
  day: Day;
  /** Titre à la place du nom du jour (accueil : « Étapes du jour », sans km ni amplitude : ils sont en tuiles). */
  title?: string;
  /** Sans l'heure limite de fin dessous (l'accueil la montre déjà en tuile). */
  noLimit?: boolean;
  /** Rang du jour dans la semaine : décale l'apparition de ses étapes. */
  index: number;
  /** Étape trouvée par la recherche, mise en évidence. */
  found?: string | null;
  onOpen: (e: TripEvent) => void;
  /** Ouvre la carte de la journée. */
  onMap: () => void;
}

export default function DaySection({ day, title, noLimit, index, found, onOpen, onMap }: Props) {
  const { km, amplitude } = summarizeDay(day.events);
  // Débuts de journée de moins de 24 h : la journée est peut-être en cours (heure limite de fin dessous).
  const recentStarts = day.events
    .filter((e) => e.type === 'debut_journee' && Date.now() - Date.parse(e.occurred_at) < 24 * 3600_000)
    .map((e) => e.id);
  return (
    <section className="day">
      <h2 className="day-header">
        <span className="day-title">
          {title ?? shortDay(day.date)}
          <button type="button" className="pill day-map" onClick={onMap} aria-label="Carte de la journée">
            <MapIcon size={13} aria-hidden />
          </button>
        </span>
        {!title && (
          <span className="day-summary">
            {[km != null && `${km.toLocaleString('fr-FR')} km`, amplitude != null && durationLabel(amplitude)]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </h2>
      {!noLimit && recentStarts.length > 0 && <DayLimitNotice startIds={recentStarts} />}
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

/** « Mercredi 4 » : le mois est dans le titre de la semaine. */
function shortDay(date: Date): string {
  const s = format(date, 'EEEE d', { locale: fr });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
