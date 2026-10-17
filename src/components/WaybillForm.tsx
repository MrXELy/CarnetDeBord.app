import { X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { formatPlace } from '../lib/geo';
import { parseNum, numText } from '../lib/numbers';
import { useModal } from '../lib/useModal';
import { useStore } from '../lib/useEvents';
import type { Place, Waybill } from '../types';
import PlaceField, { EMPTY_PLACE } from './PlaceField';

interface Props {
  waybill: Waybill;
  isNew: boolean;
  /** Ligne d'information sous le titre (ex. « Chargé à Cognac (16) le 12/10 »). */
  context?: string;
  onSave: (waybill: Waybill) => void;
  onDelete?: (waybill: Waybill) => void;
  onClose: () => void;
}

const clean = (s: string) => s.trim() || null;

export default function WaybillForm({ waybill, isNew, context, onSave, onDelete, onClose }: Props) {
  const store = useStore();
  const [names] = useState(() => store.knownNames());
  const [number, setNumber] = useState(waybill.number ?? '');
  const [shipper, setShipper] = useState(waybill.shipper ?? '');
  const [consignee, setConsignee] = useState(waybill.consignee ?? '');
  const [planned, setPlanned] = useState<Place>({ ...EMPTY_PLACE, city: waybill.planned_city ?? '' });
  const [goods, setGoods] = useState(waybill.goods ?? '');
  const [weight, setWeight] = useState(numText(waybill.weight_kg));
  const [notes, setNotes] = useState(waybill.notes ?? '');

  useModal(onClose);

  function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation(); // ne pas valider le formulaire d'étape situé derrière
    onSave({
      ...waybill,
      number: clean(number),
      shipper: clean(shipper),
      consignee: clean(consignee),
      // Ville choisie dans les suggestions : « Toulouse (31) » ; saisie libre : tel quel.
      planned_city: clean(planned.country_code ? formatPlace(planned) : planned.city),
      goods: clean(goods),
      weight_kg: parseNum(weight),
      notes: clean(notes),
    });
    onClose();
  }

  function remove() {
    if (onDelete && confirm('Supprimer cette lettre de voiture ?')) {
      onDelete(waybill);
      onClose();
    }
  }

  return (
    <div className="modal-backdrop stacked" onClick={onClose}>
      <form className="modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={22} />
          </button>
          <h2>{isNew ? 'Nouvelle lettre de voiture' : 'Lettre de voiture'}</h2>
          <button className="btn-primary btn-small">OK</button>
        </header>

        <div className="modal-body">
          {context && <p className="hint">{context}</p>}

          <label>
            N° lettre de voiture
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="À compléter plus tard" />
          </label>

          <datalist id="known-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          <label>
            Client chargeur (expéditeur)
            <input list="known-names" value={shipper} onChange={(e) => setShipper(e.target.value)} />
          </label>

          <label>
            Client destinataire
            <input list="known-names" value={consignee} onChange={(e) => setConsignee(e.target.value)} />
          </label>

          <div className="label">
            Ville de livraison prévue
            <PlaceField value={planned} onChange={setPlanned} />
          </div>

          <div className="row">
            <label>
              Marchandise
              <input value={goods} onChange={(e) => setGoods(e.target.value)} placeholder="Palettes de plâtre…" />
            </label>
            <label>
              Poids (kg)
              <input type="text" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </label>
          </div>

          <label>
            Remarque
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <button className="btn-primary btn-block">OK</button>
          {onDelete && (
            <button type="button" className="btn-danger btn-block" onClick={remove}>
              Supprimer la lettre
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
