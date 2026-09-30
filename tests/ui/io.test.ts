import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreError } from '../../src/store/db';
import { BackupError } from '../../src/io/backup';
import { TrackerImportError } from '../../src/io/importTracker';
import { GENERIC_ERROR, MODULE_ERROR, ioErrorMessage } from '../../src/ui/io';

describe('ioErrorMessage', () => {
  it('shows the message of the errors meant for the user', () => {
    expect(ioErrorMessage(new TrackerImportError('Это не «Трекер и планер расходов».'))).toBe('Это не «Трекер и планер расходов».');
    expect(ioErrorMessage(new BackupError('Это не резервная копия приложения «Трекер расходов».'))).toBe(
      'Это не резервная копия приложения «Трекер расходов».',
    );
    expect(ioErrorMessage(new StoreError('Не удалось сохранить данные.'))).toBe('Не удалось сохранить данные.');
  });

  it('anything else gets the generic message', () => {
    expect(ioErrorMessage(new TypeError('x is undefined'))).toBe(GENERIC_ERROR);
    expect(ioErrorMessage('boom')).toBe(GENERIC_ERROR);
    expect(GENERIC_ERROR).toBe('Что-то пошло не так. Данные не изменены.');
  });
});

describe('lazy I/O modules', () => {
  afterEach(() => {
    vi.doUnmock('../../src/io/backup');
    vi.doUnmock('../../src/io/importTracker');
    vi.doUnmock('../../src/io/reports');
    vi.resetModules();
  });

  it('load the real modules', async () => {
    const io = await import('../../src/ui/io');
    expect(typeof (await io.loadTrackerImport()).importTracker).toBe('function');
    expect(typeof (await io.loadBackup()).exportBackup).toBe('function');
    expect(typeof (await io.loadReports()).monthReport).toBe('function');
  });

  it.each([
    ['../../src/io/importTracker', 'loadTrackerImport'],
    ['../../src/io/backup', 'loadBackup'],
    ['../../src/io/reports', 'loadReports'],
  ] as const)('%s that fails to download asks to check the connection', async (path, loader) => {
    vi.resetModules();
    vi.doMock(path, () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    const io = await import('../../src/ui/io');
    const error = await io[loader]().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(MODULE_ERROR);
    expect(io.ioErrorMessage(error)).toBe('Не удалось загрузить модуль, проверьте подключение.');
  });
});
