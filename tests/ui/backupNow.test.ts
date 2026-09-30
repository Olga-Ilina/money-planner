import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as db from '../../src/store/db';
import { BackupError } from '../../src/io/backup';
import { actions } from '../../src/ui/actions';
import { backupNow } from '../../src/ui/backupNow';
import * as io from '../../src/ui/io';
import * as share from '../../src/ui/share';
import { data, meta as appMeta, resetSession, toast } from '../../src/ui/state';
import { scenario } from '../engine/scenario';

vi.mock('../../src/ui/share', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/ui/share')>();
  return { ...mod, shareFile: vi.fn(async () => 'shared' as const) };
});

vi.mock('../../src/ui/io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/ui/io')>();
  return { ...mod, loadBackup: vi.fn(mod.loadBackup) };
});

type BackupModule = Awaited<ReturnType<typeof io.loadBackup>>;

/** The real backup module with exportBackup spied on (or replaced by `exportImpl`). */
async function spyExport(exportImpl?: BackupModule['exportBackup']) {
  const real = await import('../../src/io/backup');
  const exportBackup = vi.fn(exportImpl ?? real.exportBackup);
  vi.mocked(io.loadBackup).mockResolvedValueOnce({ ...real, exportBackup } as BackupModule);
  return exportBackup;
}

// 12:00 UTC on 30 September is 01:00 on 1 October in Auckland (the test time zone)
const NOW = '2026-09-30T12:00:00.000Z';

beforeEach(async () => {
  db.useFactory(new IDBFactory());
  resetSession();
  data.value = scenario();
  vi.mocked(share.shareFile).mockReset().mockResolvedValue('shared');
  vi.mocked(io.loadBackup).mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(async () => {
  await actions.flush();
  vi.useRealTimers();
  resetSession();
  db.useFactory(undefined);
});

describe('backupNow', () => {
  it('exports the data (exportedAt = now), shares it under today’s local file name and marks the backup', async () => {
    const exportBackup = await spyExport();
    await expect(backupNow()).resolves.toBe('shared');
    expect(exportBackup).toHaveBeenCalledWith(data.value, NOW);
    const [filename, buffer] = vi.mocked(share.shareFile).mock.calls[0]!;
    expect(filename).toBe('Трекер расходов — копия 2026-10-01.xlsx');
    const { importBackup } = await import('../../src/io/backup');
    expect(await importBackup(buffer as ArrayBuffer)).toEqual(scenario());
    expect(appMeta.value.lastBackupAt).toBe(NOW);
    expect((await db.loadMeta()).lastBackupAt).toBe(NOW);
  }, 20_000);

  it('a download (no share sheet) also counts as a backup', async () => {
    await spyExport(async () => new Uint8Array([1]).buffer);
    vi.mocked(share.shareFile).mockResolvedValueOnce('downloaded');
    await expect(backupNow()).resolves.toBe('downloaded');
    expect(appMeta.value.lastBackupAt).toBe(NOW);
  });

  it('closing the share sheet is not a backup', async () => {
    await spyExport(async () => new Uint8Array([1]).buffer);
    vi.mocked(share.shareFile).mockResolvedValueOnce('cancelled');
    await expect(backupNow()).resolves.toBe('cancelled');
    expect(appMeta.value.lastBackupAt).toBeUndefined();
    expect(toast.value).toBeNull();
  });

  it('a failed export: a toast with the BackupError message, nothing shared or marked', async () => {
    await spyExport(async () => {
      throw new BackupError('Копия не прошла проверку. Данные не изменены.');
    });
    await expect(backupNow()).resolves.toBe('cancelled');
    expect(toast.value?.text).toBe('Копия не прошла проверку. Данные не изменены.');
    expect(share.shareFile).not.toHaveBeenCalled();
    expect(appMeta.value.lastBackupAt).toBeUndefined();
  });

  it('the Excel module cannot be loaded (offline): says so', async () => {
    vi.mocked(io.loadBackup).mockRejectedValueOnce(new io.ModuleLoadError());
    await expect(backupNow()).resolves.toBe('cancelled');
    expect(toast.value?.text).toBe('Не удалось загрузить модуль, проверьте подключение.');
  });

  it('a second tap while a backup is running joins it (one file, one share sheet)', async () => {
    const exportBackup = await spyExport(async () => new Uint8Array([1]).buffer);
    const [a, b] = [backupNow(), backupNow()];
    expect(await a).toBe('shared');
    expect(await b).toBe('shared');
    expect(exportBackup).toHaveBeenCalledOnce();
    expect(share.shareFile).toHaveBeenCalledOnce();
  });
});
