// The data set «Забрать с Mac» replaced, kept one level deep for «Вернуть данные до синхронизации»
// (spec 2026-10-01-icloud-sync). Like the data, it is written only while the stored data set is this
// tab's (the generation), and read only when it belongs to it: one data set's data never reaches another.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  StaleTabError, StoreError, loadBeforeSync, loadData, loadMeta, saveBeforeSync, saveData, saveMeta, updateStoredMeta, useFactory,
  wipeAll,
} from '../../src/store/db';
import type { BeforeSync } from '../../src/store/db';
import { scenario } from '../engine/scenario';

const GEN = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const SYNC = { lastId: '0123456789abcdef', lastAt: '2026-10-01T10:00:00.000Z', syncedHash: 'f'.repeat(64) };

function snapshot(): BeforeSync {
  return { data: scenario(), at: '2026-10-01T12:00:00.000Z', sync: SYNC };
}

beforeEach(async () => {
  useFactory(new IDBFactory());
  await saveMeta({ failedAttempts: 0, pinHash: 'h', pinSalt: 's', pinIterations: 1, generation: GEN });
});

afterEach(() => {
  useFactory(undefined);
});

describe('saveBeforeSync / loadBeforeSync', () => {
  it('nothing kept: null', async () => {
    expect(await loadBeforeSync({ generation: GEN })).toBeNull();
  });

  it('keeps one data set (with the sync state it had) and reads it back; a new one replaces it', async () => {
    await saveBeforeSync(snapshot(), { generation: GEN });
    expect(await loadBeforeSync({ generation: GEN })).toEqual({ ...snapshot(), generation: GEN });
    const second: BeforeSync = { data: { ...scenario(), operations: [] }, at: '2026-10-02T12:00:00.000Z' };
    await saveBeforeSync(second, { generation: GEN });
    expect(await loadBeforeSync({ generation: GEN })).toEqual({ ...second, generation: GEN });
  });

  it('null removes it', async () => {
    await saveBeforeSync(snapshot(), { generation: GEN });
    await saveBeforeSync(null, { generation: GEN });
    expect(await loadBeforeSync({ generation: GEN })).toBeNull();
  });

  it('leaves the data and the meta as they are', async () => {
    await saveData(scenario());
    const meta = await loadMeta();
    await saveBeforeSync({ ...snapshot(), data: { ...scenario(), operations: [] } }, { generation: GEN });
    expect(await loadData()).toEqual(scenario());
    expect(await loadMeta()).toEqual(meta);
  });

  it('another data set stored (another tab wiped and set up new data): StaleTabError, nothing written', async () => {
    await saveMeta({ failedAttempts: 0, pinHash: 'h2', pinSalt: 's2', pinIterations: 1, generation: OTHER });
    const e = await saveBeforeSync(snapshot(), { generation: GEN }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StaleTabError);
    expect(await loadBeforeSync({ generation: OTHER })).toBeNull();
    await saveMeta({ failedAttempts: 0 }); // wiped: no generation stored
    await expect(saveBeforeSync(snapshot(), { generation: GEN })).rejects.toBeInstanceOf(StaleTabError);
    await expect(saveBeforeSync(null, { generation: GEN })).rejects.toBeInstanceOf(StaleTabError);
  });

  it('a kept data set of another generation is never read as this one’s', async () => {
    await saveBeforeSync(snapshot(), { generation: GEN });
    expect(await loadBeforeSync({ generation: OTHER })).toBeNull();
    expect(await loadBeforeSync({ generation: undefined })).toBeNull();
  });

  it('no generation stored and none in memory are the same data set (as for the data)', async () => {
    await saveMeta({ failedAttempts: 0, pinHash: 'h', pinSalt: 's', pinIterations: 1 });
    await saveBeforeSync(snapshot(), { generation: undefined });
    expect(await loadBeforeSync({ generation: undefined })).toEqual(snapshot());
    expect(await loadBeforeSync({ generation: GEN })).toBeNull();
  });

  it('a wipe («Забыли PIN?») deletes it with everything else', async () => {
    await saveBeforeSync(snapshot(), { generation: GEN });
    await wipeAll();
    expect(await loadBeforeSync({ generation: GEN })).toBeNull();
    expect(await loadBeforeSync({ generation: undefined })).toBeNull();
  });

  it('a damaged kept data set rejects (StoreError), it is never restored half-read', async () => {
    await saveBeforeSync({ ...snapshot(), data: { schemaVersion: 1 } as unknown as BeforeSync['data'] }, { generation: GEN });
    await expect(loadBeforeSync({ generation: GEN })).rejects.toBeInstanceOf(StoreError);
  });
});

describe('meta.sync', () => {
  it('is stored and read back as any other meta field (absent: never synced)', async () => {
    expect((await loadMeta()).sync).toBeUndefined();
    await updateStoredMeta((m) => ({ ...m, sync: SYNC }));
    expect((await loadMeta()).sync).toEqual(SYNC);
  });
});
