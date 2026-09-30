// The data generation (Meta.generation, src/store/db.ts): which data set this tab loaded. It is set by
// onboarding with a new PIN and cleared by a wipe. When another tab deleted the data («Забыли PIN?») or set
// up new ones, another generation (or none) is stored and this tab's copy is stale: the tab stops for good —
// App shows only «Данные изменились в другой вкладке. Перезапустите приложение.» with a reload, and nothing of
// the old data is shown or saved again. Checked by every save (the store refuses it with StaleTabError:
// actions.ts), on every unlock (checkLockPin, lockState.ts) and on every return to the foreground (session.ts).
// An old meta whose generation the start could not store (no space left) goes on without one, in storage and
// in memory alike, until the next meta write that succeeds stores it (`pending` below).
import { StoreError } from '../store/db';
import type { Meta } from '../store/db';
import { meta, onResetSession, stopped } from './state';

/**
 * True while this tab's meta has a PIN but no generation because its start could not store one for an old
 * meta (loadMetaAtStart: no space left…). Storage has none either, so every check still finds this tab's data
 * set and the owner gets in; the next meta write that succeeds onto this tab's own PIN stores one
 * (actions.updateMeta), and this tab takes it. Set by the start (App.tsx), cleared by resetSession.
 */
let pending = false;

/** Whether the next meta write stores a generation (see `pending`). */
export function generationPending(): boolean {
  return pending;
}

/** App.tsx at the start; actions.updateMeta once the generation is stored. */
export function setGenerationPending(on: boolean): void {
  pending = on;
}

onResetSession(() => {
  pending = false;
});

/** A StaleTabError (StoreError code 'stale'): another data set is stored. */
export function isStale(e: unknown): boolean {
  return e instanceof StoreError && e.code === 'stale';
}

/** Whether `stored` belongs to the data set of `mine` (this tab's meta): none stored and none here count as the same. */
export function sameGeneration(stored: Meta, mine: Meta = meta.value): boolean {
  return Object.is(stored.generation, mine.generation);
}

/** Stops this tab until it is reloaded (App shows the stop screen instead of everything else). */
export function stopTab(): void {
  stopped.value = true;
}

/** «Перезапустить» on the stop screen. */
export function reloadApp(): void {
  window.location.reload();
}
