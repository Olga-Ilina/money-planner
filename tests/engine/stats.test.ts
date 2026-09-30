import { describe, expect, it } from 'vitest';
import { dailySpend, monthSummary, yearStats } from '../../src/engine/stats';
import type { Data } from '../../src/engine/model';
import { ACC, scenario, zpNovember, zpOctober } from './scenario';

const cents = (x: number) => Math.round(x * 100) / 100;

function months(data: Data) {
  return yearStats(data).months.map((m) => ({
    ym: m.ym,
    incomePlan: cents(m.incomePlan),
    incomeFact: cents(m.incomeFact),
    expensePlan: cents(m.expensePlan),
    expenseFact: cents(m.expenseFact),
    balance: cents(m.balance),
    cumulative: cents(m.cumulative),
  }));
}

describe('yearStats — scenario', () => {
  const data = scenario();
  const stats = yearStats(data);
  const rows = months(data);

  it('covers the 12 accounting months with labels', () => {
    expect(stats.months.map((m) => m.ym)).toEqual([
      '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
      '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09',
    ]);
    expect(stats.months[0]?.label).toBe('Октябрь 2026');
  });

  it('October: 3200 / 3205 / 1180 / 1235, balance 1970, cumulative 1970', () => {
    expect(rows[0]).toEqual({ ym: '2026-10', incomePlan: 3200, incomeFact: 3205, expensePlan: 1180, expenseFact: 1235, balance: 1970, cumulative: 1970 });
  });

  it('November: 200 / 0 / 990 / 1010, balance −1010, cumulative 960', () => {
    expect(rows[1]).toEqual({ ym: '2026-11', incomePlan: 200, incomeFact: 0, expensePlan: 990, expenseFact: 1010, balance: -1010, cumulative: 960 });
  });

  it('December: 200 / 0 / 1410 / 480, balance −480, cumulative 480', () => {
    expect(rows[2]).toEqual({ ym: '2026-12', incomePlan: 200, incomeFact: 0, expensePlan: 1410, expenseFact: 480, balance: -480, cumulative: 480 });
  });

  it('expense plan: Jan 910, Feb 940, Mar 910, May 940', () => {
    expect(rows[3]?.expensePlan).toBe(910);
    expect(rows[4]?.expensePlan).toBe(940);
    expect(rows[5]?.expensePlan).toBe(910);
    expect(rows[7]?.expensePlan).toBe(940);
  });

  it('ratio = expense fact / plan, 0 without a plan', () => {
    expect(stats.months[0]?.ratio).toBeCloseTo(1235 / 1180, 10);
    expect(stats.months[3]?.ratio).toBe(0); // Jan: plan 910, fact 0
    const empty = scenario();
    empty.recurring = [];
    empty.purchases = [];
    expect(yearStats(empty).months[3]?.ratio).toBe(0); // Jan: plan 0
  });

  it('matrix of expense facts per category and month', () => {
    const byName = Object.fromEntries(stats.matrix.map((m) => [m.name, m]));
    expect(stats.matrix.map((m) => m.name)).toEqual(['Жильё', 'Продукты', 'Транспорт', 'Подписки', 'Техника']);
    expect(byName['Продукты']?.byMonth.slice(0, 3)).toEqual([210, 50, 0]);
    expect(byName['Транспорт']?.byMonth.slice(0, 3)).toEqual([125, 0, 0]);
    expect(byName['Жильё']?.byMonth.slice(0, 3)).toEqual([900, 950, 0]);
    expect(byName['Подписки']?.byMonth.slice(0, 3)).toEqual([0, 10, 0]);
    expect(byName['Техника']?.byMonth.slice(0, 3)).toEqual([0, 0, 480]);
    expect(byName['Продукты']?.byMonth).toHaveLength(12);
    expect(byName['Жильё']?.total).toBe(1850);
    expect(byName['Продукты']?.total).toBe(260);
  });

  it('nothing is uncategorized in the scenario', () => {
    expect(stats.uncategorized).toEqual(Array(12).fill(0));
  });

  it('average expense over months with spending, most expensive month', () => {
    expect(stats.avgExpense).toBeCloseTo((1235 + 1010 + 480) / 3, 10);
    expect(stats.maxMonth).toBe('Октябрь 2026');
  });

  it('has no most expensive month and a zero average without spending', () => {
    const idle = scenario();
    idle.journal = [];
    idle.operations = [];
    idle.purchases = [];
    idle.recurring = [];
    const empty = yearStats(idle);
    expect(empty.maxMonth).toBeNull();
    expect(empty.avgExpense).toBe(0);
  });
});

describe('yearStats — accounting month of journal rows', () => {
  it('«ЗП ноябрь» paid 30.10 counts in November: Oct 3200/3205, Nov 600/400', () => {
    const data = scenario();
    data.journal.push(zpNovember);
    const rows = months(data);
    expect([rows[0]?.incomePlan, rows[0]?.incomeFact]).toEqual([3200, 3205]);
    expect([rows[1]?.incomePlan, rows[1]?.incomeFact]).toEqual([600, 400]);
  });

  it('«ЗП октябрь» paid 29.09 counts in October: Oct income fact 3275', () => {
    const data = scenario();
    data.journal.push(zpNovember, zpOctober);
    expect(months(data)[0]?.incomeFact).toBe(3275);
  });
});

describe('monthSummary', () => {
  it('October totals and categories', () => {
    const sum = monthSummary(scenario(), '2026-10');
    expect([sum.incomePlan, sum.incomeFact, sum.expensePlan, sum.expenseFact, sum.balanceFact].map(cents))
      .toEqual([3200, 3205, 1180, 1235, 1970]);
    const byName = Object.fromEntries(sum.byCategory.map((c) => [c.name, c]));
    expect(sum.byCategory.map((c) => c.name)).toEqual(['Жильё', 'Продукты', 'Транспорт', 'Подписки', 'Техника']);
    expect([byName['Продукты']?.plan, byName['Продукты']?.fact]).toEqual([180, 210]);
    expect([byName['Транспорт']?.plan, byName['Транспорт']?.fact]).toEqual([100, 125]);
    expect([byName['Жильё']?.plan, byName['Жильё']?.fact]).toEqual([900, 900]);
    expect(sum.uncategorized).toEqual({ plan: 0, fact: 0 });
  });

  it('limit gives what is left and the share used', () => {
    const data = scenario();
    data.categories.expense[1] = { name: 'Продукты', limit: 200 };
    data.categories.expense[2] = { name: 'Транспорт', limit: 0 };
    const cats = monthSummary(data, '2026-10').byCategory;
    const food = cats.find((c) => c.name === 'Продукты');
    expect(food?.limit).toBe(200);
    expect(food?.left).toBe(-10);
    expect(food?.share).toBeCloseTo(1.05, 10);
    const transport = cats.find((c) => c.name === 'Транспорт');
    expect(transport?.left).toBe(-125);
    expect(transport?.share).toBe(0); // like IFERROR(fact/0, 0)
    const rent = cats.find((c) => c.name === 'Жильё');
    expect(rent?.limit).toBeUndefined();
    expect(rent?.left).toBeUndefined();
    expect(rent?.share).toBeUndefined();
  });

  it('October of the scenario has no limits: limits total 0, nothing left of them', () => {
    const sum = monthSummary(scenario(), '2026-10');
    expect([sum.limitsTotal, sum.limitsLeft]).toEqual([0, 0]);
  });

  it('sums the limits and what is left of them over the categories that have a limit', () => {
    const data = scenario();
    data.categories.expense[1] = { name: 'Продукты', limit: 200 }; // fact 210: overspent by 10
    data.categories.expense[2] = { name: 'Транспорт', limit: 150 }; // fact 125: 25 left
    const sum = monthSummary(data, '2026-10');
    expect(sum.limitsTotal).toBe(350); // 200 + 150; Жильё (fact 900) has no limit and is left out
    expect(sum.limitsLeft).toBe(15); // (200 − 210) + (150 − 125)
  });

  it('counts a limit of 0: all spending of the category is over it', () => {
    const data = scenario();
    data.categories.expense[2] = { name: 'Транспорт', limit: 0 }; // fact 125
    const sum = monthSummary(data, '2026-10');
    expect([sum.limitsTotal, sum.limitsLeft]).toEqual([0, -125]);
  });

  it('puts unknown or missing categories into «uncategorized»', () => {
    const data = scenario();
    data.operations.push({ id: 'o-x', date: '2026-10-22', kind: 'expense', category: 'Неизвестная', what: 'X', amount: 40, account: ACC.card });
    data.journal.push({ id: 'j-x', date: '2026-10-23', kind: 'expense', what: 'Y', plan: 15, account: ACC.card });
    const sum = monthSummary(data, '2026-10');
    expect(sum.expenseFact).toBe(1275);
    expect(sum.uncategorized).toEqual({ plan: 15, fact: 40 });
  });

  it('counts a recurring payment without a day by its month', () => {
    const data = scenario();
    data.recurring.push({ id: 'r-x', what: 'Без дня', kind: 'expense', category: 'Жильё', amount: 50, marks: { '2026-10': '✓' } });
    const sum = monthSummary(data, '2026-10');
    expect(sum.expensePlan).toBe(1230);
    expect(sum.expenseFact).toBe(1285);
  });
});

describe('dailySpend', () => {
  it('October expense facts by exact date', () => {
    const days = dailySpend(scenario(), '2026-10');
    expect(days).toHaveLength(31);
    const nonZero = Object.fromEntries(days.map((v, i) => [i + 1, v]).filter(([, v]) => v !== 0));
    expect(nonZero).toEqual({ 5: 900, 6: 200, 7: 90, 9: 15, 10: -20, 12: 30, 14: 20 });
    expect(days.reduce((a, b) => a + b, 0)).toBe(1235);
  });

  it('uses the journal row date, not its accounting month', () => {
    const data = scenario();
    data.journal.push({ ...zpNovember, kind: 'expense', what: 'Долг за ноябрь' }); // 30.10, month Nov
    expect(dailySpend(data, '2026-10')[29]).toBe(400);
    expect(dailySpend(data, '2026-11').reduce((a, b) => a + b, 0)).toBe(1010);
  });

  it('November and December', () => {
    const nov = dailySpend(scenario(), '2026-11');
    expect(nov).toHaveLength(30);
    expect([nov[4], nov[9], nov[14]]).toEqual([950, 10, 50]);
    const dec = dailySpend(scenario(), '2026-12');
    expect(dec[9]).toBe(480);
    expect(dec.reduce((a, b) => a + b, 0)).toBe(480);
  });
});
