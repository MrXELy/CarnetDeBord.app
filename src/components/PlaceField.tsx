import { LoaderCircle, LocateFixed } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatPlace, locateMe, searchCities } from '../lib/geo';
import type { Place } from '../types';

const countryNames = new Intl.DisplayNames(['fr'], { type: 'region' });

export const EMPTY_PLACE: Place = { city: '', postcode: null, department: null, country_code: null, lat: null, lon: null };

interface Props {
  value: Place;
  onChange: (place: Place) => void;
  autoLocate?: boolean;
}

export default function PlaceField({ value, onChange, autoLocate }: Props) {
  const [query, setQuery] = useState(value.city);
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function locate() {
    setLocating(true);
    setError(null);
    try {
      const place = await locateMe();
      // Le champ a pu être remplacé entre-temps (lieu prérempli) : on ignore alors la position.
      if (!alive.current) return;
      typed.current = false;
      setQuery(place.city);
      setSuggestions([]);
      onChange(place);
    } catch (err) {
      setError(
        err instanceof GeolocationPositionError
          ? 'Position introuvable (GPS désactivé ou refusé).'
          : 'Lieu introuvable, saisis-le à la main.',
      );
    } finally {
      setLocating(false);
    }
  }

  useEffect(() => {
    if (autoLocate) void locate();
    // Uniquement à l'ouverture du formulaire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autocomplétion : attend que la saisie se calme avant d'interroger le service.
  useEffect(() => {
    if (!typed.current || query.trim().length < 2) return setSuggestions([]);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      searchCities(query.trim(), ctrl.signal)
        .then(setSuggestions)
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  function type(text: string) {
    typed.current = true;
    setQuery(text);
    // Saisie libre : on garde le texte, sans département tant qu'aucune suggestion n'est choisie.
    onChange({ ...EMPTY_PLACE, city: text });
  }

  function pick(place: Place) {
    typed.current = false;
    setQuery(place.city);
    setSuggestions([]);
    onChange(place);
  }

  return (
    <div className="place-field">
      <div className="place-input">
        <input
          type="text"
          placeholder="Ville"
          autoComplete="off"
          value={query}
          onChange={(e) => type(e.target.value)}
          onBlur={() => setTimeout(() => setSuggestions([]), 150)}
        />
        <button type="button" className="btn-secondary" onClick={locate} disabled={locating} title="Me localiser">
          {locating ? <LoaderCircle size={20} className="spin" /> : <LocateFixed size={20} />}
          <span className="sr-only">Me localiser</span>
        </button>
      </div>
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                <strong>{formatPlace(s)}</strong>
                <span className="muted">
                  {s.postcode ?? ''} {s.country_code ? countryNames.of(s.country_code) : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PlaceInfo place={value} />
      {locating && <p className="hint">Recherche de ta position…</p>}
      {error && <p className="hint hint-err">{error}</p>}
    </div>
  );
}

function PlaceInfo({ place }: { place: Place }) {
  if (!place.country_code) return null;
  const parts = [place.department && `Dép. ${place.department}`, place.postcode, countryNames.of(place.country_code)].filter(
    Boolean,
  );
  return <p className="hint">{parts.join(' · ')}</p>;
}
