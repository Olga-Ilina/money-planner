// actions.setSync — the per-field writer of meta.sync (the iCloud Drive sync state). Like every meta
// writer other than the PIN change, it changes only its own field of the STORED meta, never the PIN fields
// nor the generation, and only while the stored data set is this tab's.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as db from '../../../src/store/db';
import type { Meta, SyncState } from '../../../src/store/db';
import { actions } from '../../../src/ui/actions';
import { meta, resetSession, stopped } from '../../../src/ui/state';

vi.mock('../../../src/store/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/store/db')>();
  return { ...mod, updateStoredMeta: vi.fn(mod.updateStoredMeta) };
});

const MINE: Meta = { pinHash: 'aGFzaEE=', pinSalt: 'c2FsdEE=', pinIterations: 150_000, failedAttempts: 0, generation: 'g1' };
const SYNC: SyncState = { lastId: '0123456789abcdef', lastAt: '2026-10-01T10:00:00.000Z', syncedHash: 'f'.repeat(64) };

beforeEach(async () => {
  db.useFactory(new IDBFactory());
  resetSession();
  meta.value = MINE;
  await db.saveMeta(MINE);
  vi.mocked(db.updateStoredMeta).mockClear();
});

afterEach(async () => {
  await actions.flush();
  resetSession();
  db.useFactory(undefined);
});

describe('actions.setSync', () => {
  it('writes meta.sync onto the stored meta (another tab’s date kept) and into memory', async () => {
    await db.saveMeta({ ...MINE, lastBackupAt: '2026-09-30T10:00:00.000Z' }); // another tab, meanwhile
    await actions.setSync(SYNC);
    expect(await db.loadMeta()).toEqual({ ...MINE, lastBackupAt: '2026-09-30T10:00:00.000Z', sync: SYNC });
    expect(meta.value.sync).toEqual(SYNC);
  });

  it('undefined removes it (back to «never synced»)', async () => {
    await actions.setSync(SYNC);
    await actions.setSync(undefined);
    expect('sync' in (await db.loadMeta())).toBe(false);
    expect('sync' in meta.value).toBe(false);
  });

  it('never touches the PIN: another tab’s PIN stays stored, this tab keeps its own in memory', async () => {
    const theirs: Meta = { ...MINE, pinHash: 'aGFzaEI=', pinSalt: 'c2FsdEI=', failedAttempts: 2 };
    await db.saveMeta(theirs);
    await actions.setSync(SYNC);
    expect(await db.loadMeta()).toEqual({ ...theirs, sync: SYNC });
    expect(meta.value).toEqual({ ...MINE, sync: SYNC });
  });

  it('another data set stored: nothing written, rejects with StaleTabError and the tab stops', async () => {
    const theirs: Meta = { ...MINE, pinHash: 'aGFzaEI=', generation: 'g2' };
    await db.saveMeta(theirs);
    await expect(actions.setSync(SYNC)).rejects.toBeInstanceOf(db.StaleTabError);
    expect(await db.loadMeta()).toEqual(theirs);
    expect(stopped.value).toBe(true);
    expect(meta.value.sync).toBeUndefined();
  });

  it('a failed save rejects with the StoreError; memory unchanged', async () => {
    vi.mocked(db.updateStoredMeta).mockRejectedValueOnce(new db.StoreError('Не удалось сохранить данные.', { code: 'write' }));
    await expect(actions.setSync(SYNC)).rejects.toBeInstanceOf(db.StoreError);
    expect(meta.value).toEqual(MINE);
    expect(await db.loadMeta()).toEqual(MINE);
  });
});
