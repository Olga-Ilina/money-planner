// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import * as db from '../../../src/store/db';
import type { Meta } from '../../../src/store/db';
import { checkPin, setPin } from '../../../src/store/pin';
import { actions } from '../../../src/ui/actions';
import { Toast } from '../../../src/ui/kit';
import { PinPage } from '../../../src/ui/pages/PinPage';
import { lockNow } from '../../../src/ui/session';
import { data, locked, meta as appMeta, resetSession } from '../../../src/ui/state';
import { scenario } from '../../engine/scenario';

vi.mock('../../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/store/db')>();
  return { ...mod, saveMeta: vi.fn(mod.saveMeta), loadMeta: vi.fn(mod.loadMeta), updateStoredMeta: vi.fn(mod.updateStoredMeta) };
});

vi.mock('../../../src/store/pin', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/store/pin')>();
  return { ...mod, setPin: vi.fn(mod.setPin), checkPin: vi.fn(mod.checkPin) };
});

const HOUR = 3_600_000;
const HALF_HOUR = 30 * 60_000;

const OLD = '1234';
const NEW = '5678';

let realSaveMeta: typeof db.saveMeta;
let realUpdateStoredMeta: typeof db.updateStoredMeta;

function key(digit: string): HTMLButtonElement {
  return screen.getByRole('button', { name: digit }) as HTMLButtonElement;
}

async function enter(pin: string): Promise<void> {
  await waitFor(() => expect(key('1').disabled).toBe(false));
  for (const d of pin) fireEvent.click(key(d));
}

const heading = (name: string) => screen.findByRole('heading', { level: 2, name });

/** The next meta write of the app (updateStoredMeta) waits until `release()` is called. */
function holdNextSave(): { release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  vi.mocked(db.updateStoredMeta).mockImplementationOnce(async (fn) => {
    await gate;
    return realUpdateStoredMeta(fn);
  });
  return { release: () => release() };
}

async function start(m: Partial<Meta> = {}) {
  const pinMeta = { ...(await setPin({ failedAttempts: 0 }, OLD)), ...m };
  await realSaveMeta(pinMeta);
  appMeta.value = pinMeta;
  render(
    <>
      <PinPage params={{}} />
      <Toast />
    </>,
  );
}

beforeEach(async () => {
  const real = await vi.importActual<typeof import('../../../src/store/db')>('../../../src/store/db');
  realSaveMeta = real.saveMeta;
  realUpdateStoredMeta = real.updateStoredMeta;
  db.useFactory(new IDBFactory());
  resetSession();
  data.value = scenario();
  vi.mocked(db.saveMeta).mockReset().mockImplementation((m: Meta) => realSaveMeta(m));
  vi.mocked(db.loadMeta).mockReset(); // the real loadMeta
  vi.mocked(db.updateStoredMeta).mockReset().mockImplementation((fn) => realUpdateStoredMeta(fn));
  vi.mocked(checkPin).mockClear();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
});

describe('«PIN» — checking the current PIN', () => {
  it('asks for the current PIN first, under the page title', async () => {
    await start();
    expect(screen.getByRole('heading', { level: 1, name: 'PIN-код' })).toBeTruthy(); // as its row in «Ещё»
    expect(await heading('Текущий PIN')).toBeTruthy();
  });

  it('a wrong PIN counts as a mistake of the lock, saved before «Неверный PIN» is shown', async () => {
    await start();
    const save = holdNextSave();
    await enter('1111');
    await waitFor(() => expect(db.updateStoredMeta).toHaveBeenCalled());
    expect(screen.queryByText('Неверный PIN')).toBeNull();
    expect(key('1').disabled).toBe(true);
    save.release();
    expect(await screen.findByText('Неверный PIN')).toBeTruthy();
    expect(appMeta.value.failedAttempts).toBe(1);
    expect((await db.loadMeta()).failedAttempts).toBe(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
  });

  it('the right PIN goes on only after the reset counter is saved', async () => {
    await start({ failedAttempts: 2 });
    const save = holdNextSave();
    await enter(OLD);
    await waitFor(() => expect(db.updateStoredMeta).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { level: 2, name: 'Новый PIN' })).toBeNull();
    save.release();
    expect(await heading('Новый PIN')).toBeTruthy();
    expect((await db.loadMeta()).failedAttempts).toBe(0);
  });

  it('the fifth mistake starts the lock’s pause: the keypad waits', async () => {
    await start({ failedAttempts: 4 });
    await enter('0000');
    expect(await screen.findByText(/Попробуйте через (30|29) с/)).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    const stored = await db.loadMeta();
    expect(stored.failedAttempts).toBe(5);
    expect(stored.lockedUntil).toBeGreaterThan(Date.now());
  });

  it('mistakes counted in another tab count here: stored 4, memory 1 → the next wrong PIN is the 5th and pauses', async () => {
    await start({ failedAttempts: 1 });
    await realSaveMeta({ ...appMeta.value, failedAttempts: 4 }); // another tab made three more mistakes
    await enter('0000');
    expect(await screen.findByText(/Попробуйте через (30|29) с/)).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    const stored = await db.loadMeta();
    expect(stored.failedAttempts).toBe(5);
    expect(stored.lockedUntil).toBeGreaterThan(Date.now());
    expect(appMeta.value.failedAttempts).toBe(5);
  });

  it('a pause started in another tab holds here: the right PIN does not go on', async () => {
    await start();
    await realSaveMeta({ ...appMeta.value, failedAttempts: 5, lockedUntil: Date.now() + 60_000 });
    await enter(OLD);
    expect(await screen.findByText(/Попробуйте через (1 мин|59 с)/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect(key('1').disabled).toBe(true);
  });

  it('when the stored meta cannot be read, the PIN is not checked and the change does not go on', async () => {
    await start({ failedAttempts: 2 });
    vi.mocked(db.loadMeta).mockRejectedValueOnce(new db.StoreError('Не удалось прочитать сохранённые данные.', { code: 'read' }));
    await enter(OLD);
    expect(await screen.findByText('Не удалось прочитать сохранённые данные.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect(db.saveMeta).not.toHaveBeenCalled();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect((await db.loadMeta()).failedAttempts).toBe(2);
    await enter(OLD); // the next try reads it again
    expect(await heading('Новый PIN')).toBeTruthy();
  });

  it('a pause from the lock screen holds here too', async () => {
    await start({ failedAttempts: 5, lockedUntil: Date.now() + 60_000 });
    expect(await screen.findByText(/Попробуйте через (1 мин|59 с)/)).toBeTruthy();
    expect(key('1').disabled).toBe(true);
  });

  it('a pause that ends more than 30 min ahead (the clock moved back) is cut to 30 min, shown and saved', async () => {
    const before = Date.now();
    await start({ failedAttempts: 5, lockedUntil: before + 2 * HOUR });
    expect(await screen.findByText(/Попробуйте через (30 мин|29 мин \d+ с)/)).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    await waitFor(async () => expect((await db.loadMeta()).lockedUntil).toBeLessThanOrEqual(Date.now() + HALF_HOUR));
    const stored = await db.loadMeta();
    expect(stored.lockedUntil).toBeGreaterThanOrEqual(before + HALF_HOUR);
    expect(stored.failedAttempts).toBe(5);
    expect(appMeta.value).toEqual(stored);
  });

  it('a cut pause holds for this session even when saving it fails', async () => {
    const before = Date.now();
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    await start({ failedAttempts: 5, lockedUntil: before + 2 * HOUR });
    await waitFor(() => expect(appMeta.value.lockedUntil).toBeLessThanOrEqual(Date.now() + HALF_HOUR));
    expect(appMeta.value.lockedUntil).toBeGreaterThanOrEqual(before + HALF_HOUR);
    expect(key('1').disabled).toBe(true);
  });

  it('damaged PIN data never lets the change go on', async () => {
    await start({ pinIterations: -1 });
    await enter(OLD);
    expect(await screen.findByText(/Не удалось проверить PIN/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect(key('1').disabled).toBe(true);
  });
});

describe('«PIN» — another tab changed or removed the PIN (this tab goes on only with the PIN it was started with)', () => {
  const CHANGED = 'PIN изменён в другой вкладке. Перезапустите приложение.';

  it('a PIN changed in another tab: the old PIN is rejected, nothing is written (the stored hash stays the new one), the keypad turns off', async () => {
    await start();
    const mine = appMeta.value;
    const changed = await setPin({ failedAttempts: 0 }, NEW);
    await realSaveMeta(changed); // another tab changed the PIN
    await enter(OLD);
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    await actions.flush();
    expect(db.saveMeta).not.toHaveBeenCalled();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(changed);
    expect(appMeta.value).toBe(mine); // never takes the other PIN
  });

  it('data wiped and a new PIN set up in another tab: the newcomer’s PIN does not let the change go on', async () => {
    await start();
    const mine = appMeta.value;
    await db.wipeAll(); // another tab: «Забыли PIN?», then onboarding
    const theirs = await setPin({ failedAttempts: 0 }, NEW);
    await realSaveMeta(theirs);
    await enter(NEW);
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Новый PIN' })).toBeNull();
    expect(key('1').disabled).toBe(true);
    await actions.flush();
    expect(db.saveMeta).not.toHaveBeenCalled();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(theirs);
    expect(appMeta.value).toBe(mine);
  });

  it('a PIN changed while the right old PIN is checked: the change does not go on, nothing is written, the keypad turns off', async () => {
    await start();
    const mine = appMeta.value;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = vi.mocked(checkPin).getMockImplementation()!;
    vi.mocked(checkPin).mockImplementationOnce(async (...args) => {
      await gate;
      return real(...args);
    });
    await enter(OLD);
    await waitFor(() => expect(checkPin).toHaveBeenCalled());
    const changed = { ...(await setPin({ failedAttempts: 0 }, NEW)), failedAttempts: 3 };
    await realSaveMeta(changed); // another tab changed the PIN and counted mistakes
    release();
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Новый PIN' })).toBeNull();
    expect(key('1').disabled).toBe(true);
    await actions.flush();
    expect(db.saveMeta).not.toHaveBeenCalled();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(changed);
    expect(appMeta.value).toBe(mine);
  });

  it('data wiped in another tab («Забыли PIN?»): the PIN is not checked, nothing is written, the change does not go on', async () => {
    await start();
    await db.wipeAll(); // another tab
    await enter(OLD);
    expect(await screen.findByText('PIN удалён в другой вкладке. Перезапустите приложение.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    await actions.flush();
    expect(db.saveMeta).not.toHaveBeenCalled();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual({ failedAttempts: 0 });
  });
});

describe('«PIN» — another tab changes the PIN after the current PIN was checked here (the new PIN is written only over the checked one)', () => {
  const CHANGED = 'PIN изменён в другой вкладке. Перезапустите приложение.';

  async function toRepeat(): Promise<void> {
    await start();
    await enter(OLD);
    await heading('Новый PIN');
    await enter(NEW);
    await heading('Повторите новый PIN');
  }

  it('changed: the new PIN is not written over the other tab’s, the keypad turns off', async () => {
    await toRepeat();
    const mine = appMeta.value;
    const changed = { ...(await setPin({ failedAttempts: 0 }, '9999')), lastBackupAt: 'theirs' };
    await realSaveMeta(changed); // another tab changed the PIN meanwhile
    await enter(NEW);
    expect(await screen.findByText(CHANGED)).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    await actions.flush();
    expect(await db.loadMeta()).toEqual(changed);
    expect(appMeta.value).toBe(mine);
    expect(screen.queryByText('PIN изменён')).toBeNull();
  });

  it('removed («Забыли PIN?» in another tab): no PIN is written into the wiped storage', async () => {
    await toRepeat();
    await db.wipeAll();
    await enter(NEW);
    expect(await screen.findByText('PIN удалён в другой вкладке. Перезапустите приложение.')).toBeTruthy();
    expect(key('1').disabled).toBe(true);
    await actions.flush();
    expect(await db.loadMeta()).toEqual({ failedAttempts: 0 });
    expect(screen.queryByText('PIN изменён')).toBeNull();
  });

  it('the same PIN, another tab wrote the backup date meanwhile: the new PIN keeps it', async () => {
    await toRepeat();
    await realSaveMeta({ ...appMeta.value, lastBackupAt: 'theirs' });
    await enter(NEW);
    expect(await screen.findByText('PIN изменён')).toBeTruthy();
    const stored = await db.loadMeta();
    expect(stored.lastBackupAt).toBe('theirs');
    expect((await checkPin(stored, NEW, Date.now())).ok).toBe(true);
    expect(appMeta.value).toEqual(stored);
  });
});

describe('«PIN» — the new PIN', () => {
  it('new PIN twice: a mismatch starts the new PIN again; a match saves only its hash', async () => {
    await start({ failedAttempts: 1 });
    await enter(OLD);
    await heading('Новый PIN');
    await enter(NEW);
    await heading('Повторите новый PIN');
    await enter('5679');
    expect(await heading('Новый PIN')).toBeTruthy();
    expect(screen.getByText('PIN не совпадает. Попробуйте ещё раз.')).toBeTruthy();
    await enter(NEW);
    await heading('Повторите новый PIN');
    await enter(NEW);
    expect(await screen.findByText('PIN изменён')).toBeTruthy();
    const stored = await db.loadMeta();
    expect(stored).toEqual(appMeta.value);
    expect((await checkPin(stored, NEW, Date.now())).ok).toBe(true);
    expect((await checkPin(stored, OLD, Date.now())).ok).toBe(false);
    expect(stored.failedAttempts).toBe(0);
    expect(stored.lockedUntil).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(NEW);
    expect(await heading('Текущий PIN')).toBeTruthy(); // the page starts over
  });

  it('a failed save keeps the old PIN and says so', async () => {
    await start();
    await enter(OLD);
    await heading('Новый PIN');
    await enter(NEW);
    await heading('Повторите новый PIN');
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    await enter(NEW);
    expect(await screen.findByText('Не удалось сохранить новый PIN. Старый PIN действует.')).toBeTruthy();
    expect((await checkPin(await db.loadMeta(), OLD, Date.now())).ok).toBe(true);
    expect((await checkPin(appMeta.value, OLD, Date.now())).ok).toBe(true);
    expect(await heading('Новый PIN')).toBeTruthy();
  });

  it('when the app locks, the page forgets the checked PIN and starts over', async () => {
    await start();
    await enter(OLD);
    await heading('Новый PIN');
    act(() => lockNow());
    act(() => {
      locked.value = false;
    });
    expect(await heading('Текущий PIN')).toBeTruthy();
  });

  it('a new PIN still being hashed when the app locks is not saved: the old PIN stays', async () => {
    await start();
    await enter(OLD);
    await heading('Новый PIN');
    await enter(NEW);
    await heading('Повторите новый PIN');
    await enter(NEW.slice(0, 3));
    fireEvent.click(key(NEW[3]!)); // the save starts…
    act(() => lockNow()); // …and the app locks before it ends
    act(() => {
      locked.value = false;
    });
    await vi.mocked(setPin).mock.results.at(-1)!.value;
    await actions.flush();
    await waitFor(() => expect(key('1').disabled).toBe(false));
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect((await checkPin(await db.loadMeta(), OLD, Date.now())).ok).toBe(true);
    expect((await checkPin(appMeta.value, OLD, Date.now())).ok).toBe(true);
    expect(screen.queryByText('PIN изменён')).toBeNull();
    expect(screen.queryByText(/Не удалось сохранить новый PIN/)).toBeNull();
  });

  it('a new PIN whose write still waits for another meta write when the app locks is not saved', async () => {
    await start();
    await enter(OLD);
    await heading('Новый PIN');
    await enter(NEW);
    await heading('Повторите новый PIN');
    const held = holdNextSave();
    const other = actions.updateMeta((m) => ({ ...m })); // e.g. the backup date: the meta writes queue behind it
    await enter(NEW.slice(0, 3));
    fireEvent.click(key(NEW[3]!));
    await vi.mocked(setPin).mock.results.at(-1)!.value; // hashed; its write waits in the queue
    act(() => lockNow());
    act(() => {
      locked.value = false;
    });
    held.release();
    await other;
    await actions.flush();
    await waitFor(() => expect(key('1').disabled).toBe(false));
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect((await checkPin(await db.loadMeta(), OLD, Date.now())).ok).toBe(true);
    expect((await checkPin(appMeta.value, OLD, Date.now())).ok).toBe(true);
    expect(screen.queryByText('PIN изменён')).toBeNull();
  });

  it('a check still running when the app locks does not go on', async () => {
    await start();
    const save = holdNextSave();
    await enter(OLD);
    await waitFor(() => expect(db.updateStoredMeta).toHaveBeenCalled());
    act(() => lockNow());
    act(() => {
      locked.value = false;
    });
    save.release();
    await waitFor(() => expect(key('1').disabled).toBe(false));
    expect(screen.getByRole('heading', { level: 2, name: 'Текущий PIN' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Новый PIN' })).toBeNull();
  });
});
