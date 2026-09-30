// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import * as db from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { backupNow } from '../../../src/ui/backupNow';
import { Toast } from '../../../src/ui/kit';
import { BackupPage } from '../../../src/ui/pages/BackupPage';
import * as share from '../../../src/ui/share';
import { data, meta as appMeta, resetSession } from '../../../src/ui/state';
import { scenario } from '../../engine/scenario';

vi.mock('../../../src/ui/share', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/share')>();
  return { ...mod, pickFile: vi.fn(async () => null) };
});

vi.mock('../../../src/ui/backupNow', () => ({ backupNow: vi.fn(async () => 'shared') }));

vi.mock('../../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/store/db')>();
  return { ...mod, saveMeta: vi.fn(mod.saveMeta), updateStoredMeta: vi.fn(mod.updateStoredMeta) };
});

/** What the real backupNow does once the file is handed over: records the date (markBackupDone). */
async function sharedAndRecorded(): Promise<'shared'> {
  await actions.markBackupDone();
  return 'shared';
}

function renderPage() {
  return render(
    <>
      <BackupPage params={{}} />
      <Toast />
    </>,
  );
}

beforeEach(async () => {
  const real = await vi.importActual<typeof import('../../../src/store/db')>('../../../src/store/db');
  vi.mocked(db.saveMeta).mockReset().mockImplementation((m) => real.saveMeta(m));
  vi.mocked(db.updateStoredMeta).mockReset().mockImplementation((fn) => real.updateStoredMeta(fn));
  db.useFactory(new IDBFactory());
  resetSession();
  data.value = scenario();
  await db.saveData(scenario());
  vi.mocked(share.pickFile).mockReset().mockResolvedValue(null);
  vi.mocked(backupNow).mockReset().mockImplementation(sharedAndRecorded);
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
});

describe('«Резервная копия»', () => {
  it('shows the date of the last backup', () => {
    appMeta.value = { failedAttempts: 0, lastBackupAt: new Date().toISOString() };
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Резервная копия' })).toBeTruthy();
    const row = screen.getByText('Последняя копия').closest('.row') as HTMLElement;
    expect(row.textContent).toMatch(/\d\d\.\d\d\.\d{4}/);
  });

  it('without a backup it says so, and that it is time for one', () => {
    renderPage();
    const row = screen.getByText('Последняя копия').closest('.row') as HTMLElement;
    expect(row.textContent).toContain('ещё не было');
    expect(screen.getByText(/не было больше 14 дней|ещё не делали/)).toBeTruthy();
  });

  it('«Сделать копию» makes the full backup', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Сделать копию' }));
    expect(backupNow).toHaveBeenCalledOnce();
    expect(await screen.findByText('Копия готова')).toBeTruthy();
  });

  it('a copy whose date cannot be saved says so instead of «Копия готова»', async () => {
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Сделать копию' }));
    expect(await screen.findByText('Копия сделана, но дата не сохранилась')).toBeTruthy();
    expect(screen.queryByText('Копия готова')).toBeNull();
    expect(appMeta.value.lastBackupAt).toBeUndefined();
    const row = screen.getByText('Последняя копия').closest('.row') as HTMLElement;
    expect(row.textContent).toContain('ещё не было');
  });

  it('a cancelled backup says nothing', async () => {
    vi.mocked(backupNow).mockResolvedValueOnce('cancelled');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Сделать копию' }));
    await waitFor(() => expect(backupNow).toHaveBeenCalled());
    await actions.flush();
    expect(screen.queryByText('Копия готова')).toBeNull();
  });

  it('restores a backup: shows what is in it, offers a copy first, then replaces the data', async () => {
    const original = { ...scenario(), debts: [{ id: 'd1', name: 'Кредит', total: 1000 }] };
    original.operations = original.operations.slice(0, 2);
    const { exportBackup } = await import('../../../src/io/backup');
    const buf = await exportBackup(original, '2026-10-02T10:00:00.000Z');
    vi.mocked(share.pickFile).mockResolvedValue(new File([buf], 'Копия.xlsx'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Восстановить из копии/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' }, { timeout: 10_000 });
    const debts = within(sheet).getByText('Долги').closest('.row') as HTMLElement;
    expect(debts.textContent).toContain('1');
    expect(debts.textContent).toContain('сейчас 0');
    expect(within(sheet).getByRole('button', { name: 'Сначала сделать копию' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    await waitFor(() => expect(data.value).toEqual(original));
    expect(await db.loadData()).toEqual(original);
    expect(await screen.findByText('Данные восстановлены')).toBeTruthy();
  }, 20_000);

  it('a file that is not a backup: its message, nothing changed', async () => {
    vi.mocked(share.pickFile).mockResolvedValue(new File(['not a zip'], 'x.xlsx'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Восстановить из копии/ }));
    expect(await screen.findByRole('alert', {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(data.value).toEqual(scenario());
  }, 20_000);
});
