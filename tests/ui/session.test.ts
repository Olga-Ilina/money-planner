// @vitest-environment happy-dom
// Auto-lock fallback (spec §7): a phone may freeze or suspend the app without a visibility or page event.
// The session records when the app was last seen running (the minute tick, focus, hiding, coming back)
// and locks when the app is active again after more than 5 minutes without a sign of life — in addition
// to the visibility / pageshow rule.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCK_AFTER_MS, lockGeneration, watchSession } from '../../src/ui/session';
import { locked, meta, resetSession } from '../../src/ui/state';

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 30, 10, 0, 0);

let visibility: DocumentVisibilityState = 'visible';
let stop: (() => void) | null = null;

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Time passes while the app is frozen: the clock moves, no timer runs and no event fires. */
function freeze(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
  resetSession();
  meta.value = { failedAttempts: 0, pinHash: 'h', pinSalt: 's' };
  locked.value = false;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.useFakeTimers({ now: T0 });
  stop = watchSession();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  resetSession();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('auto-lock fallback: the last time the app was seen running', () => {
  it('the minute tick never locks an app in use, however long', () => {
    vi.advanceTimersByTime(3 * 60 * MIN);
    expect(locked.value).toBe(false);
  });

  it('the first minute tick after a freeze of more than 5 min locks (no visibility event came)', () => {
    vi.advanceTimersByTime(2 * MIN);
    freeze(LOCK_AFTER_MS);
    vi.advanceTimersByTime(MIN - 1);
    expect(locked.value).toBe(false);
    vi.advanceTimersByTime(1); // the tick: last seen 5 min + 1 min ago
    expect(locked.value).toBe(true);
  });

  it('a freeze of 5 min or less does not lock', () => {
    vi.advanceTimersByTime(MIN); // a tick at T0 + 1 min
    freeze(LOCK_AFTER_MS - MIN); // the next tick comes exactly 5 min after it
    vi.advanceTimersByTime(MIN);
    expect(locked.value).toBe(false);
    window.dispatchEvent(new Event('focus'));
    expect(locked.value).toBe(false);
  });

  it('focus after a freeze of more than 5 min locks at once', () => {
    freeze(LOCK_AFTER_MS + 1);
    window.dispatchEvent(new Event('focus'));
    expect(locked.value).toBe(true);
  });

  it('pageshow after a freeze of more than 5 min locks, even without a pagehide before it', () => {
    freeze(10 * MIN);
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(locked.value).toBe(true);
  });

  it('becoming visible after a freeze of more than 5 min locks, even without a hide before it', () => {
    freeze(10 * MIN);
    setVisibility('visible');
    expect(locked.value).toBe(true);
  });

  it('hiding records the time: 4.5 min in the background, the last tick 59 s before hiding, does not lock', () => {
    vi.advanceTimersByTime(MIN + 59_000); // the last tick was 59 s ago
    setVisibility('hidden');
    freeze(4.5 * MIN);
    setVisibility('visible');
    expect(locked.value).toBe(false);
  });

  it('the visibility rule still holds when timers keep running in the background', () => {
    setVisibility('hidden');
    vi.advanceTimersByTime(LOCK_AFTER_MS + MIN); // ticks while hidden: never a gap
    expect(locked.value).toBe(false); // hiding alone never locks
    setVisibility('visible');
    expect(locked.value).toBe(true);
  });

  it('the clock going backwards while frozen locks (fail closed)', () => {
    vi.advanceTimersByTime(MIN);
    freeze(-2 * MIN);
    vi.advanceTimersByTime(MIN);
    expect(locked.value).toBe(true);
  });

  it('a lock by the gap cancels a PIN check that started before it', () => {
    const since = lockGeneration();
    freeze(LOCK_AFTER_MS + 1);
    window.dispatchEvent(new Event('focus'));
    expect(lockGeneration()).not.toBe(since);
  });

  it('never locks without a PIN', () => {
    meta.value = { failedAttempts: 0 };
    freeze(60 * MIN);
    vi.advanceTimersByTime(MIN);
    window.dispatchEvent(new Event('focus'));
    expect(locked.value).toBe(false);
  });

  it('stops with the session: no tick and no focus check afterwards', () => {
    stop?.();
    stop = null;
    expect(vi.getTimerCount()).toBe(0);
    freeze(60 * MIN);
    window.dispatchEvent(new Event('focus'));
    expect(locked.value).toBe(false);
  });

  it('a new session starts counting from its own start', () => {
    stop?.();
    freeze(60 * MIN); // the app was not watching meanwhile (e.g. before the first start)
    stop = watchSession();
    vi.advanceTimersByTime(MIN);
    window.dispatchEvent(new Event('focus'));
    expect(locked.value).toBe(false);
  });
});
