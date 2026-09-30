// Handing a file to the user and picking one. On iPhone the share sheet («Поделиться»: Files, Mail,
// AirDrop…) is used when it accepts files; otherwise the file is downloaded through a link
// (spec: the fallback when the share sheet is not available in the Home Screen app).
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded';

/** The largest file pickFile accepts (the tracker is well under 1 MB; bigger files are not ours). */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** A picked file over MAX_FILE_BYTES; the message is for the user (ioErrorMessage shows it). */
export class FileTooLargeError extends Error {
  override name = 'FileTooLargeError';
  constructor() {
    super('Файл больше 20 МБ');
  }
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Safari reads the blob after click() returns; give it time before freeing it
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/**
 * Shares an .xlsx file: the share sheet when it accepts files (closing it is not an error),
 * otherwise — or when the share sheet refuses — a download. Call it straight from a tap: Safari
 * only opens the share sheet shortly after a user gesture.
 */
export async function shareFile(filename: string, buffer: ArrayBuffer | Uint8Array): Promise<ShareOutcome> {
  const file = new File([buffer as BlobPart], filename, { type: XLSX_MIME });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
      // NotAllowedError (the tap was too long ago) and the like: fall back to the download
    }
  }
  download(file);
  return 'downloaded';
}

/**
 * Opens the system file picker; resolves with the chosen file or null when cancelled, rejects with
 * FileTooLargeError («Файл больше 20 МБ») for a file over 20 MB. Call it synchronously from a tap
 * handler (before any await), or Safari will not open the picker.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let done = false;
    const finish = (file: File | null) => {
      if (done) return;
      done = true;
      input.remove();
      if (file && file.size > MAX_FILE_BYTES) reject(new FileTooLargeError());
      else resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}
