// «Сделать копию» as the user sees it, the same on «Сегодня» (its banner) and on «Резервная копия»: busy
// while the file is made (a shared flag, so both places show it), then «Копия готова» — or, when the file
// was made but its date could not be saved, «Копия сделана, но дата не сохранилась». A closed share sheet
// says nothing; a copy that failed has already explained itself (backupNow's toast).
import { signal } from '@preact/signals';
import { backupNow } from './backupNow';
import type { BackupOutcome } from './backupNow';
import { showToast } from './kit/Toast';
import { meta, onResetSession } from './state';

/** A copy is being made (from either place). */
export const copying = signal(false);

onResetSession(() => {
  copying.value = false;
});

/** Call it straight from the tap: Safari opens the share sheet only then. A second tap while busy does nothing. */
export async function makeCopy(): Promise<BackupOutcome> {
  if (copying.value) return 'cancelled';
  copying.value = true;
  const before = meta.value.lastBackupAt;
  try {
    const outcome = await backupNow();
    if (outcome !== 'cancelled') {
      // backupNow records the date; when that save fails the date stays as it was (its own toast said so)
      // — the file was still made, and «Копия готова» must not hide that the date was lost
      showToast(meta.value.lastBackupAt !== before ? 'Копия готова' : 'Копия сделана, но дата не сохранилась');
    }
    return outcome;
  } finally {
    copying.value = false;
  }
}
