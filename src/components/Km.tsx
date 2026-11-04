/** Kilomètres dans une petite tuile : « km » plus petit, sur la même ligne que le nombre. */
export default function Km({ km }: { km: number }) {
  return (
    <>
      {km.toLocaleString('fr-FR')} <small>km</small>
    </>
  );
}
