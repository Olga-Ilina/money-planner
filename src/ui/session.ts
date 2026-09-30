// Auto-lock (spec §7): the app locks when it comes back after more than 5 minutes in the background
// (or when the clock went backwards meanwhile — fail closed). Cold starts are always locked (App).
// Fallback for a phone that freezes or suspends the app without a visibility or page event: the last
// time the app was seen running is recorded on the minute tick, on focus and on hiding and coming back;
// when the app is active again more than 5 minutes after it (or before it: the clock went back), it locks.
// While hidden, an opaque cover hides the screen (the iOS app switcher snapshot shows no data); it is
// removed on return only after the lock decision. Hiding never locks by itself (5 minutes, spec §7) —
// only a gap of more than 5 minutes before it does.
// Also keeps today() current: every minute and on every return to the foreground.
// On every return to the foreground a tab that holds data also checks that the stored data set is still
// the one it loaded (generation.ts): another tab may have deleted the data or set up new ones meanwhile —
// then it stops; when the stored meta cannot be read, it locks (fail closed).
import { loadMeta } from '../store/db';
import type { Meta } from '../store/db';
import { sameGeneration, stopTab } from './generation';
import { data, hasPin, locked, meta, onResetSession, refreshToday, stopped } from './state';

export const LOCK_AFTER_MS = 5 * 60_000;
const CLOCK_TICK_MS = 60_000;
/** Class on <html> while the app is in the background: styles.css covers everything with --bg. */
export const COVER_CLASS = 'privacy-cover';

function cover(on: boolean): void {
  document.documentElement.classList.toggle(COVER_CLASS, on);
}

let hiddenAt: number | null = null;
/** When the app was last seen running (watchSession's clock); null while nothing is watched. */
let lastSeen: number | null = null;
/** Bumped by every lock, so a PIN check that started before the app locked again cannot unlock it. */
let generation = 0;
/** Bumped by resetSession and when watching stops: a data-set check started before then is ignored. */
let epoch = 0;

/** The app went to the background at `now` (the first of several hide events counts). */
export function noteHidden(now: number = Date.now()): void {
  if (hiddenAt === null) hiddenAt = now;
}

/** The app is back at `now`: lock if it was away too long. */
export function noteVisible(now: number = Date.now()): void {
  refreshToday();
  if (hiddenAt === null) return;
  const away = now - hiddenAt;
  hiddenAt = null;
  if (away > LOCK_AFTER_MS || away < 0) lockNow();
}

/**
 * The app is running at `now` (the minute tick, focus, hiding, coming back): lock when it was last seen
 * more than 5 minutes before (frozen or suspended without an event) or after `now` (the clock went back).
 */
function noteAlive(now: number = Date.now()): void {
  if (lastSeen !== null) {
    const gap = now - lastSeen;
    if (gap > LOCK_AFTER_MS || gap < 0) lockNow();
  }
  lastSeen = now;
}

/** Shows the PIN screen (only when a PIN is set). */
export function lockNow(): void {
  if (!hasPin(meta.value)) return;
  generation += 1;
  locked.value = true;
}

/** Read before checking a PIN; pass it to unlockIfCurrent afterwards. */
export function lockGeneration(): number {
  return generation;
}

/**
 * Unlocks after a correct PIN — unless the app locked again since `since` was read (the app was
 * hidden for more than 5 minutes while the PIN was being checked). Returns whether it unlocked.
 */
export function unlockIfCurrent(since: number): boolean {
  if (since !== generation) return false;
  locked.value = false;
  return true;
}

/**
 * Back in the foreground with data in memory: stops the tab when another data set is stored now than the
 * one it held when the check began; locks it when the stored meta cannot be read (the unlock reads it
 * again). A check that outlives a session reset (this tab's own wipe) does nothing. Never rejects.
 */
async function checkDataSet(): Promise<void> {
  if (data.value === null || stopped.value) return;
  const since = epoch;
  const mine = meta.value;
  let stored: Meta;
  try {
    stored = await loadMeta();
  } catch {
    if (since === epoch) lockNow();
    return;
  }
  if (since === epoch && !sameGeneration(stored, mine)) stopTab();
}

/** Starts watching visibility and the clock; returns the function that stops it. */
export function watchSession(): () => void {
  lastSeen = Date.now();
  const hide = () => {
    cover(true);
    noteAlive();
    noteHidden();
  };
  const show = () => {
    noteVisible(); // the lock decisions first…
    noteAlive();
    cover(false); // …then the screen (already the PIN screen when it locked)
    void checkDataSet(); // …and whether the data set is still this tab's
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? hide() : show());
  const onPageHide = () => hide();
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) show();
    else {
      noteAlive();
      cover(false);
    }
  };
  const onFocus = () => noteAlive();
  const tick = () => {
    noteAlive();
    refreshToday();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('focus', onFocus);
  const clock = setInterval(tick, CLOCK_TICK_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('focus', onFocus);
    clearInterval(clock);
    lastSeen = null;
    epoch += 1;
    cover(false);
  };
}

onResetSession(() => {
  hiddenAt = null;
  epoch += 1;
});
