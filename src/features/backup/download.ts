/** `lowtide-backup-YYYY-MM-DD-HHmm.json` in local time; the time avoids same-day overwrites. */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `lowtide-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/**
 * Saves text as a file with standard browser APIs only: Blob, an object URL
 * and a temporary <a download>. No network, no File System Access API.
 */
export function downloadText(fileName: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    // Let the click's navigation start before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Saves binary data (e.g. the workspace ZIP) the same way as `downloadText`. */
export function downloadBytes(fileName: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
