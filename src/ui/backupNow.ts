// «Сделать копию» — one shared implementation for the «Сегодня» banner and the «Резервная копия» page:
// the whole data as a backup .xlsx (src/io/backup.ts, loaded lazily), handed to the user through the
// share sheet (or a download), then meta.lastBackupAt = now. Call it straight from the tap.
import { actions } from './actions';
import { todayISO } from './format';
import { ioErrorMessage, loadBackup } from './io';
import { showToast } from './kit/Toast';
import { shareFile } from './share';
import { appData } from './state';

export type BackupOutcome = 'shared' | 'downloaded' | 'cancelled';

let running: Promise<BackupOutcome> | null = null;

async function run(): Promise<BackupOutcome> {
  try {
    const d = appData();
    const { exportBackup, backupFilename } = await loadBackup();
    // exportedAt: the moment of the copy as an ISO datetime, as backup.ts stores it
    const buffer = await exportBackup(d, new Date().toISOString());
    const outcome = await shareFile(backupFilename(todayISO()), buffer);
    if (outcome !== 'cancelled') await actions.markBackupDone();
    return outcome;
  } catch (e) {
    showToast(ioErrorMessage(e));
    return 'cancelled';
  }
}

/**
 * Makes a full backup and hands it to the user. 'shared' / 'downloaded': done, and the backup date is
 * recorded (the «сделайте копию» banner goes away for 14 days). 'cancelled': the share sheet was closed
 * — or the copy could not be made, which a toast has already explained (the BackupError message);
 * nothing is recorded then. A second call while one is running joins it.
 */
export function backupNow(): Promise<BackupOutcome> {
  running ??= run().finally(() => {
    running = null;
  });
  return running;
}
