import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { emptyData } from '../../src/engine';
import type { Data } from '../../src/engine';
import * as db from '../../src/store/db';
import type { Meta } from '../../src/store/db';
import { actions, needsBackup } from '../../src/ui/actions';
import { generationPending, setGenerationPending } from '../../src/ui/generation';
import { ioErrorMessage } from '../../src/ui/io';
import { accountName, data, feedMonth, meta, resetSession, stopped, toast } from '../../src/ui/state';

vi.mock('../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/store/db')>();
  return { ...mod, saveData: vi.fn(mod.saveData), saveMeta: vi.fn(mod.saveMeta), updateStoredMeta: vi.fn(mod.updateStoredMeta) };
});

const DAY = 86_400_000;

function withOperation(d: Data, what: string): Data {
  return {
    ...d,
    operations: [...d.operations, { id: what, date: '2026-09-30', kind: 'expense', what, amount: 10, account: d.accounts[0]?.id }],
  };
}

beforeEach(async () => {
  db.useFactory(new IDBFactory());
  resetSession();
  await actions.flush();
  vi.mocked(db.saveData).mockClear();
  vi.mocked(db.saveMeta).mockClear();
  vi.mocked(db.updateStoredMeta).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  db.useFactory(undefined);
});

describe('actions.commit', () => {
  it('sets data at once and persists it', async () => {
    const next = emptyData('2026-09-30');
    actions.commit(next);
    expect(data.value).toBe(next);
    await actions.flush();
    expect(await db.loadData()).toEqual(next);
  });

  it('serialises writes: the last commit wins and superseded ones are skipped', async () => {
    const base = emptyData('2026-09-30');
    const a = withOperation(base, 'A');
    const b = withOperation(a, 'B');
    const c = withOperation(b, 'C');
    actions.commit(a);
    actions.commit(b);
    actions.commit(c);
    await actions.flush();
    expect(await db.loadData()).toEqual(c);
    // A is written at once; B is replaced by C while A is being written
    expect(vi.mocked(db.saveData).mock.calls.map(([d]) => d)).toEqual([a, c]);
  });

  it('shows a toast with «Отменить» when given a message', () => {
    actions.commit(emptyData('2026-09-30'), 'Операция добавлена');
    expect(toast.value?.text).toBe('Операция добавлена');
    expect(typeof toast.value?.undo).toBe('function');
  });

  it('reports a failed save in a toast and keeps the data on screen', async () => {
    vi.mocked(db.saveData).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные: на устройстве закончилось место.'));
    const next = emptyData('2026-09-30');
    actions.commit(next, 'Операция добавлена');
    await actions.flush();
    expect(data.value).toBe(next);
    expect(toast.value?.text).toBe('Не удалось сохранить данные: на устройстве закончилось место.');
  });

  it('a failure that is not a StoreError still starts with «Не удалось сохранить»', async () => {
    vi.mocked(db.saveData).mockRejectedValueOnce(new Error('boom'));
    actions.commit(emptyData('2026-09-30'));
    await actions.flush();
    expect(toast.value?.text).toMatch(/^Не удалось сохранить/);
  });
});

describe('actions.undo', () => {
  it('restores the previous data within 5 s and persists it', async () => {
    const first = emptyData('2026-09-30');
    actions.commit(first);
    const second = withOperation(first, 'Кафе');
    actions.commit(second, 'Операция добавлена');
    expect(actions.undo()).toBe(true);
    expect(data.value).toBe(first);
    await actions.flush();
    expect(await db.loadData()).toEqual(first);
    expect(toast.value?.undo).toBeUndefined();
  });

  it('keeps only one snapshot: a second undo does nothing', () => {
    const first = emptyData('2026-09-30');
    actions.commit(first);
    actions.commit(withOperation(first, 'A'), 'Добавлено');
    expect(actions.undo()).toBe(true);
    expect(actions.undo()).toBe(false);
    expect(data.value).toBe(first);
  });

  it('expires after 5 s', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const first = emptyData('2026-09-30');
    actions.commit(first);
    const second = withOperation(first, 'A');
    actions.commit(second, 'Добавлено');
    vi.setSystemTime(Date.now() + 5_001);
    expect(actions.undo()).toBe(false);
    expect(data.value).toBe(second);
  });

  it('a later commit without a message drops the snapshot, so undo never reverts the wrong change', () => {
    const first = emptyData('2026-09-30');
    actions.commit(first);
    const a = withOperation(first, 'A');
    actions.commit(a, 'Добавлено');
    const b = withOperation(a, 'B');
    actions.commit(b);
    expect(actions.undo()).toBe(false);
    expect(data.value).toBe(b);
  });
});

describe('actions.commit — a toast action', () => {
  it('offers the action next to «Отменить»; undo still works', () => {
    const first = emptyData('2026-09-30');
    actions.commit(first);
    const onClick = vi.fn();
    actions.commit(withOperation(first, 'A'), 'Сохранено', { action: { label: 'Показать', onClick } });
    expect(toast.value?.text).toBe('Сохранено');
    expect(toast.value?.action?.label).toBe('Показать');
    toast.value?.action?.onClick();
    expect(onClick).toHaveBeenCalledOnce();
    expect(typeof toast.value?.undo).toBe('function');
    expect(actions.undo()).toBe(true);
    expect(data.value).toBe(first);
  });
});

describe('actions.undo — the month of «Лента»', () => {
  /** A year of 12 months from `accountingStart`. */
  const year = (d: Data, accountingStart: string): Data => ({ ...d, settings: { ...d.settings, accountingStart } });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 15, 12, 0)); // 15 November 2026
    resetSession();
  });

  it('undoing a new accounting year brings back the month «Лента» showed (the change had clamped it away)', () => {
    const first = year(emptyData('2026-10-01'), '2026-10'); // October 2026 – September 2027
    actions.commit(first);
    feedMonth.value = '2027-03';
    actions.commit(year(first, '2027-04'), 'Учётный год изменён'); // April 2027 – March 2028: March 2027 is out
    expect(feedMonth.value).toBe('2027-04');
    expect(actions.undo()).toBe(true);
    expect(data.value).toBe(first);
    expect(feedMonth.value).toBe('2027-03');
  });

  it('undo brings the month back even when the new year does not contain it (restoring the data re-clamps it first)', () => {
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0)); // 6 October 2026: today is inside the old year only
    resetSession();
    const first = year(emptyData('2026-10-01'), '2026-10'); // October 2026 – September 2027
    actions.commit(first);
    feedMonth.value = '2026-11';
    actions.commit(year(first, '2027-10'), 'Учётный год изменён'); // October 2027 – September 2028
    expect(feedMonth.value).toBe('2027-10');
    expect(actions.undo()).toBe(true);
    expect(data.value).toBe(first);
    expect(feedMonth.value).toBe('2026-11');
  });

  it('a month the user chose after the change is left alone', () => {
    const first = year(emptyData('2026-10-01'), '2026-10');
    actions.commit(first);
    feedMonth.value = '2027-03';
    actions.commit(year(first, '2027-04'), 'Учётный год изменён');
    feedMonth.value = '2027-06';
    expect(actions.undo()).toBe(true);
    expect(feedMonth.value).toBe('2027-06'); // inside the old year too: kept
  });

  it('a change that did not move the month does not move it on undo', () => {
    const first = year(emptyData('2026-10-01'), '2026-10');
    actions.commit(first);
    feedMonth.value = '2027-03';
    actions.commit(withOperation(first, 'A'), 'Добавлено');
    feedMonth.value = '2027-05';
    expect(actions.undo()).toBe(true);
    expect(feedMonth.value).toBe('2027-05');
  });
});

describe('actions.commit — failed saves', () => {
  it('a failed save keeps «Отменить» while the undo snapshot exists', async () => {
    const first = emptyData('2026-09-30');
    actions.commit(first);
    await actions.flush();
    vi.mocked(db.saveData).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.'));
    const second = withOperation(first, 'Кафе');
    actions.commit(second, 'Операция добавлена');
    await actions.flush();
    expect(toast.value?.text).toBe('Не удалось сохранить данные.');
    expect(typeof toast.value?.undo).toBe('function');
    toast.value?.undo?.();
    expect(data.value).toBe(first);
    await actions.flush();
    expect(await db.loadData()).toEqual(first);
  });

  it('without a snapshot the failure toast has no «Отменить»', async () => {
    vi.mocked(db.saveData).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.'));
    actions.commit(emptyData('2026-09-30'));
    await actions.flush();
    expect(toast.value?.text).toBe('Не удалось сохранить данные.');
    expect(toast.value?.undo).toBeUndefined();
  });
});

describe('actions.replaceData', () => {
  it('persists first, then shows the new data', async () => {
    const next = emptyData('2026-09-30');
    await actions.replaceData(next);
    expect(data.value).toBe(next);
    expect(await db.loadData()).toEqual(next);
  });

  it('leaves the data unchanged when the save fails', async () => {
    const before = emptyData('2026-09-01');
    actions.commit(before);
    await actions.flush();
    vi.mocked(db.saveData).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.'));
    await expect(actions.replaceData(emptyData('2026-09-30'))).rejects.toThrow('Не удалось сохранить данные.');
    expect(data.value).toBe(before);
  });

  it('drops «Отменить» before saving, so an undo cannot slip in (memory and storage end equal)', async () => {
    const before = emptyData('2026-09-01');
    actions.commit(before);
    await actions.flush();
    actions.commit(withOperation(before, 'Кафе'), 'Операция добавлена');
    const imported = withOperation(emptyData('2026-10-01'), 'IMPORTED');
    const replacing = actions.replaceData(imported);
    expect(toast.value).toBeNull();
    expect(actions.undo()).toBe(false);
    await replacing;
    await actions.flush();
    expect(data.value).toBe(imported);
    expect(await db.loadData()).toEqual(imported);
  });

  it.each([
    ['while the new data is being written', false],
    ['while it waits behind another write', true],
  ])('a commit made %s wins in memory and in storage; replaceData rejects', async (_label, busy) => {
    const old = emptyData('2026-09-01');
    actions.commit(old);
    await actions.flush();
    if (busy) actions.commit(withOperation(old, 'X')); // a write in flight: the import waits behind it
    const imported = withOperation(emptyData('2026-10-01'), 'IMPORTED');
    const replacing = actions.replaceData(imported);
    const editOnOld = withOperation(old, 'EDIT');
    actions.commit(editOnOld);
    const error = await replacing.then(() => null, (e: unknown) => e);
    await actions.flush();
    expect(data.value).toBe(editOnOld);
    expect(await db.loadData()).toEqual(editOnOld);
    expect(error).toBeInstanceOf(Error);
    expect(ioErrorMessage(error)).toBe('Данные изменились, пока шло сохранение. Файл не загружен — попробуйте ещё раз.');
  });
});

describe('actions.updateMeta', () => {
  it('reads the latest meta: queued updates build on each other', async () => {
    const inc = (m: Meta): Meta => ({ ...m, failedAttempts: m.failedAttempts + 1 });
    await Promise.all([actions.updateMeta(inc), actions.updateMeta(inc), actions.updateMeta(inc)]);
    expect(meta.value.failedAttempts).toBe(3);
    expect((await db.loadMeta()).failedAttempts).toBe(3);
  });

  it.each(['lock first', 'backup first'])('a backup mark does not reset the failed-attempt counter written at the same time (%s)', async (order) => {
    const wrongPin = () => actions.updateMeta((m) => ({ ...m, failedAttempts: m.failedAttempts + 1 }));
    const both = order === 'lock first' ? [wrongPin(), actions.markBackupDone()] : [actions.markBackupDone(), wrongPin()];
    await Promise.all(both);
    expect(meta.value.failedAttempts).toBe(1);
    expect(meta.value.lastBackupAt).toBeDefined();
    expect(await db.loadMeta()).toEqual(meta.value);
  });

  it('a failed save rejects and leaves the meta as it was', async () => {
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.'));
    await expect(actions.updateMeta((m) => ({ ...m, failedAttempts: 9 }))).rejects.toThrow('Не удалось сохранить данные.');
    expect(meta.value.failedAttempts).toBe(0);
  });

  it('applyOnFailure: the change holds in memory even when it could not be saved (the PIN counter)', async () => {
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.'));
    await expect(actions.updateMeta((m) => ({ ...m, failedAttempts: 9 }), { applyOnFailure: true })).rejects.toThrow();
    expect(meta.value.failedAttempts).toBe(9);
  });

  it('flush waits for meta writes too', async () => {
    void actions.updateMeta((m) => ({ ...m, lastImportAt: '2026-09-30T10:00:00.000Z' }));
    await actions.flush();
    expect((await db.loadMeta()).lastImportAt).toBe('2026-09-30T10:00:00.000Z');
  });
});

describe('actions.updateMeta — the STORED meta, in one transaction (another tab may have changed it)', () => {
  const pinA: Meta = { pinHash: 'aGFzaEE=', pinSalt: 'c2FsdEE=', pinIterations: 150_000, failedAttempts: 0 };
  const pinB: Meta = { pinHash: 'aGFzaEI=', pinSalt: 'c2FsdEI=', pinIterations: 150_000, failedAttempts: 0 };

  it('fn gets the stored meta, not this tab’s copy; memory takes the written meta', async () => {
    meta.value = { ...pinA, lastBackupAt: 'memory' };
    await db.saveMeta({ ...pinA, failedAttempts: 3, lastBackupAt: 'stored', lastImportAt: 'stored' }); // another tab, same PIN
    const seen: Meta[] = [];
    const written = await actions.updateMeta((m) => {
      seen.push(m);
      return { ...m, lastImportAt: 'new' };
    });
    expect(seen).toEqual([{ ...pinA, failedAttempts: 3, lastBackupAt: 'stored', lastImportAt: 'stored' }]);
    const expected = { ...pinA, failedAttempts: 3, lastBackupAt: 'stored', lastImportAt: 'new' };
    expect(written).toEqual(expected);
    expect(await db.loadMeta()).toEqual(expected);
    expect(meta.value).toEqual(expected);
  });

  it('reads, changes and writes through ONE updateStoredMeta call; never saveMeta (the whole meta)', async () => {
    meta.value = pinA;
    await db.saveMeta(pinA);
    vi.mocked(db.saveMeta).mockClear();
    await actions.updateMeta((m) => ({ ...m, lastImportAt: 'x' }));
    await actions.markBackupDone();
    expect(db.updateStoredMeta).toHaveBeenCalledTimes(2);
    expect(db.saveMeta).not.toHaveBeenCalled();
  });

  it('the backup date after another tab changed the PIN: only the date is written, onto the stored PIN; memory keeps this tab’s PIN', async () => {
    meta.value = { ...pinA, failedAttempts: 2, lockedUntil: 1_790_000_000_000, lastBackupAt: 'old' };
    await db.saveMeta({ ...pinB, lastImportAt: 'theirs' }); // another tab changed the PIN
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    await actions.markBackupDone();
    expect(await db.loadMeta()).toEqual({ ...pinB, lastImportAt: 'theirs', lastBackupAt: '2026-09-30T10:00:00.000Z' });
    // this tab never takes the other PIN (nor its counter): the lock refuses it until a restart
    expect(meta.value).toEqual({
      ...pinA, failedAttempts: 2, lockedUntil: 1_790_000_000_000, lastImportAt: 'theirs', lastBackupAt: '2026-09-30T10:00:00.000Z',
    });
  });

  it('the backup date after another tab removed the PIN («Забыли PIN?»): no PIN is written back', async () => {
    meta.value = pinA;
    await actions.markBackupDone();
    const stored = await db.loadMeta();
    expect(stored.pinHash).toBeUndefined();
    expect(stored.lastBackupAt).toBeDefined();
    expect(meta.value.pinHash).toBe(pinA.pinHash);
  });

  it.each([
    ['the hash', { pinHash: 'eA==' }],
    ['the salt', { pinSalt: 'eA==' }],
    ['the iterations', { pinIterations: 1 }],
    ['the PIN removed', { pinHash: undefined, pinSalt: undefined, pinIterations: undefined }],
  ])('a writer that is not the PIN change may not change the PIN (%s): refused, nothing written, memory unchanged', async (_label, change) => {
    const mine: Meta = { ...pinA, lastBackupAt: 'memory' };
    meta.value = mine;
    await db.saveMeta(pinA);
    await expect(actions.updateMeta((m) => ({ ...m, ...change, lastImportAt: 'x' }))).rejects.toThrow();
    await expect(actions.updateMeta((m) => ({ ...m, ...change }), { applyOnFailure: true })).rejects.toThrow();
    expect(await db.loadMeta()).toEqual(pinA);
    expect(meta.value).toBe(mine);
  });

  it('the PIN change ({ pin: true }) writes the new PIN; this tab then unlocks with it', async () => {
    meta.value = pinA;
    await db.saveMeta({ ...pinA, lastBackupAt: 'stored' });
    await actions.updateMeta((m) => ({ ...m, pinHash: pinB.pinHash, pinSalt: pinB.pinSalt }), { pin: true });
    expect(await db.loadMeta()).toEqual({ ...pinB, lastBackupAt: 'stored' });
    expect(meta.value).toEqual({ ...pinB, lastBackupAt: 'stored' });
  });

  it('an error thrown by fn: nothing written, memory unchanged (also with applyOnFailure)', async () => {
    const mine: Meta = { ...pinA };
    meta.value = mine;
    await db.saveMeta(pinA);
    const boom = new Error('refused');
    await expect(actions.updateMeta(() => {
      throw boom;
    }, { applyOnFailure: true })).rejects.toBe(boom);
    expect(await db.loadMeta()).toEqual(pinA);
    expect(meta.value).toBe(mine);
  });

  it('applyOnFailure, when the write fails after fn ran on the stored meta: memory takes that result', async () => {
    meta.value = { ...pinA, failedAttempts: 1 };
    await db.saveMeta({ ...pinA, failedAttempts: 4, lastBackupAt: 'stored' });
    const real = vi.mocked(db.updateStoredMeta).getMockImplementation()!;
    vi.mocked(db.updateStoredMeta).mockImplementationOnce(async (fn) => {
      await real((m) => {
        fn(m); // fn runs on the stored meta…
        return null; // …nothing is written…
      });
      throw new db.StoreError('Не удалось сохранить данные.', { code: 'write' }); // …and the write fails
    });
    await expect(actions.updateMeta((m) => ({ ...m, failedAttempts: m.failedAttempts + 1 }), { applyOnFailure: true })).rejects.toThrow();
    expect(meta.value).toEqual({ ...pinA, failedAttempts: 5, lastBackupAt: 'stored' });
  });
});

describe('the data generation: a tab never saves over a data set another tab deleted or set up anew', () => {
  const pinA: Meta = { pinHash: 'aGFzaEE=', pinSalt: 'c2FsdEE=', pinIterations: 150_000, failedAttempts: 0, generation: 'g1' };
  const theirs: Meta = { pinHash: 'aGFzaEI=', pinSalt: 'c2FsdEI=', pinIterations: 150_000, failedAttempts: 0, generation: 'g2' };

  it('a commit saves while the stored generation is this tab’s', async () => {
    meta.value = pinA;
    await db.saveMeta(pinA);
    const next = emptyData('2026-09-30');
    actions.commit(next);
    await actions.flush();
    expect(await db.loadData()).toEqual(next);
    expect(stopped.value).toBe(false);
    expect(vi.mocked(db.saveData).mock.calls[0]?.[1]).toEqual({ generation: 'g1' });
  });

  it.each([
    ['wiped and set up anew in another tab', theirs],
    ['wiped in another tab', undefined],
  ])('a commit after the data were %s: nothing is saved, the tab stops, no «Не удалось сохранить» toast', async (_label, stored) => {
    meta.value = pinA;
    const theirData = emptyData('2026-01-01');
    if (stored) {
      await db.saveMeta(stored);
      await db.saveData(theirData);
    }
    vi.mocked(db.saveData).mockClear();
    actions.commit(withOperation(emptyData('2026-09-30'), 'MINE'));
    await actions.flush();
    expect(await db.loadData()).toEqual(stored ? theirData : null);
    expect(stopped.value).toBe(true);
    expect(toast.value?.text ?? '').not.toMatch(/Не удалось сохранить/);
  });

  it('replaceData after the data were set up anew in another tab: rejects (StaleTabError), nothing saved, the tab stops', async () => {
    meta.value = pinA;
    await db.saveMeta(theirs);
    const e = await actions.replaceData(emptyData('2026-09-30')).then(() => null, (err: unknown) => err);
    expect(e).toBeInstanceOf(db.StaleTabError);
    expect(await db.loadData()).toBeNull();
    expect(stopped.value).toBe(true);
  });

  it('a meta write after the data were set up anew in another tab: nothing written, rejects (StaleTabError), the tab stops', async () => {
    const mine = pinA;
    meta.value = mine;
    await db.saveMeta(theirs);
    await actions.markBackupDone();
    await expect(actions.updateMeta((m) => ({ ...m, failedAttempts: 5 }), { applyOnFailure: true })).rejects.toBeInstanceOf(db.StaleTabError);
    expect(await db.loadMeta()).toEqual(theirs);
    expect(meta.value).toBe(mine);
    expect(stopped.value).toBe(true);
  });

  it('a writer that is not the PIN change may not change the generation: refused, nothing written', async () => {
    meta.value = pinA;
    await db.saveMeta(pinA);
    await expect(actions.updateMeta((m) => ({ ...m, generation: 'other' }))).rejects.toThrow();
    const { generation: _g, ...withoutGeneration } = pinA;
    await expect(actions.updateMeta(() => withoutGeneration)).rejects.toThrow();
    expect(await db.loadMeta()).toEqual(pinA);
  });

  it('a stopped tab writes nothing at all: commit, replaceData, updateMeta', async () => {
    meta.value = pinA;
    await db.saveMeta(pinA);
    stopped.value = true;
    vi.mocked(db.saveData).mockClear();
    vi.mocked(db.updateStoredMeta).mockClear();
    actions.commit(emptyData('2026-09-30'));
    await expect(actions.replaceData(emptyData('2026-09-30'))).rejects.toBeInstanceOf(db.StaleTabError);
    await expect(actions.updateMeta((m) => ({ ...m, lastBackupAt: 'x' }))).rejects.toBeInstanceOf(db.StaleTabError);
    await actions.flush();
    expect(db.saveData).not.toHaveBeenCalled();
    expect(db.updateStoredMeta).not.toHaveBeenCalled();
    expect(await db.loadData()).toBeNull();
    expect(await db.loadMeta()).toEqual(pinA);
  });
});

describe('a generation the start could not store (generationPending): the next meta write that succeeds stores it', () => {
  const pinA: Meta = { pinHash: 'aGFzaEE=', pinSalt: 'c2FsdEE=', pinIterations: 150_000, failedAttempts: 0, lastImportAt: 'i' };
  const pinB: Meta = { pinHash: 'aGFzaEI=', pinSalt: 'c2FsdEI=', pinIterations: 150_000, failedAttempts: 2 };

  function startedWithout(stored: Meta = pinA): Promise<void> {
    meta.value = pinA; // what the start loaded: no generation, like storage
    setGenerationPending(true);
    return db.saveMeta(stored);
  }

  it('a date writer stores it with its own field; memory takes it; it is stored once', async () => {
    await startedWithout();
    await actions.markBackupDone();
    const stored = await db.loadMeta();
    expect(stored.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(stored).toEqual({ ...pinA, lastBackupAt: stored.lastBackupAt, generation: stored.generation });
    expect(meta.value).toEqual(stored);
    expect(generationPending()).toBe(false);
    await actions.updateMeta((m) => ({ ...m, lastImportAt: 'later' }));
    expect(await db.loadMeta()).toEqual({ ...stored, lastImportAt: 'later' });
  });

  it('the PIN change stores it too', async () => {
    await startedWithout();
    await actions.updateMeta((m) => ({ ...m, pinHash: 'bmV3', pinSalt: 'c2FsdE4=' }), { pin: true });
    const stored = await db.loadMeta();
    expect(stored).toEqual({ ...pinA, pinHash: 'bmV3', pinSalt: 'c2FsdE4=', generation: stored.generation });
    expect(stored.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(meta.value).toEqual(stored);
  });

  it('a write that fails: memory keeps its change (applyOnFailure) but no generation — storage has none; still pending', async () => {
    await startedWithout();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    await expect(actions.updateMeta((m) => ({ ...m, failedAttempts: 3 }), { applyOnFailure: true })).rejects.toThrow();
    put.mockRestore();
    expect(meta.value).toEqual({ ...pinA, failedAttempts: 3 });
    expect(await db.loadMeta()).toEqual(pinA);
    expect(generationPending()).toBe(true);
    await actions.markBackupDone(); // space again
    expect((await db.loadMeta()).generation).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never onto another tab’s PIN: its date is written, no generation; still pending', async () => {
    await startedWithout(pinB);
    await actions.markBackupDone();
    const stored = await db.loadMeta();
    expect(stored).toEqual({ ...pinB, lastBackupAt: stored.lastBackupAt });
    expect(generationPending()).toBe(true);
    expect(meta.value.pinHash).toBe(pinA.pinHash);
    expect(meta.value.generation).toBeUndefined();
  });

  it('a refused write (fn throws) stores nothing', async () => {
    await startedWithout();
    await expect(actions.updateMeta(() => {
      throw new Error('no');
    })).rejects.toThrow('no');
    expect(await db.loadMeta()).toEqual(pinA);
    expect(generationPending()).toBe(true);
  });

  it('not pending (the start stored or found one): nothing is added', async () => {
    meta.value = pinA;
    await db.saveMeta(pinA);
    await actions.markBackupDone();
    expect((await db.loadMeta()).generation).toBeUndefined();
  });

  it('resetSession clears it', () => {
    setGenerationPending(true);
    resetSession();
    expect(generationPending()).toBe(false);
  });
});

describe('actions.markBackupDone', () => {
  it('stores the backup time in meta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
    await actions.markBackupDone();
    expect(meta.value.lastBackupAt).toBe('2026-09-30T10:00:00.000Z');
    expect((await db.loadMeta()).lastBackupAt).toBe('2026-09-30T10:00:00.000Z');
  });

  it('a failed save shows why in a toast', async () => {
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(
      new db.StoreError('Не удалось сохранить данные: на устройстве закончилось место.', { code: 'quota' }),
    );
    await actions.markBackupDone();
    expect(toast.value?.text).toBe('Не удалось сохранить данные: на устройстве закончилось место.');
  });

  it.each([
    ['after another tab set up new data', false],
    ['in a tab that has stopped already', true],
  ])('%s: nothing written, no «Не удалось сохранить» toast (the stop screen says why)', async (_label, stoppedBefore) => {
    const mine: Meta = { pinHash: 'aGFzaEE=', pinSalt: 'c2FsdEE=', pinIterations: 150_000, failedAttempts: 0, generation: 'g1' };
    const theirs: Meta = { pinHash: 'aGFzaEI=', pinSalt: 'c2FsdEI=', pinIterations: 150_000, failedAttempts: 0, generation: 'g2' };
    meta.value = mine;
    await db.saveMeta(theirs);
    stopped.value = stoppedBefore;
    await actions.markBackupDone();
    expect(await db.loadMeta()).toEqual(theirs);
    expect(stopped.value).toBe(true);
    expect(toast.value).toBeNull();
  });
});

describe('needsBackup', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const withRows = withOperation(emptyData('2026-09-01'), 'Кафе');
  const noPin: Meta = { failedAttempts: 0 };

  it('false without data or without any rows', () => {
    expect(needsBackup(noPin, null, now)).toBe(false);
    expect(needsBackup(noPin, emptyData('2026-09-01'), now)).toBe(false);
  });

  it('true when there are rows and no backup yet', () => {
    expect(needsBackup(noPin, withRows, now)).toBe(true);
  });

  it('counts journal, recurring, purchases, debts and non-zero balances as rows', () => {
    const e = emptyData('2026-09-01');
    const acc = e.accounts[0]!;
    expect(needsBackup(noPin, { ...e, journal: [{ id: 'j', date: '2026-09-02', kind: 'expense', what: 'x' }] }, now)).toBe(true);
    expect(needsBackup(noPin, { ...e, recurring: [{ id: 'r', what: 'x', kind: 'expense', amount: 1, marks: {} }] }, now)).toBe(true);
    expect(needsBackup(noPin, { ...e, purchases: [{ id: 'p', what: 'x', bought: false }] }, now)).toBe(true);
    expect(needsBackup(noPin, { ...e, debts: [{ id: 'd', name: 'x' }] }, now)).toBe(true);
    expect(needsBackup(noPin, { ...e, accounts: [{ ...acc, start: 100 }] }, now)).toBe(true);
  });

  it('false within 14 days of the last backup, true after', () => {
    const at = (ms: number): Meta => ({ failedAttempts: 0, lastBackupAt: new Date(now.getTime() - ms).toISOString() });
    expect(needsBackup(at(13 * DAY), withRows, now)).toBe(false);
    expect(needsBackup(at(14 * DAY), withRows, now)).toBe(false);
    expect(needsBackup(at(14 * DAY + 1), withRows, now)).toBe(true);
  });

  it('true when the stored backup time cannot be read', () => {
    expect(needsBackup({ failedAttempts: 0, lastBackupAt: 'вчера' }, withRows, now)).toBe(true);
  });

  it('accepts epoch milliseconds for now', () => {
    expect(needsBackup(noPin, withRows, now.getTime())).toBe(true);
  });
});

describe('accountName', () => {
  it('names an account by id; unknown ids and no id are marked', () => {
    const d = emptyData('2026-09-01');
    const acc = d.accounts[0]!;
    expect(accountName(d, acc.id)).toBe(acc.name);
    expect(accountName(d, 'gone')).toBe('(удалённый счёт)');
    expect(accountName(d, undefined)).toBe('');
    expect(accountName(null, acc.id)).toBe('');
  });
});
