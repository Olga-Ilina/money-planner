import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  StaleTabError, StoreError, loadData, loadMeta, loadMetaAtStart, migrate, newGeneration, requestPersistence, saveData,
  saveMeta, updateStoredMeta, useFactory, wipeAll,
} from '../../src/store/db';
import type { Meta } from '../../src/store/db';
import { SCHEMA_VERSION, emptyData } from '../../src/engine/model';
import { scenario } from '../engine/scenario';

const NEWER = 'Данные сохранены более новой версией приложения. Обновите приложение.';
const META_DAMAGED = 'Сохранённые настройки PIN повреждены. Если не получается войти, используйте «Забыли PIN?».';

let factory: IDBFactory;

beforeEach(() => {
  factory = new IDBFactory();
  useFactory(factory);
});

afterEach(() => {
  useFactory(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Opens the app database directly, as another tab or a newer app version would. */
function openRaw(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? factory.open('money-planner') : factory.open('money-planner', version);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked by an open connection'));
  });
}

function thrown(f: () => unknown): StoreError {
  try {
    f();
  } catch (e) {
    return e as StoreError;
  }
  throw new Error('expected a throw');
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected the promise to reject');
}

describe('data', () => {
  it('is null when nothing is stored', async () => {
    expect(await loadData()).toBeNull();
  });

  it('round-trips the scenario', async () => {
    await saveData(scenario());
    expect(await loadData()).toEqual(scenario());
  });

  it('round-trips a fresh data set', async () => {
    const data = emptyData('2026-09-30');
    await saveData(data);
    expect(await loadData()).toEqual(data);
  });

  it('replaces the previous document', async () => {
    await saveData(scenario());
    const next = scenario();
    next.operations = [];
    next.settings.cushion = 7;
    await saveData(next);
    expect(await loadData()).toEqual(next);
  });

  it('keeps the document in the kv store of database money-planner, version 1', async () => {
    await saveData(scenario());
    const db = await openRaw();
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames]).toEqual(['kv']);
    const stored = await new Promise((resolve, reject) => {
      const req = db.transaction('kv').objectStore('kv').get('data');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    expect(stored).toEqual(scenario());
  });

  it('refuses data saved by a newer app version', async () => {
    await saveData({ ...scenario(), schemaVersion: SCHEMA_VERSION + 1 });
    const e = await rejection(loadData());
    expect(e).toBeInstanceOf(StoreError);
    expect((e as Error).message).toBe(NEWER);
    expect((e as StoreError).code).toBe('newer-version');
  });

  it('refuses a database that a newer app version upgraded', async () => {
    (await openRaw(2)).close();
    const e = await rejection(loadData());
    expect(e).toBeInstanceOf(StoreError);
    expect((e as Error).message).toBe(NEWER);
    expect((e as StoreError).code).toBe('newer-version');
  });

  it('closes its connections so another tab can upgrade the database', async () => {
    await saveData(scenario());
    await loadData();
    await saveMeta({ failedAttempts: 1 });
    await loadMeta();
    await wipeAll();
    const db = await openRaw(2);
    expect(db.version).toBe(2);
    db.close();
  });
});

const storeCalls: [string, () => Promise<unknown>][] = [
  ['saveData', () => saveData(scenario())],
  ['loadData', () => loadData()],
  ['saveMeta', () => saveMeta({ failedAttempts: 1 })],
  ['loadMeta', () => loadMeta()],
  ['wipeAll', () => wipeAll()],
  ['updateStoredMeta', () => updateStoredMeta((m) => ({ ...m, failedAttempts: 1 }))],
  ['loadMetaAtStart', () => loadMetaAtStart()],
  ['saveData with the generation check', () => saveData(scenario(), { generation: undefined })],
];

describe('connections', () => {
  // Two separate close paths: every call closes its own connection when done (finally), and a
  // connection that is still open closes itself when another tab upgrades (versionchange).
  it.each(storeCalls)('%s closes its connection exactly once', async (_name, call) => {
    const close = vi.spyOn(IDBDatabase.prototype, 'close');
    await call();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes its connection once when the write fails', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const close = vi.spyOn(IDBDatabase.prototype, 'close');
    await expect(saveData(scenario())).rejects.toBeInstanceOf(StoreError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(storeCalls)('a connection that %s left open gives way when another tab upgrades', async (_name, call) => {
    const realClose = IDBDatabase.prototype.close;
    let phase: 'call' | 'upgrade' | 'done' = 'call';
    const closedByUpgrade: IDBDatabase[] = [];
    vi.spyOn(IDBDatabase.prototype, 'close').mockImplementation(function (this: IDBDatabase) {
      if (phase === 'call') return; // the call's own close is suppressed: its connection stays open
      if (phase === 'upgrade') closedByUpgrade.push(this);
      realClose.call(this);
    });
    await call();
    phase = 'upgrade';
    const db = await openRaw(2); // blocked (rejects) unless the open connection handles versionchange
    phase = 'done';
    expect(db.version).toBe(2);
    expect(closedByUpgrade).toHaveLength(1);
    expect(closedByUpgrade[0]).not.toBe(db);
    db.close();
  });
});

describe('durability', () => {
  it.each([
    ['saveData', () => saveData(scenario())],
    ['saveMeta', () => saveMeta({ failedAttempts: 1 })],
    ['wipeAll', () => wipeAll()],
    ['updateStoredMeta', () => updateStoredMeta((m) => ({ ...m, failedAttempts: 1 }))],
    ['saveData with the generation check', () => saveData(scenario(), { generation: undefined })],
  ])('%s writes in a strict-durability transaction', async (_name, call) => {
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
    await call();
    const writes = transaction.mock.calls.filter((args) => args[1] === 'readwrite');
    expect(writes).toEqual([['kv', 'readwrite', { durability: 'strict' }]]);
  });
});

describe('meta', () => {
  it('defaults to no PIN and no failed attempts', async () => {
    expect(await loadMeta()).toEqual({ failedAttempts: 0 });
  });

  it('round-trips', async () => {
    const meta: Meta = {
      pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==', pinIterations: 150_000, failedAttempts: 3,
      lockedUntil: 1_790_000_000_000, lastBackupAt: '2026-09-30T10:00:00.000Z', lastImportAt: '2026-09-29T09:00:00.000Z',
    };
    await saveMeta(meta);
    expect(await loadMeta()).toEqual(meta);
  });

  it('is stored apart from the data', async () => {
    await saveData(scenario());
    await saveMeta({ failedAttempts: 2 });
    expect(await loadData()).toEqual(scenario());
    expect(await loadMeta()).toEqual({ failedAttempts: 2 });
  });

  it('reads a damaged failed-attempts counter as zero', async () => {
    await saveMeta({ pinHash: 'aGFzaA==', failedAttempts: Number.NaN });
    expect(await loadMeta()).toEqual({ pinHash: 'aGFzaA==', failedAttempts: 0 });
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a string', '1790000000000'],
    ['null', null],
  ])('drops a pause end that is %s', async (_label, lockedUntil) => {
    await saveMeta({ pinHash: 'aGFzaA==', failedAttempts: 5, lockedUntil } as unknown as Meta);
    const meta = await loadMeta();
    expect(meta).toEqual({ pinHash: 'aGFzaA==', failedAttempts: 5 });
    expect('lockedUntil' in meta).toBe(false);
  });

  it('keeps the pinIterations it finds, even a damaged one, for checkPin to refuse', async () => {
    await saveMeta({ pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==', pinIterations: -1, failedAttempts: 0 });
    expect((await loadMeta()).pinIterations).toBe(-1);
  });

  it.each([
    ['null', null],
    ['a string', 'meta'],
    ['a number', 5],
    ['a boolean', true],
    ['an array', [{ failedAttempts: 0 }]],
  ])('refuses a stored meta that is %s instead of reading it as «no PIN»', async (_label, raw) => {
    await saveMeta(raw as unknown as Meta);
    const e = await rejection(loadMeta());
    expect(e).toBeInstanceOf(StoreError);
    expect((e as Error).message).toBe(META_DAMAGED);
    expect((e as StoreError).code).toBe('meta-damaged');
  });
});

describe('updateStoredMeta (read, change and write the meta in ONE transaction)', () => {
  const pinMeta: Meta = { pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==', pinIterations: 150_000, failedAttempts: 2 };

  it('gives fn the STORED meta and writes what it returns; resolves with the written meta', async () => {
    await saveMeta({ ...pinMeta, lastBackupAt: '2026-09-01T00:00:00.000Z' });
    const seen: Meta[] = [];
    const written = await updateStoredMeta((m) => {
      seen.push(m);
      return { ...m, lastImportAt: '2026-09-30T10:00:00.000Z' };
    });
    expect(seen).toEqual([{ ...pinMeta, lastBackupAt: '2026-09-01T00:00:00.000Z' }]);
    const expected = { ...pinMeta, lastBackupAt: '2026-09-01T00:00:00.000Z', lastImportAt: '2026-09-30T10:00:00.000Z' };
    expect(written).toEqual(expected);
    expect(await loadMeta()).toEqual(expected);
  });

  it('gives fn the stored meta as loadMeta reads it: the defaults when nothing is stored, a damaged counter as 0', async () => {
    const seen: Meta[] = [];
    await updateStoredMeta((m) => {
      seen.push(m);
      return null;
    });
    await saveMeta({ ...pinMeta, failedAttempts: Number.NaN, lockedUntil: Number.NaN });
    await updateStoredMeta((m) => {
      seen.push(m);
      return null;
    });
    expect(seen).toEqual([{ failedAttempts: 0 }, { ...pinMeta, failedAttempts: 0 }]);
  });

  it('null writes nothing and resolves with the stored meta (nothing stored stays nothing stored)', async () => {
    expect(await updateStoredMeta(() => null)).toEqual({ failedAttempts: 0 });
    const raw = await openRaw();
    const keys = await new Promise((resolve, reject) => {
      const req = raw.transaction('kv').objectStore('kv').getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    raw.close();
    expect(keys).toEqual([]);
    await saveMeta(pinMeta);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    expect(await updateStoredMeta(() => null)).toEqual(pinMeta);
    expect(put).not.toHaveBeenCalled();
  });

  it('two updates at the same time: both are applied, none is lost', async () => {
    await saveMeta(pinMeta);
    await Promise.all([
      updateStoredMeta((m) => ({ ...m, lastBackupAt: 'backup' })),
      updateStoredMeta((m) => ({ ...m, lastImportAt: 'import' })),
    ]);
    expect(await loadMeta()).toEqual({ ...pinMeta, lastBackupAt: 'backup', lastImportAt: 'import' });
  });

  it('ten counters at the same time (e.g. ten tabs): every one counts', async () => {
    await saveMeta({ ...pinMeta, failedAttempts: 0 });
    await Promise.all(Array.from({ length: 10 }, () => updateStoredMeta((m) => ({ ...m, failedAttempts: m.failedAttempts + 1 }))));
    expect((await loadMeta()).failedAttempts).toBe(10);
  });

  it('reads and writes in one readwrite transaction (no other transaction in between)', async () => {
    await saveMeta(pinMeta);
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
    await updateStoredMeta((m) => ({ ...m, failedAttempts: 3 }));
    expect(transaction.mock.calls).toEqual([['kv', 'readwrite', { durability: 'strict' }]]);
  });

  it('an error thrown by fn rejects with that very error and writes nothing', async () => {
    await saveMeta(pinMeta);
    const mine = new Error('not this PIN');
    const e = await rejection(updateStoredMeta(() => {
      throw mine;
    }));
    expect(e).toBe(mine);
    expect(await loadMeta()).toEqual(pinMeta);
  });

  it.each([
    ['null', null],
    ['a string', 'meta'],
    ['an array', [{ failedAttempts: 0 }]],
  ])('a stored meta that is %s: rejects (meta-damaged), fn is not called, nothing is written over it', async (_label, raw) => {
    await saveMeta(raw as unknown as Meta);
    const fn = vi.fn((m: Meta) => ({ ...m, lastBackupAt: 'x' }));
    const e = await rejection(updateStoredMeta(fn));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).code).toBe('meta-damaged');
    expect((e as Error).message).toBe(META_DAMAGED);
    expect(fn).not.toHaveBeenCalled();
    expect(await rejection(loadMeta())).toBeInstanceOf(StoreError); // still the damaged value
  });

  it('a write that fails for lack of space: StoreError quota, nothing written', async () => {
    await saveMeta(pinMeta);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const e = await rejection(updateStoredMeta((m) => ({ ...m, failedAttempts: 5 })));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).code).toBe('quota');
    vi.restoreAllMocks();
    expect(await loadMeta()).toEqual(pinMeta);
  });

  it('a value that cannot be stored: StoreError write, nothing written', async () => {
    await saveMeta(pinMeta);
    const e = await rejection(updateStoredMeta((m) => ({ ...m, extra: () => 1 }) as unknown as Meta));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).code).toBe('write');
    expect((e as Error).message).toBe('Не удалось сохранить данные.');
    expect(await loadMeta()).toEqual(pinMeta);
  });

  it('an aborted transaction: StoreError write, nothing written', async () => {
    await saveMeta(pinMeta);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const req = put.call(this, value, key);
      this.transaction.abort();
      return req;
    });
    const e = await rejection(updateStoredMeta((m) => ({ ...m, failedAttempts: 5 })));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).code).toBe('write');
    vi.restoreAllMocks();
    expect(await loadMeta()).toEqual(pinMeta);
  });

  it('a stored meta that cannot be read: StoreError read, fn is not called', async () => {
    await saveMeta(pinMeta);
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new DOMException('gone', 'UnknownError');
    });
    const fn = vi.fn((m: Meta) => m);
    const e = await rejection(updateStoredMeta(fn));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).code).toBe('read');
    expect((e as Error).message).toBe('Не удалось прочитать сохранённые данные.');
    expect(fn).not.toHaveBeenCalled();
  });

  it('a database that cannot be opened: StoreError write; no IndexedDB: unavailable', async () => {
    useFactory({
      open() {
        const req: { error?: DOMException; onerror?: () => void } = {};
        setTimeout(() => {
          req.error = new DOMException('closed', 'UnknownError');
          req.onerror?.();
        }, 0);
        return req;
      },
    } as unknown as IDBFactory);
    const e = await rejection(updateStoredMeta((m) => m));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).code).toBe('write');
    useFactory(undefined);
    vi.stubGlobal('indexedDB', undefined);
    expect(((await rejection(updateStoredMeta((m) => m))) as StoreError).code).toBe('unavailable');
  });

  it('a database a newer app version upgraded: newer-version', async () => {
    (await openRaw(2)).close();
    expect(((await rejection(updateStoredMeta((m) => m))) as StoreError).code).toBe('newer-version');
  });
});

describe('generation (which data set the meta and the data belong to)', () => {
  const pinMeta: Meta = { pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==', pinIterations: 150_000, failedAttempts: 1 };
  const STALE = 'Данные изменились в другой вкладке. Перезапустите приложение.';

  function metaPuts(put: { mock: { calls: unknown[][] } }): unknown[] {
    return put.mock.calls.filter((args) => args[1] === 'meta').map((args) => args[0]);
  }

  it('newGeneration: a random id, a new one every time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newGeneration()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('round-trips with the meta', async () => {
    await saveMeta({ ...pinMeta, generation: 'g1' });
    expect(await loadMeta()).toEqual({ ...pinMeta, generation: 'g1' });
  });

  it('loadMetaAtStart: nothing stored → the defaults, and nothing is written (onboarding sets the generation)', async () => {
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    expect(await loadMetaAtStart()).toEqual({ failedAttempts: 0 });
    expect(put).not.toHaveBeenCalled();
    expect(await loadMeta()).toEqual({ failedAttempts: 0 });
  });

  it('loadMetaAtStart: a meta stored before generations existed gets one now, stored once', async () => {
    await saveMeta(pinMeta);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const first = await loadMetaAtStart();
    expect(first.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(first).toEqual({ ...pinMeta, generation: first.generation });
    expect(await loadMeta()).toEqual(first);
    expect(metaPuts(put)).toEqual([{ ...pinMeta, generation: first.generation }]);
    // the next start finds it: the same generation, nothing written again
    expect(await loadMetaAtStart()).toEqual(first);
    expect(metaPuts(put)).toHaveLength(1);
  });

  it('loadMetaAtStart: only the generation is added (a damaged counter stays as it was stored)', async () => {
    await saveMeta({ ...pinMeta, failedAttempts: Number.NaN, lastBackupAt: 'b' });
    const m = await loadMetaAtStart();
    const raw = await openRaw();
    const stored = await new Promise((resolve, reject) => {
      const req = raw.transaction('kv').objectStore('kv').get('meta');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    raw.close();
    expect(stored).toEqual({ ...pinMeta, failedAttempts: Number.NaN, lastBackupAt: 'b', generation: m.generation });
    expect(m).toEqual({ ...pinMeta, failedAttempts: 0, lastBackupAt: 'b', generation: m.generation });
  });

  it('loadMetaAtStart: two tabs starting at the same time with an old meta agree on ONE generation', async () => {
    await saveMeta(pinMeta);
    const [a, b] = await Promise.all([loadMetaAtStart(), loadMetaAtStart()]);
    expect(a.generation).toBeDefined();
    expect(b.generation).toBe(a.generation);
    expect((await loadMeta()).generation).toBe(a.generation);
  });

  it('loadMetaAtStart: a stored generation is kept, nothing written', async () => {
    await saveMeta({ ...pinMeta, generation: 'g1' });
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    expect(await loadMetaAtStart()).toEqual({ ...pinMeta, generation: 'g1' });
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty string', ''],
    ['a number', 7],
    ['null', null],
  ])('loadMetaAtStart: a generation that is %s counts as none: a new one is stored', async (_label, generation) => {
    await saveMeta({ ...pinMeta, generation } as unknown as Meta);
    const m = await loadMetaAtStart();
    expect(m.generation).toMatch(/^[0-9a-f]{32}$/);
    expect((await loadMeta()).generation).toBe(m.generation);
  });

  it('loadMetaAtStart: a damaged meta rejects (meta-damaged) and is not written over', async () => {
    await saveMeta('meta' as unknown as Meta);
    const e = await rejection(loadMetaAtStart());
    expect((e as StoreError).code).toBe('meta-damaged');
    expect(await rejection(loadMeta())).toBeInstanceOf(StoreError);
  });

  it('loadMetaAtStart: the new generation cannot be stored (no space): the stored meta as read — no generation, like storage; the next start stores one', async () => {
    const old = { ...pinMeta, lastBackupAt: 'b' };
    await saveMeta(old);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(await loadMetaAtStart()).toEqual(old);
    put.mockRestore();
    expect(await loadMeta()).toEqual(old); // nothing written
    const next = await loadMetaAtStart(); // space again
    expect(next.generation).toMatch(/^[0-9a-f]{32}$/);
    expect(await loadMeta()).toEqual(next);
  });

  it('loadMetaAtStart: the same when the space runs out only at commit (the transaction aborts after the put)', async () => {
    await saveMeta(pinMeta);
    const realPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const req = realPut.call(this, value, key);
      this.transaction.abort();
      return req;
    });
    expect(await loadMetaAtStart()).toEqual(pinMeta);
    put.mockRestore();
    expect(await loadMeta()).toEqual(pinMeta);
  });

  it('loadMetaAtStart: an unusable generation that cannot be replaced is returned as stored (memory and storage stay the same)', async () => {
    await saveMeta({ ...pinMeta, generation: '' });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(await loadMetaAtStart()).toEqual({ ...pinMeta, generation: '' });
  });

  it('loadMetaAtStart: a stored meta that cannot be read still rejects (read); a newer database still rejects (newer-version)', async () => {
    await saveMeta(pinMeta);
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new DOMException('gone', 'UnknownError');
    });
    expect(((await rejection(loadMetaAtStart())) as StoreError).code).toBe('read');
    vi.restoreAllMocks();
    (await openRaw(2)).close();
    expect(((await rejection(loadMetaAtStart())) as StoreError).code).toBe('newer-version');
  });

  it('wipeAll clears it', async () => {
    await saveMeta({ ...pinMeta, generation: 'g1' });
    await wipeAll();
    expect((await loadMeta()).generation).toBeUndefined();
  });

  it('saveData with the generation check: written while the stored generation is this tab’s (none stored and none here counts)', async () => {
    await saveData(scenario(), { generation: undefined });
    expect(await loadData()).toEqual(scenario());
    await saveMeta({ ...pinMeta, generation: 'g1' });
    const next = { ...scenario(), operations: [] };
    await saveData(next, { generation: 'g1' });
    expect(await loadData()).toEqual(next);
  });

  it.each([
    ['another generation stored (wiped and set up anew in another tab)', { ...pinMeta, generation: 'g2' }, 'g1'],
    ['nothing stored (wiped in another tab)', undefined, 'g1'],
    ['a generation stored while this tab has none', { ...pinMeta, generation: 'g2' }, undefined],
    ['an old meta without one while this tab has one', pinMeta, 'g1'],
  ])('saveData with the generation check refuses when %s: StaleTabError, nothing written', async (_label, stored, mine) => {
    const theirs = emptyData('2026-01-01');
    if (stored) {
      await saveMeta(stored);
      await saveData(theirs);
    }
    const e = await rejection(saveData(scenario(), { generation: mine }));
    expect(e).toBeInstanceOf(StaleTabError);
    expect(e).toBeInstanceOf(StoreError);
    expect((e as StoreError).code).toBe('stale');
    expect((e as Error).message).toBe(STALE);
    expect(await loadData()).toEqual(stored ? theirs : null);
  });

  it('saveData with the generation check reads the meta and writes the data in ONE transaction', async () => {
    await saveMeta({ ...pinMeta, generation: 'g1' });
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
    await saveData(scenario(), { generation: 'g1' });
    expect(transaction.mock.calls).toEqual([['kv', 'readwrite', { durability: 'strict' }]]);
  });

  it('saveData with the generation check: a damaged meta refuses the write (meta-damaged)', async () => {
    await saveMeta(5 as unknown as Meta);
    const e = await rejection(saveData(scenario(), { generation: undefined }));
    expect((e as StoreError).code).toBe('meta-damaged');
    expect(await loadData()).toBeNull();
  });
});

describe('wipeAll', () => {
  it('deletes the data and the meta', async () => {
    await saveData(scenario());
    await saveMeta({ pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==', pinIterations: 150_000, failedAttempts: 4 });
    await wipeAll();
    expect(await loadData()).toBeNull();
    expect(await loadMeta()).toEqual({ failedAttempts: 0 });
  });

  it('works on an empty database', async () => {
    await wipeAll();
    expect(await loadData()).toBeNull();
  });
});

describe('failures', () => {
  it('rejects with StoreError when the database cannot be opened', async () => {
    useFactory({
      open() {
        const req: { error?: DOMException; onerror?: () => void } = {};
        setTimeout(() => {
          req.error = new DOMException('closed', 'UnknownError');
          req.onerror?.();
        }, 0);
        return req;
      },
    } as unknown as IDBFactory);
    const e = await rejection(saveData(scenario()));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as Error).message).toMatch(/Не удалось сохранить данные/);
    expect((e as StoreError).code).toBe('write');
  });

  it('a database that cannot be opened for reading or wiping has its own codes', async () => {
    useFactory({
      open() {
        const req: { error?: DOMException; onerror?: () => void } = {};
        setTimeout(() => {
          req.error = new DOMException('closed', 'UnknownError');
          req.onerror?.();
        }, 0);
        return req;
      },
    } as unknown as IDBFactory);
    for (const [call, code, message] of [
      [loadData, 'read', 'Не удалось прочитать сохранённые данные.'],
      [loadMeta, 'read', 'Не удалось прочитать сохранённые данные.'],
      [wipeAll, 'wipe', 'Не удалось удалить данные.'],
    ] as const) {
      const e = await rejection(call());
      expect(e).toBeInstanceOf(StoreError);
      expect((e as StoreError).code).toBe(code);
      expect((e as Error).message).toBe(message);
    }
  });

  it('rejects with StoreError when the commit fails for lack of space', async () => {
    // browsers may report the quota only at commit time: the put request succeeds, then the transaction aborts
    const quota = new DOMException('quota', 'QuotaExceededError');
    const tx: { error: DOMException | null; onabort?: () => void; oncomplete?: () => void; objectStore(): unknown } = {
      error: null,
      objectStore: () => ({
        put: () => {
          const req: { result?: unknown; onsuccess?: () => void } = {};
          setTimeout(() => {
            req.result = 'data';
            req.onsuccess?.();
            tx.error = quota;
            tx.onabort?.();
          }, 0);
          return req;
        },
      }),
    };
    const db = { transaction: () => tx, close: vi.fn(), onversionchange: null };
    useFactory({
      open() {
        const req: { result?: unknown; onsuccess?: () => void } = {};
        setTimeout(() => {
          req.result = db;
          req.onsuccess?.();
        }, 0);
        return req;
      },
    } as unknown as IDBFactory);
    const e = await rejection(saveData(scenario()));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as Error).message).toMatch(/закончилось место/);
    expect((e as StoreError).code).toBe('quota');
    expect((e as Error).cause).toBe(quota);
    expect(db.close).toHaveBeenCalled();
  });

  it('rejects with StoreError when the write throws', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const e = await rejection(saveData(scenario()));
    expect(e).toBeInstanceOf(StoreError);
    expect((e as Error).message).toMatch(/закончилось место/);
  });

  it('rejects with StoreError when the transaction is aborted', async () => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const req = put.call(this, value, key);
      this.transaction.abort();
      return req;
    });
    await expect(saveData(scenario())).rejects.toBeInstanceOf(StoreError);
    vi.restoreAllMocks();
    expect(await loadData()).toBeNull();
  });

  it('rejects with StoreError for data that cannot be stored', async () => {
    const data = { ...scenario(), extra: () => 1 };
    await expect(saveData(data)).rejects.toBeInstanceOf(StoreError);
  });

  it('rejects with StoreError when IndexedDB is not available', async () => {
    useFactory(undefined);
    vi.stubGlobal('indexedDB', undefined);
    await expect(loadData()).rejects.toBeInstanceOf(StoreError);
    await expect(saveData(scenario())).rejects.toBeInstanceOf(StoreError);
    await expect(loadMeta()).rejects.toBeInstanceOf(StoreError);
    await expect(saveMeta({ failedAttempts: 0 })).rejects.toBeInstanceOf(StoreError);
    await expect(wipeAll()).rejects.toBeInstanceOf(StoreError);
    for (const call of [loadData, () => saveData(scenario()), loadMeta, () => saveMeta({ failedAttempts: 0 }), wipeAll]) {
      expect(((await rejection(call())) as StoreError).code).toBe('unavailable');
    }
  });

  it('StoreError is an Error with its own name', () => {
    const e = new StoreError('текст');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('StoreError');
    expect(e.message).toBe('текст');
  });

  it('StoreError carries a code; without one it counts as damaged data (e.g. PIN data checkPin cannot use)', () => {
    expect(new StoreError('текст', { code: 'newer-version' }).code).toBe('newer-version');
    expect(new StoreError('текст').code).toBe('damaged');
    const cause = new Error('x');
    const e = new StoreError('текст', { cause, code: 'read' });
    expect(e.cause).toBe(cause);
    expect(e.code).toBe('read');
  });
});

describe('migrate', () => {
  it('returns version 1 data as is', () => {
    const data = scenario();
    expect(migrate(data)).toBe(data);
  });

  it('refuses a newer schema version with an update hint', () => {
    expect(() => migrate({ ...scenario(), schemaVersion: 2 })).toThrow(StoreError);
    expect(() => migrate({ ...scenario(), schemaVersion: 2 })).toThrow(NEWER);
    expect(thrown(() => migrate({ ...scenario(), schemaVersion: 2 })).code).toBe('newer-version');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'data'],
    ['a number', 1],
    ['an array', []],
    ['an empty object', {}],
    ['version 0', { ...scenario(), schemaVersion: 0 }],
    ['a string version', { ...scenario(), schemaVersion: '1' }],
    ['a fractional version', { ...scenario(), schemaVersion: 1.5 }],
    ['no settings', { ...scenario(), settings: undefined }],
    ['no categories', { ...scenario(), categories: null }],
    ['expense categories not a list', { ...scenario(), categories: { expense: {}, income: [] } }],
    ['income categories missing', { ...scenario(), categories: { expense: [] } }],
    ['accounts not a list', { ...scenario(), accounts: {} }],
    ['no credit settings', { ...scenario(), credit: undefined }],
    ['operations missing', { ...scenario(), operations: undefined }],
    ['journal not a list', { ...scenario(), journal: 'x' }],
    ['recurring missing', { ...scenario(), recurring: undefined }],
    ['purchases missing', { ...scenario(), purchases: undefined }],
    ['debts missing', { ...scenario(), debts: undefined }],
  ])('refuses %s', (_label, raw) => {
    expect(() => migrate(raw)).toThrow(StoreError);
    expect(() => migrate(raw)).not.toThrow(NEWER);
    expect(thrown(() => migrate(raw)).code).toBe('damaged');
  });
});

describe('requestPersistence', () => {
  it('returns what the browser grants', async () => {
    vi.stubGlobal('navigator', { storage: { persist: async () => true } });
    expect(await requestPersistence()).toBe(true);
    vi.stubGlobal('navigator', { storage: { persist: async () => false } });
    expect(await requestPersistence()).toBe(false);
  });

  it('is false without the storage API', async () => {
    vi.stubGlobal('navigator', {});
    expect(await requestPersistence()).toBe(false);
    vi.stubGlobal('navigator', { storage: {} });
    expect(await requestPersistence()).toBe(false);
    vi.stubGlobal('navigator', undefined);
    expect(await requestPersistence()).toBe(false);
  });

  it('never throws', async () => {
    vi.stubGlobal('navigator', { storage: { persist: async () => { throw new Error('denied'); } } });
    expect(await requestPersistence()).toBe(false);
    vi.stubGlobal('navigator', { storage: { persist: () => { throw new Error('denied'); } } });
    expect(await requestPersistence()).toBe(false);
  });
});
