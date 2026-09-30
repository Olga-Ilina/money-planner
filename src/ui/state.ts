// App-wide state as Preact signals. Screens read `data.value` (never mutate it: every change goes
// through actions.commit with a new object) and re-render when it changes.
import { effect, signal } from '@preact/signals';
import { accountingMonths, ymOf } from '../engine';
import type { Data, ISODate, YM } from '../engine';
import type { Meta } from '../store/db';
import { todayISO } from './format';

export type Tab = 'today' | 'feed' | 'accounts' | 'reports' | 'more';

export const TABS: readonly Tab[] = ['today', 'feed', 'accounts', 'reports', 'more'];

/** Root titles of the tabs (also the labels of the tab bar). */
export const TAB_TITLES: Record<Tab, string> = {
  today: 'Сегодня',
  feed: 'Лента',
  accounts: 'Счета',
  reports: 'Отчёты',
  more: 'Ещё',
};

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastState {
  id: number;
  text: string;
  /** Shown as «Отменить». */
  undo?: () => void;
  /** Any other single action, e.g. «Показать» (shown before «Отменить» when both are there). */
  action?: ToastAction;
}

/** The app data; null before loading and before onboarding has created it. */
export const data = signal<Data | null>(null);
/** PIN lock state and backup/import dates (src/store/db.ts). */
export const meta = signal<Meta>({ failedAttempts: 0 });
/** True while the PIN screen is shown (every cold start, and after 5 min in the background). */
export const locked = signal<boolean>(false);
/**
 * True once another tab deleted the data or set up new ones (another generation is stored, generation.ts):
 * this tab then shows only the stop screen until it is reloaded, and saves nothing.
 */
export const stopped = signal<boolean>(false);
export const tab = signal<Tab>('today');
/**
 * Month shown in «Лента»: always one of the 12 accounting months once there is data. A month outside
 * them (set here, or left over after the accounting year changed) becomes the current month when that
 * is inside the year, otherwise the nearest accounting month (the first before the year, the last after it).
 */
export const feedMonth = signal<YM>(ymOf(todayISO()));
export const toast = signal<ToastState | null>(null);

const todayDate = signal<ISODate>(todayISO());

/**
 * `ym` when it is one of `months` (ascending); else `current` when it is; else the month nearest to
 * `current`: the first when today is before the year, the last when it is after it.
 */
export function clampMonth(ym: YM, months: readonly YM[], current: YM): YM {
  const first = months[0];
  const last = months[months.length - 1];
  if (first === undefined || last === undefined || months.includes(ym)) return ym;
  if (months.includes(current)) return current;
  return current > last ? last : first;
}

// re-clamped whenever the data (its settings), the day or feedMonth itself changes
effect(() => {
  const d = data.value;
  if (!d) return;
  const ym = feedMonth.value;
  const clamped = clampMonth(ym, accountingMonths(d.settings), ymOf(todayDate.value));
  if (clamped !== ym) feedMonth.value = clamped;
});

/** Today's local date; reading it in a component re-renders the component when the day changes. */
export function today(): ISODate {
  return todayDate.value;
}

/** Re-reads the clock (the app calls it every minute and when it comes back to the foreground). */
export function refreshToday(): void {
  const now = todayISO();
  if (todayDate.value !== now) todayDate.value = now;
}

/** The data inside the unlocked app, where it always exists; throws when called before it is loaded. */
export function appData(): Data {
  const d = data.value;
  if (!d) throw new Error('appData() called before the data was loaded');
  return d;
}

export const DELETED_ACCOUNT = '(удалённый счёт)';

/** Account name by id; '' without an id, «(удалённый счёт)» for an id that no longer exists. */
export function accountName(d: Data | null, id: string | undefined): string {
  if (!id || !d) return '';
  return d.accounts.find((a) => a.id === id)?.name ?? DELETED_ACCOUNT;
}

export function hasPin(m: Meta): boolean {
  return typeof m.pinHash === 'string' && m.pinHash.length > 0;
}

/** The fields of the PIN a tab unlocks with (the hash, the salt, the iterations). */
export const PIN_FIELDS = ['pinHash', 'pinSalt', 'pinIterations'] as const;

/** The same PIN hash, salt and iterations (absent in both counts as the same). */
export function samePin(a: Meta, b: Meta): boolean {
  return PIN_FIELDS.every((k) => Object.is(a[k], b[k]));
}

/** Back to the state of a fresh start (after «Забыли PIN?» wiped everything, and in tests). */
export function resetSession(): void {
  data.value = null;
  meta.value = { failedAttempts: 0 };
  locked.value = false;
  stopped.value = false;
  tab.value = 'today';
  feedMonth.value = ymOf(todayISO());
  toast.value = null;
  todayDate.value = todayISO();
  for (const reset of resetHooks) reset();
}

const resetHooks: (() => void)[] = [];

/** Modules with their own session state (navigation, sheets, undo) register how to clear it. */
export function onResetSession(reset: () => void): void {
  resetHooks.push(reset);
}
