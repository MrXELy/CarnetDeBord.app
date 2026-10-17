import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { useModal } from '../lib/useModal';
import { useEvents } from '../lib/useEvents';
import { stepLabel } from '../lib/waybills';
import { isInTruck, waybillStatus, type Waybill } from '../types';
import WaybillForm from './WaybillForm';
import WaybillLine from './WaybillLine';

export type WaybillFilter = 'a_completer' | 'dans_camion' | 'toutes';

const FILTERS: { value: WaybillFilter; label: string }[] = [
  { value: 'a_completer', label: 'À compléter' },
  { value: 'dans_camion', label: 'Dans le camion' },
  { value: 'toutes', label: 'Toutes' },
];

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

interface Props {
  initialFilter: WaybillFilter;
  onClose: () => void;
}

export default function WaybillsPage({ initialFilter, onClose }: Props) {
  const { waybills, store } = useEvents();
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Waybill | null>(null);

  useModal(onClose);

  // Date de référence d'une LV : son chargement, sinon sa livraison.
  const dateOf = (w: Waybill) =>
    store.event(w.loading_event_id)?.occurred_at ?? store.event(w.delivery_event_id)?.occurred_at ?? w.updated_at;

  const q = normalize(query.trim());
  const list = waybills
    .filter((w) => {
      if (filter === 'a_completer' && waybillStatus(w) !== 'a_completer') return false;
      if (filter === 'dans_camion' && !isInTruck(w)) return false;
      if (!q) return true;
      return [w.number, w.consignee, w.shipper, w.planned_city, w.goods].some((v) => v && normalize(v).includes(q));
    })
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));

  const count = (f: WaybillFilter) =>
    f === 'a_completer'
      ? waybills.filter((w) => waybillStatus(w) === 'a_completer').length
      : f === 'dans_camion'
        ? waybills.filter(isInTruck).length
        : waybills.length;

  function context(w: Waybill): string {
    const loading = store.event(w.loading_event_id);
    const delivery = store.event(w.delivery_event_id);
    return [
      `Chargée : ${stepLabel(loading)}`,
      delivery ? `Livrée : ${stepLabel(delivery)}` : null,
    ]
      .filter(Boolean)
      .join(' — ');
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <header className="modal-header">
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
              <X size={22} />
            </button>
            <h2>Lettres de voiture</h2>
          </header>

          <div className="modal-body">
            <div className="segmented">
              {FILTERS.map((f) => (
                <button
                  type="button"
                  key={f.value}
                  className={filter === f.value ? 'selected' : ''}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label} <span className="segmented-count">{count(f.value)}</span>
                </button>
              ))}
            </div>

            <label className="search">
              <Search size={18} aria-hidden />
              <input
                type="search"
                placeholder="N°, client, expéditeur…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Rechercher une lettre de voiture"
              />
            </label>

            {list.length === 0 ? (
              <p className="empty muted">
                {filter === 'a_completer' && !q ? 'Toutes les lettres de voiture sont complètes.' : 'Aucune lettre de voiture.'}
              </p>
            ) : (
              <div className="lv-list">
                {list.map((w) => (
                  <WaybillLine
                    key={w.id}
                    waybill={w}
                    onClick={() => setEditing(w)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <WaybillForm
          waybill={editing}
          isNew={false}
          context={context(editing)}
          onSave={(w) => store.saveWaybill(w)}
          onDelete={(w) => store.removeWaybill(w)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
