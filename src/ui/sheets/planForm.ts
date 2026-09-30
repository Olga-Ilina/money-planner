// Small pieces shared by the forms: the plan forms of «Ещё» (RecurringForm, PurchaseForm, DebtForm), and
// for OperationForm and JournalForm the note about a date outside the accounting year and «Показать».
import { accountingMonths, addMonths, inAccountingYear } from '../../engine';
import type { Data, Settings, YM } from '../../engine';
import type { CommitOptions } from '../actions';
import type { Option } from '../kit';
import { openTab } from '../nav';
import { monthRange } from '../pages/usageText';
import { DELETED_ACCOUNT, feedMonth, tab } from '../state';

/**
 * Saved from «Лента» into another month than it shows (a record's month: an operation's date, a journal row's
 * accounting month): the toast offers «Показать», which switches «Лента» to that month. Nothing outside
 * «Лента», for the shown month, or for a month «Лента» cannot show (outside the accounting year).
 */
export function showInFeed(s: Settings, ym: YM): CommitOptions {
  if (tab.value !== 'feed' || ym === feedMonth.value || !inAccountingYear(ym, s)) return {};
  return {
    action: {
      label: 'Показать',
      onClick: () => {
        feedMonth.value = ym;
        openTab('feed');
      },
    },
  };
}

/**
 * Under a date when the record's month (an operation: its date's; a journal row: its accounting month) is
 * outside the accounting year: «Лента» and the reports never show such a record; it changes the balances only
 * when they count it (`inBalances`: the engine's `dateInBalances` / `monthInBalances` — not before «Дата
 * остатков»). Saving stays allowed.
 */
export function outsideYearNote(s: Settings, ym: YM | undefined, inBalances: boolean): string | undefined {
  if (ym === undefined || inAccountingYear(ym, s)) return undefined;
  const months = accountingMonths(s);
  const range = monthRange(months[0] ?? s.accountingStart, months[11] ?? addMonths(s.accountingStart, 11));
  const where = inBalances
    ? 'запись учтётся в остатках, но не попадёт в ленту и отчёты'
    : 'запись не попадёт ни в остатки (раньше даты остатков), ни в ленту и отчёты';
  return `Дата вне учётного года (${range}): ${where}. Учётный год меняется в «Ещё → Учёт и прогноз».`;
}

/** The object without its undefined fields: a cleared optional field is stored as absent. */
export function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Replaces the row with the same id, or adds it at the end (a new row, or one deleted meanwhile). */
export function upsert<T extends { id: string }>(rows: readonly T[], row: T): T[] {
  return rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];
}

/** Options from names, plus the current value when it is not among them (a value is never lost). */
export function nameOptions(names: readonly string[], current: string | undefined): Option[] {
  const options = names.map((n) => ({ value: n, label: n }));
  return current !== undefined && !names.includes(current) ? [...options, { value: current, label: current }] : options;
}

/** `id` when it names an account that exists; undefined without one or for a deleted account (as good as none). */
export function knownAccount(d: Data, id: string | undefined): string | undefined {
  return id !== undefined && d.accounts.some((a) => a.id === id) ? id : undefined;
}

/** The accounts, plus «(удалённый счёт)» for a current id that no longer exists. */
export function accountOptions(d: Data, current: string | undefined): Option[] {
  const options = d.accounts.map((a) => ({ value: a.id, label: a.name }));
  return current !== undefined && !d.accounts.some((a) => a.id === current)
    ? [...options, { value: current, label: DELETED_ACCOUNT }]
    : options;
}

/** Validation errors of a form: shown once saving was tried, then kept up to date as fields change. */
export type Errors<K extends string> = Partial<Record<K, string>>;

export const hasErrors = (e: Errors<string>): boolean => Object.values(e).some((m) => m !== undefined);

/** 'Октябрь 2026' → 'октябрь 2026' (inside a sentence). */
export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Between the parts of a row's subtitle: « ·» and a no-break space, so the dot stays with the word after
 * it and a wrapped line never ends with a dangling «·».
 */
export const DOT = ' ·\u00a0';

/** The parts that are there, joined by `DOT`. */
export const dotted = (parts: readonly (string | undefined)[]): string => parts.filter(Boolean).join(DOT);
