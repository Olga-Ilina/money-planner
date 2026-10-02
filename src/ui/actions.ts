// Every change to the data goes through here: commit() shows the new data at once and saves it in
// the background (one write at a time, the newest data wins), keeping ONE undo snapshot for 5 s.
// Meta changes (PIN counter, backup date) are read-modify-write steps of the STORED meta, each in one
// transaction (updateStoredMeta), run one at a time; each writer changes only its own fields.
// Every save — data and meta — happens only while the stored data set is the one this tab loaded (the
// generation, generation.ts); otherwise nothing is saved and the tab stops.
import type { Data } from '../engine';
import { StaleTabError, StoreError, hasGeneration, newGeneration, saveData, updateStoredMeta } from '../store/db';
import type { Meta, SyncState } from '../store/db';
import { generationPending, isStale, sameGeneration, setGenerationPending, stopTab } from './generation';
import { hideToast, showToast } from './kit/Toast';
import { PIN_FIELDS, data, feedMonth, hasPin, meta, onResetSession, samePin, stopped } from './state';
import type { ToastAction } from './state';

const UNDO_MS = 5_000;
const BACKUP_EVERY_MS = 14 * 86_400_000;
const SAVE_FAILED = 'Не удалось сохранить данные.';
const UNDONE = 'Отменено';
const DATA_CHANGED = 'Данные изменились, пока шло сохранение. Файл не загружен — попробуйте ещё раз.';

/** replaceData lost to a commit made while it was saving (see replaceData); the message is for the user. */
export class DataChangedError extends Error {
  override name = 'DataChangedError';
  constructor() {
    super(DATA_CHANGED);
  }
}

/** Counts every change of data.value made here, so replaceData can tell whether anything changed meanwhile. */
let version = 0;

function show(d: Data | null): void {
  data.value = d;
  version += 1;
}

// ---------- serialised writes ----------

interface Waiter {
  resolve: () => void;
  reject: (e: unknown) => void;
}

let pending: { data: Data; waiters: Waiter[] } | null = null;
let draining: Promise<void> | null = null;

async function drain(): Promise<void> {
  while (pending) {
    const job = pending;
    pending = null;
    try {
      // only while the stored data set is still this tab's (checked in the write's own transaction)
      await saveData(job.data, { generation: meta.value.generation });
      for (const w of job.waiters) w.resolve();
    } catch (e) {
      if (isStale(e)) stopTab(); // another tab deleted the data or set up new ones: nothing saved
      for (const w of job.waiters) w.reject(e);
    }
  }
  draining = null;
}

/**
 * Queues a write of `d`; a write still waiting is replaced (its promise settles with the newer one). A
 * stopped tab saves nothing (StaleTabError).
 */
function persist(d: Data): Promise<void> {
  if (stopped.value) return Promise.reject(new StaleTabError());
  return new Promise<void>((resolve, reject) => {
    if (pending) {
      pending.data = d;
      pending.waiters.push({ resolve, reject });
    } else {
      pending = { data: d, waiters: [{ resolve, reject }] };
    }
    draining ??= drain();
  });
}

/** 'Не удалось сохранить …' for the toast; StoreError messages are Russian and shown as they are. */
function saveFailedText(e: unknown): string {
  if (e instanceof StoreError) {
    return e.message.startsWith('Не удалось сохранить') ? e.message : `${SAVE_FAILED} ${e.message}`;
  }
  return SAVE_FAILED;
}

/** Saves in the background; a failure is shown in a toast that keeps «Отменить» while it can still undo. */
function persistInBackground(d: Data): void {
  persist(d).catch((e: unknown) => {
    if (isStale(e)) return; // the tab has stopped: its stop screen says why
    const text = saveFailedText(e);
    if (undoable(snapshot)) snapshot.toastId = showToast(text, { undo: () => void undo() });
    else showToast(text);
  });
}

// ---------- undo ----------

interface Snapshot {
  prev: Data | null;
  expiresAt: number;
  toastId?: number;
  /** The month of «Лента» before the change and right after it (the change may have clamped it away). */
  feedBefore: string;
  feedAfter: string;
}

let snapshot: Snapshot | null = null;

function undoable(s: Snapshot | null): s is Snapshot & { prev: Data } {
  return s !== null && s.prev !== null && Date.now() <= s.expiresAt;
}

/** Forgets the undo snapshot and hides its toast. */
function dropUndo(): void {
  if (!snapshot) return;
  hideToast(snapshot.toastId);
  snapshot = null;
}

export interface CommitOptions {
  /** One more button in the toast, next to «Отменить» (e.g. «Показать» in «Лента»). */
  action?: ToastAction;
}

function commit(next: Data, message?: string, opts: CommitOptions = {}): void {
  const prev = data.value;
  const feedBefore = feedMonth.peek();
  show(next); // a new accounting year re-clamps feedMonth at once (state.ts)
  persistInBackground(next);
  if (message === undefined) {
    // an older «Отменить» would now revert this change instead of its own: drop it
    dropUndo();
    return;
  }
  snapshot = { prev, expiresAt: Date.now() + UNDO_MS, feedBefore, feedAfter: feedMonth.peek() };
  snapshot.toastId = showToast(message, { undo: () => void undo(), ...(opts.action ? { action: opts.action } : {}) });
}

/**
 * Restores the data before the last commit made with a message, within 5 s. False when nothing to undo.
 * The month of «Лента» comes back too when the change had moved it (a new accounting year clamps it) and
 * the user has not chosen another one since.
 */
function undo(): boolean {
  const s = snapshot;
  snapshot = null;
  if (!undoable(s)) return false;
  // decided BEFORE showing the old data: showing it re-clamps feedMonth (state.ts) when the new year's month
  // is not one of the old year's, which would look like a month the user chose
  const untouched = feedMonth.peek() === s.feedAfter;
  show(s.prev);
  if (s.feedAfter !== s.feedBefore && untouched) feedMonth.value = s.feedBefore;
  persistInBackground(s.prev);
  showToast(UNDONE);
  return true;
}

// ---------- replacing everything ----------

/**
 * Replaces all data (tracker import, restore from a backup): saves first and only then shows it, so a
 * failed save leaves everything as it was (rejects with the StoreError). Not undoable: «Отменить» of an
 * earlier change is dropped BEFORE saving, so it cannot slip in while the new data is being written.
 * If anything is committed while it saves, that commit wins: it is what is shown and what ends up
 * stored (last write wins), and replaceData rejects with DataChangedError (the user loads the file
 * again) — memory and storage never disagree.
 */
async function replaceData(next: Data): Promise<void> {
  dropUndo();
  const seen = version;
  await persist(next);
  if (version !== seen) throw new DataChangedError();
  show(next);
}

// ---------- meta ----------

let metaQueue: Promise<unknown> = Promise.resolve();

export interface UpdateMetaOptions {
  /** Keep the change in memory even when saving fails (the PIN counter and pause must hold). */
  applyOnFailure?: boolean;
  /**
   * The write sets a new PIN (onboarding, the «PIN» page): the only writers that may change the PIN
   * fields; this tab then unlocks with the new PIN.
   */
  pin?: boolean;
}

const PIN_ONLY = 'Only the PIN change may write the PIN fields and the generation.';
/** What memory keeps of its own when another tab's PIN is stored: this tab's PIN and its lock state. */
const OWN_LOCK_FIELDS = [...PIN_FIELDS, 'failedAttempts', 'lockedUntil'] as const;

/**
 * What memory takes after `next` was written (or, with applyOnFailure, could not be): `next` itself —
 * except when it holds another PIN than this tab's and the writer is not the PIN change. Then another tab
 * changed or removed the PIN meanwhile: memory keeps this tab's PIN and its counter and pause (a tab only
 * ever unlocks with the PIN it was started with; the lock refuses the other one until a restart) and
 * takes the rest (dates) from `next`.
 */
function remembered(next: Meta, opts: UpdateMetaOptions): Meta {
  const mine = meta.value;
  if (opts.pin || samePin(next, mine)) return next;
  const kept: Record<string, unknown> = { ...next };
  for (const k of OWN_LOCK_FIELDS) {
    if (mine[k] === undefined) delete kept[k];
    else kept[k] = mine[k];
  }
  return kept as unknown as Meta;
}

/**
 * What is written for `next` onto `stored`: `next` — plus a new generation when this tab's start could not
 * store one (generationPending) and `stored` is this tab's own PIN without one. Memory takes it only once it
 * is written: a failed write leaves memory, like storage, without one.
 */
function withPendingGeneration(stored: Meta, next: Meta, mine: Meta): Meta {
  if (!generationPending() || hasGeneration(next) || !hasPin(stored) || !samePin(stored, mine)) return next;
  return { ...next, generation: newGeneration() };
}

/**
 * Read-modify-write of the STORED meta in one transaction (updateStoredMeta): `fn` gets the meta as it is
 * stored right now — another tab may have changed it — and returns it with only its own fields changed.
 * Only while the stored generation is this tab's: otherwise nothing is written, it rejects with
 * StaleTabError and the tab stops (as it does at once when it has stopped already). A writer that is not
 * the PIN change (`pin`) never changes the PIN fields nor the generation: when it tries, nothing is
 * written and it rejects. Updates from this tab run one at a time. Memory then takes
 * the written meta (see `remembered`: a PIN that is not this tab's never enters memory unless this tab set
 * it). Rejects when the save fails, and with fn's own error when fn throws — nothing is written then and
 * memory stays as it was; with `applyOnFailure` a save that fails still changes memory (fn's result on the
 * stored meta, or on memory when the stored meta could not be read). Resolves with the written meta. A
 * caller with nothing to write does not call it. When this tab's start could not store a generation
 * (generationPending), a write onto this tab's own PIN also stores one (withPendingGeneration).
 */
function updateMeta(fn: (stored: Meta) => Meta, opts: UpdateMetaOptions = {}): Promise<Meta> {
  const job = metaQueue.then(async () => {
    if (stopped.value) throw new StaleTabError();
    const mine = meta.value;
    /** fn with the rule every writer keeps: only the PIN change changes the PIN (and the generation). */
    const apply = (base: Meta): Meta => {
      const next = fn(base);
      if (!opts.pin && (!samePin(next, base) || !sameGeneration(next, base))) throw new Error(PIN_ONLY);
      return next;
    };
    let computed: Meta | undefined;
    let refused = false;
    let written: Meta;
    try {
      written = await updateStoredMeta((stored) => {
        try {
          if (!sameGeneration(stored, mine)) throw new StaleTabError(); // another data set: nothing written
          computed = apply(stored);
        } catch (e) {
          refused = true;
          throw e;
        }
        return withPendingGeneration(stored, computed, mine);
      });
    } catch (e) {
      if (isStale(e)) stopTab();
      if (opts.applyOnFailure && !refused) {
        let next = computed;
        if (next === undefined) {
          try {
            next = apply(meta.value); // the stored meta could not be read: this tab's copy
          } catch {
            // fn refuses this tab's copy too: nothing changes
          }
        }
        if (next) meta.value = remembered(next, opts);
      }
      throw e;
    }
    meta.value = remembered(written, opts);
    if (hasGeneration(meta.value)) setGenerationPending(false);
    return written;
  });
  metaQueue = job.catch(() => {});
  return job;
}

/**
 * Records that a full backup was just made (hides the «сделайте резервную копию» banner for 14 days). A failed
 * save is shown in a toast — except in a tab that has stopped (another data set stored): its stop screen says why.
 */
async function markBackupDone(): Promise<void> {
  const at = new Date().toISOString();
  try {
    await updateMeta((m) => ({ ...m, lastBackupAt: at }));
  } catch (e) {
    if (isStale(e)) return;
    showToast(saveFailedText(e));
  }
}

/**
 * The sync state (meta.sync: the iCloud Drive sync with the Mac) — `undefined` removes it («never synced»).
 * Changes nothing else of the stored meta. Rejects like updateMeta (StaleTabError: the tab has stopped; a
 * StoreError when the save fails — memory then keeps the state it had); the caller says what it means.
 */
async function setSync(sync: SyncState | undefined): Promise<void> {
  await updateMeta((m) => {
    const next: Meta = { ...m, sync };
    if (sync === undefined) delete next.sync;
    return next;
  });
}

/** Resolves when every queued data and meta write has finished (whatever its outcome). */
async function flush(): Promise<void> {
  for (;;) {
    if (draining) {
      await draining;
      continue;
    }
    const queued = metaQueue;
    await queued;
    if (queued === metaQueue && !draining) return;
  }
}

export const actions = { commit, undo, replaceData, updateMeta, markBackupDone, setSync, flush };

/** True when there is something to lose (any row or a non-zero balance) and no backup for 14 days. */
export function needsBackup(m: Meta, d: Data | null, now: Date | number = Date.now()): boolean {
  if (!d) return false;
  const hasRows =
    d.operations.length > 0 ||
    d.journal.length > 0 ||
    d.recurring.length > 0 ||
    d.purchases.length > 0 ||
    d.debts.length > 0 ||
    d.accounts.some((a) => a.start !== 0);
  if (!hasRows) return false;
  if (!m.lastBackupAt) return true;
  const last = Date.parse(m.lastBackupAt);
  if (!Number.isFinite(last)) return true;
  const at = typeof now === 'number' ? now : now.getTime();
  return at - last > BACKUP_EVERY_MS;
}

onResetSession(() => {
  snapshot = null;
});
