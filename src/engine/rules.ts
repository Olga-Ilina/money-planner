// Row rules — fact, plan and expected amounts exactly as the Excel tracker computes them.
import { dateIn, inAccountingYear, monthDiff, monthEnd, monthStart, ymOf } from './dates';
import type { Data, ISODate, JournalRow, Operation, Purchase, Recurring, Settings, YM } from './model';
import { opt } from './opt';
import { rowCheck } from './transfers';

// ── Journal ─────────────────────────────────────────────────────────────
/** Fact: the entered fact; otherwise the plan when paid; otherwise 0. */
export function journalFact(r: JournalRow): number {
  if (r.fact !== undefined) return r.fact;
  return r.status === 'paid' ? (r.plan ?? 0) : 0;
}

/** Plan: 0 when cancelled; otherwise the plan, or the fact when there is no plan. */
export function journalPlan(r: JournalRow): number {
  return r.status === 'cancelled' ? 0 : (r.plan ?? r.fact ?? 0);
}

/** Expected: the fact once paid or entered, the plan before that. */
export function journalExpected(r: JournalRow): number {
  return r.status === 'paid' || r.fact !== undefined ? journalFact(r) : journalPlan(r);
}

/** Accounting month: the chosen month if it is one of the 12 accounting months, else the month of the date. */
export function journalMonth(r: JournalRow, s: Settings): YM {
  return accountingMonthOf(r.date, r.month, s);
}

/** `journalMonth` from the two fields it reads (e.g. a form that has no row yet). */
export function accountingMonthOf(date: ISODate, month: YM | undefined, s: Settings): YM {
  const chosen = opt(month);
  return chosen !== undefined && inAccountingYear(chosen, s) ? chosen : ymOf(date);
}

// ── Recurring ───────────────────────────────────────────────────────────
/** The payment applies in month ym: inside from/to and on its every-N-months rhythm. */
export function recurringDue(rec: Recurring, ym: YM, s: Settings): boolean {
  const from = opt(rec.from);
  const to = opt(rec.to);
  if (from !== undefined && from > monthEnd(ym)) return false;
  if (to !== undefined && to < monthStart(ym)) return false;
  const anchor = from !== undefined ? ymOf(from) : s.accountingStart;
  const n = Math.max(1, rec.every ?? 1);
  const d = monthDiff(anchor, ym);
  return ((d % n) + n) % n === 0;
}

export function recurringDate(rec: Recurring, ym: YM): ISODate | undefined {
  return rec.day ? dateIn(ym, rec.day) : undefined;
}

export function recurringPlan(rec: Recurring, ym: YM, s: Settings): number {
  return recurringDue(rec, ym, s) ? rec.amount : 0;
}

/** Fact from the month mark: ✓ → amount, a number → that number, no mark → 0 (due or not). */
export function recurringFact(rec: Recurring, ym: YM): number {
  const mark = rec.marks[ym];
  if (mark === '✓') return rec.amount;
  return typeof mark === 'number' ? mark : 0;
}

/** Expected: the mark if the month is in the accounting year and marked, otherwise the plan. */
export function recurringExpected(rec: Recurring, ym: YM, s: Settings): number {
  return inAccountingYear(ym, s) && rec.marks[ym] !== undefined ? recurringFact(rec, ym) : recurringPlan(rec, ym, s);
}

// ── Purchases ───────────────────────────────────────────────────────────
/** Plan: the cost, in the month of the date; no date — no plan. */
export function purchasePlan(p: Purchase): number {
  return opt(p.date) !== undefined ? (p.cost ?? 0) : 0;
}

export function purchaseFact(p: Purchase): number {
  return p.bought ? (p.price ?? p.cost ?? 0) : 0;
}

export function purchaseExpected(p: Purchase): number {
  return p.bought ? purchaseFact(p) : purchasePlan(p);
}

// ── Operations ──────────────────────────────────────────────────────────
/** The sign of an operation amount does not matter: the kind decides. */
export function opAmount(o: Operation): number {
  return Math.abs(o.amount);
}

// ── Possible duplicates ─────────────────────────────────────────────────
export type DuplicateOf = 'journal' | 'recurring' | 'purchase';

// Excel COUNTIF compares text ignoring letter case.
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function namedLikeRecurringOrPurchase(data: Data, what: string): DuplicateOf | null {
  if (data.recurring.some((rec) => sameName(rec.what, what))) return 'recurring';
  if (data.purchases.some((p) => sameName(p.what, what))) return 'purchase';
  return null;
}

/**
 * A journal row named like a recurring payment or a purchase. A row with a check of its type and accounts (`rowCheck`)
 * shows that check instead, as the tracker's «Дубль или проверка» does, and is not counted as a duplicate.
 */
export function duplicatesForJournal(data: Data, r: JournalRow): DuplicateOf | null {
  if (r.what === '' || rowCheck(data, r) !== null) return null;
  return namedLikeRecurringOrPurchase(data, r.what);
}

/**
 * An expense/income operation that repeats a journal row (same date and fact) or is named like a recurring payment or a
 * purchase; never a transfer, nor a row with a check (`rowCheck`), as in the tracker.
 */
export function duplicatesForOperation(data: Data, o: Operation): DuplicateOf | null {
  if (o.kind === 'transfer' || o.what === '' || rowCheck(data, o) !== null) return null;
  const amount = opAmount(o);
  if (amount !== 0 && data.journal.some((r) => r.date === o.date && journalFact(r) === amount)) return 'journal';
  return namedLikeRecurringOrPurchase(data, o.what);
}
