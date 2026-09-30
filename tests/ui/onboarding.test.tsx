// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { emptyData } from '../../src/engine';
import type { Data } from '../../src/engine';
import * as db from '../../src/store/db';
import * as pin from '../../src/store/pin';
import { checkPin, setPin } from '../../src/store/pin';
import { todayISO } from '../../src/ui/format';
import * as io from '../../src/ui/io';
import { Icon } from '../../src/ui/kit';
import { Onboarding } from '../../src/ui/Onboarding';
import * as share from '../../src/ui/share';
import { data, locked, meta as appMeta, resetSession, tab } from '../../src/ui/state';

vi.mock('../../src/ui/share', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/ui/share')>();
  return { ...mod, pickFile: vi.fn(async () => null) };
});

vi.mock('../../src/ui/io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/ui/io')>();
  return { ...mod, loadTrackerImport: vi.fn(mod.loadTrackerImport), loadBackup: vi.fn(mod.loadBackup) };
});

vi.mock('../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/store/db')>();
  return { ...mod, requestPersistence: vi.fn(async () => true) };
});

vi.mock('../../src/store/pin', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/store/pin')>();
  return { ...mod, setPin: vi.fn(mod.setPin) };
});

function fixtureFile(): File {
  const bytes = readFileSync(join(import.meta.dirname, '../fixtures/tracker-scenario.xlsx'));
  return new File([bytes], 'Трекер.xlsx');
}

function key(digit: string): HTMLButtonElement {
  return screen.getByRole('button', { name: digit }) as HTMLButtonElement;
}

async function enter(pin: string): Promise<void> {
  await waitFor(() => expect(key('1').disabled).toBe(false));
  for (const d of pin) fireEvent.click(key(d));
}

async function choosePin(pin = '1234'): Promise<void> {
  await enter(pin);
  await screen.findByRole('heading', { name: 'Повторите PIN' });
  await enter(pin);
  await screen.findByRole('heading', { name: 'С чего начнём?' });
}

let putSpy: { mockRestore(): void } | undefined;

/** The next write of the data document fails for lack of space (IndexedDB's QuotaExceededError). */
function failDataPutOnce(): { mockRestore(): void } {
  const put = IDBObjectStore.prototype.put;
  let failed = false;
  putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (key === 'data' && !failed) {
      failed = true;
      throw new DOMException('quota', 'QuotaExceededError');
    }
    return put.call(this, value, key);
  });
  return putSpy;
}

/** emptyData with its random account ids blanked out, to compare two fresh data sets. */
const withoutIds = (d: Data | null) => d && { ...d, accounts: d.accounts.map((a) => ({ ...a, id: '' })) };

beforeEach(() => {
  db.useFactory(new IDBFactory());
  resetSession();
  vi.mocked(share.pickFile).mockReset().mockResolvedValue(null);
  vi.mocked(db.requestPersistence).mockClear();
  vi.mocked(io.loadTrackerImport).mockClear();
});

afterEach(() => {
  putSpy?.mockRestore();
  putSpy = undefined;
  cleanup();
  resetSession();
  db.useFactory(undefined);
});

describe('Onboarding — PIN', () => {
  it('asks to invent a PIN and warns that only a backup can bring data back', () => {
    render(<Onboarding />);
    expect(screen.getByRole('heading', { name: 'Придумайте PIN' })).toBeTruthy();
    expect(screen.getByText('Если забудете PIN, данные можно вернуть только из резервной копии.')).toBeTruthy();
  });

  it('a mismatch shakes and starts over; a match goes on', async () => {
    render(<Onboarding />);
    await enter('1234');
    await screen.findByRole('heading', { name: 'Повторите PIN' });
    await enter('4321');
    expect(await screen.findByRole('heading', { name: 'Придумайте PIN' })).toBeTruthy();
    expect(screen.getByText('PIN не совпадает. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Введено цифр: 0 из 4' }).className).toContain('shake');
    await choosePin('1234');
    expect(await db.loadMeta()).toEqual({ failedAttempts: 0 }); // nothing saved before the data is ready
  });

  it('a PIN that cannot be created: says so, the keypad works again, nothing is saved', async () => {
    vi.mocked(pin.setPin).mockRejectedValueOnce(new Error('no WebCrypto'));
    render(<Onboarding />);
    await enter('1234');
    await screen.findByRole('heading', { name: 'Повторите PIN' });
    await enter('1234');
    expect(await screen.findByText('Не удалось создать PIN. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Придумайте PIN' })).toBeTruthy();
    expect(key('1').disabled).toBe(false);
    expect(appMeta.value.pinHash).toBeUndefined();
    expect(await db.loadMeta()).toEqual({ failedAttempts: 0 });
    await choosePin('1234'); // and a second try goes on
  });
});

describe('Onboarding — «Начать с нуля»', () => {
  it('saves emptyData(today) and the PIN, asks for persistent storage and opens «Сегодня»', async () => {
    tab.value = 'more';
    render(<Onboarding />);
    await choosePin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    await waitFor(() => expect(data.value).not.toBeNull());
    const stored = await db.loadData();
    expect(withoutIds(stored)).toEqual(withoutIds(emptyData(todayISO())));
    expect(stored).toEqual(data.value);
    const storedMeta = await db.loadMeta();
    expect(storedMeta).toEqual(appMeta.value);
    expect((await checkPin(storedMeta, '1234', Date.now())).ok).toBe(true);
    expect(JSON.stringify(storedMeta)).not.toContain('1234');
    expect(db.requestPersistence).toHaveBeenCalledOnce();
    expect(tab.value).toBe('today');
    expect(locked.value).toBe(false);
  });

  it('with a PIN already set (data lost), starts at «С чего начнём?»', async () => {
    const m = await setPin({ failedAttempts: 0 }, '9999');
    await db.saveMeta(m); // the meta this tab loaded at the start
    appMeta.value = m;
    render(<Onboarding />);
    expect(screen.getByRole('heading', { name: 'С чего начнём?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    await waitFor(() => expect(data.value).not.toBeNull());
    expect((await db.loadMeta()).pinHash).toBe(m.pinHash);
  });

  it('a PIN set up in another tab meanwhile: this tab never writes its PIN over it, nor its data', async () => {
    render(<Onboarding />);
    await choosePin('1234');
    const theirs = await setPin({ failedAttempts: 0 }, '9999');
    const theirData = emptyData('2026-01-01');
    await db.saveMeta(theirs); // another tab finished its onboarding first
    await db.saveData(theirData);
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    expect(await screen.findByText('PIN изменён в другой вкладке. Перезапустите приложение.')).toBeTruthy();
    expect(await db.loadMeta()).toEqual(theirs);
    expect(await db.loadData()).toEqual(theirData);
    expect(data.value).toBeNull();
    expect(appMeta.value.pinHash).toBeUndefined();
  });

  it('the data save fails after the PIN was stored: «Начать с нуля» again saves the data under that same PIN and generation', async () => {
    render(<Onboarding />);
    await choosePin('1234');
    const put = failDataPutOnce();
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    expect(await screen.findByText(/закончилось место/)).toBeTruthy();
    const first = await db.loadMeta();
    expect((await checkPin(first, '1234', Date.now())).ok).toBe(true); // the PIN went first
    expect(first.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(await db.loadData()).toBeNull();
    expect(data.value).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    await waitFor(() => expect(data.value).not.toBeNull());
    put.mockRestore();
    expect(await db.loadData()).toEqual(data.value);
    expect(await db.loadMeta()).toEqual(first); // the same PIN and generation, nothing else changed
    expect(appMeta.value).toEqual(first);
    expect(screen.queryByText(/PIN изменён/)).toBeNull();
    expect(tab.value).toBe('today');
  });

  it('the same retry from the tracker import: the data and the import date are saved, the PIN and generation kept', async () => {
    vi.mocked(share.pickFile).mockResolvedValue(fixtureFile());
    render(<Onboarding />);
    await choosePin('1234');
    fireEvent.click(screen.getByRole('button', { name: /Загрузить трекер из Excel/ }));
    await screen.findByRole('dialog', { name: 'Трекер загружен' }, { timeout: 10_000 });
    const put = failDataPutOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText(/закончилось место/)).toBeTruthy();
    const first = await db.loadMeta();
    expect(first.pinHash).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(data.value).not.toBeNull());
    put.mockRestore();
    expect(await db.loadData()).toEqual(data.value);
    const stored = await db.loadMeta();
    const { lastImportAt, ...rest } = stored;
    const { lastImportAt: _firstImport, ...firstRest } = first;
    expect(rest).toEqual(firstRest);
    expect(typeof lastImportAt).toBe('string');
    expect(appMeta.value).toEqual(stored);
  }, 20_000);

  it('the data save failed, then another tab changed the PIN: the retry refuses (PIN изменён), nothing written', async () => {
    render(<Onboarding />);
    await choosePin('1234');
    const put = failDataPutOnce();
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    expect(await screen.findByText(/закончилось место/)).toBeTruthy();
    put.mockRestore();
    const theirs = await setPin(await db.loadMeta(), '9999'); // their «PIN» page: the same data set, another PIN
    await db.saveMeta(theirs);
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    expect(await screen.findByText('PIN изменён в другой вкладке. Перезапустите приложение.')).toBeTruthy();
    expect(await db.loadMeta()).toEqual(theirs);
    expect(await db.loadData()).toBeNull();
    expect(data.value).toBeNull();
    expect(appMeta.value.pinHash).not.toBe(theirs.pinHash);
  });

  it('the data save failed, then another tab wiped and set up anew: the retry refuses, nothing written', async () => {
    render(<Onboarding />);
    await choosePin('1234');
    const put = failDataPutOnce();
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    expect(await screen.findByText(/закончилось место/)).toBeTruthy();
    put.mockRestore();
    await db.wipeAll();
    const theirs: db.Meta = { ...(await setPin({ failedAttempts: 0 }, '9999')), generation: db.newGeneration() };
    const theirData = emptyData('2026-01-01');
    await db.saveMeta(theirs);
    await db.saveData(theirData);
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    expect(await screen.findByText('Данные изменились в другой вкладке. Перезапустите приложение.')).toBeTruthy();
    expect(await db.loadMeta()).toEqual(theirs);
    expect(await db.loadData()).toEqual(theirData);
    expect(data.value).toBeNull();
    expect(appMeta.value.pinHash).not.toBe(theirs.pinHash);
  });

  it('a failed save stays on the step, shows why and changes nothing on screen', async () => {
    render(<Onboarding />);
    await choosePin();
    // no IndexedDB at all (happy-dom has none once the fake is removed)
    db.useFactory(undefined);
    fireEvent.click(screen.getByRole('button', { name: /Начать с нуля/ }));
    expect(await screen.findByText('Хранилище на этом устройстве недоступно.')).toBeTruthy();
    expect(data.value).toBeNull();
    expect(appMeta.value.pinHash).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'С чего начнём?' })).toBeTruthy();
  });
});

describe('Onboarding — «Загрузить трекер из Excel»', () => {
  it('has the import glyph (upload), not the export one', async () => {
    const upload = render(<Icon name="upload" />).container.querySelector('svg')?.innerHTML;
    render(<Onboarding />);
    await choosePin();
    const row = screen.getByRole('button', { name: /Загрузить трекер из Excel/ });
    expect(row.querySelector('.row-icon svg')?.innerHTML).toBe(upload);
  });

  it('imports the tracker, shows what was found and saves it on «Готово»', async () => {
    vi.mocked(share.pickFile).mockResolvedValue(fixtureFile());
    render(<Onboarding />);
    await choosePin();
    fireEvent.click(screen.getByRole('button', { name: /Загрузить трекер из Excel/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Трекер загружен' }, { timeout: 10_000 });
    expect(share.pickFile).toHaveBeenCalledWith(expect.stringContaining('.xlsx'));
    const counts = Object.fromEntries(
      Array.from(sheet.querySelectorAll('.row')).map((r) => [r.querySelector('.row-title')?.textContent, r.querySelector('.row-value')?.textContent]),
    );
    expect(counts).toMatchObject({ Счета: '3', Операции: '6', 'Плановые записи': '10', Постоянные: '4', Покупки: '1', Долги: '0' });
    expect(data.value).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(data.value).not.toBeNull());
    expect(data.value?.operations).toHaveLength(6);
    expect(await db.loadData()).toEqual(data.value);
    expect(appMeta.value.lastImportAt).toBeDefined();
    expect(tab.value).toBe('today');
  }, 20_000);

  it('lists the notes and the numbers typed over formulas', async () => {
    const imported = emptyData('2026-10-01');
    vi.mocked(share.pickFile).mockResolvedValue(new File(['x'], 't.xlsx'));
    vi.mocked(io.loadTrackerImport).mockResolvedValueOnce({
      importTracker: async () => ({ data: imported, notes: ['Журнал: строка 12 без даты — пропущена.'], overrides: ['Счета!E10 = 1234'] }),
    } as unknown as Awaited<ReturnType<typeof io.loadTrackerImport>>);
    render(<Onboarding />);
    await choosePin();
    fireEvent.click(screen.getByRole('button', { name: /Загрузить трекер из Excel/ }));
    await screen.findByRole('dialog', { name: 'Трекер загружен' });
    expect(screen.getByText('Журнал: строка 12 без даты — пропущена.')).toBeTruthy();
    expect(screen.getByText('Счета!E10 = 1234')).toBeTruthy();
  });

  it('cancelling the summary saves nothing', async () => {
    vi.mocked(share.pickFile).mockResolvedValue(fixtureFile());
    render(<Onboarding />);
    await choosePin();
    fireEvent.click(screen.getByRole('button', { name: /Загрузить трекер из Excel/ }));
    await screen.findByRole('dialog', { name: 'Трекер загружен' }, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(data.value).toBeNull();
    expect(await db.loadData()).toBeNull();
  }, 20_000);

  it('a file that is not the tracker: its message, nothing saved', async () => {
    vi.mocked(share.pickFile).mockResolvedValue(new File(['not a zip'], 'x.xlsx'));
    render(<Onboarding />);
    await choosePin();
    fireEvent.click(screen.getByRole('button', { name: /Загрузить трекер из Excel/ }));
    expect(await screen.findByText(/Не удалось прочитать файл/, {}, { timeout: 10_000 })).toBeTruthy();
    expect(data.value).toBeNull();
    expect(await db.loadData()).toBeNull();
  }, 20_000);

  it('an unexpected failure: «Что-то пошло не так. Данные не изменены.»', async () => {
    vi.mocked(share.pickFile).mockResolvedValue(new File(['x'], 't.xlsx'));
    vi.mocked(io.loadTrackerImport).mockResolvedValueOnce({
      importTracker: async () => {
        throw new TypeError('cannot read properties of undefined');
      },
    } as unknown as Awaited<ReturnType<typeof io.loadTrackerImport>>);
    render(<Onboarding />);
    await choosePin();
    fireEvent.click(screen.getByRole('button', { name: /Загрузить трекер из Excel/ }));
    expect(await screen.findByText('Что-то пошло не так. Данные не изменены.')).toBeTruthy();
    expect(data.value).toBeNull();
  });

  it('a file over 20 MB: «Файл больше 20 МБ», nothing read or saved', async () => {
    vi.mocked(share.pickFile).mockRejectedValue(new share.FileTooLargeError());
    render(<Onboarding />);
    await choosePin();
    fireEvent.click(screen.getByRole('button', { name: /Загрузить трекер из Excel/ }));
    expect(await screen.findByText('Файл больше 20 МБ')).toBeTruthy();
    expect(io.loadTrackerImport).not.toHaveBeenCalled();
    expect(data.value).toBeNull();
  });

  it('no file chosen: nothing happens', async () => {
    render(<Onboarding />);
    await choosePin();
    fireEvent.click(screen.getByRole('button', { name: /Загрузить трекер из Excel/ }));
    await waitFor(() => expect(share.pickFile).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Onboarding — «Восстановить из резервной копии»', () => {
  it('restores a backup made by the app', async () => {
    const original = { ...emptyData('2026-10-01'), debts: [{ id: 'd1', name: 'Кредит', total: 1000 }] };
    const { exportBackup } = await import('../../src/io/backup');
    const buf = await exportBackup(original, '2026-10-02T10:00:00.000Z');
    vi.mocked(share.pickFile).mockResolvedValue(new File([buf], 'Копия.xlsx'));
    render(<Onboarding />);
    await choosePin();
    fireEvent.click(screen.getByRole('button', { name: /Восстановить из резервной копии/ }));
    await screen.findByRole('dialog', { name: 'Копия прочитана' }, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(data.value).not.toBeNull());
    expect(data.value).toEqual(original);
    expect(await db.loadData()).toEqual(original);
  }, 20_000);
});
