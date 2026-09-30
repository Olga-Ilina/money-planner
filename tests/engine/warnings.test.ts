import { describe, expect, it } from 'vitest';
import { warnings } from '../../src/engine/warnings';
import { ACC, scenario, zpNovember, zpOctober } from './scenario';

describe('warnings — scenario', () => {
  it('one row outside the accounting year (05.09), two possible duplicates, nothing else', () => {
    expect(warnings(scenario())).toEqual({
      unassigned: { count: 0, sum: 0 },
      transfersWithoutTarget: 0,
      outOfYear: 1,
      duplicates: 2, // journal «Аренда» (recurring) and operation «Кафе» 06.10 (journal)
      unknownAccounts: 0,
      recurringMarkedWithoutDay: 0,
      boughtWithoutDate: 0,
    });
  });

  it('a row paid 30.10 for November or 29.09 for October is inside the year', () => {
    const data = scenario();
    data.journal.push(zpNovember);
    expect(warnings(data).outOfYear).toBe(1);
    data.journal.push(zpOctober);
    expect(warnings(data).outOfYear).toBe(1);
  });
});

describe('warnings — rows that do not reach any balance', () => {
  it('counts paid rows without an account and sums their fact', () => {
    const data = scenario();
    data.operations.push({ id: 'o-x', date: '2026-10-22', kind: 'expense', what: 'Без счёта', amount: -25 });
    data.journal.push({ id: 'j-x', date: '2026-10-23', kind: 'expense', what: 'Без счёта 2', plan: 40, status: 'paid' });
    data.journal.push({ id: 'j-y', date: '2026-10-24', kind: 'expense', what: 'Не оплачено', plan: 99 });
    data.recurring.push({ id: 'r-x', what: 'Без счёта 3', kind: 'expense', day: 3, amount: 15, marks: { '2026-10': '✓', '2026-11': 20 } });
    data.purchases.push({ id: 'p-x', what: 'Без счёта 4', cost: 70, price: 60, date: '2026-11-01', bought: true });
    data.purchases.push({ id: 'p-y', what: 'Не куплено', cost: 70, bought: false });
    expect(warnings(data).unassigned).toEqual({ count: 5, sum: 25 + 40 + 15 + 20 + 60 });
  });

  it('counts transfers without a target account', () => {
    const data = scenario();
    data.operations.push({ id: 'o-x', date: '2026-10-22', kind: 'transfer', what: 'Куда?', amount: 10, account: ACC.card });
    expect(warnings(data).transfersWithoutTarget).toBe(1);
  });

  it('counts operations dated outside the accounting year', () => {
    const data = scenario();
    data.operations.push({ id: 'o-x', date: '2027-10-01', kind: 'expense', what: 'Потом', amount: 10, account: ACC.card });
    data.operations.push({ id: 'o-y', date: '2026-09-30', kind: 'transfer', what: 'Раньше', amount: 10, account: ACC.card, toAccount: ACC.cash });
    expect(warnings(data).outOfYear).toBe(3);
  });
});

describe('warnings — broken references and rows without a date', () => {
  it('counts rows that point to an account that does not exist (once per row)', () => {
    const data = scenario();
    const ghost = 'acc-deleted';
    data.operations.push({ id: 'o-a', date: '2026-10-22', kind: 'expense', what: 'Удалённый счёт', amount: 10, account: ghost });
    data.operations.push({ id: 'o-b', date: '2026-10-22', kind: 'transfer', what: 'Туда', amount: 10, account: ACC.card, toAccount: ghost });
    data.operations.push({ id: 'o-c', date: '2026-10-22', kind: 'transfer', what: 'Оба', amount: 10, account: ghost, toAccount: ghost });
    data.journal.push({ id: 'j-a', date: '2026-10-23', kind: 'expense', what: 'Ж', plan: 5, account: ghost });
    data.recurring.push({ id: 'r-a', what: 'Р', kind: 'expense', day: 3, amount: 5, account: ghost, marks: {} });
    data.purchases.push({ id: 'p-a', what: 'П', cost: 5, bought: false, account: ghost });
    expect(warnings(data).unknownAccounts).toBe(6);
  });

  it('counts credit settings that point to an account that does not exist', () => {
    const data = scenario();
    data.credit = { ...data.credit, accountId: 'acc-deleted', fromAccountId: 'acc-gone' };
    expect(warnings(data).unknownAccounts).toBe(2);
    data.credit = { ...data.credit, accountId: ACC.credit, fromAccountId: 'acc-gone' };
    expect(warnings(data).unknownAccounts).toBe(1);
  });

  it('counts recurring payments with marks but no day: their marks reach no balance', () => {
    const data = scenario();
    data.recurring.push({ id: 'r-a', what: 'Без дня', kind: 'expense', amount: 5, account: ACC.card, marks: { '2026-10': '✓' } });
    data.recurring.push({ id: 'r-b', what: 'День 0', kind: 'expense', day: 0, amount: 5, account: ACC.card, marks: { '2026-11': 4 } });
    data.recurring.push({ id: 'r-c', what: 'Без дня, без отметок', kind: 'expense', amount: 5, account: ACC.card, marks: {} });
    expect(warnings(data).recurringMarkedWithoutDay).toBe(2);
  });

  it('counts bought purchases without a date', () => {
    const data = scenario();
    data.purchases.push({ id: 'p-a', what: 'Куплено без даты', cost: 25, bought: true, account: ACC.card });
    data.purchases.push({ id: 'p-b', what: 'Не куплено, без даты', cost: 25, bought: false, account: ACC.card });
    expect(warnings(data).boughtWithoutDate).toBe(1);
  });
});
