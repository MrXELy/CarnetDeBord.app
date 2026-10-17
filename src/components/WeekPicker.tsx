import { isSameDay } from 'date-fns';
import { CalendarDays, CalendarCheck, Map as MapIcon, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { listWeeks, monthLabel, weekLabel, weekStart } from '../lib/dates';
import { useEvents } from '../lib/useEvents';
import { useModal } from '../lib/useModal';

interface Props {
  /** Semaine affichée actuellement (mise en évidence dans la liste). */
  current: Date;
  onPick: (start: Date) => void;
  /** Ouvre la carte d'un mois (« Janvier 2026 »). */
  onMonthMap: (month: string) => void;
  onClose: () => void;
}

/** Liste des semaines travaillées, groupées par mois, et saut à une date. */
export default function WeekPicker({ current, onPick, onMonthMap, onClose }: Props) {
  const { events } = useEvents();
  const weeks = useMemo(() => listWeeks(events), [events]);
  const selected = useRef<HTMLButtonElement>(null);
  const datePicker = useRef<HTMLInputElement>(null);

  useModal(onClose);

  // La semaine affichée est visible dès l'ouverture, même loin dans la liste.
  useEffect(() => {
    selected.current?.scrollIntoView({ block: 'center' });
  }, []);

  function pick(start: Date) {
    onPick(start);
    onClose();
  }

  // Regroupe les semaines par mois, dans l'ordre de la liste.
  const months: { label: string; weeks: typeof weeks }[] = [];
  for (const w of weeks) {
    const label = monthLabel(w.start);
    if (months.at(-1)?.label === label) months.at(-1)!.weeks.push(w);
    else months.push({ label, weeks: [w] });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>Choisir une semaine</h2>
        </header>

        <div className="modal-body">
          <div className="row">
            <button type="button" className="btn-secondary btn-icon lv-add" onClick={() => pick(weekStart(new Date()))}>
              <CalendarCheck size={18} />
              Cette semaine
            </button>
            <button
              type="button"
              className="btn-secondary btn-icon lv-add"
              onClick={() => {
                const input = datePicker.current;
                if (!input) return;
                // Ouvre directement le calendrier du téléphone ; à défaut, simple clic sur le champ.
                if (typeof input.showPicker === 'function') input.showPicker();
                else input.click();
              }}
            >
              <CalendarDays size={18} />
              Aller à une date
            </button>
            <input
              ref={datePicker}
              type="date"
              className="date-jump"
              aria-label="Aller à une date"
              tabIndex={-1}
              onChange={(e) => {
                if (e.target.value) pick(weekStart(new Date(`${e.target.value}T12:00`)));
              }}
            />
          </div>

          {months.length === 0 ? (
            <p className="empty muted">Aucune semaine enregistrée.</p>
          ) : (
            months.map((m) => (
              <section key={m.label} className="settings-group">
                <div className="month-head">
                  <h3>{m.label}</h3>
                  <button
                    type="button"
                    className="btn-link btn-icon month-map-btn"
                    onClick={() => onMonthMap(m.label)}
                    aria-label={`Carte de ${m.label.toLowerCase()}`}
                  >
                    <MapIcon size={16} />
                    Carte du mois
                  </button>
                </div>
                {m.weeks.map((w) => {
                  const isCurrent = isSameDay(w.start, current);
                  return (
                    <button
                      type="button"
                      key={w.start.getTime()}
                      ref={isCurrent ? selected : undefined}
                      className={`week-row${isCurrent ? ' selected' : ''}`}
                      onClick={() => pick(w.start)}
                    >
                      <span className="week-row-title">{weekLabel(w.start)}</span>
                      <span className="week-row-meta">
                        {w.km != null && `${w.km.toLocaleString('fr-FR')} km · `}
                        {w.count} étape{w.count > 1 ? 's' : ''}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
