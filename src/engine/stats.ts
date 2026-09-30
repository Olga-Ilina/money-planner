// Month and year statistics: plan and fact of income and expenses, per expense category.
// Keys: journal — accounting month; recurring — month of the expansion; purchases and operations — month of the date.
import { accountingMonths, daysInMonth, monthLabel, ymOf } from './dates';
import type { Data, ISODate, YM } from './model';
import { opt } from './opt';
import {
  journalFact,
  journalMonth,
  journalPlan,
  opAmount,
  purchaseFact,
  purchasePlan,
  recurringDate,
  recurringFact,
  recurringPlan,
} from './rules';

export interface MonthTotals {
  incomePlan: number;
  incomeFact: number;
  expensePlan: number;
  expenseFact: number;
}

export interface CategorySummary {
  name: string;
  limit?: number;
  plan: number;
  fact: number;
  left?: number; // limit − fact
  share?: number; // fact / limit (0 when the limit is 0)
}

export interface MonthSummary extends MonthTotals {
  balanceFact: number;
  byCategory: CategorySummary[];
  uncategorized: { plan: number; fact: number };
  limitsTotal: number; // Σ limit of the categories that have one (a limit of 0 counts)
  limitsLeft: number; // Σ (limit − fact) over the same categories
}

export interface YearMonth extends MonthTotals {
  ym: YM;
  label: string;
  balance: number; // income fact − expense fact
  cumulative: number;
  ratio: number; // expense fact / expense plan, 0 without a plan
}

export interface YearStats {
  months: YearMonth[];
  matrix: { name: string; byMonth: number[]; total: number }[];
  uncategorized: number[];
  avgExpense: number;
  maxMonth: string | null;
}

interface Entry {
  income: boolean;
  category?: string;
  plan: number;
  fact: number;
}

/** Everything that counts in month ym, with its plan and fact. */
function monthEntries(data: Data, ym: YM): Entry[] {
  const s = data.settings;
  const out: Entry[] = [];
  for (const r of data.journal) {
    if (journalMonth(r, s) !== ym) continue;
    out.push({ income: r.kind === 'income', category: opt(r.category), plan: journalPlan(r), fact: journalFact(r) });
  }
  for (const rec of data.recurring) {
    out.push({ income: rec.kind === 'income', category: opt(rec.category), plan: recurringPlan(rec, ym, s), fact: recurringFact(rec, ym) });
  }
  for (const p of data.purchases) {
    const date = opt(p.date);
    if (date === undefined || ymOf(date) !== ym) continue;
    out.push({ income: false, category: opt(p.category), plan: purchasePlan(p), fact: purchaseFact(p) });
  }
  for (const o of data.operations) {
    if (o.kind === 'transfer' || ymOf(o.date) !== ym) continue;
    out.push({ income: o.kind === 'income', category: opt(o.category), plan: 0, fact: opAmount(o) });
  }
  return out;
}

function totals(entries: Entry[]): MonthTotals {
  const t: MonthTotals = { incomePlan: 0, incomeFact: 0, expensePlan: 0, expenseFact: 0 };
  for (const e of entries) {
    if (e.income) {
      t.incomePlan += e.plan;
      t.incomeFact += e.fact;
    } else {
      t.expensePlan += e.plan;
      t.expenseFact += e.fact;
    }
  }
  return t;
}

function expenseByCategory(entries: Entry[]): Map<string, { plan: number; fact: number }> {
  const map = new Map<string, { plan: number; fact: number }>();
  for (const e of entries) {
    if (e.income || e.category === undefined) continue;
    const v = map.get(e.category) ?? { plan: 0, fact: 0 };
    v.plan += e.plan;
    v.fact += e.fact;
    map.set(e.category, v);
  }
  return map;
}

export function monthSummary(data: Data, ym: YM): MonthSummary {
  const entries = monthEntries(data, ym);
  const t = totals(entries);
  const perCategory = expenseByCategory(entries);
  const byCategory = data.categories.expense.map((c): CategorySummary => {
    const v = perCategory.get(c.name) ?? { plan: 0, fact: 0 };
    const row: CategorySummary = { name: c.name, plan: v.plan, fact: v.fact };
    if (c.limit !== undefined) {
      row.limit = c.limit;
      row.left = c.limit - v.fact;
      row.share = c.limit !== 0 ? v.fact / c.limit : 0;
    }
    return row;
  });
  const sum = (key: 'plan' | 'fact') => byCategory.reduce((acc, c) => acc + c[key], 0);
  const limited = byCategory.filter((c) => c.limit !== undefined);
  return {
    ...t,
    balanceFact: t.incomeFact - t.expenseFact,
    byCategory,
    uncategorized: { plan: t.expensePlan - sum('plan'), fact: t.expenseFact - sum('fact') },
    limitsTotal: limited.reduce((acc, c) => acc + (c.limit ?? 0), 0),
    limitsLeft: limited.reduce((acc, c) => acc + (c.left ?? 0), 0),
  };
}

/** Expense facts of month ym by exact date (journal by row date, recurring by payment date); index 0 = day 1. */
export function dailySpend(data: Data, ym: YM): number[] {
  const days: number[] = Array.from({ length: daysInMonth(ym) }, () => 0);
  const add = (at: ISODate | undefined, value: number) => {
    const date = opt(at);
    if (date === undefined || ymOf(date) !== ym) return;
    const i = Number(date.slice(8, 10)) - 1;
    days[i] = (days[i] ?? 0) + value;
  };
  for (const r of data.journal) if (r.kind === 'expense') add(r.date, journalFact(r));
  for (const rec of data.recurring) if (rec.kind === 'expense') add(recurringDate(rec, ym), recurringFact(rec, ym));
  for (const p of data.purchases) add(p.date, purchaseFact(p));
  for (const o of data.operations) if (o.kind === 'expense') add(o.date, opAmount(o));
  return days;
}

export function yearStats(data: Data): YearStats {
  const matrix = data.categories.expense.map((c) => ({ name: c.name, byMonth: [] as number[], total: 0 }));
  const uncategorized: number[] = [];
  let cumulative = 0;
  const months = accountingMonths(data.settings).map((ym): YearMonth => {
    const entries = monthEntries(data, ym);
    const t = totals(entries);
    const perCategory = expenseByCategory(entries);
    let categorized = 0;
    for (const row of matrix) {
      const fact = perCategory.get(row.name)?.fact ?? 0;
      row.byMonth.push(fact);
      row.total += fact;
      categorized += fact;
    }
    uncategorized.push(t.expenseFact - categorized);
    const balance = t.incomeFact - t.expenseFact;
    cumulative += balance;
    return {
      ym,
      label: monthLabel(ym),
      ...t,
      balance,
      cumulative,
      ratio: t.expensePlan !== 0 ? t.expenseFact / t.expensePlan : 0,
    };
  });
  const spent = months.filter((m) => m.expenseFact > 0);
  const avgExpense = spent.length > 0 ? spent.reduce((a, m) => a + m.expenseFact, 0) / spent.length : 0;
  // like the tracker: no «most expensive month» while the maximum is 0
  const max = Math.max(...months.map((m) => m.expenseFact));
  const maxMonth = max === 0 ? null : (months.find((m) => m.expenseFact === max)?.label ?? null);
  return { months, matrix, uncategorized, avgExpense, maxMonth };
}
