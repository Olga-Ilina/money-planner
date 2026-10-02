// The Excel modules (and ExcelJS inside them) load only when the user asks for an import or an
// export, as separate chunks; screens always go through these loaders, never a static import of
// src/io/*, so the app itself stays small. The service worker precaches the chunks for offline use.
export const GENERIC_ERROR = 'Что-то пошло не так. Данные не изменены.';
export const MODULE_ERROR = 'Не удалось загрузить модуль, проверьте подключение.';

/** A lazily loaded module that could not be downloaded (offline, an outdated app version). */
export class ModuleLoadError extends Error {
  override name = 'ModuleLoadError';
  constructor() {
    super(MODULE_ERROR);
  }
}

async function load<T>(importer: () => Promise<T>): Promise<T> {
  try {
    return await importer();
  } catch {
    throw new ModuleLoadError();
  }
}

/** src/io/importTracker: importTracker(buf) → {data, notes, overrides}; throws TrackerImportError. */
export const loadTrackerImport = () => load(() => import('../io/importTracker'));
/** src/io/backup: exportBackup(data, exportedAt), importBackup(buf), backupFilename(today); throw BackupError. */
export const loadBackup = () => load(() => import('../io/backup'));
/** src/io/reports: monthReport(data, ym), yearReport(data), accountsReport(data, today, ym), forecastReport(data) → {filename, buffer}. */
export const loadReports = () => load(() => import('../io/reports'));
/**
 * src/io/sync (the iCloud Drive sync with the Mac; small, no ExcelJS): formatStamp, parseStamp, readStamp(buf),
 * newSyncId(), stampTime(date), dataHash(data); throw SyncError.
 */
export const loadSync = () => load(() => import('../io/sync'));

// matched by name: importing the classes would pull the I/O modules into the main chunk
const USER_FACING = new Set([
  'TrackerImportError', 'BackupError', 'StoreError', 'ModuleLoadError', 'DataChangedError', 'FileTooLargeError', 'SyncError',
]);

/**
 * The message to show for a failed import/export/save: the error's own (Russian) text for the errors
 * meant for the user (TrackerImportError, BackupError, StoreError, ModuleLoadError, DataChangedError,
 * FileTooLargeError, SyncError), otherwise the generic one.
 */
export function ioErrorMessage(e: unknown): string {
  return e instanceof Error && USER_FACING.has(e.name) && e.message ? e.message : GENERIC_ERROR;
}
