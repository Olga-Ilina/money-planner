// Account balances, credit-card statements and auto-payments, money at the forecast start.
// Balances count everything from settings.balancesDate on: journal rows by accounting month,
// everything else by date (purchases without a date count too).
// Savings accounts are outside the balance (spec 2026-10-01-savings-accounts): their balances are kept as
// every other, but «Всего» and the forecast count only the accounts in the balance (debit, cash, credit).
import { accountingMonths, addDays, addMonths, clampDay, dateIn, monthStart, ymOf } from './dates';
import type { AccountType, Data, ISODate, Operation, Recurring, Settings, YM } from './model';
import { opt } from './opt';
import { journalFact, journalMonth, opAmount, purchaseFact, recurringDate, recurringFact } from './rules';

export interface BalanceRow {
  id: string;
  name: string;
  type: AccountType;
  start: number;
  income: number;
  expense: number;
  transfers: number; // transfers in − out, ± credit-card auto-payments
  now: number;
  debt?: number; // credit account below zero
}

export interface Balances {
  rows: BalanceRow[];
  cards: number; // «На картах»: debit accounts
  cash: number;
  creditDebt: number; // ≤ 0
  total: number; // «Всего»: the accounts in the balance (debit, cash, credit), savings left out
  savings: number; // «Сбережения»: the savings accounts, outside «Всего» and the forecast
}

export interface CreditStatement {
  from: ISODate; // statement period, inclusive; never before the balances date (empty when after `close`)
  close: ISODate;
  carried: number; // debt from the previous statement; on the first statement paid on or after the balances date, the card start
  repaid: number; // auto-payment of the previous statement
  purchases: number; // ≤ 0
  other: number; // refunds, income and transfers to the card
  debt: number;
  payDate: ISODate; // after `close`: in the next month when the pay day is not after the close day
  payAmount: number;
  counted: number; // payAmount once payDate has come (and is not before the balances date)
}

export type MovementSource = 'operation' | 'journal' | 'recurring' | 'purchase' | 'repayment';

export interface Movement {
  date: ISODate;
  source: MovementSource;
  id: string; // id of the row; for auto-payments 'credit-<statement close date>'
  ym?: YM; // recurring: month of the mark
  what: string;
  amount: number; // + in, − out
  running: number;
}

/**
 * Whether a row of account `id` counts in the balance — in «Всего» and in the forecast: every account but a savings
 * one. A row without an account, or of an account that no longer exists, counts in the balance, as in the tracker
 * (its flag is 0 only for a name found among the «Сберегательная» accounts).
 */
export function inBalance(data: Pick<Data, 'accounts'>, id: string | undefined): boolean {
  return balanceCheck(data)(id);
}

/** `inBalance` for many rows: looks the savings accounts up once. */
export function balanceCheck(data: Pick<Data, 'accounts'>): (id: string | undefined) => boolean {
  const outside = new Set(data.accounts.filter((a) => a.type === 'savings').map((a) => a.id));
  return (id) => {
    const given = opt(id);
    return given === undefined || !outside.has(given);
  };
}

/**
 * How a transfer changes the free money (the forecast): −amount from the balance into savings, +amount out of
 * savings into the balance, 0 inside one group or without «На счёт» (the tracker's Операции U). A transfer without
 * «Со счёта» comes from the balance. An expense or an income: 0 (it is not a transfer).
 */
export function transferToFree(data: Pick<Data, 'accounts'>, o: Operation): number {
  return transferEffect(balanceCheck(data), o);
}

function transferEffect(counts: (id: string | undefined) => boolean, o: Operation): number {
  if (o.kind !== 'transfer' || opt(o.toAccount) === undefined) return 0;
  return (Number(counts(o.toAccount)) - Number(counts(o.account))) * opAmount(o);
}

/** A dated move of money between the balance and savings: + into the free money, − out of it. */
export interface FreeMoneyMove {
  date: ISODate;
  amount: number;
}

/**
 * Every transfer and credit-card auto-payment that moves money between the balance and savings, with its effect on
 * the free money. An auto-payment moves the statement's amount (facts only, whatever today is) from the pay-from
 * account to the card, so paid from savings it is an inflow — the tracker's «Переводы в сбережения (−) / из
 * сбережений (+)» and the part of «Деньги на старте» it adds.
 */
export function freeMoneyMoves(data: Data): FreeMoneyMove[] {
  const counts = balanceCheck(data);
  const out: FreeMoneyMove[] = [];
  for (const o of data.operations) {
    const date = opt(o.date);
    const amount = transferEffect(counts, o);
    if (date !== undefined && amount !== 0) out.push({ date, amount });
  }
  const perPayment = Number(counts(creditCardId(data))) - Number(counts(payFromId(data)));
  if (perPayment !== 0) {
    // the statement amounts do not depend on today (only `counted` does)
    for (const st of creditStatements(data, data.settings.balancesDate)) {
      if (st.payAmount !== 0) out.push({ date: st.payDate, amount: perPayment * st.payAmount });
    }
  }
  return out;
}

/** The net of `freeMoneyMoves` dated from..to (inclusive). */
export function freeMoneyTransfers(data: Data, from: ISODate, to: ISODate, moves = freeMoneyMoves(data)): number {
  return moves.reduce((sum, m) => (m.date >= from && m.date <= to ? sum + m.amount : sum), 0);
}

/** The credit card: the chosen account, else the first account of type 'credit'. */
export function creditCardId(data: Data): string | undefined {
  return opt(data.credit.accountId) ?? data.accounts.find((a) => a.type === 'credit')?.id;
}

/**
 * The account auto-payments are taken from: the chosen account, else the first account that is
 * not a credit card. Undefined when there is none — then no auto-payment is made.
 */
export function payFromId(data: Data): string | undefined {
  return opt(data.credit.fromAccountId) ?? data.accounts.find((a) => a.type !== 'credit')?.id;
}

interface RecurringFact {
  rec: Recurring;
  ym: YM;
  date: ISODate;
  fact: number;
}

/** Recurring facts of the 12 accounting months that have a payment date. */
function recurringFacts(data: Data): RecurringFact[] {
  const out: RecurringFact[] = [];
  for (const ym of accountingMonths(data.settings)) {
    for (const rec of data.recurring) {
      const date = recurringDate(rec, ym);
      if (date !== undefined) out.push({ rec, ym, date, fact: recurringFact(rec, ym) });
    }
  }
  return out;
}

const signed = (income: boolean, value: number): number => (income ? value : -value);

export function creditStatements(data: Data, today: ISODate): CreditStatement[] {
  const s = data.settings;
  const cc = creditCardId(data);
  const card = data.accounts.find((a) => a.id === cc);
  const autoPay = data.credit.auto && payFromId(data) !== undefined;
  const recFacts = recurringFacts(data);
  const closeDay = clampDay(data.credit.closeDay);
  const payDay = clampDay(data.credit.payDay);
  // A card is paid after its statement closes: a pay day on or before the close day is next month.
  const payShift = payDay <= closeDay ? 1 : 0;
  const rows: CreditStatement[] = [];
  for (const ym of accountingMonths(s)) {
    const prev = rows[rows.length - 1];
    const close = dateIn(ym, closeDay);
    const payDate = dateIn(addMonths(ym, payShift), payDay);
    // Never before the balances date: anything earlier is already inside the account starts.
    const afterPrev = prev ? addDays(prev.close, 1) : s.balancesDate;
    const from = afterPrev < s.balancesDate ? s.balancesDate : afterPrev;
    // Paid before the balances date: the statement is already inside the starts (its period is empty).
    if (payDate < s.balancesDate) {
      rows.push({ from, close, carried: 0, repaid: 0, purchases: 0, other: 0, debt: 0, payDate, payAmount: 0, counted: 0 });
      continue;
    }
    const inWindow = (d: ISODate | undefined): boolean => {
      const day = opt(d);
      return day !== undefined && day >= from && day <= close;
    };
    let purchases = 0;
    let other = 0;
    if (cc !== undefined) {
      for (const o of data.operations) {
        if (!inWindow(o.date)) continue;
        const amount = opAmount(o);
        if (o.kind === 'expense' && o.account === cc) purchases -= amount;
        if (o.kind === 'income' && o.account === cc) other += amount;
        if (o.kind === 'transfer') {
          if (o.toAccount === cc) other += amount;
          if (o.account === cc) other -= amount;
        }
      }
      for (const r of data.journal) {
        if (r.account !== cc || !inWindow(r.date)) continue;
        if (r.kind === 'income') other += journalFact(r);
        else purchases -= journalFact(r);
      }
      for (const f of recFacts) {
        if (f.rec.account !== cc || !inWindow(f.date)) continue;
        if (f.rec.kind === 'income') other += f.fact;
        else purchases -= f.fact;
      }
      for (const p of data.purchases) {
        if (p.account === cc && inWindow(p.date)) purchases -= purchaseFact(p);
      }
    }
    // The card's start belongs to the first statement paid on or after the balances date.
    const first = prev === undefined || prev.payDate < s.balancesDate;
    const carried = first ? Math.min(0, card?.start ?? 0) : prev.debt;
    const repaid = first ? 0 : prev.payAmount;
    const debt = carried + repaid + purchases + other;
    const payAmount = autoPay && debt < 0 ? -debt : 0;
    const counted = payDate <= today && payDate >= s.balancesDate ? payAmount : 0;
    rows.push({ from, close, carried, repaid, purchases, other, debt, payDate, payAmount, counted });
  }
  return rows;
}

/** Whether a record dated `date` (an operation, a recurring mark, a purchase) counts in the balances: from the balances date on. */
export function dateInBalances(date: ISODate, s: Settings): boolean {
  return date >= s.balancesDate;
}

/** Whether a journal row of accounting month `month` counts in the balances: from the month of the balances date on. */
export function monthInBalances(month: YM, s: Settings): boolean {
  return month >= ymOf(s.balancesDate);
}

/**
 * The months whose marks of `rec` change the balance of its account (as `balances` counts them): accounting
 * months where the payment has a date (a day), on or after the balances date, with a fact other than 0.
 */
export function marksInBalances(rec: Recurring, s: Settings): YM[] {
  return accountingMonths(s).filter((ym) => {
    const date = recurringDate(rec, ym);
    return date !== undefined && dateInBalances(date, s) && recurringFact(rec, ym) !== 0;
  });
}

/** The first auto-payment on or after today. */
export function nextCreditDebit(data: Data, today: ISODate): { date: ISODate; amount: number } | null {
  const next = creditStatements(data, today).find((r) => r.payDate >= today);
  return next ? { date: next.payDate, amount: next.payAmount } : null;
}

export function balances(data: Data, today: ISODate): Balances {
  const s = data.settings;
  const cc = creditCardId(data);
  const payFrom = payFromId(data);
  const repaidSoFar = creditStatements(data, today).reduce((acc, r) => acc + r.counted, 0);
  const recFacts = recurringFacts(data).filter((f) => dateInBalances(f.date, s));

  const rows = data.accounts.map((a): BalanceRow => {
    let income = 0;
    let expense = 0;
    let transfers = 0;
    for (const o of data.operations) {
      if (!dateInBalances(o.date, s)) continue;
      const amount = opAmount(o);
      if (o.kind === 'transfer') {
        if (o.toAccount === a.id) transfers += amount;
        if (o.account === a.id) transfers -= amount;
      } else if (o.account === a.id) {
        if (o.kind === 'income') income += amount;
        else expense += amount;
      }
    }
    for (const r of data.journal) {
      if (r.account !== a.id || !monthInBalances(journalMonth(r, s), s)) continue;
      if (r.kind === 'income') income += journalFact(r);
      else expense += journalFact(r);
    }
    for (const f of recFacts) {
      if (f.rec.account !== a.id) continue;
      if (f.rec.kind === 'income') income += f.fact;
      else expense += f.fact;
    }
    for (const p of data.purchases) {
      const date = opt(p.date);
      if (p.account !== a.id || (date !== undefined && !dateInBalances(date, s))) continue;
      expense += purchaseFact(p);
    }
    if (a.id === cc) transfers += repaidSoFar;
    if (a.id === payFrom) transfers -= repaidSoFar;
    const now = a.start + income - expense + transfers;
    const row: BalanceRow = { id: a.id, name: a.name, type: a.type, start: a.start, income, expense, transfers, now };
    if (a.type === 'credit' && now < 0) row.debt = now;
    return row;
  });

  const sumWhere = (pick: (r: BalanceRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  return {
    rows,
    cards: sumWhere((r) => (r.type === 'debit' ? r.now : 0)),
    cash: sumWhere((r) => (r.type === 'cash' ? r.now : 0)),
    creditDebt: sumWhere((r) => r.debt ?? 0),
    total: sumWhere((r) => (r.type !== 'savings' ? r.now : 0)),
    savings: sumWhere((r) => (r.type === 'savings' ? r.now : 0)),
  };
}

/**
 * The free money at the forecast start (the tracker's «Деньги на старте прогноза (без сбережений)»): the starts of
 * the accounts in the balance plus their fact between the balances date and the forecast start, plus the transfers
 * and auto-payments across the line to savings in that time — so it is what the accounts in the balance hold then.
 * Rows without an account count in the balance. `moves`: `freeMoneyMoves(data)`, when the caller already has them.
 */
export function cashAtForecastStart(data: Data, moves = freeMoneyMoves(data)): number {
  const s = data.settings;
  const sd = s.balancesDate;
  const sdMonth = ymOf(sd);
  const fs = monthStart(s.forecastStart);
  const fsMonth = s.forecastStart;
  const inWindow = (d: ISODate | undefined): boolean => {
    const day = opt(d);
    return day !== undefined && day >= sd && day < fs;
  };
  const counts = balanceCheck(data);
  let cash = data.accounts.reduce((acc, a) => (counts(a.id) ? acc + a.start : acc), 0);
  for (const o of data.operations) {
    if (o.kind !== 'transfer' && inWindow(o.date) && counts(o.account)) cash += signed(o.kind === 'income', opAmount(o));
  }
  for (const r of data.journal) {
    const m = journalMonth(r, s);
    if (m >= sdMonth && m < fsMonth && counts(r.account)) cash += signed(r.kind === 'income', journalFact(r));
  }
  for (const f of recurringFacts(data)) {
    if (inWindow(f.date) && counts(f.rec.account)) cash += signed(f.rec.kind === 'income', f.fact);
  }
  for (const p of data.purchases) {
    if (inWindow(p.date) && counts(p.account)) cash -= purchaseFact(p);
  }
  return cash + freeMoneyTransfers(data, sd, addDays(fs, -1), moves);
}

/**
 * Money movements of one account dated from..to (inclusive) with a running balance.
 * Counts the same rows as `balances`; the opening balance is the start plus every counted
 * movement dated before `from`. Auto-payments count once their date is ≤ `today`.
 * Bought purchases without a date change the balance but cannot be placed by date, so they are not listed.
 */
export function accountMovements(data: Data, accountId: string, from: ISODate, to: ISODate, today: ISODate): Movement[] {
  const s = data.settings;
  const sd = s.balancesDate;
  const sdMonth = ymOf(sd);
  const all: Omit<Movement, 'running'>[] = [];
  const add = (m: Omit<Movement, 'running'>) => {
    if (m.amount !== 0) all.push(m);
  };

  for (const o of data.operations) {
    if (o.date < sd) continue;
    const amount = opAmount(o);
    let value = 0;
    if (o.kind === 'transfer') {
      if (o.toAccount === accountId) value += amount;
      if (o.account === accountId) value -= amount;
    } else if (o.account === accountId) {
      value = signed(o.kind === 'income', amount);
    }
    add({ date: o.date, source: 'operation', id: o.id, what: o.what, amount: value });
  }
  for (const r of data.journal) {
    if (r.account !== accountId || journalMonth(r, s) < sdMonth) continue;
    add({ date: r.date, source: 'journal', id: r.id, what: r.what, amount: signed(r.kind === 'income', journalFact(r)) });
  }
  for (const f of recurringFacts(data)) {
    if (f.rec.account !== accountId || f.date < sd) continue;
    add({ date: f.date, source: 'recurring', id: f.rec.id, ym: f.ym, what: f.rec.what, amount: signed(f.rec.kind === 'income', f.fact) });
  }
  for (const p of data.purchases) {
    const date = opt(p.date);
    if (p.account !== accountId || date === undefined || date < sd) continue;
    add({ date, source: 'purchase', id: p.id, what: p.what, amount: -purchaseFact(p) });
  }
  const cc = creditCardId(data);
  const payFrom = payFromId(data);
  for (const st of creditStatements(data, today)) {
    let value = 0;
    if (accountId === cc) value += st.counted;
    if (accountId === payFrom) value -= st.counted;
    add({ date: st.payDate, source: 'repayment', id: `credit-${st.close}`, what: 'Погашение кредитки', amount: value });
  }

  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); // stable: same-day order is kept
  const start = data.accounts.find((a) => a.id === accountId)?.start ?? 0;
  let running = all.filter((m) => m.date < from).reduce((acc, m) => acc + m.amount, start);
  const out: Movement[] = [];
  for (const m of all) {
    if (m.date < from || m.date > to) continue;
    running += m.amount;
    out.push({ ...m, running });
  }
  return out;
}
