// The app's side of the iCloud Drive sync with the Excel tracker on the Mac (spec
// .internal/specs/2026-10-01-icloud-sync.md): what the «Синхронизация» page and the «Сегодня» reminder share.
// - meta.sync (written only by actions.setSync) says what was last exchanged; «есть неотправленные
//   изменения» = the hash of the data now ≠ sync.syncedHash (computed on demand, never written per commit).
// - «Отправить на Mac»: the full backup with a stamp (from=app) → the share sheet → sync = this version.
// - «Забрать с Mac» replaces the data only after keeping the data set it replaces (one level, in IndexedDB,
//   generation-checked), so «Вернуть данные до синхронизации» can bring it back.
// - «Загрузить трекер» and the onboarding import of a tracker the Mac stamped record its version too
//   (readTrackerStamped → setSyncFromImport), so the next send is no false conflict on the Mac.
// No network: the files travel through the share sheet and the file picker.
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Data } from '../engine';
import { StaleTabError, loadBeforeSync, saveBeforeSync } from '../store/db';
import type { BeforeSync, Meta, SyncState } from '../store/db';
import { DataChangedError, actions } from './actions';
import { isStale, stopTab } from './generation';
import { ioErrorMessage, loadBackup, loadSync, loadTrackerImport } from './io';
import { showToast } from './kit/Toast';
import { shareFile } from './share';
import type { ShareOutcome } from './share';
import { appData, data, meta, onResetSession, stopped } from './state';

/** The folder in iCloud Drive both sides use, and the two files in it. */
export const SYNC_FOLDER = 'Трекер расходов — синхронизация';
export const TO_MAC_FILE = 'Из приложения.xlsx';
export const FROM_MAC_FILE = 'Для приложения.xlsx';

const DAY_MS = 86_400_000;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** meta.sync when it can be used; undefined («never synced») when absent or not readable. */
export function syncOf(m: Meta): SyncState | undefined {
  const s: unknown = m.sync;
  if (typeof s !== 'object' || s === null) return undefined;
  const { lastId, lastAt, syncedHash, sentDirty } = s as Record<string, unknown>;
  if (typeof lastId !== 'string' || !HEX16.test(lastId)) return undefined;
  if (typeof lastAt !== 'string' || !Number.isFinite(Date.parse(lastAt))) return undefined;
  if (typeof syncedHash !== 'string' || !HEX64.test(syncedHash)) return undefined;
  return sentDirty === true ? { lastId, lastAt, syncedHash, sentDirty: true } : { lastId, lastAt, syncedHash };
}

// ---------- the data hash ----------

const hashes = new WeakMap<Data, Promise<string>>();

/** dataHash of `d` (src/io/sync.ts), computed once per data object (data is never changed in place). */
export function hashOf(d: Data): Promise<string> {
  let h = hashes.get(d);
  if (!h) {
    h = loadSync().then((m) => m.dataHash(d));
    hashes.set(d, h);
    h.catch(() => hashes.delete(d)); // a failed load is tried again next time
  }
  return h;
}

/** Whether `d` holds changes not sent to the Mac: always when it has never been synced. */
export async function hasUnsent(d: Data, s: SyncState | undefined = syncOf(meta.value)): Promise<boolean> {
  return s === undefined || (await hashOf(d)) !== s.syncedHash;
}

/**
 * Whether the app data now holds changes not sent to the Mac; undefined while it is being worked out
 * (or with `enabled` false). Re-checked whenever the data or meta.sync changes.
 */
export function useUnsent(enabled = true): boolean | undefined {
  const d = data.value;
  const s = syncOf(meta.value);
  const [known, setKnown] = useState<{ d: Data; hash: string } | null>(null);
  useEffect(() => {
    if (!enabled || !d) return undefined;
    let live = true;
    hashOf(d).then(
      (hash) => {
        if (live) setKnown({ d, hash });
      },
      () => {}, // no answer: nothing is claimed
    );
    return () => {
      live = false;
    };
  }, [d, enabled]);
  if (!enabled || !d || known?.d !== d) return undefined;
  return s === undefined || known.hash !== s.syncedHash;
}

/** The «Сегодня» reminder is due: synced before, more than a day ago (the hash then tells whether anything is unsent). */
export function reminderDue(s: SyncState | undefined, now: number = Date.now()): boolean {
  return s !== undefined && now - Date.parse(s.lastAt) > DAY_MS;
}

// ---------- «Отправить на Mac» ----------

/** A file is being made for the Mac (the button is disabled meanwhile). */
export const sending = signal(false);

export type SendOutcome = ShareOutcome | 'failed';

/**
 * «Отправить на Mac»: a new version id, the stamp (base = the last version exchanged, dirty = changes since
 * it, from=app) in the full backup «Из приложения.xlsx», handed to the share sheet (or downloaded). Once
 * handed over ('shared' / 'downloaded') the sync state becomes this version and this data; a closed share
 * sheet ('cancelled') changes nothing. A failure shows a toast and changes nothing ('failed'). Call it
 * straight from the tap: Safari opens the share sheet only then. A second tap while busy does nothing.
 * `dirty` is also 1 while the last version sent with changes (sentDirty) is not known to be on the Mac: iOS
 * may have put this file in that one's place («Ersetzen»), and with dirty=0 the Mac would take its own older
 * version for the newer one and archive this file — those changes would be lost without a word.
 */
export async function sendToMac(): Promise<SendOutcome> {
  if (sending.value) return 'cancelled';
  sending.value = true;
  try {
    const before = syncOf(meta.value);
    let outcome: ShareOutcome;
    let state: SyncState;
    try {
      const d = appData();
      const [{ exportBackup }, sync] = await Promise.all([loadBackup(), loadSync()]);
      const hash = await hashOf(d);
      const dirty = before === undefined || hash !== before.syncedHash || before.sentDirty === true;
      const now = new Date();
      const id = sync.newSyncId();
      const stamp = sync.formatStamp({ id, base: before?.lastId ?? null, dirty, at: sync.stampTime(now), from: 'app' });
      const buffer = await exportBackup(d, now.toISOString(), { stamp });
      outcome = await shareFile(TO_MAC_FILE, buffer);
      state = { lastId: id, lastAt: now.toISOString(), syncedHash: hash };
      if (dirty) state.sentDirty = true;
    } catch (e) {
      showToast(ioErrorMessage(e));
      return 'failed';
    }
    if (outcome === 'cancelled') return outcome;
    try {
      await actions.setSync(state);
      showToast(outcome === 'shared' ? 'Файл для Mac передан' : `Файл скачан — перенесите его в папку «${SYNC_FOLDER}»`);
    } catch (e) {
      if (!isStale(e)) showToast('Файл для Mac готов, но отметка синхронизации не сохранилась');
    }
    return outcome;
  } finally {
    sending.value = false;
  }
}

// ---------- the data set before the sync ----------

/** The data set kept before the last «Забрать с Mac» (null: none; undefined: not read yet). */
export const beforeSync = signal<BeforeSync | null | undefined>(undefined);

onResetSession(() => {
  beforeSync.value = undefined;
  sending.value = false;
});

/** Reads the kept data set (this tab's data set only) into `beforeSync`; one that cannot be read counts as none. */
export async function refreshBeforeSync(): Promise<void> {
  try {
    beforeSync.value = await loadBeforeSync({ generation: meta.value.generation });
  } catch {
    beforeSync.value = null;
  }
}

/** saveBeforeSync for this tab's data set; a tab that has stopped writes nothing, a stale one stops. */
async function keep(snapshot: BeforeSync | null): Promise<void> {
  if (stopped.value) throw new StaleTabError();
  try {
    await saveBeforeSync(snapshot, { generation: meta.value.generation });
  } catch (e) {
    if (isStale(e)) stopTab();
    throw e;
  }
}

/**
 * Replaces the data with `next` («Забрать с Mac») after keeping what it replaces — the data and the sync
 * state now — as the one data set before the sync. When the data cannot be replaced, the data set kept
 * before is put back (when that fails too, `beforeSync` is read again: what is offered is what is stored).
 * Rejects (nothing replaced) like actions.replaceData, when the kept copy cannot be saved (nothing is
 * replaced without it), or with DataChangedError when the data changed while it was being saved.
 */
export async function replaceKeepingBefore(next: Data): Promise<void> {
  const current = appData();
  let previous: BeforeSync | null = null;
  try {
    previous = await loadBeforeSync({ generation: meta.value.generation });
  } catch {
    // an unreadable earlier copy is not worth keeping
  }
  const kept: BeforeSync = { data: current, at: new Date().toISOString() };
  const s = syncOf(meta.value);
  if (s) kept.sync = s;
  await keep(kept);
  try {
    if (data.value !== current) throw new DataChangedError(); // changed while the copy was saved: it is not this data
    await actions.replaceData(next);
  } catch (e) {
    try {
      await keep(previous);
      beforeSync.value = previous;
    } catch {
      await refreshBeforeSync(); // not put back: what is offered is what is stored
    }
    throw e;
  }
  beforeSync.value = { ...kept, generation: meta.value.generation } as BeforeSync;
}

/** restoreBeforeSync found nothing kept (another tab restored it meanwhile); the message is for the user. */
export class NothingKeptError extends Error {
  override name = 'NothingKeptError';
  constructor() {
    super('Данных до синхронизации больше нет.');
  }
}

/**
 * «Вернуть данные до синхронизации»: the kept data set (read again: the newest one of this data set) comes
 * back (actions.replaceData: saved, then shown), with the sync state it had; then it is no longer kept. The
 * sync state and forgetting the copy are separate steps: one failing never skips the other. Says how it went
 * in a toast. Rejects when there is none any more (NothingKeptError; in a tab whose data set another tab
 * replaced, StaleTabError: the tab stops, like any stale write) or the data cannot be saved (nothing changed then).
 */
export async function restoreBeforeSync(): Promise<void> {
  const kept = await loadBeforeSync({ generation: meta.value.generation });
  if (!kept) {
    // in a tab whose data set another tab replaced, this writes nothing and stops the tab (StaleTabError)
    await keep(null).catch((e: unknown) => {
      if (isStale(e)) throw e;
    });
    beforeSync.value = null;
    throw new NothingKeptError();
  }
  await actions.replaceData(kept.data);
  beforeSync.value = null;
  let text = 'Данные возвращены';
  try {
    await actions.setSync(kept.sync);
  } catch (e) {
    if (isStale(e)) return; // the tab has stopped: its stop screen says why
    // the data are back; a sync state left as it was shows «есть неотправленные изменения» — never less safe
    text = 'Данные возвращены, но отметка синхронизации не сохранилась';
  }
  try {
    await keep(null);
  } catch (e) {
    if (isStale(e)) return;
    await refreshBeforeSync(); // still kept: still offered
  }
  showToast(text);
}

/** A tap on «Забрать с Mac» that the page has to answer: what the picked file is. */
export type PickUp =
  /** No stamp: a tracker like any other («Загрузить трекер»). */
  | { kind: 'plain' }
  /** The app's own file («Из приложения.xlsx»). */
  | { kind: 'from-app' }
  /** The version last exchanged: nothing new. */
  | { kind: 'nothing-new' }
  /**
   * A new version from the Mac. `warn`: 'unsent' — the app holds changes not sent (or never sent); 'not-seen' —
   * the app's last version was sent with changes and this file is not built on it.
   */
  | { kind: 'take'; id: string; warn: 'unsent' | 'not-seen' | null };

/**
 * A picked Mac file is the version last exchanged (id == lastId): when that was sent with changes, the Mac
 * has them now (it publishes a file with the app's id only once its tracker holds that version), so they no
 * longer need a warning (sentDirty goes). A failed save keeps sentDirty: more warnings, never fewer.
 */
export async function resolveSentDirty(s: SyncState): Promise<void> {
  if (!s.sentDirty) return;
  await actions.setSync({ lastId: s.lastId, lastAt: s.lastAt, syncedHash: s.syncedHash }).catch(() => {});
}

/** What to do with a picked file, from its stamp, the sync state and whether the app holds unsent changes. */
export function classifyPickUp(
  stamp: { id: string; base: string | null; from: 'app' | 'mac' } | null,
  s: SyncState | undefined,
  unsent: boolean,
): PickUp {
  if (!stamp) return { kind: 'plain' };
  if (stamp.from === 'app') return { kind: 'from-app' };
  if (s && stamp.id === s.lastId) return { kind: 'nothing-new' };
  const warn = unsent ? 'unsent' : s?.sentDirty && stamp.base !== s.lastId ? 'not-seen' : null;
  return { kind: 'take', id: stamp.id, warn };
}

// ---------- a tracker the Mac stamped, loaded the usual way ----------

/** A Mac version a picked tracker carries: its stamp's id and the hash of the data read from it. */
export interface MacVersion {
  id: string;
  hash: string;
}

/** The first note of a tracker whose stamp cannot be read («Загрузить трекер», onboarding). */
export const STAMP_UNREADABLE =
  'Отметка синхронизации в файле не читается. Данные загрузятся, но синхронизация с Mac не будет отмечена.';

/**
 * Reads a tracker for «Загрузить трекер» or the onboarding import, with the Mac version it carries (`mac`,
 * null when it has none or is the app's own file): after the replace, setSyncFromImport records it as
 * «Забрать с Mac» would — otherwise the next «Отправить на Mac» would look like a conflict on the Mac. A stamp
 * that cannot be read never stops the import (the file is a tracker): `mac` is null and the first note says
 * so. Rejects like importTracker.
 */
export async function readTrackerStamped(
  buf: ArrayBuffer,
): Promise<{ data: Data; notes: string[]; overrides: string[]; mac: MacVersion | null }> {
  let id: string | null = null;
  let unreadable = false;
  try {
    const stamp = await (await loadSync()).readStamp(buf);
    if (stamp?.from === 'mac') id = stamp.id;
  } catch {
    unreadable = true;
  }
  const { importTracker } = await loadTrackerImport();
  const result = await importTracker(buf);
  let mac: MacVersion | null = null;
  if (id !== null) {
    try {
      mac = { id, hash: await hashOf(result.data) };
    } catch {
      unreadable = true;
    }
  }
  return { ...result, notes: unreadable ? [STAMP_UNREADABLE, ...result.notes] : result.notes, mac };
}

/**
 * After a tracker the Mac stamped replaced the data the usual way: the sync state becomes that version and
 * those data (sentDirty gone), as after «Забрать с Mac». Call it once the data are replaced. Never rejects: a
 * failed save says so in a toast (a stopped tab: its stop screen does).
 */
export async function setSyncFromImport(mac: MacVersion): Promise<void> {
  try {
    await actions.setSync({ lastId: mac.id, lastAt: new Date().toISOString(), syncedHash: mac.hash });
  } catch (e) {
    if (!isStale(e)) showToast('Трекер загружен, но отметка синхронизации не сохранилась');
  }
}
