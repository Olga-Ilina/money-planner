// @vitest-environment happy-dom
// The pieces the lock screen (Lock.tsx) and the «PIN» page (PinPage.tsx) share: they must keep the PIN
// lock fail-closed — the counter and the pause saved as checkPin returns them, a pause the clock moved back
// cut to 30 min exactly like checkPin cuts it, and a countdown that never shows less than is left. Another
// tab may change or remove the PIN: then nothing is checked or written — a tab only ever unlocks with the PIN
// it was started with, and never takes another tab's PIN.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import { IDBFactory } from 'fake-indexeddb';
import * as db from '../../src/store/db';
import type { Meta } from '../../src/store/db';
import { checkPin, setPin } from '../../src/store/pin';
import { actions } from '../../src/ui/actions';
import {
  MAX_PAUSE_MS, PIN_LENGTH, PinChangedError, PinRemovedError, checkLockPin, cutLongPause, formatWait, freshLockMeta,
  pauseLeft, saveLockState, strictestLockState, useCutLongPause, usePause, withLockState,
} from '../../src/ui/lockState';
import { meta as appMeta, resetSession, stopped } from '../../src/ui/state';

// saveMeta, loadMeta and updateStoredMeta (the app's meta writes) are spies that call through (a test makes
// them fail); the rest of the store is the real one
vi.mock('../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/store/db')>();
  return { ...mod, saveMeta: vi.fn(mod.saveMeta), loadMeta: vi.fn(mod.loadMeta), updateStoredMeta: vi.fn(mod.updateStoredMeta) };
});

const MIN = 60_000;
const NOW = Date.UTC(2026, 8, 30, 10, 0, 0);

beforeEach(() => {
  db.useFactory(new IDBFactory());
  resetSession();
});

afterEach(async () => {
  cleanup();
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
  vi.useRealTimers();
  vi.mocked(db.saveMeta).mockReset(); // back to the real saveMeta
  vi.mocked(db.loadMeta).mockReset(); // back to the real loadMeta
  vi.mocked(db.updateStoredMeta).mockReset(); // back to the real updateStoredMeta
});

describe('constants', () => {
  it('a PIN has 4 digits', () => {
    expect(PIN_LENGTH).toBe(4);
  });

  it('the longest pause is checkPin’s: 30 min', async () => {
    expect(MAX_PAUSE_MS).toBe(30 * MIN);
    // checkPin cuts a pause ending further ahead to exactly this
    const m = await setPin({ failedAttempts: 0 }, '2580');
    const r = await checkPin({ ...m, lockedUntil: NOW + 3 * 60 * MIN }, '2580', NOW);
    expect(r.meta.lockedUntil).toBe(NOW + MAX_PAUSE_MS);
  });
});

describe('withLockState', () => {
  const base: Meta = { failedAttempts: 0, pinHash: 'h', pinSalt: 's', pinIterations: 1, lastBackupAt: 'b' };

  it('takes the counter and the pause end from the checked meta, keeps everything else', () => {
    const next = withLockState(base, { ...base, pinHash: 'other', failedAttempts: 5, lockedUntil: NOW + MIN });
    expect(next).toEqual({ ...base, failedAttempts: 5, lockedUntil: NOW + MIN });
  });

  it('drops the pause end when the checked meta has none (a right PIN ends the pause)', () => {
    const next = withLockState({ ...base, failedAttempts: 7, lockedUntil: NOW + MIN }, { ...base, failedAttempts: 0 });
    expect(next).toEqual(base);
    expect('lockedUntil' in next).toBe(false);
  });

  it('never changes the meta it is given', () => {
    const m: Meta = { ...base, lockedUntil: NOW };
    const copy = structuredClone(m);
    withLockState(m, { failedAttempts: 3 });
    expect(m).toEqual(copy);
  });
});

describe('strictestLockState (another tab counts mistakes too)', () => {
  const pinData: Meta = { failedAttempts: 0, pinHash: 'h', pinSalt: 's', pinIterations: 1, lastBackupAt: 'b' };

  it('strictestLockState(stored, memory): the larger counter and the later pause end of both, the rest (the PIN) from storage', () => {
    const stored: Meta = { ...pinData, failedAttempts: 4, lockedUntil: NOW + MIN };
    const memory: Meta = { failedAttempts: 1, pinHash: 'old', pinSalt: 'old', pinIterations: 2, lastBackupAt: 'm' };
    expect(strictestLockState(stored, memory)).toEqual({ ...pinData, failedAttempts: 4, lockedUntil: NOW + MIN });
    expect(strictestLockState(stored, { ...memory, failedAttempts: 6, lockedUntil: NOW + 2 * MIN })).toEqual({
      ...pinData, failedAttempts: 6, lockedUntil: NOW + 2 * MIN,
    });
  });

  it('a pause in only one of them holds; none in either stays none', () => {
    expect(strictestLockState({ failedAttempts: 5, lockedUntil: NOW + MIN }, { failedAttempts: 0 }).lockedUntil).toBe(NOW + MIN);
    expect(strictestLockState({ failedAttempts: 0 }, { failedAttempts: 5, lockedUntil: NOW + MIN }).lockedUntil).toBe(NOW + MIN);
    const none = strictestLockState({ failedAttempts: 2 }, { failedAttempts: 3 });
    expect(none).toEqual({ failedAttempts: 3 });
    expect('lockedUntil' in none).toBe(false);
  });

  it('a damaged counter or pause end stays damaged, so checkPin gives the longest pause (never none)', async () => {
    const m = await setPin({ failedAttempts: 0 }, '2580');
    const damagedUntil = strictestLockState({ ...m, lockedUntil: Number.NaN }, { failedAttempts: 0, lockedUntil: NOW + MIN });
    const r1 = await checkPin(damagedUntil, '2580', NOW);
    expect(r1.ok).toBe(false);
    expect(r1.waitMs).toBe(MAX_PAUSE_MS);
    const damagedCount = strictestLockState({ ...m, failedAttempts: Number.NaN }, { failedAttempts: 2 });
    const r2 = await checkPin(damagedCount, '0000', NOW);
    expect(r2.waitMs).toBe(MAX_PAUSE_MS);
  });

  it('never changes the metas it is given', () => {
    const memory: Meta = { ...pinData, failedAttempts: 1 };
    const stored: Meta = { failedAttempts: 4, lockedUntil: NOW };
    const [a, b] = [structuredClone(memory), structuredClone(stored)];
    strictestLockState(memory, stored);
    expect(memory).toEqual(a);
    expect(stored).toEqual(b);
  });
});

describe('freshLockMeta', () => {
  it('reads the stored meta and keeps the stricter counter and pause (stored 4, memory 1 → 4)', async () => {
    const m = await setPin({ failedAttempts: 0 }, '2580');
    await db.saveMeta({ ...m, failedAttempts: 4 });
    const fresh = await freshLockMeta({ ...m, failedAttempts: 1 });
    expect(fresh).toEqual({ ...m, failedAttempts: 4 });
    const r = await checkPin(fresh, '0000', NOW);
    expect(r.meta.failedAttempts).toBe(5);
    expect(r.waitMs).toBe(30_000);
  });

  it('rejects with PinChangedError when the stored PIN is not this tab’s (changed, or wiped and set up anew, in another tab): not checked, nothing written', async () => {
    const old = await setPin({ failedAttempts: 0 }, '2580');
    const changed = await setPin({ failedAttempts: 0 }, '1111');
    await db.saveMeta({ ...changed, failedAttempts: 1 }); // another tab changed the PIN
    vi.mocked(db.saveMeta).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    for (const mine of [
      { ...old, failedAttempts: 2 },
      { ...changed, pinSalt: old.pinSalt }, // any one of the hash, the salt and the iterations differs
      { ...changed, pinIterations: 1 },
      { ...changed, pinHash: old.pinHash },
      { failedAttempts: 0 }, // no PIN here, one stored
    ]) {
      const e: unknown = await freshLockMeta(mine).catch((err: unknown) => err);
      expect(e).toBeInstanceOf(PinChangedError);
      expect(e).toBeInstanceOf(db.StoreError);
      expect((e as db.StoreError).code).toBe('meta-damaged');
      expect((e as db.StoreError).message).toBe('PIN изменён в другой вкладке. Перезапустите приложение.');
    }
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual({ ...changed, failedAttempts: 1 });
  });

  it('the same PIN in memory and storage is checked: the stored meta with the stricter counter and pause', async () => {
    const m = await setPin({ failedAttempts: 0 }, '2580');
    await db.saveMeta({ ...m, failedAttempts: 1, lockedUntil: NOW + MIN, lastBackupAt: 'stored' });
    const fresh = await freshLockMeta({ ...m, failedAttempts: 3, lastBackupAt: 'memory' });
    expect(fresh).toEqual({ ...m, failedAttempts: 3, lockedUntil: NOW + MIN, lastBackupAt: 'stored' });
  });

  it('rejects with PinRemovedError when no PIN is stored (another tab used «Забыли PIN?»): not checked, nothing written', async () => {
    const old = await setPin({ failedAttempts: 0 }, '2580'); // storage is empty: wiped
    const e: unknown = await freshLockMeta(old).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(PinRemovedError);
    expect(e).toBeInstanceOf(db.StoreError);
    expect((e as db.StoreError).code).toBe('meta-damaged');
    expect((e as db.StoreError).message).toBe('PIN удалён в другой вкладке. Перезапустите приложение.');
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual({ failedAttempts: 0 });
  });

  it('rejects when the stored meta cannot be read (the PIN is then not checked)', async () => {
    const damaged = new db.StoreError('Сохранённые настройки PIN повреждены.', { code: 'meta-damaged' });
    vi.mocked(db.loadMeta).mockRejectedValueOnce(damaged);
    await expect(freshLockMeta({ failedAttempts: 0 })).rejects.toBe(damaged);
  });
});

describe('cutLongPause', () => {
  it('a pause ending more than 30 min from now (the clock moved back) ends now + 30 min', () => {
    const m: Meta = { failedAttempts: 9, lockedUntil: NOW + 2 * 60 * MIN };
    expect(cutLongPause(m, NOW)).toEqual({ failedAttempts: 9, lockedUntil: NOW + MAX_PAUSE_MS });
    expect(m.lockedUntil).toBe(NOW + 2 * 60 * MIN);
  });

  it('keeps a pause of 30 min or less, and no pause, as they are (the same object)', () => {
    const exact: Meta = { failedAttempts: 9, lockedUntil: NOW + MAX_PAUSE_MS };
    const short: Meta = { failedAttempts: 6, lockedUntil: NOW + MIN };
    const none: Meta = { failedAttempts: 0 };
    expect(cutLongPause(exact, NOW)).toBe(exact);
    expect(cutLongPause(short, NOW)).toBe(short);
    expect(cutLongPause(none, NOW)).toBe(none);
  });
});

describe('pauseLeft', () => {
  it('what is left of the pause, never below 0 and never above 30 min', () => {
    expect(pauseLeft(undefined, NOW)).toBe(0);
    expect(pauseLeft(NOW - 1, NOW)).toBe(0);
    expect(pauseLeft(NOW + 30_000, NOW)).toBe(30_000);
    expect(pauseLeft(NOW + 5 * 60 * MIN, NOW)).toBe(MAX_PAUSE_MS);
  });
});

describe('formatWait', () => {
  it('«30 с», «1 мин 5 с», «2 мин»; a part of a second counts as a whole one', () => {
    expect(formatWait(30_000)).toBe('30 с');
    expect(formatWait(65_000)).toBe('1 мин 5 с');
    expect(formatWait(120_000)).toBe('2 мин');
    expect(formatWait(1)).toBe('1 с');
    expect(formatWait(29_001)).toBe('30 с');
    expect(formatWait(0)).toBe('1 с');
  });
});

describe('saveLockState', () => {
  it('saves the counter and the pause of a check into the LATEST meta', async () => {
    appMeta.value = { failedAttempts: 0, lastBackupAt: '2026-09-01T00:00:00.000Z' };
    await db.saveMeta(appMeta.value); // the meta this tab loaded (writers change the STORED meta)
    const pending = actions.updateMeta((m) => ({ ...m, lastImportAt: 'x' }));
    await saveLockState({ failedAttempts: 5, lockedUntil: NOW + MIN });
    await pending;
    const stored = await db.loadMeta();
    expect(stored).toEqual({ failedAttempts: 5, lockedUntil: NOW + MIN, lastBackupAt: '2026-09-01T00:00:00.000Z', lastImportAt: 'x' });
    expect(appMeta.value).toEqual(stored);
  });

  it('writes only the counter and the pause, onto this tab’s PIN', async () => {
    const m = await setPin({ failedAttempts: 0 }, '2580');
    appMeta.value = { ...m, lastBackupAt: '2026-09-01T00:00:00.000Z' };
    await db.saveMeta(appMeta.value); // the meta this tab loaded (writers change the STORED meta)
    await saveLockState({ ...m, failedAttempts: 5, lockedUntil: NOW + MIN, lastBackupAt: 'checked' });
    const stored = await db.loadMeta();
    expect(stored).toEqual({ ...m, failedAttempts: 5, lockedUntil: NOW + MIN, lastBackupAt: '2026-09-01T00:00:00.000Z' });
    expect(appMeta.value).toEqual(stored);
  });

  it('a checked meta with another PIN than this tab’s writes nothing: this tab never takes another PIN, and never writes its own over it', async () => {
    const old = await setPin({ failedAttempts: 0 }, '2580');
    const changed = await setPin({ failedAttempts: 0 }, '1111');
    await db.saveMeta(changed); // another tab changed the PIN
    vi.mocked(db.saveMeta).mockClear();
    const mine: Meta = { ...old, lastBackupAt: '2026-09-01T00:00:00.000Z' };
    appMeta.value = mine;
    await expect(saveLockState({ ...changed, failedAttempts: 3 })).resolves.toBeUndefined();
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    // the one transaction was refused: nothing written
    for (const r of vi.mocked(db.updateStoredMeta).mock.results) await expect(r.value).rejects.toBeInstanceOf(PinChangedError);
    expect(await db.loadMeta()).toEqual(changed);
    expect(appMeta.value).toBe(mine);
  });

  it('a wrong PIN: a counter and a pause another tab stored right before the write (after the read that follows the check) are never lowered', async () => {
    const mine = await setPin({ failedAttempts: 0 }, '2580');
    appMeta.value = mine;
    await db.saveMeta(mine);
    const later = Date.now() + 4 * MIN;
    const realUpdate = (await vi.importActual<typeof import('../../src/store/db')>('../../src/store/db')).updateStoredMeta;
    vi.mocked(db.updateStoredMeta).mockImplementationOnce(async (fn) => {
      await db.saveMeta({ ...mine, failedAttempts: 7, lockedUntil: later }); // another tab, the same PIN
      return realUpdate(fn);
    });
    expect(await checkLockPin('0000')).toEqual({ kind: 'checked', ok: false, waitMs: 0 });
    const stored = await db.loadMeta();
    expect(stored.failedAttempts).toBe(7);
    expect(stored.lockedUntil).toBe(later);
    expect(appMeta.value).toEqual(stored);
  });

  it('never rejects: when saving fails the counter and the pause still hold for this session', async () => {
    appMeta.value = { failedAttempts: 0 };
    const spy = vi.spyOn(actions, 'updateMeta').mockImplementationOnce(async (fn, opts) => {
      expect(opts).toEqual({ applyOnFailure: true });
      appMeta.value = fn(appMeta.value);
      throw new Error('disk full');
    });
    await expect(saveLockState({ failedAttempts: 6, lockedUntil: NOW + MIN })).resolves.toBeUndefined();
    expect(appMeta.value).toEqual({ failedAttempts: 6, lockedUntil: NOW + MIN });
    spy.mockRestore();
  });
});

function Countdown({ until }: { until: number | undefined }) {
  const left = usePause(until);
  useCutLongPause(until);
  return <p>{left}</p>;
}

describe('usePause and useCutLongPause', () => {
  it('counts the pause down every half second and stops at 0', () => {
    vi.useFakeTimers({ now: NOW });
    const { container } = render(<Countdown until={NOW + 2000} />);
    expect(container.textContent).toBe('2000');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(container.textContent).toBe('1500');
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(container.textContent).toBe('0');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a pause more than 30 min ahead shows 30 min at once, and is cut and saved', async () => {
    const until = Date.now() + 5 * 60 * MIN;
    appMeta.value = { failedAttempts: 9, lockedUntil: until };
    const { container } = render(<Countdown until={until} />);
    expect(Number(container.textContent)).toBe(MAX_PAUSE_MS);
    await waitFor(() => expect(appMeta.value.lockedUntil).toBeLessThan(until)); // the cut reads the stored meta first
    await actions.flush();
    const cut = appMeta.value.lockedUntil!;
    expect(cut).toBeLessThanOrEqual(Date.now() + MAX_PAUSE_MS);
    expect(cut).toBeGreaterThan(Date.now() + MAX_PAUSE_MS - MIN);
    expect((await db.loadMeta()).lockedUntil).toBe(cut);
  });

  it('saves the cut with applyOnFailure: the lock stays fail-closed when the write fails', async () => {
    const until = Date.now() + 5 * 60 * MIN;
    appMeta.value = { failedAttempts: 9, lockedUntil: until };
    const spy = vi.spyOn(actions, 'updateMeta'); // calls through: the cut is really stored
    render(<Countdown until={until} />);
    await waitFor(() => expect(spy).toHaveBeenCalled()); // the cut reads the stored meta first
    await actions.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Function), { applyOnFailure: true });
    spy.mockRestore();
  });

  it('when the write of the cut fails, the cut pause still holds in memory (never a longer pause left in place)', async () => {
    vi.mocked(db.updateStoredMeta).mockRejectedValue(new Error('disk full'));
    const until = Date.now() + 5 * 60 * MIN;
    appMeta.value = { failedAttempts: 9, lockedUntil: until };
    const { container } = render(<Countdown until={until} />);
    await waitFor(() => expect(appMeta.value.lockedUntil).toBeLessThan(until)); // the cut reads the stored meta first
    await actions.flush();
    expect(vi.mocked(db.updateStoredMeta)).toHaveBeenCalled();
    const cut = appMeta.value.lockedUntil!;
    expect(cut).toBeLessThanOrEqual(Date.now() + MAX_PAUSE_MS);
    expect(cut).toBeGreaterThan(Date.now() + MAX_PAUSE_MS - MIN);
    expect(appMeta.value.failedAttempts).toBe(9); // the counter is never touched by the cut
    expect(Number(container.textContent)).toBeLessThanOrEqual(MAX_PAUSE_MS);
  });

  it('the cut keeps the stricter counter of storage and memory (another tab counted mistakes on the same PIN)', async () => {
    const m = await setPin({ failedAttempts: 0 }, '2580');
    await db.saveMeta({ ...m, failedAttempts: 12 }); // another tab counted mistakes
    const until = Date.now() + 5 * 60 * MIN;
    appMeta.value = { ...m, failedAttempts: 9, lockedUntil: until };
    render(<Countdown until={until} />);
    await waitFor(async () => expect((await db.loadMeta()).lockedUntil).toBeDefined());
    await actions.flush();
    const stored = await db.loadMeta();
    expect(stored.lockedUntil).toBeLessThanOrEqual(Date.now() + MAX_PAUSE_MS);
    expect(stored.lockedUntil).toBeGreaterThan(Date.now() + MAX_PAUSE_MS - MIN);
    expect([stored.pinHash, stored.pinSalt, stored.pinIterations]).toEqual([m.pinHash, m.pinSalt, m.pinIterations]);
    expect(stored.failedAttempts).toBe(12);
    expect(appMeta.value).toEqual(stored);
  });

  it('nothing is written when the stored PIN was changed in another tab: memory keeps its own PIN and the longer pause', async () => {
    const old = await setPin({ failedAttempts: 0 }, '2580');
    const changed = await setPin({ failedAttempts: 0 }, '1111');
    await db.saveMeta({ ...changed, failedAttempts: 2 }); // another tab changed the PIN (or wiped and set up a new one)
    vi.mocked(db.saveMeta).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    const until = Date.now() + 5 * 60 * MIN;
    const mine: Meta = { ...old, failedAttempts: 9, lockedUntil: until };
    appMeta.value = mine;
    const spy = vi.spyOn(actions, 'updateMeta');
    const { container } = render(<Countdown until={until} />);
    await waitFor(() => expect(vi.mocked(db.loadMeta)).toHaveBeenCalled());
    await vi.mocked(db.loadMeta).mock.results.at(-1)!.value;
    await new Promise((r) => setTimeout(r, 50));
    await actions.flush();
    expect(spy).not.toHaveBeenCalled();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual({ ...changed, failedAttempts: 2 });
    expect(appMeta.value).toBe(mine);
    expect(Number(container.textContent)).toBe(MAX_PAUSE_MS); // the keypad still waits
    spy.mockRestore();
  });

  it('nothing is written when the stored PIN was removed in another tab («Забыли PIN?»)', async () => {
    const old = await setPin({ failedAttempts: 0 }, '2580'); // storage is empty: wiped
    const until = Date.now() + 5 * 60 * MIN;
    appMeta.value = { ...old, failedAttempts: 9, lockedUntil: until };
    render(<Countdown until={until} />);
    await waitFor(() => expect(vi.mocked(db.loadMeta)).toHaveBeenCalled());
    await vi.mocked(db.loadMeta).mock.results.at(-1)!.value;
    await actions.flush();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual({ failedAttempts: 0 });
    expect(appMeta.value).toEqual({ ...old, failedAttempts: 9, lockedUntil: until });
  });

  it('a pause of 30 min or less is left alone: nothing read or written, even after several renders', async () => {
    const until = Date.now() + 10 * MIN;
    const mine: Meta = { failedAttempts: 7, lockedUntil: until };
    await db.saveMeta(mine);
    vi.mocked(db.saveMeta).mockClear();
    appMeta.value = mine;
    const spy = vi.spyOn(actions, 'updateMeta');
    const { container } = render(<Countdown until={until} />);
    const shown = container.textContent;
    await waitFor(() => expect(container.textContent).not.toBe(shown), { timeout: 2000 }); // re-rendered by the countdown
    await new Promise((r) => setTimeout(r, 100)); // any cut started by a render has settled
    await actions.flush();
    expect(vi.mocked(db.loadMeta)).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(vi.mocked(db.saveMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.updateStoredMeta)).not.toHaveBeenCalled();
    expect(appMeta.value).toBe(mine);
    expect(await db.loadMeta()).toEqual(mine);
    spy.mockRestore();
  });
});

describe('the data generation on the lock paths (another tab deleted the data or set up new ones)', () => {
  it('freshLockMeta: another generation stored → StaleTabError, before the PIN is looked at', async () => {
    const m = await setPin({ failedAttempts: 0 }, '2580');
    await db.saveMeta({ ...m, generation: 'g2' }); // even the same PIN: another data set
    const e: unknown = await freshLockMeta({ ...m, generation: 'g1' }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(db.StaleTabError);
    expect((e as db.StoreError).code).toBe('stale');
  });

  it('checkLockPin: another generation stored → broken, the tab stops; nothing checked or written', async () => {
    const mine = { ...(await setPin({ failedAttempts: 0 }, '2580')), generation: 'g1' };
    const theirs = { ...(await setPin({ failedAttempts: 0 }, '1111')), generation: 'g2' };
    appMeta.value = mine;
    await db.saveMeta(theirs);
    vi.mocked(db.updateStoredMeta).mockClear();
    for (const pin of ['2580', '1111']) {
      const r = await checkLockPin(pin);
      expect(r.kind).toBe('broken');
      expect((r as { error: unknown }).error).toBeInstanceOf(db.StaleTabError);
    }
    expect(stopped.value).toBe(true);
    await actions.flush();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(theirs);
    expect(appMeta.value).toBe(mine);
  });

  it('checkLockPin: the generation changes while the PIN is checked → broken, the tab stops, nothing written', async () => {
    const mine = { ...(await setPin({ failedAttempts: 0 }, '2580')), generation: 'g1' };
    appMeta.value = mine;
    await db.saveMeta(mine);
    const theirs = { ...mine, generation: 'g2' }; // wiped and set up anew with the same digits would differ too
    const realLoad = (await vi.importActual<typeof import('../../src/store/db')>('../../src/store/db')).loadMeta;
    let reads = 0;
    vi.mocked(db.loadMeta).mockImplementation(async () => {
      reads += 1;
      if (reads === 2) await db.saveMeta(theirs); // another tab, between the check and the read after it
      return realLoad();
    });
    vi.mocked(db.updateStoredMeta).mockClear();
    const r = await checkLockPin('2580');
    expect(r.kind).toBe('broken');
    expect((r as { error: unknown }).error).toBeInstanceOf(db.StaleTabError);
    expect(stopped.value).toBe(true);
    await actions.flush();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual(theirs);
  });

  it('the same generation: checked as before', async () => {
    const mine = { ...(await setPin({ failedAttempts: 0 }, '2580')), generation: 'g1' };
    appMeta.value = mine;
    await db.saveMeta(mine);
    expect(await checkLockPin('2580')).toEqual({ kind: 'checked', ok: true, waitMs: 0 });
    expect(stopped.value).toBe(false);
  });

  it('the pause cut: another generation stored → nothing written, the tab stops', async () => {
    const m = await setPin({ failedAttempts: 0 }, '2580');
    await db.saveMeta({ ...m, generation: 'g2' });
    vi.mocked(db.updateStoredMeta).mockClear();
    const until = Date.now() + 5 * 60 * MIN;
    const mine: Meta = { ...m, generation: 'g1', failedAttempts: 9, lockedUntil: until };
    appMeta.value = mine;
    render(<Countdown until={until} />);
    await waitFor(() => expect(stopped.value).toBe(true));
    await actions.flush();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect(await db.loadMeta()).toEqual({ ...m, generation: 'g2' });
    expect(appMeta.value).toBe(mine);
  });
});
