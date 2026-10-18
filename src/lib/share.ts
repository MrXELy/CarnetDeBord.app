/** Partage le fichier sur téléphone (menu de partage), le télécharge sur ordinateur (partage annulé : AbortError). */
export async function shareFile(blob: Blob, name: string, title: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  const phone = matchMedia('(pointer: coarse)').matches;
  if (phone && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
  else {
    const url = URL.createObjectURL(file);
    const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
