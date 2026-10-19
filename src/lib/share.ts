/** Partage le fichier sur téléphone (menu de partage), le télécharge sinon (partage annulé : AbortError). */
export async function shareFile(blob: Blob, name: string, title: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  // Téléphone ou tablette d'après le navigateur : `(pointer: coarse)` peut être faux sur un téléphone
  // (appli installée Firefox Android), qui recevait alors un téléchargement au lieu du menu de partage.
  const phone =
    /Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
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
