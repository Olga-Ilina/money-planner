// What the lock screen (Lock.tsx) and the «PIN» page (pages/PinPage.tsx) share, so both keep the PIN
// lock the same way (checkLockPin). A tab only ever unlocks with the PIN it was started with (the PIN hash,
// salt and iterations in its memory), and only while that is still the STORED PIN, read right before the
// check and again right after it: another tab of the app may have changed the PIN, or removed it («Забыли
// PIN?») and set up a new one — this tab still holds the older data in memory, so no PIN opens it then.
// A stored PIN that is not this tab's (changed or removed): nothing is checked, accepted or written, and
// the keypad stays off until a restart; this tab never takes another tab's PIN. A read that fails: nothing
// is accepted or written, the next try reads again. The PIN is checked with the stricter counter and pause
// of storage and memory, so another tab cannot reset the count; the counter and the pause checkPin returns
// are saved into the STORED meta (one transaction) before a result is shown (and still hold for the session
// when saving fails); a wrong PIN never lowers a counter or a pause another tab stored meanwhile. Another
// data set stored (generation.ts: another tab deleted the data or set up new ones) stops the tab: nothing is
// checked or written. A pause ending more
// than 30 min ahead (the clock moved back) is cut to 30 min like checkPin cuts it, and saved while the
// stored PIN is this tab's; the countdown shows at most 30 min. The pure helpers take `now`; the hooks read
// the clock.
import { useEffect, useRef, useState } from 'preact/hooks';
import { StaleTabError, StoreError, loadMeta } from '../store/db';
import type { Meta } from '../store/db';
import { MAX_PAUSE_MS, checkPin } from '../store/pin';
import { actions } from './actions';
import { isStale, sameGeneration, stopTab } from './generation';
import { hasPin, meta, samePin } from './state';

export { MAX_PAUSE_MS };

/** Digits in a PIN. */
export const PIN_LENGTH = 4;

/** `m` with the mistake counter and the pause end of `from` (what checkPin changes). */
export function withLockState(m: Meta, from: Meta): Meta {
  const next: Meta = { ...m, failedAttempts: from.failedAttempts };
  if (from.lockedUntil === undefined) delete next.lockedUntil;
  else next.lockedUntil = from.lockedUntil;
  return next;
}

/**
 * `m` with the larger mistake counter and the later pause end of `m` and `other`; the rest is `m`'s. A
 * damaged counter or pause end (not a number) stays damaged — checkPin turns it into the longest pause.
 */
export function strictestLockState(m: Meta, other: Meta): Meta {
  const next: Meta = { ...m, failedAttempts: Math.max(m.failedAttempts, other.failedAttempts) };
  const a = m.lockedUntil;
  const b = other.lockedUntil;
  if (a === undefined && b === undefined) delete next.lockedUntil;
  else next.lockedUntil = a === undefined ? b : b === undefined ? a : Math.max(a, b);
  return next;
}

const MSG_PIN_REMOVED = 'PIN удалён в другой вкладке. Перезапустите приложение.';
const MSG_PIN_CHANGED = 'PIN изменён в другой вкладке. Перезапустите приложение.';

/**
 * No PIN is stored while this tab still has one: another tab used «Забыли PIN?». Checking this tab's copy
 * would open the data it still holds, and writing it would bring the PIN back, so nothing is checked or
 * written until a restart. A StoreError ('meta-damaged'), so its message is shown as is.
 */
export class PinRemovedError extends StoreError {
  constructor() {
    super(MSG_PIN_REMOVED, { code: 'meta-damaged' });
  }
}

/**
 * The stored PIN is not the one this tab was started with: another tab changed it, or wiped everything
 * and set up a new one. This tab still holds the older data in memory, so neither its PIN nor the stored
 * one may open it, and nothing is checked or written until a restart. A StoreError ('meta-damaged').
 */
export class PinChangedError extends StoreError {
  constructor() {
    super(MSG_PIN_CHANGED, { code: 'meta-damaged' });
  }
}

/** Why `stored` must not be checked or written by a tab whose PIN is `mine`'s; undefined when it may. */
function otherPin(stored: Meta, mine: Meta): StoreError | undefined {
  if (!hasPin(stored)) return new PinRemovedError();
  if (!samePin(stored, mine)) return new PinChangedError();
  return undefined;
}

/**
 * The meta to check a PIN against, read right before the check: the STORED meta — only while its data set
 * (generation) and its PIN are `m`'s (this tab's) — with the stricter counter and pause of storage and `m`,
 * so another tab cannot reset the counter. Rejects when the stored meta cannot be read, with StaleTabError
 * when another generation is stored (another tab deleted the data or set up new ones), with PinRemovedError
 * when it has no PIN and with PinChangedError when its PIN is another one: the PIN is then not checked
 * (fail closed).
 */
export async function freshLockMeta(m: Meta): Promise<Meta> {
  const stored = await loadMeta();
  if (!sameGeneration(stored, m)) throw new StaleTabError();
  const other = otherPin(stored, m);
  if (other) throw other;
  return strictestLockState(stored, m);
}

/** A pause that ends more than 30 min after `now` (the clock moved back) ends at `now` + 30 min, like checkPin does. */
export function cutLongPause(m: Meta, now: number): Meta {
  return m.lockedUntil !== undefined && m.lockedUntil - now > MAX_PAUSE_MS ? { ...m, lockedUntil: now + MAX_PAUSE_MS } : m;
}

/** Milliseconds left at `now` of a pause ending at `until`: 0 without one, at most 30 min. */
export function pauseLeft(until: number | undefined, now: number): number {
  return Math.max(0, until === undefined ? 0 : Math.min(until - now, MAX_PAUSE_MS));
}

/** «30 с», «1 мин 5 с», «2 мин». */
export function formatWait(ms: number): string {
  const total = Math.max(1, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min === 0) return `${sec} с`;
  return sec === 0 ? `${min} мин` : `${min} мин ${sec} с`;
}

/**
 * Saves the counter and the pause end of a checked meta (checkPin's result) into the STORED meta, in one
 * transaction (actions.updateMeta); nothing else changes, the PIN never. Only a right PIN (`reset`) may
 * lower them (to none); otherwise the stricter of `checked` and the stored ones is written, so a count
 * another tab stored right before this write is never lowered. Only while the stored meta has the PIN
 * `checked` was checked against: a checked meta with another PIN writes nothing (this tab never takes
 * another PIN, nor writes its own over it). Never rejects: when the write fails they are kept in memory
 * (`applyOnFailure`) and still hold for this session.
 */
export async function saveLockState(checked: Meta, reset = false): Promise<void> {
  try {
    await actions.updateMeta(
      (m) => {
        // the stored PIN must be the checked one AND this tab's: nothing is written otherwise
        if (!samePin(m, checked) || !samePin(m, meta.value)) throw new PinChangedError();
        return withLockState(m, reset ? checked : strictestLockState(checked, m));
      },
      { applyOnFailure: true },
    );
  } catch {
    // the counter and the pause still hold for this session (or another PIN: nothing to save)
  }
}

/** What checkLockPin found. */
export type LockCheck =
  /** The stored meta cannot be read (before or after the check): never ok, nothing written; tried again next time. */
  | { kind: 'unread'; error: unknown }
  /**
   * Never ok, and nothing more to check until a restart: damaged PIN data, no working crypto, no PIN
   * stored (PinRemovedError), a stored PIN that is not this tab's (PinChangedError), or another data set
   * stored (StaleTabError: the tab has stopped).
   */
  | { kind: 'broken'; error: unknown }
  /** Checked; its counter and pause are saved (or hold for the session). */
  | { kind: 'checked'; ok: boolean; waitMs: number };

/**
 * Checks `pin` for the lock screen and the «PIN» page against this tab's PIN, reading the stored meta
 * right before the check (freshLockMeta) and again right after it (another tab may have changed or
 * removed the PIN, counted mistakes, or deleted the data and set up new ones meanwhile). Only while both
 * reads show this tab's data set (generation) and PIN is the result accepted; otherwise it is 'broken'
 * (StaleTabError — and the tab stops —, PinRemovedError, PinChangedError) and nothing is written.
 * When a read fails the result is not accepted and nothing is written ('unread'). Saves the counter and
 * the pause BEFORE resolving: a right PIN resets them; a wrong one keeps the stricter counter and pause of
 * its result and of the second read, so a count another tab stored meanwhile is never lowered. Never
 * rejects.
 */
export async function checkLockPin(pin: string): Promise<LockCheck> {
  const mine = meta.value;
  let current: Meta;
  try {
    current = await freshLockMeta(mine);
  } catch (e) {
    if (isStale(e)) {
      stopTab(); // another data set is stored: nothing is checked, this tab stops
      return { kind: 'broken', error: e };
    }
    return e instanceof PinRemovedError || e instanceof PinChangedError
      ? { kind: 'broken', error: e }
      : { kind: 'unread', error: e };
  }
  let result;
  try {
    result = await checkPin(current, pin, Date.now());
  } catch (e) {
    return { kind: 'broken', error: e };
  }
  let latest: Meta;
  try {
    latest = await loadMeta();
  } catch (e) {
    return { kind: 'unread', error: e }; // not accepted, nothing written: the next try reads it again
  }
  if (!sameGeneration(latest, mine)) {
    stopTab(); // deleted or set up anew meanwhile: not accepted, nothing written, this tab stops
    return { kind: 'broken', error: new StaleTabError() };
  }
  const other = otherPin(latest, current);
  if (other) return { kind: 'broken', error: other }; // changed or removed meanwhile: nothing written
  const checked = result.ok ? result.meta : strictestLockState(result.meta, latest);
  await saveLockState(checked, result.ok); // never rejects
  return { kind: 'checked', ok: result.ok, waitMs: result.waitMs };
}

/** Milliseconds left of the pause ending at `until`, re-rendering every half second while it lasts. */
export function usePause(until: number | undefined): number {
  const [, setTick] = useState(0);
  const left = pauseLeft(until, Date.now());
  const active = left > 0;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [active, until]);
  return left;
}

/**
 * Cuts a pause ending more than 30 min ahead to 30 min and saves it. Reads the stored meta first: the cut is
 * written with the stricter counter and pause of storage and memory, only while the stored PIN is this
 * tab's (checked again inside the write's transaction). When the stored meta cannot be read, or its PIN is
 * not this tab's (changed or removed in another tab), nothing is written and the longer pause holds; when
 * another data set is stored, nothing is written and the tab stops.
 * Checked on every render (every half second during a pause), so the keypad follows the cut pause; one
 * write at a time.
 */
export function useCutLongPause(until: number | undefined): void {
  const cutting = useRef(false);
  useEffect(() => {
    if (cutting.current || until === undefined || until - Date.now() <= MAX_PAUSE_MS) return;
    cutting.current = true;
    void cutStoredPause().finally(() => (cutting.current = false));
  });
}

/** useCutLongPause's write. Never rejects. */
async function cutStoredPause(): Promise<void> {
  let stored: Meta;
  try {
    stored = await loadMeta();
  } catch {
    return; // not cut: the longer pause holds; tried again on the next render
  }
  if (!sameGeneration(stored)) {
    stopTab(); // another tab deleted the data or set up new ones: nothing written
    return;
  }
  if (!samePin(stored, meta.value)) return; // changed or removed in another tab: nothing written
  try {
    await actions.updateMeta(
      (m) => {
        const mine = meta.value;
        if (!samePin(m, mine)) throw new PinChangedError(); // changed meanwhile: nothing written
        return cutLongPause(strictestLockState(m, mine), Date.now());
      },
      { applyOnFailure: true },
    );
  } catch {
    // the cut pause still holds for this session (or another PIN: nothing written)
  }
}
