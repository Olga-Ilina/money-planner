import { describe, expect, it } from 'vitest';
import {
  duplicatesForJournal,
  duplicatesForOperation,
  journalExpected,
  accountingMonthOf,
  journalFact,
  journalMonth,
  journalPlan,
  opAmount,
  purchaseExpected,
  purchaseFact,
  purchasePlan,
  recurringDate,
  recurringDue,
  recurringExpected,
  recurringFact,
  recurringPlan,
} from '../../src/engine/rules';
import { accountingMonths } from '../../src/engine/dates';
import type { Operation, Purchase, Recurring } from '../../src/engine/model';
import { ACC, row, scenario, zpNovember } from './scenario';

const data = scenario();
const s = data.settings;

describe('journal rows (P fact, Q plan, S expected)', () => {
  const cases: [string, number, number, number][] = [
    ['j-eda', 0, 100, 100],
    ['j-kafe', 100, 100, 100],
    ['j-taxi', 90, 100, 90],
    ['j-otmena', 0, 0, 0],
    ['j-shtraf', 15, 0, 15],
    ['j-vozvrat', -20, -20, -20],
    ['j-arenda', 0, 0, 0],
    ['j-sentyabr', 0, 10, 10],
  ];
  it.each(cases)('%s → fact %d, plan %d, expected %d', (id, fact, plan, expected) => {
    const r = row(data.journal, id);
    expect(journalFact(r)).toBe(fact);
    expect(journalPlan(r)).toBe(plan);
    expect(journalExpected(r)).toBe(expected);
  });

  it('uses the chosen accounting month only when it is inside the accounting year', () => {
    expect(journalMonth(row(data.journal, 'j-zp'), s)).toBe('2026-10');
    expect(journalMonth(zpNovember, s)).toBe('2026-11');
    expect(journalMonth({ ...zpNovember, month: '2025-01' }, s)).toBe('2026-10');
    expect(journalMonth(row(data.journal, 'j-sentyabr'), s)).toBe('2026-09');
  });

  it('accountingMonthOf(date, month, s): the same rule from the fields alone (a form without a row yet)', () => {
    expect(accountingMonthOf('2026-10-30', '2026-11', s)).toBe('2026-11');
    expect(accountingMonthOf('2026-10-30', undefined, s)).toBe('2026-10');
    expect(accountingMonthOf('2026-10-30', '2025-01', s)).toBe('2026-10'); // a month outside the year: the date decides
    for (const r of [...data.journal, zpNovember]) expect(accountingMonthOf(r.date, r.month, s)).toBe(journalMonth(r, s));
  });
});

describe('recurring', () => {
  const insurance = row(data.recurring, 'r-strahovka'); // every 3 months from 01.11
  const rent = row(data.recurring, 'r-arenda');
  const dueMonths = (rec: Recurring) => accountingMonths(s).filter((ym) => recurringDue(rec, ym, s));

  it('every 3 months from 01.11 is due in Nov, Feb, May and Aug only', () => {
    expect(dueMonths(insurance)).toEqual(['2026-11', '2027-02', '2027-05', '2027-08']);
    expect(recurringPlan(insurance, '2026-11', s)).toBe(30);
    expect(recurringPlan(insurance, '2026-12', s)).toBe(0);
  });

  it('`from` and `to` limit the months', () => {
    expect(dueMonths({ ...rent, to: '2027-01-15' })).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(recurringDue(row(data.recurring, 'r-podpiska'), '2026-10', s)).toBe(false);
    expect(recurringDue({ ...rent, from: '2026-10-31' }, '2026-10', s)).toBe(true);
    expect(recurringDue({ ...rent, to: '2026-11-01' }, '2026-11', s)).toBe(true);
    expect(recurringDue({ ...rent, to: '2026-10-31' }, '2026-11', s)).toBe(false);
  });

  it('without `from` the period is anchored at the accounting start, also before it', () => {
    const bimonthly: Recurring = { ...row(data.recurring, 'r-bonus'), every: 2 };
    expect(dueMonths(bimonthly)).toEqual(['2026-10', '2026-12', '2027-02', '2027-04', '2027-06', '2027-08']);
    expect(recurringDue(bimonthly, '2026-08', s)).toBe(true);
    expect(recurringDue(bimonthly, '2026-09', s)).toBe(false);
  });

  it('treats a missing or zero period as monthly', () => {
    expect(dueMonths({ ...rent, every: 0 })).toHaveLength(12);
    expect(dueMonths({ ...rent, every: undefined })).toHaveLength(12);
  });

  it('dates the payment on its day, clamped to the month length', () => {
    expect(recurringDate(rent, '2026-10')).toBe('2026-10-05');
    expect(recurringDate({ ...rent, day: 31 }, '2027-02')).toBe('2027-02-28');
    expect(recurringDate({ ...rent, day: 31 }, '2028-02')).toBe('2028-02-29');
    expect(recurringDate({ ...rent, day: undefined }, '2026-10')).toBeUndefined();
  });

  it('takes the fact from the month mark: ✓ → amount, number → number, none → 0', () => {
    expect(recurringFact(rent, '2026-10')).toBe(900);
    expect(recurringFact(rent, '2026-11')).toBe(950);
    expect(recurringFact(rent, '2026-12')).toBe(0);
  });

  it('counts a mark even in a month when the payment is not due', () => {
    const marked: Recurring = { ...insurance, marks: { '2026-12': 25 } };
    expect(recurringPlan(marked, '2026-12', s)).toBe(0);
    expect(recurringFact(marked, '2026-12')).toBe(25);
    expect(recurringExpected(marked, '2026-12', s)).toBe(25);
  });

  it('expects the mark inside the accounting year, the plan otherwise', () => {
    expect(recurringExpected(rent, '2026-11', s)).toBe(950);
    expect(recurringExpected(rent, '2026-12', s)).toBe(900);
    expect(recurringExpected(insurance, '2026-12', s)).toBe(0);
    const markedOutside: Recurring = { ...rent, marks: { '2027-10': 99 } };
    expect(recurringExpected(markedOutside, '2027-10', s)).toBe(900);
  });
});

describe('purchases', () => {
  const laptop = row(data.purchases, 'p-noutbuk');

  it('bought: plan = cost, fact = price, expected = fact', () => {
    expect(purchasePlan(laptop)).toBe(500);
    expect(purchaseFact(laptop)).toBe(480);
    expect(purchaseExpected(laptop)).toBe(480);
  });

  it('not bought: fact 0, expected = plan', () => {
    const wish: Purchase = { ...laptop, bought: false };
    expect(purchaseFact(wish)).toBe(0);
    expect(purchaseExpected(wish)).toBe(500);
  });

  it('has no plan without a date', () => {
    const undated: Purchase = { ...laptop, bought: false, date: undefined };
    expect(purchasePlan(undated)).toBe(0);
    expect(purchaseExpected(undated)).toBe(0);
  });

  it('falls back to cost, then 0, for the fact of a bought purchase', () => {
    expect(purchaseFact({ ...laptop, price: undefined })).toBe(500);
    expect(purchaseFact({ ...laptop, price: undefined, cost: undefined })).toBe(0);
  });
});

describe('operations', () => {
  it('ignores the sign of the amount', () => {
    expect(opAmount(row(data.operations, 'o-magazin'))).toBe(30);
    expect(opAmount(row(data.operations, 'o-kafe'))).toBe(100);
  });
});

describe('possible duplicates', () => {
  it('journal «Аренда» is also a recurring payment', () => {
    expect(duplicatesForJournal(data, row(data.journal, 'j-arenda'))).toBe('recurring');
  });

  it('journal row named like a purchase is flagged as purchase', () => {
    expect(duplicatesForJournal(data, { ...row(data.journal, 'j-eda'), what: 'Ноутбук' })).toBe('purchase');
  });

  it('other journal rows are not duplicates', () => {
    const flagged = data.journal.filter((r) => duplicatesForJournal(data, r) !== null).map((r) => r.id);
    expect(flagged).toEqual(['j-arenda']);
    expect(duplicatesForJournal(data, { ...row(data.journal, 'j-eda'), what: '' })).toBeNull();
  });

  it('compares names like Excel COUNTIF, ignoring letter case', () => {
    expect(duplicatesForJournal(data, { ...row(data.journal, 'j-eda'), what: 'аренда' })).toBe('recurring');
  });

  it('operation «Кафе» 06.10 100 matches a journal row with the same date and fact', () => {
    expect(duplicatesForOperation(data, row(data.operations, 'o-kafe'))).toBe('journal');
  });

  it('the other five operations are not duplicates', () => {
    const others = data.operations.filter((o) => o.id !== 'o-kafe');
    expect(others).toHaveLength(5);
    expect(others.map((o) => duplicatesForOperation(data, o))).toEqual([null, null, null, null, null]);
  });

  it('operation named like a recurring payment or a purchase is flagged', () => {
    const op: Operation = { id: 'x', date: '2026-10-25', kind: 'expense', what: 'Страховка', amount: 30, account: ACC.card };
    expect(duplicatesForOperation(data, op)).toBe('recurring');
    expect(duplicatesForOperation(data, { ...op, what: 'Ноутбук' })).toBe('purchase');
  });

  it('never flags transfers, unnamed operations or a zero journal fact', () => {
    const op: Operation = { id: 'x', date: '2026-10-20', kind: 'transfer', what: 'Аренда', amount: 30, account: ACC.card, toAccount: ACC.cash };
    expect(duplicatesForOperation(data, op)).toBeNull();
    expect(duplicatesForOperation(data, { ...op, kind: 'expense', what: '' })).toBeNull();
    // «Еда» 05.10 has journal fact 0: an operation of 0 on that date is not a journal duplicate
    expect(duplicatesForOperation(data, { ...op, kind: 'expense', what: 'Хлеб', date: '2026-10-05', amount: 0 })).toBeNull();
  });
});
