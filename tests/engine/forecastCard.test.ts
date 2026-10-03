// «Кредиты (погашение кредитки, справочно)» of a forecast month (spec 2026-10-03-month-limits, «Дополнение 18:43»):
// what is debited that month for the statement it closes — the statement's facts plus the planned card spending of its
// period not paid yet (planned rows, recurring payments, purchases on the card; transfers to the card lower it).
// For reference only: the forecast's sums do not change.
import { describe, expect, it } from 'vitest';
import { emptyData, forecast, forecastCardRepayment } from '../../src/engine';
import type { Data } from '../../src/engine';

/** Accounting year and forecast from October 2026; the card closes on the 4th and is debited on the 10th. */
function cardScenario(): Data {
  const d = emptyData('2026-10-03');
  d.accounts = [
    { id: 'debit', name: 'Карта', type: 'debit', start: 2000 },
    { id: 'cash', name: 'Наличные', type: 'cash', start: 0 },
    { id: 'credit', name: 'Кредитка', type: 'credit', start: 0 },
  ];
  d.operations = [
    { id: 'o1', date: '2026-10-02', kind: 'expense', what: 'Кофе', amount: 50, account: 'credit' }, // statement to 4 Oct
    { id: 'o2', date: '2026-10-20', kind: 'expense', what: 'Обувь', amount: 200, account: 'credit' },
    { id: 'o3', date: '2026-10-25', kind: 'income', what: 'Возврат', amount: 30, account: 'credit' },
    { id: 'o4', date: '2026-10-28', kind: 'transfer', what: 'На кредитку', amount: 70, account: 'debit', toAccount: 'credit' },
  ];
  d.journal = [
    { id: 'j1', date: '2026-10-30', kind: 'expense', what: 'Ужин', plan: 40, status: 'planned', account: 'credit' },
    { id: 'j2', date: '2026-10-31', kind: 'expense', what: 'Оплачено', plan: 15, status: 'paid', account: 'credit' }, // a fact
    { id: 'j3', date: '2026-11-20', kind: 'expense', what: 'Билеты', plan: 120, status: 'planned', account: 'credit' },
    { id: 'j4', date: '2026-11-21', kind: 'expense', what: 'Отменено', plan: 999, status: 'cancelled', account: 'credit' },
    { id: 'j5', date: '2026-11-25', kind: 'transfer', what: 'Погасить', plan: 50, status: 'planned', account: 'debit', toAccount: 'credit' },
    { id: 'j6', date: '2026-11-26', kind: 'expense', what: 'С карты', plan: 500, status: 'planned', account: 'debit' }, // not the card
  ];
  d.recurring = [
    { id: 'r1', what: 'Подписка', kind: 'expense', day: 15, amount: 25, account: 'credit', marks: { '2026-10': '✓' } },
  ];
  d.purchases = [
    { id: 'p1', what: 'Пылесос', cost: 300, date: '2026-11-01', bought: false, account: 'credit' },
  ];
  return d;
}

describe('forecastCardRepayment', () => {
  it('October: the facts of the statement to 4 October (50)', () => {
    expect(forecastCardRepayment(cardScenario(), '2026-10')).toEqual({ day: 10, amount: 50, auto: true });
  });

  it('November: facts 200 + 25 + 15 − 30 − 70 and the unpaid plan 40 + 300 of 5 Oct…4 Nov', () => {
    expect(forecastCardRepayment(cardScenario(), '2026-11').amount).toBe(480);
  });

  it('December: only planned spending — 120 + 25 (the November payment) − 50 (a planned transfer to the card)', () => {
    expect(forecastCardRepayment(cardScenario(), '2026-12').amount).toBe(95);
  });

  it('a debit day after a close day in the next month: the statement closing in the month before', () => {
    const d = cardScenario();
    d.credit = { ...d.credit, closeDay: 25, payDay: 5 }; // closes 25 Oct, debited 5 Nov
    // 1 Oct…25 Oct: 50 + 200 + 25 − 30 = 245; 26 Oct…25 Nov: 15 − 70 facts, 40 + 300 + 120 + 25 − 50 planned = 380
    expect([forecastCardRepayment(d, '2026-10').amount, forecastCardRepayment(d, '2026-11').amount,
      forecastCardRepayment(d, '2026-12').amount]).toEqual([0, 245, 380]);
  });

  it('without auto-payment: 0, and says so', () => {
    const d = cardScenario();
    d.credit = { ...d.credit, auto: false };
    expect(forecastCardRepayment(d, '2026-11')).toEqual({ day: 10, amount: 0, auto: false });
  });

  it('is in no sum of the forecast', () => {
    const d = cardScenario();
    const before = forecast(d);
    d.credit = { ...d.credit, auto: false };
    expect(forecast(d).months.map((m) => m.expenses)).toEqual(before.months.map((m) => m.expenses));
  });
});

/**
 * Parity with the tracker: the scenario of excel-planners src/test_forecast_rows.py («Кредиты»), whose «Прогноз»
 * C:E after a LibreOffice recalc is 40, 110, 280 (and 0, 0, 0 with «Нет» in Счета C33). Today 15.10.2026.
 */
function trackerCreditScenario(): Data {
  const d = emptyData('2026-10-15');
  d.settings.cushion = 0;
  d.categories.expense = [{ name: 'Продукты' }, { name: 'Подписки' }, { name: 'Техника' }];
  d.accounts = [
    { id: 'card', name: 'Карта', type: 'debit', start: 1000 },
    { id: 'cc', name: 'Кредитка', type: 'credit', start: 0 },
  ];
  d.credit = { auto: true, closeDay: 4, payDay: 10 };
  d.operations = [
    { id: 'o1', date: '2026-10-02', kind: 'expense', category: 'Продукты', what: 'Магазин', amount: 40, account: 'cc' },
    { id: 'o2', date: '2026-10-12', kind: 'expense', category: 'Продукты', what: 'Рынок', amount: 100, account: 'cc' },
    { id: 'o3', date: '2026-10-20', kind: 'income', category: 'Продукты', what: 'Возврат', amount: 30, account: 'cc' },
    { id: 'o4', date: '2026-10-25', kind: 'transfer', what: 'На кредитку', amount: 50, account: 'card', toAccount: 'cc' },
  ];
  d.journal = [
    { id: 'j1', date: '2026-11-03', kind: 'expense', category: 'Продукты', what: 'Ужин', plan: 70, status: 'paid', account: 'cc' },
    { id: 'j2', date: '2026-11-15', kind: 'expense', category: 'Техника', what: 'Телефон', plan: 200, status: 'planned', account: 'cc' },
    { id: 'j3', date: '2026-11-20', kind: 'transfer', what: 'Погасить кредитку', plan: 60, status: 'planned', account: 'card', toAccount: 'cc' },
    { id: 'j4', date: '2026-11-18', kind: 'expense', category: 'Техника', what: 'Отменённое', plan: 500, status: 'cancelled', account: 'cc' },
  ];
  d.recurring = [
    { id: 'r1', what: 'Подписка', kind: 'expense', category: 'Подписки', day: 8, amount: 20, account: 'cc', marks: { '2026-10': '✓' } },
  ];
  d.purchases = [{ id: 'p1', what: 'Наушники', category: 'Техника', cost: 120, date: '2026-12-01', bought: false, account: 'cc' }];
  return d;
}

describe('forecastCardRepayment — parity with the tracker', () => {
  const months = ['2026-10', '2026-11', '2026-12'];

  it('«Кредиты»: 40, 110, 280; «Всего расходов» without them: 160, 290, 140', () => {
    const d = trackerCreditScenario();
    expect(months.map((m) => forecastCardRepayment(d, m).amount)).toEqual([40, 110, 280]);
    expect(forecast(d).months.map((m) => m.expenses)).toEqual([160, 290, 140]);
  });

  it('auto-payment off: 0, 0, 0', () => {
    const d = trackerCreditScenario();
    d.credit.auto = false;
    expect(months.map((m) => forecastCardRepayment(d, m))).toEqual(months.map(() => ({ day: 10, amount: 0, auto: false })));
  });
});
