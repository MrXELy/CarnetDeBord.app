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

// DIAGNOSTIC TEMPORAIRE (bas des Options) : ce que le navigateur répond pour le partage de fichiers. À retirer.
const testFile = (name: string, type: string) => new File(['%PDF-1.4\n%%EOF\n'], name, { type });
const yes = (v: boolean | undefined) => (v === undefined ? '?' : v ? 'oui' : 'non');

export function shareDiagnostic(): string {
  const can = (data: ShareData) => (navigator.canShare ? navigator.canShare(data) : undefined);
  return [
    `téléphone ${yes(/Android|iPhone|iPad/i.test(navigator.userAgent))}`,
    `tactile ${yes(matchMedia('(pointer: coarse)').matches)}`,
    `appli ${yes(matchMedia('(display-mode: standalone)').matches)}`,
    `share ${yes(typeof navigator.share === 'function')}`,
    `PDF ${yes(can({ files: [testFile('test.pdf', 'application/pdf')] }))}`,
    `image ${yes(can({ files: [testFile('test.png', 'image/png')] }))}`,
    `lien ${yes(can({ url: location.href }))}`,
  ].join(' · ');
}

/** Essaie vraiment de partager un petit PDF, même si `canShare` dit non : renvoie ce qui s'est passé. */
export async function shareTest(): Promise<string> {
  try {
    await navigator.share({ files: [testFile('test.pdf', 'application/pdf')], title: 'Test' });
    return 'partage réussi';
  } catch (err) {
    return err instanceof Error ? `${err.name} : ${err.message}` : String(err);
  }
}
