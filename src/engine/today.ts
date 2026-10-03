// «Сегодня»: what is due in the next days (plus everything overdue) and paying it in one tap.
import { accountingMonths, addDays, inAccountingYear, ymOf } from './dates';
import type { Data, ISODate, JournalRow, OpKind, Purchase, YM } from './model';
import { opt } from './opt';
import { journalExpected, journalMonth, purchasePlan, recurringDate, recurringDue } from './rules';

export type UpcomingSource = 'journal' | 'recurring' | 'purchase';

export interface UpcomingItem {
  source: UpcomingSource;
  id: string;
  ym?: YM; // recurring: the month to mark
  date: ISODate;
  what: string;
  amount: number; // expected (planned) amount
  kind: OpKind; // a planned or recurring transfer is marked done like any other item
  overdue: boolean; // an expense dated before today (an income or a transfer is never overdue)
}

export type PayTarget = Pick<UpcomingItem, 'source' | 'id' | 'ym'>;

/**
 * Unpaid items of the accounting year dated up to today + days: journal rows (not paid or cancelled,
 * no fact, with a plan), due recurring payments without a mark, purchases not bought yet; transfers among them too.
 * Older unpaid items stay in the list; expenses among them are overdue.
 */
export function upcoming(data: Data, today: ISODate, days = 7): UpcomingItem[] {
  const s = data.settings;
  const limit = addDays(today, days);
  const items: UpcomingItem[] = [];
  const push = (item: Omit<UpcomingItem, 'overdue'>) => {
    if (item.date > limit) return;
    items.push({ ...item, overdue: item.date < today && item.kind === 'expense' });
  };

  for (const r of data.journal) {
    if (r.status === 'paid' || r.status === 'cancelled' || r.fact !== undefined || r.plan === undefined) continue;
    if (!inAccountingYear(journalMonth(r, s), s)) continue;
    push({ source: 'journal', id: r.id, date: r.date, what: r.what, amount: journalExpected(r), kind: r.kind });
  }
  for (const ym of accountingMonths(s)) {
    for (const rec of data.recurring) {
      const date = recurringDate(rec, ym);
      if (date === undefined || rec.marks[ym] !== undefined || !recurringDue(rec, ym, s)) continue;
      push({ source: 'recurring', id: rec.id, ym, date, what: rec.what, amount: rec.amount, kind: rec.kind });
    }
  }
  for (const p of data.purchases) {
    const date = opt(p.date);
    if (p.bought || date === undefined || !inAccountingYear(ymOf(date), s)) continue;
    push({ source: 'purchase', id: p.id, date, what: p.what, amount: purchasePlan(p), kind: 'expense' });
  }

  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function replaceById<T extends { id: string }>(rows: T[], id: string, change: (row: T) => T): T[] {
  const index = rows.findIndex((r) => r.id === id);
  if (index < 0) throw new Error(`markPaid: no row with id "${id}"`);
  return rows.map((r, i) => (i === index ? change(r) : r));
}

/**
 * Marks an item as paid and returns new data (the given data is not changed).
 * Journal → status paid (+ fact when it differs from the plan); recurring → month mark ✓ or the amount;
 * purchase → bought (+ price when it differs from the cost).
 */
export function markPaid(data: Data, item: PayTarget, fact?: number): Data {
  switch (item.source) {
    case 'journal':
      return {
        ...data,
        journal: replaceById(data.journal, item.id, (r): JournalRow => {
          if (fact === undefined) return { ...r, status: 'paid' };
          const { fact: _old, ...rest } = r;
          return fact === r.plan ? { ...rest, status: 'paid' } : { ...rest, status: 'paid', fact };
        }),
      };
    case 'recurring': {
      const ym = item.ym;
      if (ym === undefined) throw new Error(`markPaid: recurring "${item.id}" needs the month to mark`);
      return {
        ...data,
        recurring: replaceById(data.recurring, item.id, (rec) => ({
          ...rec,
          marks: { ...rec.marks, [ym]: fact === undefined || fact === rec.amount ? '✓' : fact },
        })),
      };
    }
    case 'purchase':
      return {
        ...data,
        purchases: replaceById(data.purchases, item.id, (p): Purchase => {
          if (fact === undefined) return { ...p, bought: true };
          const { price: _old, ...rest } = p;
          return fact === p.cost ? { ...rest, bought: true } : { ...rest, bought: true, price: fact };
        }),
      };
  }
}
