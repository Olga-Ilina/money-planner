// «Резерв по лимитам (повседневные траты)» of the forecast (spec 2026-10-03-month-limits, «Дополнение 18:55»): for
// each forecast month and expense category with a limit, R = max(0, limit − expected), where expected is the fact of
// what is done and the plan of what is not. Counted in the month's expenses, its free money and balances; spread
// evenly over the days of the month (today's month: from today, or the forecast start, to its end) for the weeks.
import { describe, expect, it } from 'vitest';
import { emptyData, forecast, limitReserve, purchaseStatus } from '../../src/engine';
import type { Data } from '../../src/engine';

/** Accounting year and forecast from October 2026, cushion 0, 1000 on the card; today 15 October. */
function reserveScenario(): Data {
  const d = emptyData('2026-10-15');
  d.settings.cushion = 0;
  d.accounts = [{ id: 'card', name: 'Карта', type: 'debit', start: 1000 }];
  d.categories.expense = [
    { name: 'Продукты', limit: 300 }, // a limit without a plan
    { name: 'Кафе', limit: 100, monthLimits: { '2026-11': 50 } }, // a fact and an unpaid plan in October
    { name: 'Техника', limit: 100 }, // November: the plan (250) is over the limit
    { name: 'Прочее' }, // no limit
  ];
  d.operations = [
    { id: 'o1', date: '2026-10-05', kind: 'expense', category: 'Продукты', what: 'Магазин', amount: 120, account: 'card' },
    { id: 'o2', date: '2026-10-08', kind: 'expense', category: 'Кафе', what: 'Обед', amount: 20, account: 'card' },
  ];
  d.journal = [
    { id: 'j1', date: '2026-10-20', kind: 'expense', category: 'Кафе', what: 'Ужин', plan: 30, status: 'planned', account: 'card' },
    { id: 'j2', date: '2026-11-12', kind: 'expense', category: 'Техника', what: 'Телефон', plan: 250, status: 'planned', account: 'card' },
    { id: 'j3', date: '2026-11-14', kind: 'expense', category: 'Прочее', what: 'Разное', plan: 40, status: 'planned', account: 'card' },
  ];
  return d;
}

const TODAY = '2026-10-15';

describe('limitReserve', () => {
  it('today\'s month: what is left of each limit after the facts and the unpaid plans (180 + 50 + 100)', () => {
    expect(limitReserve(reserveScenario(), '2026-10', TODAY)).toBe(330);
  });

  it('a later month: limit − plan; a month limit counts; a plan over its limit gives 0, not less', () => {
    expect(limitReserve(reserveScenario(), '2026-11', TODAY)).toBe(350); // 300 + 50 + 0
    expect(limitReserve(reserveScenario(), '2026-12', TODAY)).toBe(500); // 300 + 100 + 100
  });

  it('a month before today\'s: 0', () => {
    expect(limitReserve(reserveScenario(), '2026-10', '2026-11-10')).toBe(0);
  });

  it('no limits: 0', () => {
    const d = reserveScenario();
    d.categories.expense = d.categories.expense.map((c) => ({ name: c.name }));
    expect(['2026-10', '2026-11', '2026-12'].map((m) => limitReserve(d, m, TODAY))).toEqual([0, 0, 0]);
  });
});

describe('forecast with the reserve by limits', () => {
  const f = forecast(reserveScenario(), TODAY);

  it('months: the reserve is in the expenses, the free money and the balances', () => {
    expect(f.months.map((m) => [m.reserve, m.oneOff, m.expenses, m.free, m.end])).toEqual([
      [330, 170, 500, -500, 500],
      [350, 290, 640, -640, -140],
      [500, 0, 500, -500, -640],
    ]);
    expect(f.expensesTotal).toBe(1640);
  });

  it('weeks: today\'s month spread from today (17 days), the next ones over all their days; a week across months gets both', () => {
    const w = f.weeks;
    expect(w.map((x) => x.from).slice(0, 5)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(w[0]!.reserve).toBe(0); // 1…4 October: before today
    expect(w[1]!.reserve).toBe(0);
    expect(w[2]!.reserve).toBeCloseTo((4 * 330) / 17, 10); // 15…18 October
    expect(w[3]!.reserve).toBeCloseTo((7 * 330) / 17, 10);
    expect(w[4]!.reserve).toBeCloseTo((6 * 330) / 17 + 350 / 30, 10); // 26…31 October and 1 November
    expect(w[3]!.expenses).toBeCloseTo(30 + (7 * 330) / 17, 10); // in the expenses
    expect(w[4]!.end).toBeCloseTo(1000 - 140 - 330 - 30 - 350 / 30, 10);
  });

  it('the weeks spread the whole reserve of the months they cover', () => {
    const covered = f.weeks.reduce((sum, w) => sum + w.reserve, 0);
    // 13 weeks from 28 September end on 27 December: October and November in full, 27 of the 31 days of December
    expect(covered).toBeCloseTo(330 + 350 + (27 * 500) / 31, 8);
  });

  it('without today: today\'s month is the forecast start month, spread over all its days', () => {
    const g = forecast(reserveScenario());
    expect(g.months[0]!.reserve).toBe(330);
    expect(g.weeks[0]!.reserve).toBeCloseTo((4 * 330) / 31, 10);
  });

  it('weeks below the cushion and «Хватит ли денег» follow the balances with the reserve', () => {
    const d = reserveScenario();
    d.settings.cushion = 500;
    d.purchases = [{ id: 'p1', what: 'Кресло', cost: 0, date: '2026-11-02', bought: false, account: 'card' }];
    const withReserve = forecast(d, TODAY);
    const without = forecast({ ...d, categories: { ...d.categories, expense: d.categories.expense.map((c) => ({ name: c.name })) } }, TODAY);
    expect(without.weeksBelow).toBe(0); // 1000 − 460 = 540 at the lowest
    expect(withReserve.weeksBelow).toBeGreaterThan(0);
    expect(purchaseStatus(d.purchases[0]!, without, d)).toBe('enough');
    expect(purchaseStatus(d.purchases[0]!, withReserve, d)).toBe('short'); // the week of 2 November ends at 1000 − 170 − 330 − 8 × 350 / 30 ≈ 407
  });
});

/**
 * Parity with the tracker: the reserve scenario of excel-planners src/test_forecast_rows.py (LibreOffice recalc,
 * hand-computed answers; today 15.10.2026): a limit without a plan, a plan over the limit, today's month with a part
 * of the fact, a category without a limit, a month limit, a week across two months; a past forecast month gets 0.
 */
function trackerReserveScenario(start: '2026-10' | '2026-09' = '2026-10'): Data {
  const d = emptyData('2026-10-15');
  d.settings = { accountingStart: start, forecastStart: start, cushion: 0, balancesDate: `${start}-01` };
  d.accounts = [{ id: 'card', name: 'Карта', type: 'debit', start: 1000 }];
  d.categories.expense = [
    { name: 'Продукты', limit: 300, monthLimits: { '2026-11': 400 } },
    { name: 'Кафе', limit: 100 },
    { name: 'Жильё', limit: 500 },
    { name: 'Техника' },
  ];
  d.operations = [
    { id: 'o1', date: '2026-10-05', kind: 'expense', category: 'Продукты', what: 'Магазин', amount: 120, account: 'card' },
    { id: 'o2', date: '2026-10-12', kind: 'expense', category: 'Продукты', what: 'Рынок', amount: 60, account: 'card' },
    { id: 'o3', date: '2026-10-10', kind: 'expense', category: 'Кафе', what: 'Кофе', amount: 30, account: 'card' },
  ];
  d.journal = [
    { id: 'j1', date: '2026-10-25', kind: 'expense', category: 'Продукты', what: 'Закупка', plan: 50, status: 'planned', account: 'card' },
    { id: 'j2', date: '2026-11-10', kind: 'expense', category: 'Продукты', what: 'Праздник', plan: 100, status: 'planned', account: 'card' },
  ];
  d.recurring = [
    { id: 'r1', what: 'Зарплата', kind: 'income', category: 'Зарплата', day: 1, amount: 3000, account: 'card', marks: {} },
    { id: 'r2', what: 'Аренда', kind: 'expense', category: 'Жильё', day: 3, amount: 800, account: 'card', marks: start === '2026-10' ? { '2026-10': '✓' } : {} },
  ];
  d.purchases = [{ id: 'p1', what: 'Ноутбук', category: 'Техника', cost: 200, date: '2026-11-20', bought: false, account: 'card' }];
  return d;
}

describe('forecast with the reserve — parity with the tracker', () => {
  const f = forecast(trackerReserveScenario(), '2026-10-15');

  it('months: reserve 140, 400, 400; expenses 1200, 1500, 1200; free 1800, 1500, 1800; ends 2800, 4300, 6100', () => {
    expect(f.months.map((m) => m.reserve)).toEqual([140, 400, 400]);
    expect(f.months.map((m) => [m.income, m.recurring, m.oneOff, m.purchases])).toEqual([
      [3000, 800, 260, 0], [3000, 800, 100, 200], [3000, 800, 0, 0],
    ]);
    expect(f.months.map((m) => m.expenses)).toEqual([1200, 1500, 1200]);
    expect(f.months.map((m) => m.free)).toEqual([1800, 1500, 1800]);
    expect(f.months.map((m) => m.end)).toEqual([2800, 4300, 6100]);
    expect([f.expensesTotal, f.freeTotal]).toEqual([3900, 5100]);
  });

  it('weeks: October 140 over 17 days, November 400 over 30, December 400 over 31; the week of 26.10 gets both', () => {
    const o = 140 / 17;
    const n = 400 / 30;
    const dd = 400 / 31;
    const want = [0, 0, 4 * o, 7 * o, 6 * o + n, 7 * n, 7 * n, 7 * n, 7 * n, n + 6 * dd, 7 * dd, 7 * dd, 7 * dd];
    f.weeks.forEach((w, i) => expect(w.reserve).toBeCloseTo(want[i]!, 9));
    expect(f.weeks[4]!.expenses).toBeCloseTo(6 * o + n, 9); // 26.10–01.11: nothing else
    expect([f.weeks[1]!.oneOff, f.weeks[1]!.reserve]).toEqual([150, 0]); // 05–11.10: before today
    expect(f.weeks[12]!.end).toBeCloseTo(1000 + 9000 - 2400 - 360 - 200 - (140 + 400 + 27 * dd), 9); // 6151,61
  });

  it('a forecast from September (already past): 0, 140, 400; the weeks hold October and 29 days of November', () => {
    const g = forecast(trackerReserveScenario('2026-09'), '2026-10-15');
    expect(g.months.map((m) => m.reserve)).toEqual([0, 140, 400]);
    expect(g.weeks.reduce((sum, w) => sum + w.reserve, 0)).toBeCloseTo(140 + (29 * 400) / 30, 9);
  });
});

/**
 * A recurring payment without a day: the forecast's flows never count it (no date), so it must not use up the limit
 * either — the tracker leaves it out of both («Ожидаемо» sums only rows with a date). Review I1.
 */
describe('limitReserve — a recurring payment without a day', () => {
  /** «Подписки» with a limit of 300, today 1 October, one recurring row. */
  function subscriptions(rec?: { day?: number }): Data {
    const d = emptyData('2026-10-01');
    d.settings.cushion = 0;
    d.accounts = [{ id: 'card', name: 'Карта', type: 'debit', start: 1000 }];
    d.categories.expense = [{ name: 'Подписки', limit: 300 }];
    if (rec) {
      d.recurring = [{ id: 'r1', what: 'Сервис', kind: 'expense', category: 'Подписки', amount: 100, account: 'card', marks: {}, ...rec }];
    }
    return d;
  }

  it('no day: the reserve stays the whole limit and the expenses are the same as without the row', () => {
    const without = forecast(subscriptions(), '2026-10-01');
    const dayless = forecast(subscriptions({}), '2026-10-01');
    expect(limitReserve(subscriptions({}), '2026-10', '2026-10-01')).toBe(300);
    expect(dayless.months.map((m) => [m.recurring, m.reserve, m.expenses])).toEqual([[0, 300, 300], [0, 300, 300], [0, 300, 300]]);
    expect(dayless.months.map((m) => m.expenses)).toEqual(without.months.map((m) => m.expenses));
    expect(dayless.expensesTotal).toBe(without.expensesTotal);
  });

  it('a day: the payment counts in the recurring expenses and uses up the limit (200)', () => {
    const f = forecast(subscriptions({ day: 5 }), '2026-10-01');
    expect(limitReserve(subscriptions({ day: 5 }), '2026-10', '2026-10-01')).toBe(200);
    expect(f.months.map((m) => [m.recurring, m.reserve, m.expenses])).toEqual([[100, 200, 300], [100, 200, 300], [100, 200, 300]]);
  });
});
