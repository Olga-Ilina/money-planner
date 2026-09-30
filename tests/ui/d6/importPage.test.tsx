// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import { emptyData } from '../../../src/engine';
import * as db from '../../../src/store/db';
import { setPin } from '../../../src/store/pin';
import { actions } from '../../../src/ui/actions';
import { backupNow } from '../../../src/ui/backupNow';
import * as io from '../../../src/ui/io';
import { Icon, Toast } from '../../../src/ui/kit';
import { ImportPage } from '../../../src/ui/pages/ImportPage';
import * as share from '../../../src/ui/share';
import { data, meta as appMeta, resetSession } from '../../../src/ui/state';
import { scenario } from '../../engine/scenario';

vi.mock('../../../src/ui/share', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/share')>();
  return { ...mod, pickFile: vi.fn(async () => null) };
});

vi.mock('../../../src/ui/io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/ui/io')>();
  return { ...mod, loadTrackerImport: vi.fn(mod.loadTrackerImport) };
});

vi.mock('../../../src/ui/backupNow', () => ({ backupNow: vi.fn(async () => 'shared') }));

vi.mock('../../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/store/db')>();
  return { ...mod, saveData: vi.fn(mod.saveData) };
});

type TrackerModule = Awaited<ReturnType<typeof io.loadTrackerImport>>;

function fixtureFile(): File {
  const bytes = readFileSync(join(import.meta.dirname, '../../fixtures/tracker-scenario.xlsx'));
  return new File([bytes], 'Трекер.xlsx');
}

/** importTracker replaced by one that returns `result`. */
function fakeImport(result: { data: ReturnType<typeof emptyData>; notes: string[]; overrides: string[] }) {
  vi.mocked(share.pickFile).mockResolvedValue(new File(['x'], 't.xlsx'));
  vi.mocked(io.loadTrackerImport).mockResolvedValueOnce({ importTracker: async () => result } as unknown as TrackerModule);
}

function renderPage() {
  return render(
    <>
      <ImportPage params={{}} />
      <Toast />
    </>,
  );
}

const pickButton = () => screen.getByRole('button', { name: 'Выбрать файл' });

/** The text a screen reader gets: without the parts hidden from it. */
function spoken(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

beforeEach(async () => {
  db.useFactory(new IDBFactory());
  resetSession();
  data.value = scenario();
  await db.saveData(scenario());
  vi.mocked(share.pickFile).mockReset().mockResolvedValue(null);
  vi.mocked(io.loadTrackerImport).mockClear();
  vi.mocked(backupNow).mockReset().mockResolvedValue('shared');
  vi.mocked(db.saveData).mockClear();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
});

describe('«Загрузить трекер»', () => {
  it('explains that the file replaces the data and shows the last import', () => {
    appMeta.value = { failedAttempts: 0, lastImportAt: '2026-09-20T10:00:00.000Z' };
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Загрузить трекер' })).toBeTruthy();
    expect(screen.getByText(/заменятся данными из файла/)).toBeTruthy();
    expect(screen.getByText(/операции, плановые записи, постоянные/)).toBeTruthy();
    // «Сначала — копия» is an export: the download glyph (loading the tracker in is «upload»)
    const glyph = (name: 'upload' | 'download') => render(<Icon name={name} />).container.querySelector('svg')?.innerHTML;
    const copy = screen.getByText('Сначала — копия').closest('.row');
    expect(copy?.querySelector('.row-icon svg')?.innerHTML).toBe(glyph('download'));
    expect(screen.getByText('Последняя загрузка: 20.09.2026')).toBeTruthy();
  });

  it('reads the tracker, shows what is in it next to what is here, and replaces the data', async () => {
    vi.mocked(share.pickFile).mockResolvedValue(fixtureFile());
    renderPage();
    fireEvent.click(pickButton());
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' }, { timeout: 10_000 });
    expect(share.pickFile).toHaveBeenCalledWith(expect.stringContaining('.xlsx'));
    const operations = within(sheet).getByText('Операции').closest('.row') as HTMLElement;
    expect(operations.textContent).toContain('6');
    expect(operations.textContent).toContain('сейчас 6');
    expect(within(sheet).getByText('Сейчас в приложении другие данные. Файл заменит их, это нельзя отменить.')).toBeTruthy();
    expect(data.value).toEqual(scenario()); // nothing changed before the choice
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(data.value?.operations).toHaveLength(6);
    expect(data.value).not.toEqual(scenario()); // ids are new
    expect(await db.loadData()).toEqual(data.value);
    await actions.flush();
    expect(appMeta.value.lastImportAt).toBeDefined();
    expect((await db.loadMeta()).lastImportAt).toBe(appMeta.value.lastImportAt);
    expect(screen.getByText('Трекер загружен')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull(); // not undoable
  }, 20_000);

  it('each count reads as «в файле N, сейчас M» to a screen reader', async () => {
    fakeImport({ data: emptyData('2026-10-01'), notes: [], overrides: [] });
    renderPage();
    fireEvent.click(pickButton());
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    const row = (title: string) => within(sheet).getByText(title).closest('.row') as HTMLElement;
    expect(spoken(row('Счета'))).toMatch(/^Счета ?в файле 3, сейчас 3$/);
    expect(spoken(row('Операции'))).toMatch(/^Операции ?в файле 0, сейчас 6$/);
    expect(spoken(row('Плановые записи'))).toMatch(/^Плановые записи ?в файле 0, сейчас 10$/);
    expect(row('Операции').textContent).toContain('сейчас 6'); // what is seen stays as it was
  });

  it('lists the notes and the numbers typed over formulas', async () => {
    fakeImport({ data: emptyData('2026-10-01'), notes: ['Журнал: строка 12 без даты — пропущена.'], overrides: ['Счета!E10 = 1234'] });
    renderPage();
    fireEvent.click(pickButton());
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    expect(within(sheet).getByText('Журнал: строка 12 без даты — пропущена.')).toBeTruthy();
    expect(within(sheet).getByText('Счета!E10 = 1234')).toBeTruthy();
    expect(within(sheet).getByText(/Замечаний: 1/)).toBeTruthy();
  });

  it('«Сначала сделать копию» makes a backup and changes nothing yet', async () => {
    const imported = emptyData('2026-10-01');
    fakeImport({ data: imported, notes: [], overrides: [] });
    renderPage();
    fireEvent.click(pickButton());
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сначала сделать копию' }));
    expect(backupNow).toHaveBeenCalledOnce();
    expect(await within(sheet).findByRole('button', { name: 'Копия сделана' })).toBeTruthy();
    expect(data.value).toEqual(scenario());
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    await waitFor(() => expect(data.value).toEqual(imported));
  });

  it('a cancelled backup keeps «Сначала сделать копию»', async () => {
    vi.mocked(backupNow).mockResolvedValueOnce('cancelled');
    fakeImport({ data: emptyData('2026-10-01'), notes: [], overrides: [] });
    renderPage();
    fireEvent.click(pickButton());
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сначала сделать копию' }));
    await waitFor(() => expect((within(sheet).getByRole('button', { name: 'Сначала сделать копию' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('«Отмена» keeps the data', async () => {
    fakeImport({ data: emptyData('2026-10-01'), notes: [], overrides: [] });
    renderPage();
    fireEvent.click(pickButton());
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(data.value).toEqual(scenario());
    expect(await db.loadData()).toEqual(scenario());
    expect(appMeta.value.lastImportAt).toBeUndefined();
  });

  it('a failed save: the reason in the sheet, the data unchanged', async () => {
    fakeImport({ data: emptyData('2026-10-01'), notes: [], overrides: [] });
    vi.mocked(db.saveData).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные: на устройстве закончилось место.', { code: 'quota' }));
    renderPage();
    fireEvent.click(pickButton());
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    expect(await within(sheet).findByText('Не удалось сохранить данные: на устройстве закончилось место.')).toBeTruthy();
    expect(data.value).toEqual(scenario());
    expect(await db.loadData()).toEqual(scenario());
    expect(appMeta.value.lastImportAt).toBeUndefined();
  });

  it('the import date after another tab changed the PIN: written onto the stored PIN, this tab’s PIN is never written back', async () => {
    const mine = await setPin({ failedAttempts: 0 }, '1234');
    const theirs = { ...(await setPin({ failedAttempts: 0 }, '9999')), lastBackupAt: 'theirs' };
    appMeta.value = mine;
    await db.saveMeta(theirs); // another tab changed the PIN
    const imported = emptyData('2026-10-01');
    fakeImport({ data: imported, notes: [], overrides: [] });
    renderPage();
    fireEvent.click(pickButton());
    const sheet = await screen.findByRole('dialog', { name: 'Заменить данные в приложении' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Заменить данные в приложении' }));
    await waitFor(() => expect(data.value).toEqual(imported));
    await actions.flush();
    const stored = await db.loadMeta();
    expect(stored.lastImportAt).toBeDefined();
    expect(stored).toEqual({ ...theirs, lastImportAt: stored.lastImportAt });
    expect(appMeta.value.pinHash).toBe(mine.pinHash);
    expect(appMeta.value.lastImportAt).toBe(stored.lastImportAt);
  });

  it('a file that is not the tracker: its message, nothing changed', async () => {
    vi.mocked(share.pickFile).mockResolvedValue(new File(['not a zip'], 'x.xlsx'));
    renderPage();
    fireEvent.click(pickButton());
    expect(await screen.findByText(/Не удалось прочитать файл/, {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(data.value).toEqual(scenario());
  }, 20_000);

  it('a file over 20 MB: «Файл больше 20 МБ»', async () => {
    vi.mocked(share.pickFile).mockRejectedValue(new share.FileTooLargeError());
    renderPage();
    fireEvent.click(pickButton());
    expect(await screen.findByText('Файл больше 20 МБ')).toBeTruthy();
    expect(io.loadTrackerImport).not.toHaveBeenCalled();
  });

  it('no file chosen: nothing happens', async () => {
    renderPage();
    fireEvent.click(pickButton());
    await waitFor(() => expect(share.pickFile).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
