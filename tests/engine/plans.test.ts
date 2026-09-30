// Rules of the tracker's plan sheets («Постоянные», «Покупки», «Долги») that the screens show.
// Moved here from tests/ui/d5 together with the helpers (they were in the D5 pages).
import { describe, expect, it } from 'vitest';
import {
  addDays, debtLeft, debtStatus, forecast, isDebtOpen, leftToSave, monthlyAverage, purchaseStatus, roundCents,
} from '../../src/engine';
import type { Data, Debt, Purchase } from '../../src/engine';
import { row, scenario } from './scenario';

describe('roundCents', () => {
  it('rounds half away from zero, the same way for negative amounts; never -0', () => {
    expect(roundCents(12.345)).toBe(12.35);
    expect(roundCents(-12.345)).toBe(-12.35);
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(0.125)).toBe(0.13);
    expect(roundCents(-0.005)).toBe(-0.01);
    expect(Object.is(roundCents(-0.004), 0)).toBe(true);
    expect(roundCents(12000 - 3500.5)).toBe(8499.5);
  });

  it('leaves what is not a finite number as it is', () => {
    expect(roundCents(Number.NaN)).toBeNaN();
    expect(roundCents(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('monthlyAverage («В среднем в месяц» of «Постоянные»)', () => {
  it('averages a month like the tracker: amount / every (blank or 1 = every month), per kind', () => {
    const rows = scenario().recurring;
    expect(monthlyAverage(rows, 'expense')).toBeCloseTo(900 + 10 + 30 / 3);
    expect(monthlyAverage(rows, 'income')).toBe(200);
    expect(monthlyAverage([], 'expense')).toBe(0);
  });

  it('a rhythm of 0 or below counts as every month', () => {
    const base = { id: 'r', what: 'x', kind: 'expense' as const, amount: 60, marks: {} };
    expect(monthlyAverage([{ ...base, every: 0 }], 'expense')).toBe(60);
    expect(monthlyAverage([{ ...base, every: 6 }], 'expense')).toBe(10);
  });
});

// Scenario forecast (cushion 100): week 3 (12.10–18.10) ends at 2665, week 11 (07.12–13.12) at 640;
// the 13 weeks run from 28.09.2026 to 27.12.2026.
const PLANS: Purchase[] = [
  { id: 'p-naush', what: 'Наушники', category: 'Техника', cost: 50, saved: 50, date: '2026-10-15', bought: false },
  { id: 'p-velo', what: 'Велосипед', cost: 1000, saved: 250, date: '2026-12-08', priority: 'Желательно', bought: false },
  { id: 'p-divan', what: 'Диван', cost: 700, saved: 0, date: '2027-03-01', bought: false },
  { id: 'p-knigi', what: 'Книги', cost: 30, bought: false },
];

function withPlans(): Data {
  const d = scenario();
  d.purchases = [...d.purchases, ...PLANS.map((p) => ({ ...p }))];
  return d;
}

describe('purchaseStatus («Хватит ли денег» of «Покупки»)', () => {
  it('bought → «Куплено»; no date → none; outside the 13 forecast weeks → «Вне прогноза»', () => {
    const d = withPlans();
    const fc = forecast(d);
    expect(purchaseStatus(row(d.purchases, 'p-noutbuk'), fc, d)).toBe('bought');
    expect(purchaseStatus(row(d.purchases, 'p-knigi'), fc, d)).toBeNull();
    expect(purchaseStatus(row(d.purchases, 'p-divan'), fc, d)).toBe('outside');
    expect(purchaseStatus({ ...row(d.purchases, 'p-divan'), date: '2026-09-27' }, fc, d)).toBe('outside');
  });

  it('inside: the end of the week of the date against the cushion (equal is enough)', () => {
    const d = withPlans();
    const fc = forecast(d);
    expect(purchaseStatus(row(d.purchases, 'p-naush'), fc, d)).toBe('enough');
    expect(purchaseStatus(row(d.purchases, 'p-velo'), fc, d)).toBe('short');
    // the first and the last day of the forecast count
    expect(purchaseStatus({ ...row(d.purchases, 'p-naush'), date: '2026-09-28' }, fc, d)).toBe('enough');
    expect(purchaseStatus({ ...row(d.purchases, 'p-naush'), date: '2026-12-27' }, fc, d)).toBe('short');
    const week = fc.weeks[2]!;
    const exact = forecast({ ...d, settings: { ...d.settings, cushion: week.end } });
    expect(purchaseStatus(row(d.purchases, 'p-naush'), exact, d)).toBe('enough');
  });

  it('a blank date (as a stored empty string) is no date', () => {
    const d = withPlans();
    expect(purchaseStatus({ ...row(d.purchases, 'p-naush'), date: '' }, forecast(d), d)).toBeNull();
  });
});

describe('leftToSave («Осталось накопить» of «Покупки»)', () => {
  it('sums cost − saved of the plans, each never below 0; blanks count as 0', () => {
    expect(leftToSave(PLANS)).toBe(0 + 750 + 700 + 30);
    expect(leftToSave([{ id: 'x', what: 'x', cost: 100, saved: 150, bought: false }])).toBe(0);
    expect(leftToSave([{ id: 'x', what: 'x', saved: 20, bought: false }])).toBe(0);
    expect(leftToSave([])).toBe(0);
  });

  it('a bought purchase has nothing left to save', () => {
    expect(leftToSave([...PLANS, { id: 'b', what: 'b', cost: 500, saved: 0, bought: true }])).toBe(1480);
  });
});

function debts(): Debt[] {
  return [
    { id: 'd-car', name: 'Кредит на машину', whom: 'Банк', total: 12000, paid: 3500.5, rate: 0.049, payment: 350, nextDate: '2027-01-31' },
    { id: 'd-masha', name: 'Долг Маше', whom: 'Маша', total: 200, paid: 200, payment: 50 },
    { id: 'd-phone', name: 'Рассрочка', total: 600, payment: 100, nextDate: addDays('2026-09-30', 1) },
  ];
}

describe('debtLeft, debtStatus and isDebtOpen («Долги»)', () => {
  it('left = total − paid in cents, never below 0; no total — nothing to show', () => {
    const [car, masha, phone] = debts();
    expect(debtLeft(car!)).toBe(8499.5);
    expect(debtLeft(masha!)).toBe(0);
    expect(debtLeft(phone!)).toBe(600);
    expect(debtLeft({ id: 'x', name: 'x', total: 100, paid: 150 })).toBe(0);
    expect(debtLeft({ id: 'x', name: 'x', total: 0.3, paid: 0.1 + 0.2 })).toBe(0);
    expect(debtLeft({ id: 'x', name: 'x' })).toBeUndefined();
  });

  it('«Закрыт» when nothing is left, «В работе» once something is paid, else «Не начат»', () => {
    const [car, masha, phone] = debts();
    expect(debtStatus(car!)).toBe('В работе');
    expect(debtStatus(masha!)).toBe('Закрыт');
    expect(debtStatus(phone!)).toBe('Не начат');
    expect(debtStatus({ id: 'x', name: 'x' })).toBeUndefined();
  });

  it('open = not «Закрыт»: something left, or no total to tell', () => {
    const [car, masha, phone] = debts();
    expect(isDebtOpen(car!)).toBe(true);
    expect(isDebtOpen(masha!)).toBe(false);
    expect(isDebtOpen(phone!)).toBe(true);
    expect(isDebtOpen({ id: 'x', name: 'x', payment: 10 })).toBe(true);
    expect(isDebtOpen({ id: 'x', name: 'x', total: 100, paid: 150 })).toBe(false);
  });
});
