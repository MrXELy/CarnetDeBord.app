import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Search, X } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { dayLabel, workDay } from '../lib/dates';
import { searchEvents, type SearchResult } from '../lib/search';
import { useEvents } from '../lib/useEvents';
import { useSheet } from '../lib/useSheet';
import { EVENT_TYPES, type EventType, type TripEvent } from '../types';
import EventCard from './EventCard';

// Au-delà, la liste deviendrait lourde à afficher : on invite à préciser.
const MAX_RESULTS = 100;

// Dernière recherche, retrouvée en rouvrant la fenêtre après être allé voir une semaine.
let lastQuery = '';

interface Props {
  /** Ferme la recherche et affiche cette étape dans sa semaine. */
  onShowWeek: (event: TripEvent) => void;
  onClose: () => void;
}

// Filtres : chargements, livraisons et carburant (les débuts et fins de journée restent dans « Tout »).
const KINDS = EVENT_TYPES.filter((t) => ['chargement', 'livraison', 'carburant'].includes(t.value)).map((t) => ({
  value: t.value,
  label: t.value === 'carburant' ? t.label : `${t.label}s`,
}));

export default function SearchPage({ onShowWeek, onClose }: Props) {
  const { events, waybills } = useEvents();
  const [query, setQuery] = useState(lastQuery);
  // La frappe reste fluide : la liste se met à jour juste après.
  const deferred = useDeferredValue(query);
  const found = useMemo(() => searchEvents(events, waybills, deferred), [events, waybills, deferred]);
  // Filtre par type d'étape (cases colorées sous le champ), « Tout » par défaut.
  const [kind, setKind] = useState<EventType | null>(null);
  const results = kind ? found.filter((r) => r.event.type === kind) : found;
  const days = useMemo(() => groupByDay(results.slice(0, MAX_RESULTS)), [results]);
  const count = (type: EventType) => found.filter((r) => r.event.type === type).length;

  const sheet = useSheet(onClose);

  const last = results[0]?.event.occurred_at;

  return (
    <div className="modal-backdrop" ref={sheet.ref} onClick={sheet.close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header" {...sheet.handle}>
          <button type="button" className="icon-btn" onClick={sheet.close} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Rechercher</h2>
        </header>

        <div className="modal-body search-body">
          <label className="search">
            <Search size={18} aria-hidden />
            <input
              type="search"
              placeholder="Ville, client, LV, marchandise, plaque…"
              value={query}
              onChange={(e) => setQuery((lastQuery = e.target.value))}
              aria-label="Rechercher dans tout l’historique"
              autoFocus
            />
          </label>

          {deferred.trim() && found.length > 0 && (
            <div className="search-kinds" role="group" aria-label="Type d’étape">
              <button
                type="button"
                className={kind ? '' : 'selected'}
                aria-pressed={!kind}
                onClick={() => setKind(null)}
              >
                Tout · {found.length}
              </button>
              {KINDS.filter((t) => count(t.value)).map((t) => (
                <button
                  type="button"
                  key={t.value}
                  className={`tone-${t.value}${kind === t.value ? ' selected' : ''}`}
                  aria-pressed={kind === t.value}
                  onClick={() => setKind(kind === t.value ? null : t.value)}
                >
                  {t.label} · {count(t.value)}
                </button>
              ))}
            </div>
          )}

          {!deferred.trim() ? (
            <p className="empty muted">
              Cherche dans toutes tes étapes et lettres de voiture.
              <br />
              Plusieurs mots : « livraison toulouse ».
            </p>
          ) : results.length === 0 ? (
            <p className="empty muted">Aucun résultat.</p>
          ) : (
            <>
              <p className="search-summary">
                {results.length} étape{results.length > 1 ? 's' : ''}
                {last && ` · la dernière le ${format(parseISO(last), 'd MMMM yyyy', { locale: fr })}`}
              </p>
              <div className="search-results">
                {days.map((day) => (
                  <section key={day.date.getTime()} className="day">
                    <h3 className="day-header">
                      <span>
                        {dayLabel(day.date)} {day.date.getFullYear()}
                      </span>
                    </h3>
                    <ol className="timeline">
                      {day.results.map(({ event, waybills }) => (
                        <li key={event.id}>
                          <EventCard event={event} onOpen={() => onShowWeek(event)} />
                          {waybills.some((w) => w.number || w.goods) && (
                            <span className="search-lv">
                              {waybills
                                .map((w) => [w.number && `LV ${w.number}`, w.goods].filter(Boolean).join(' · '))
                                .filter(Boolean)
                                .join(' — ')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
              {results.length > MAX_RESULTS && (
                <p className="muted search-more">
                  {MAX_RESULTS} plus récentes affichées : ajoute un mot pour préciser.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Résultats regroupés par jour de travail, dans l'ordre reçu (le plus récent en premier). */
function groupByDay(results: SearchResult[]): { date: Date; results: SearchResult[] }[] {
  const days: { date: Date; results: SearchResult[] }[] = [];
  for (const r of results) {
    const date = workDay(parseISO(r.event.occurred_at));
    const day = days[days.length - 1];
    if (day && day.date.getTime() === date.getTime()) day.results.push(r);
    else days.push({ date, results: [r] });
  }
  return days;
}
