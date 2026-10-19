import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useMemo } from 'react';
import { hoursLabel, openDebts, restSummary } from '../../lib/rest';
import { periodAt, type Period, type Range } from '../../lib/stats';
import { useStore } from '../../lib/useEvents';
import type { TripEvent } from '../../types';
import { KV, Section } from './shared';

const dayText = (date: Date) => format(date, 'EEE d MMM', { locale: fr });
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Repos de la période (RSE) : nombre, réduits, alertes (toucher ouvre le jour), rattrapages à faire. */
export default function RestSection(props: {
  events: TripEvent[];
  range: Range;
  now: Date;
  onPick: (p: Period) => void;
}) {
  const { events, range, now } = props;
  const store = useStore();
  const checks = store.restChecks();
  const s = useMemo(() => restSummary(events, checks, range), [events, checks, range]);
  // Rattrapages : seulement pour la période en cours.
  const debts = useMemo(
    () => (range.start <= now && now < range.end ? openDebts(events, now) : []),
    [events, range, now],
  );
  const errors = s.alerts.filter((a) => a.level === 'error').length;

  return (
    <Section title="Repos">
      <div className="st-kv">
        <KV
          label="Repos journaliers"
          value={s.daily}
          note={s.dailyReduced ? plural(s.dailyReduced, 'réduit') : 'aucun réduit'}
        />
        <KV
          label="Repos hebdomadaires"
          value={s.weekly}
          note={s.weeklyReduced ? plural(s.weeklyReduced, 'réduit') : 'aucun réduit'}
        />
        <KV label="Infractions" value={errors} note="repos trop courts ou trop tard" />
        <KV label="À vérifier" value={s.alerts.length - errors} note="réduits, oublis…" />
      </div>
      {s.alerts.length > 0 && (
        <ul className="st-rest-alerts">
          {s.alerts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={`st-rest-alert rest-${a.level}`}
                onClick={() => props.onPick(periodAt('jour', a.at))}
              >
                <b>{dayText(a.at)}</b>
                <span>{a.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {debts.map((d) => (
        <p key={d.from.getTime()} className="hint">
          À rattraper : {hoursLabel(d.owed)} (repos réduit du {dayText(d.from)}), avant la fin du {dayText(d.lastDay)}
        </p>
      ))}
      <p className="hint">Repère d’après les débuts et fins de journée notés ; le chrono fait foi.</p>
    </Section>
  );
}
