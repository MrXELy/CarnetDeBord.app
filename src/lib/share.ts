/** Partage le fichier sur téléphone (menu de partage), le télécharge sinon (partage annulé : AbortError). */
export async function shareFile(blob: Blob, name: string, title: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const phone = matchMedia('(pointer: coarse)').matches;
  if (phone && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
  else {
    // Type « octet-stream » : le fichier est enregistré, jamais ouvert dans un onglet (un PDF ouvert ainsi
    // depuis l'appli installée Firefox Android donne une page about:blank).
    const url = URL.createObjectURL(new File([blob], name, { type: 'application/octet-stream' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
