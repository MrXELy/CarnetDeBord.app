import { ImageOff, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { photoUrl } from '../lib/photos';
import { useModal } from '../lib/useModal';

/** Charge l'adresse affichable d'une photo (copie locale ou lien temporaire). */
function usePhotoUrl(path: string) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    photoUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}

export function PhotoThumb({ path, onOpen }: { path: string; onOpen: () => void }) {
  const url = usePhotoUrl(path);
  return (
    <button type="button" className="photo-thumb" onClick={onOpen} aria-label="Voir la photo">
      {url ? <img src={url} alt="" /> : url === null ? <ImageOff size={20} /> : null}
    </button>
  );
}

export default function PhotoViewer({
  path,
  onDelete,
  onClose,
}: {
  path: string;
  /** Absent : photo seulement à regarder (fiche LV en lecture seule). */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const url = usePhotoUrl(path);
  useModal(onClose);

  return (
    <div className="photo-viewer" onClick={onClose}>
      <div className="photo-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">
          <X size={24} />
        </button>
        {onDelete && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Supprimer la photo"
            onClick={() => {
              if (confirm('Supprimer cette photo ?')) {
                onDelete();
                onClose();
              }
            }}
          >
            <Trash2 size={22} />
          </button>
        )}
      </div>
      {url ? (
        <img src={url} alt="Photo de la lettre de voiture" onClick={(e) => e.stopPropagation()} />
      ) : (
        <p className="muted">{url === null ? 'Photo indisponible' : 'Chargement…'}</p>
      )}
    </div>
  );
}
