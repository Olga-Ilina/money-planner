// @vitest-environment happy-dom
// The data generation: a tab remembers which data set it loaded (Meta.generation). When another tab deleted
// the data («Забыли PIN?») or set up new ones, this tab's copy is stale: on its next save, on its return to
// the foreground and on every unlock it stops — a full-screen «Данные изменились в другой вкладке.
// Перезапустите приложение.» with a reload, never the old data on screen, never saved over the new ones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { emptyData } from '../../src/engine';
import type { Data } from '../../src/engine';
import * as db from '../../src/store/db';
import { setPin } from '../../src/store/pin';
import { actions } from '../../src/ui/actions';
import { App } from '../../src/ui/App';
import { backupNow } from '../../src/ui/backupNow';
import { LOCK_AFTER_MS, noteHidden, noteVisible } from '../../src/ui/session';
import * as share from '../../src/ui/share';
import { data, locked, meta as appMeta, resetSession, stopped } from '../../src/ui/state';

vi.mock('../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/store/db')>();
  return { ...mod, loadData: vi.fn(mod.loadData), loadMeta: vi.fn(mod.loadMeta) };
});

vi.mock('../../src/ui/share', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/ui/share')>();
  return { ...mod, shareFile: vi.fn(mod.shareFile) };
});

const PIN = '1234';
const THEIR_PIN = '9999';
const STOP = 'Данные изменились в другой вкладке. Перезапустите приложение.';

let real: typeof import('../../src/store/db');

function withOperation(d: Data, what: string): Data {
  return {
    ...d,
    operations: [...d.operations, { id: what, date: '2026-09-30', kind: 'expense', what, amount: 10, account: d.accounts[0]?.id }],
  };
}

/** The owner's data set, stored before generations existed (the start gives it one). */
async function storeOwner(): Promise<Data> {
  await db.saveMeta(await setPin({ failedAttempts: 0 }, PIN));
  const owner = withOperation(emptyData('2026-09-30'), 'OWNER');
  await db.saveData(owner);
  return owner;
}

/** Another tab: «Забыли PIN?», then onboarding with a new PIN (and a new generation) and new data. */
async function wipeAndSetUpElsewhere(): Promise<{ theirMeta: db.Meta; theirData: Data }> {
  await db.wipeAll();
  const theirMeta: db.Meta = { ...(await setPin({ failedAttempts: 0 }, THEIR_PIN)), generation: db.newGeneration() };
  await db.saveMeta(theirMeta);
  const theirData = withOperation(emptyData('2026-01-01'), 'THEIRS');
  await db.saveData(theirData);
  return { theirMeta, theirData };
}

function key(digit: string): HTMLButtonElement {
  return screen.getByRole('button', { name: digit }) as HTMLButtonElement;
}

async function enter(pin: string): Promise<void> {
  await waitFor(() => expect(key('1').disabled).toBe(false));
  for (const d of pin) fireEvent.click(key(d));
}

async function startUnlocked(): Promise<Data> {
  const owner = await storeOwner();
  render(<App />);
  await screen.findByRole('heading', { name: 'Введите PIN' });
  await enter(PIN);
  await screen.findByRole('navigation', { name: 'Разделы' });
  return owner;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** The stop screen, and nothing of the app (the old data) behind it. */
async function expectStopped(): Promise<void> {
  expect(await screen.findByText(STOP)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Перезапустить' })).toBeTruthy();
  expect(stopped.value).toBe(true);
  expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
  expect(document.querySelector('.shell')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Введите PIN' })).toBeNull();
}

beforeEach(async () => {
  real = await vi.importActual<typeof import('../../src/store/db')>('../../src/store/db');
  vi.mocked(db.loadData).mockReset().mockImplementation(() => real.loadData());
  vi.mocked(db.loadMeta).mockReset().mockImplementation(() => real.loadMeta());
  db.useFactory(new IDBFactory());
  resetSession();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
  vi.restoreAllMocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.documentElement.classList.remove('privacy-cover');
});

describe('the start', () => {
  it('a meta stored before generations existed gets one, stored once; the tab remembers it', async () => {
    await storeOwner();
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    const stored = await real.loadMeta();
    expect(stored.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(appMeta.value.generation).toBe(stored.generation);
  });

  it('a wipe and a new setup in another tab between the start’s reads: the start reads again — never the owner’s PIN with their data', async () => {
    await storeOwner();
    let theirs: Awaited<ReturnType<typeof wipeAndSetUpElsewhere>> | undefined;
    vi.mocked(db.loadData).mockImplementationOnce(async () => {
      theirs = await wipeAndSetUpElsewhere(); // after the meta was read, before the data is
      return real.loadData();
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    await waitFor(() => expect(appMeta.value.generation).toBe(theirs?.theirMeta.generation));
    expect(data.value).toEqual(theirs!.theirData);
    await enter(PIN); // the owner's PIN does not open their data
    expect(await screen.findByText('Неверный PIN')).toBeTruthy();
    await enter(THEIR_PIN);
    await screen.findByRole('navigation', { name: 'Разделы' });
    expect(data.value).toEqual(theirs!.theirData);
  });

  it('the same, with the change after the data was read: the start reads again', async () => {
    const owner = await storeOwner();
    let theirs: Awaited<ReturnType<typeof wipeAndSetUpElsewhere>> | undefined;
    vi.mocked(db.loadMeta).mockImplementationOnce(async () => {
      theirs = await wipeAndSetUpElsewhere(); // after the data was read, before the meta is read again
      return real.loadMeta();
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    await waitFor(() => expect(appMeta.value.generation).toBe(theirs?.theirMeta.generation));
    expect(data.value).toEqual(theirs!.theirData);
    expect(data.value).not.toEqual(owner);
  });
});

describe('an unlocked tab after a wipe and a new setup in another tab', () => {
  it('its next commit stops it: the stop screen, nothing saved over the new data', async () => {
    const owner = await startUnlocked();
    const { theirMeta, theirData } = await wipeAndSetUpElsewhere();
    act(() => actions.commit(withOperation(owner, 'EDIT')));
    await expectStopped();
    await actions.flush();
    expect(await real.loadData()).toEqual(theirData);
    expect(await real.loadMeta()).toEqual(theirMeta);
  });

  it('after a wipe only («Забыли PIN?» in another tab): its next commit stops it, nothing is written into the wiped storage', async () => {
    const owner = await startUnlocked();
    await db.wipeAll();
    act(() => actions.commit(withOperation(owner, 'EDIT')));
    await expectStopped();
    await actions.flush();
    expect(await real.loadData()).toBeNull();
    expect(await real.loadMeta()).toEqual({ failedAttempts: 0 });
  });

  it('coming back to the foreground (a short absence) stops it', async () => {
    await startUnlocked();
    act(() => setVisibility('hidden'));
    const { theirData } = await wipeAndSetUpElsewhere();
    act(() => setVisibility('visible'));
    expect(locked.value).toBe(false); // a short absence does not lock…
    await expectStopped(); // …but the data changed
    await actions.flush();
    expect(await real.loadData()).toEqual(theirData);
  });

  it('coming back with the same data set changes nothing', async () => {
    await startUnlocked();
    const reads = vi.mocked(db.loadMeta).mock.calls.length;
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await waitFor(() => expect(vi.mocked(db.loadMeta).mock.calls.length).toBeGreaterThan(reads)); // it did look
    await actions.flush();
    expect(stopped.value).toBe(false);
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
  });

  it('coming back when the stored meta cannot be read: it locks (fail closed)', async () => {
    await startUnlocked();
    act(() => setVisibility('hidden'));
    vi.mocked(db.loadMeta).mockRejectedValueOnce(new db.StoreError('Не удалось прочитать сохранённые данные.', { code: 'read' }));
    act(() => setVisibility('visible'));
    await waitFor(() => expect(locked.value).toBe(true));
    expect(stopped.value).toBe(false);
    expect(await screen.findByRole('heading', { name: 'Введите PIN' })).toBeTruthy();
  });

  it('a check still running when this tab resets its session (its own «Забыли PIN?») does nothing afterwards', async () => {
    await startUnlocked();
    act(() => setVisibility('hidden'));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(db.loadMeta).mockImplementationOnce(async () => {
      await gate;
      return real.loadMeta();
    });
    await wipeAndSetUpElsewhere();
    act(() => setVisibility('visible')); // the check starts and waits for its read…
    act(() => resetSession()); // …while this tab wipes and starts over
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(stopped.value).toBe(false);
    expect(locked.value).toBe(false);
  });

  it('«Перезапустить» reloads the app', async () => {
    const owner = await startUnlocked();
    await wipeAndSetUpElsewhere();
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location);
    act(() => actions.commit(withOperation(owner, 'EDIT')));
    fireEvent.click(await screen.findByRole('button', { name: 'Перезапустить' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('a locked tab after a wipe and a new setup in another tab', () => {
  async function lockedStale(): Promise<{ theirMeta: db.Meta; theirData: Data; owner: Data }> {
    const owner = await startUnlocked();
    act(() => {
      noteHidden(1_000_000);
      noteVisible(1_000_000 + LOCK_AFTER_MS + 1);
    });
    await screen.findByRole('heading', { name: 'Введите PIN' });
    return { ...(await wipeAndSetUpElsewhere()), owner };
  }

  it.each([
    ['the newcomer’s PIN', THEIR_PIN],
    ['the owner’s PIN', PIN],
  ])('%s does not unlock it: it stays locked, stops, and writes nothing', async (_label, pin) => {
    const { theirMeta, theirData } = await lockedStale();
    await enter(pin);
    await expectStopped();
    expect(locked.value).toBe(true);
    await actions.flush();
    expect(await real.loadMeta()).toEqual(theirMeta);
    expect(await real.loadData()).toEqual(theirData);
  });

  it('after a reload it shows the new data (with the new PIN)', async () => {
    const { theirData } = await lockedStale();
    await enter(THEIR_PIN);
    await expectStopped();
    // the reload: a fresh start of the app
    cleanup();
    await actions.flush();
    resetSession();
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    await enter(THEIR_PIN);
    await screen.findByRole('navigation', { name: 'Разделы' });
    expect(data.value).toEqual(theirData);
    expect(stopped.value).toBe(false);
  });
});

describe('onboarding and «Забыли PIN?» in this tab', () => {
  it('onboarding stores a new generation with the PIN; «Забыли PIN?» clears it; the next onboarding sets another one', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Придумайте PIN' });
    await enter(PIN);
    await screen.findByRole('heading', { name: 'Повторите PIN' });
    await enter(PIN);
    fireEvent.click(await screen.findByRole('button', { name: /Начать с нуля/ }));
    await screen.findByRole('navigation', { name: 'Разделы' });
    const first = (await real.loadMeta()).generation;
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(appMeta.value.generation).toBe(first);
    // «Забыли PIN?» on the lock screen of this tab
    act(() => {
      noteHidden(1_000_000);
      noteVisible(1_000_000 + LOCK_AFTER_MS + 1);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Забыли PIN?' }));
    fireEvent.input(await screen.findByLabelText('Введите УДАЛИТЬ'), { target: { value: 'УДАЛИТЬ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить все данные' }));
    await screen.findByRole('heading', { name: 'Придумайте PIN' });
    expect(appMeta.value.generation).toBeUndefined();
    expect((await real.loadMeta()).generation).toBeUndefined();
    await enter(PIN);
    await screen.findByRole('heading', { name: 'Повторите PIN' });
    await enter(PIN);
    fireEvent.click(await screen.findByRole('button', { name: /Начать с нуля/ }));
    await screen.findByRole('navigation', { name: 'Разделы' });
    const second = (await real.loadMeta()).generation;
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
    expect(stopped.value).toBe(false);
  });
});

describe('the start cannot store the generation of an old meta (no space left)', () => {
  function quota(): never {
    throw new DOMException('quota', 'QuotaExceededError');
  }

  it('the owner still gets in: the lock screen, the right PIN, the data — and the unlock’s write stores the generation', async () => {
    const owner = await storeOwner();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(quota); // the start's migration put
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    expect(appMeta.value.generation).toBeUndefined(); // none stored, none here: the same data set
    expect((await real.loadMeta()).generation).toBeUndefined();
    await enter(PIN);
    await screen.findByRole('navigation', { name: 'Разделы' });
    expect(data.value).toEqual(owner);
    const stored = await real.loadMeta();
    expect(stored.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(appMeta.value.generation).toBe(stored.generation);
    act(() => actions.commit(withOperation(owner, 'EDIT')));
    await actions.flush();
    expect(stopped.value).toBe(false);
    expect((await real.loadData())?.operations.map((o) => o.id)).toEqual(['OWNER', 'EDIT']);
  });

  it('no space at all: the owner unlocks, sees the data and makes a backup; with space again the next meta write stores the generation', async () => {
    const owner = await storeOwner();
    const before = await real.loadMeta();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(quota);
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    await enter(PIN);
    await screen.findByRole('navigation', { name: 'Разделы' });
    expect(data.value).toEqual(owner);
    expect(stopped.value).toBe(false);
    // the unlock's write failed too: memory never takes a generation storage does not have
    expect(appMeta.value.generation).toBeUndefined();
    expect(await real.loadMeta()).toEqual(before);
    // a backup of the data
    vi.mocked(share.shareFile).mockResolvedValueOnce('shared');
    await expect(backupNow()).resolves.toBe('shared');
    const [, buffer] = vi.mocked(share.shareFile).mock.calls[0]!;
    const { importBackup } = await import('../../src/io/backup');
    expect(await importBackup(buffer as ArrayBuffer)).toEqual(owner);
    // space again: the data set is still this tab's
    put.mockRestore();
    act(() => actions.commit(withOperation(owner, 'EDIT')));
    await actions.flush();
    expect(stopped.value).toBe(false);
    expect((await real.loadData())?.operations.map((o) => o.id)).toEqual(['OWNER', 'EDIT']);
    // the next meta write stores the generation, with its own field only
    await actions.markBackupDone();
    const stored = await real.loadMeta();
    expect(stored.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(stored).toEqual({ ...before, lastBackupAt: stored.lastBackupAt, generation: stored.generation });
    expect(appMeta.value.generation).toBe(stored.generation);
    act(() => actions.commit(withOperation(data.value!, 'AFTER')));
    await actions.flush();
    expect(stopped.value).toBe(false);
    expect((await real.loadData())?.operations.map((o) => o.id)).toEqual(['OWNER', 'EDIT', 'AFTER']);
    // a reload finds it: the same generation, the right PIN unlocks
    cleanup();
    await actions.flush();
    resetSession();
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    expect(appMeta.value.generation).toBe(stored.generation);
    await enter(PIN);
    await screen.findByRole('navigation', { name: 'Разделы' });
    expect(stopped.value).toBe(false);
  });

  it('another tab stores a generation meanwhile (its own start): this tab never takes it — its unlock stops it, nothing written', async () => {
    const owner = await storeOwner();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(quota);
    render(<App />);
    await screen.findByRole('heading', { name: 'Введите PIN' });
    const theirs = await real.loadMetaAtStart(); // the other tab's start, with space again
    expect(theirs.generation).toMatch(/^[0-9a-f]{32}$/);
    await enter(PIN);
    await expectStopped();
    expect(locked.value).toBe(true);
    await actions.flush();
    expect(await real.loadMeta()).toEqual(theirs);
    expect(await real.loadData()).toEqual(owner);
    expect(appMeta.value.generation).toBeUndefined();
  });
});
