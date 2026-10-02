// On-device storage: IndexedDB database 'money-planner' (version 1) with one object store 'kv'
// (out-of-line keys) holding the documents 'data' (the Data model), 'meta' (PIN lock state, backup and
// import dates, the data generation, the sync state) and 'beforeSync' (the data set «Забрать с Mac»
// replaced, one level, for «Вернуть данные до синхронизации»). Every call opens its own connection and
// closes it when done.
import { SCHEMA_VERSION } from '../engine/model';
import type { Data } from '../engine/model';

export interface Meta {
  pinHash?: string;
  pinSalt?: string;
  pinIterations?: number;
  failedAttempts: number;
  lockedUntil?: number; // epoch ms
  lastBackupAt?: string; // ISO datetime
  lastImportAt?: string; // ISO datetime
  /**
   * Which data set the stored meta and data belong to: a random id (newGeneration) set by onboarding with a
   * new PIN, cleared by a wipe, given once to a meta stored before it existed (loadMetaAtStart). A tab
   * remembers the one it loaded; another one stored means another tab deleted the data or set up new ones.
   */
  generation?: string;
  /** What the app last exchanged with the Mac (iCloud Drive sync); absent: never synced. Written by actions.setSync. */
  sync?: SyncState;
}

/** The iCloud Drive sync with the Mac (spec 2026-10-01-icloud-sync), as the app last left it. */
export interface SyncState {
  /** The id of the last version sent to or taken from the Mac (16 hex). */
  lastId: string;
  /** When (ISO datetime). */
  lastAt: string;
  /** dataHash of the data set at that moment: another hash now means changes not sent yet. */
  syncedHash: string;
  /**
   * A version was sent from the app with changes (dirty=1) and no Mac file built on it has been picked up
   * since: a file from the Mac that is not built on the last one (its base is not lastId) lacks them, and
   * taking it warns first; later sends stay dirty=1 meanwhile. Absent after taking a Mac version, or once a
   * picked Mac file carries lastId itself (src/ui/sync.ts resolveSentDirty).
   */
  sentDirty?: true;
}

/** The data set «Забрать с Mac» replaced — kept one level deep for «Вернуть данные до синхронизации». */
export interface BeforeSync {
  data: Data;
  /** When it was replaced (ISO datetime). */
  at: string;
  /** The sync state it had (absent: never synced). */
  sync?: SyncState;
  /** The data set it belongs to (set by saveBeforeSync). */
  generation?: string;
}

/**
 * What went wrong, for the app to decide what to offer (the message text is for people only):
 * 'newer-version' — saved by a newer app version (update the app); 'damaged' — the data document is
 * unreadable (also the default, e.g. PIN data that checkPin cannot use); 'meta-damaged' — the PIN/meta
 * document is unreadable; 'unavailable' — no IndexedDB; 'quota' — out of space; 'read', 'write',
 * 'wipe' — that operation failed; 'stale' — another generation is stored (StaleTabError).
 */
export type StoreErrorCode =
  | 'newer-version' | 'damaged' | 'meta-damaged' | 'unavailable' | 'quota' | 'read' | 'write' | 'wipe' | 'stale';

/** Storage failure; the message is Russian and can be shown to the user as is. */
export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(message: string, options?: ErrorOptions & { code?: StoreErrorCode }) {
    super(message, options);
    this.name = 'StoreError';
    this.code = options?.code ?? 'damaged';
  }
}

const MSG_STALE = 'Данные изменились в другой вкладке. Перезапустите приложение.';

/**
 * The stored data set is not the one this tab loaded (another generation, or none: another tab deleted the
 * data, or set up new ones): nothing of this tab's copy is saved, and the tab stops. Code 'stale'.
 */
export class StaleTabError extends StoreError {
  constructor() {
    super(MSG_STALE, { code: 'stale' });
  }
}

/** A new random generation id: 16 random bytes, hex. */
export function newGeneration(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function validGeneration(g: unknown): g is string {
  return typeof g === 'string' && g.length > 0;
}

const DB_NAME = 'money-planner';
const DB_VERSION = 1;
const STORE = 'kv';
const DATA_KEY = 'data';
const META_KEY = 'meta';
const BEFORE_SYNC_KEY = 'beforeSync';
/** In readThenWrite's writes: delete the key instead of writing a value. */
const REMOVE = Symbol('remove');

const MSG_NEWER = 'Данные сохранены более новой версией приложения. Обновите приложение.';
const MSG_DAMAGED = 'Сохранённые данные повреждены или имеют неизвестный формат.';
const MSG_UNAVAILABLE = 'Хранилище на этом устройстве недоступно.';
const MSG_QUOTA = 'Не удалось сохранить данные: на устройстве закончилось место.';
const MSG_SAVE = 'Не удалось сохранить данные.';
const MSG_READ = 'Не удалось прочитать сохранённые данные.';
const MSG_WIPE = 'Не удалось удалить данные.';
const MSG_META_DAMAGED = 'Сохранённые настройки PIN повреждены. Если не получается войти, используйте «Забыли PIN?».';

let injected: IDBFactory | undefined;

/** Uses `factory` instead of `globalThis.indexedDB` (tests); `undefined` restores the default. */
export function useFactory(factory: IDBFactory | undefined): void {
  injected = factory;
}

function factory(): IDBFactory {
  const f = injected ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!f) throw new StoreError(MSG_UNAVAILABLE, { code: 'unavailable' });
  return f;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory().open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab (or a newer app version) wants to upgrade: let it
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Runs one transaction on the kv store; resolves with the result of `work`'s request once committed. */
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | undefined,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      // writes ask to be flushed to disk before completing; engines without the option ignore it
      const tx = mode === 'readwrite' ? db.transaction(STORE, mode, { durability: 'strict' }) : db.transaction(STORE, mode);
      let result: T | undefined;
      tx.oncomplete = () => resolve(result);
      // a failed request aborts the transaction; tx.error then holds its error
      tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
      const req = work(tx.objectStore(STORE));
      if (req) req.onsuccess = () => { result = req.result; };
    });
  } finally {
    db.close();
  }
}

/** An error thrown by the caller's own function inside readThenWrite: passed on as it is. */
class Refused {
  constructor(readonly error: unknown) {}
}

/**
 * ONE readwrite transaction: reads `key`, `plan` decides from what is stored (undefined: nothing) what to
 * write (REMOVE: delete the key) and what to resolve with, the writes are made and the transaction commits — no other transaction
 * can come in between. An error thrown by `plan` aborts it (nothing written) and rejects with that very
 * error; any other failure rejects with a StoreError: 'read' when the stored value could not be read,
 * 'write' otherwise (and 'quota', 'newer-version', 'unavailable' as everywhere).
 */
async function readThenWrite<T>(key: string, plan: (raw: unknown) => { result: T; writes: [string, unknown][] }): Promise<T> {
  let read = false;
  let readFailed = false;
  try {
    const db = await openDb();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' });
        let result: T;
        let refused: Refused | undefined;
        let failure: unknown;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(refused ?? failure ?? tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
        const store = tx.objectStore(STORE);
        let req: IDBRequest;
        try {
          req = store.get(key);
        } catch (e) {
          readFailed = true;
          failure = e;
          tx.abort();
          return;
        }
        req.onerror = () => {
          readFailed = true;
        };
        req.onsuccess = () => {
          read = true;
          let p: { result: T; writes: [string, unknown][] };
          try {
            p = plan(req.result);
          } catch (e) {
            refused = new Refused(e);
            tx.abort();
            return;
          }
          result = p.result;
          try {
            for (const [k, v] of p.writes) {
              if (v === REMOVE) store.delete(k);
              else store.put(v, k);
            }
          } catch (e) {
            failure = e; // DataCloneError, QuotaExceededError…
            tx.abort();
          }
        };
      });
    } finally {
      db.close();
    }
  } catch (e) {
    if (e instanceof Refused) throw e.error;
    if (readFailed && !read) throw toStoreError(e, MSG_READ, 'read');
    throw toStoreError(e, MSG_SAVE, 'write');
  }
}

function errorName(e: unknown): string | undefined {
  return e instanceof Error || e instanceof DOMException ? e.name : undefined;
}

function toStoreError(e: unknown, message: string, code: StoreErrorCode): StoreError {
  if (e instanceof StoreError) return e;
  switch (errorName(e)) {
    case 'QuotaExceededError':
      return new StoreError(MSG_QUOTA, { cause: e, code: 'quota' });
    case 'VersionError':
      return new StoreError(MSG_NEWER, { cause: e, code: 'newer-version' });
    default:
      return new StoreError(message, { cause: e, code });
  }
}

async function read(key: string): Promise<unknown> {
  try {
    return await transact<unknown>('readonly', (store) => store.get(key));
  } catch (e) {
    throw toStoreError(e, MSG_READ, 'read');
  }
}

async function write(key: string, value: unknown): Promise<void> {
  try {
    await transact('readwrite', (store) => store.put(value, key));
  } catch (e) {
    throw toStoreError(e, MSG_SAVE, 'write');
  }
}

/** Stored data after migration; null when nothing is stored. */
export async function loadData(): Promise<Data | null> {
  const raw = await read(DATA_KEY);
  return raw === undefined ? null : migrate(raw);
}

/**
 * Replaces the stored data in a single transaction. With `check` (the app's saves), the transaction first
 * reads the stored meta and writes only while its generation is `check.generation` (none stored and
 * undefined count as the same); otherwise it rejects with StaleTabError and writes nothing — a tab never
 * saves its copy over data another tab deleted or set up anew. A damaged meta rejects (meta-damaged).
 */
export async function saveData(data: Data, check?: { generation: string | undefined }): Promise<void> {
  if (!check) {
    await write(DATA_KEY, data);
    return;
  }
  await readThenWrite(META_KEY, (raw) => {
    if (readMeta(raw).generation !== check.generation) throw new StaleTabError();
    return { result: undefined, writes: [[DATA_KEY, data]] };
  });
}

/**
 * Keeps `snapshot` as the data set before the sync (null removes it): one level, a new one replaces the old.
 * Like the app's saveData, in ONE transaction that first reads the stored meta and writes only while its
 * generation is `check.generation` (none stored and undefined are the same); otherwise it rejects with
 * StaleTabError and writes nothing — one data set's data never lands in another's storage. The snapshot
 * is stored with that generation. A wipe deletes it with everything else.
 */
export async function saveBeforeSync(snapshot: BeforeSync | null, check: { generation: string | undefined }): Promise<void> {
  await readThenWrite(META_KEY, (raw) => {
    if (readMeta(raw).generation !== check.generation) throw new StaleTabError();
    const value = snapshot === null ? REMOVE : { ...snapshot, generation: check.generation };
    return { result: undefined, writes: [[BEFORE_SYNC_KEY, value]] };
  });
}

/**
 * The data set kept before the sync — only when it belongs to `check.generation` (this tab's data set);
 * null when there is none or it is another data set's. A kept value that cannot be read rejects with a
 * StoreError ('damaged', or 'newer-version' for data of a newer schema): it is never restored half-read.
 */
export async function loadBeforeSync(check: { generation: string | undefined }): Promise<BeforeSync | null> {
  const raw = await read(BEFORE_SYNC_KEY);
  if (raw === undefined) return null;
  if (!isRecord(raw) || typeof raw.at !== 'string') throw new StoreError(MSG_DAMAGED, { code: 'damaged' });
  if (raw.generation !== check.generation) return null;
  const kept = { ...(raw as unknown as BeforeSync), data: migrate(raw.data) };
  if (kept.generation === undefined) delete kept.generation;
  return kept;
}

/**
 * Stored meta; defaults (no PIN) only when nothing is stored. A stored value that is not an object
 * rejects (fail closed: it is never read as «no PIN»). Damaged pinIterations are kept for checkPin to refuse.
 */
export async function loadMeta(): Promise<Meta> {
  return readMeta(await read(META_KEY));
}

/** What loadMeta makes of a stored value (undefined: nothing stored). */
function readMeta(raw: unknown): Meta {
  if (raw === undefined) return { failedAttempts: 0 };
  if (!isRecord(raw)) throw new StoreError(MSG_META_DAMAGED, { code: 'meta-damaged' });
  const failed = raw.failedAttempts;
  const failedAttempts = typeof failed === 'number' && Number.isInteger(failed) && failed >= 0 ? failed : 0;
  const meta: Meta = { ...(raw as Partial<Meta>), failedAttempts };
  if (!Number.isFinite(meta.lockedUntil)) delete meta.lockedUntil;
  return meta;
}

/** Whether `m` has a usable generation (a non-empty string). */
export function hasGeneration(m: Meta): boolean {
  return validGeneration(m.generation);
}

/**
 * loadMeta for the app start: a meta stored before generations existed (none, or not a usable one) gets a
 * new generation, stored once — only that field is added. Read and written in ONE transaction, so tabs
 * starting at the same time agree on one generation. Nothing stored: the defaults, nothing written (the
 * generation comes with the PIN at onboarding). When the new generation cannot be stored (no space left…),
 * it resolves with the meta as it was read and is still stored — without a usable generation, like storage,
 * so the checks still find one data set and the owner is never kept out; the app stores one with its next
 * meta write (src/ui/generation.ts). Otherwise rejects like loadMeta.
 */
export async function loadMetaAtStart(): Promise<Meta> {
  const old: { meta?: Meta } = {};
  try {
    return await readThenWrite(META_KEY, (raw) => {
      const meta = readMeta(raw);
      if (raw === undefined || validGeneration(meta.generation)) return { result: meta, writes: [] };
      old.meta = meta;
      const generation = newGeneration();
      return { result: { ...meta, generation }, writes: [[META_KEY, { ...(raw as object), generation }]] };
    });
  } catch (e) {
    if (old.meta) return old.meta; // read, but its generation could not be written: nothing was written
    throw e;
  }
}

/**
 * Replaces the whole stored meta. Only the store itself, tests and a first save may use it: the app
 * changes the meta with updateStoredMeta, so it never writes back a meta another tab has changed meanwhile.
 */
export async function saveMeta(meta: Meta): Promise<void> {
  await write(META_KEY, meta);
}

/**
 * Read-modify-write of the STORED meta in ONE readwrite transaction (strict durability): reads it (as
 * loadMeta does: the defaults when nothing is stored), gives it to `fn` and writes what `fn` returns —
 * null writes nothing. No other write, from this tab or another one, can come between the read and the
 * write, so two updates at the same time are both applied. Resolves with the written meta (with the
 * stored one after null). An error thrown by `fn` rejects with that very error and nothing is written. A
 * stored meta that is not an object rejects with StoreError 'meta-damaged' before `fn` runs (it is never
 * written over); other failures reject with StoreError 'read' (the stored meta could not be read), 'write',
 * 'quota', 'newer-version' or 'unavailable'.
 */
export async function updateStoredMeta(fn: (stored: Meta) => Meta | null): Promise<Meta> {
  return readThenWrite(META_KEY, (raw) => {
    const stored = readMeta(raw);
    const next = fn(stored);
    return next === null ? { result: stored, writes: [] } : { result: next, writes: [[META_KEY, next]] };
  });
}

/** Deletes the data and the meta (PIN included). */
export async function wipeAll(): Promise<void> {
  try {
    await transact('readwrite', (store) => store.clear());
  } catch (e) {
    throw toStoreError(e, MSG_WIPE, 'wipe');
  }
}

/** Asks the browser not to evict the data; false when refused or unsupported. Never throws. */
export async function requestPersistence(): Promise<boolean> {
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    return (await nav?.storage?.persist?.()) === true;
  } catch {
    return false;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const DATA_LISTS = ['accounts', 'operations', 'journal', 'recurring', 'purchases', 'debts'] as const;

/** Brings stored data to the current schema. Version 1 is current: validated and returned as is. */
export function migrate(raw: unknown): Data {
  if (!isRecord(raw)) throw new StoreError(MSG_DAMAGED, { code: 'damaged' });
  const version = raw.schemaVersion;
  if (typeof version === 'number' && Number.isInteger(version) && version > SCHEMA_VERSION) {
    throw new StoreError(MSG_NEWER, { code: 'newer-version' });
  }
  if (version !== 1) throw new StoreError(MSG_DAMAGED, { code: 'damaged' });
  const categories = raw.categories;
  const valid =
    isRecord(raw.settings) &&
    isRecord(categories) &&
    Array.isArray(categories.expense) &&
    Array.isArray(categories.income) &&
    isRecord(raw.credit) &&
    DATA_LISTS.every((k) => Array.isArray(raw[k]));
  if (!valid) throw new StoreError(MSG_DAMAGED, { code: 'damaged' });
  return raw as unknown as Data;
}
