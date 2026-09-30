import { describe, expect, it } from 'vitest';
import { forecast } from '../../src/engine/forecast';
import { ACC, scenario, zpNovember, zpOctober } from './scenario';

const cents = (x: number) => Math.round(x * 100) / 100;

describe('forecast — scenario from October', () => {
  const f = forecast(scenario());

  it('starts with the money at the forecast start: 1000', () => {
    expect(f.start).toBe(1000);
  });

  it('months (income, expenses, end): Oct 3205/1335/2870, Nov 200/1040/2030, Dec 200/1390/840', () => {
    expect(f.months.map((m) => [m.ym, cents(m.income), cents(m.expenses), cents(m.end)])).toEqual([
      ['2026-10', 3205, 1335, 2870],
      ['2026-11', 200, 1040, 2030],
      ['2026-12', 200, 1390, 840],
    ]);
  });

  it('splits expenses into recurring, one-off and purchases', () => {
    expect(f.months.map((m) => [m.recurring, m.oneOff, m.purchases].map(cents))).toEqual([
      [900, 435, 0],
      [990, 50, 0],
      [910, 0, 480],
    ]);
  });

  it('free money and the reserve over the cushion of 100', () => {
    expect(f.months.map((m) => [cents(m.free), cents(m.overCushion)])).toEqual([
      [1870, 2770],
      [-840, 1930],
      [-1190, 740],
    ]);
    expect(f.months[0]).toMatchObject({ label: 'Октябрь 2026', from: '2026-10-01', to: '2026-10-31' });
  });

  it('13 weeks from the Monday before the start, by date', () => {
    expect(f.weeks).toHaveLength(13);
    expect(f.weeks[0]).toMatchObject({ n: 1, from: '2026-09-28', to: '2026-10-04' });
    expect(f.weeks[12]).toMatchObject({ n: 13, from: '2026-12-21', to: '2026-12-27' });
    expect(f.weeks.map((w) => cents(w.end))).toEqual([4000, 2715, 2665, 2870, 2870, 1920, 1830, 2030, 2030, 1130, 640, 840, 840]);
    expect(f.weeks.every((w) => w.cushion === 100)).toBe(true);
  });

  it('week 2 holds the rent, the October journal rows and the café operation', () => {
    const w = f.weeks[1];
    expect(w && [w.income, w.recurring, w.oneOff, w.purchases, w.expenses].map(cents)).toEqual([0, 900, 385, 0, 1285]);
  });

  it('last week ends at 840, like the last month', () => {
    expect(f.weeks[12]?.end).toBe(f.months[2]?.end);
  });

  it('summary: minimum 640 in the week of 07.12, no weeks below the cushion, totals', () => {
    expect(cents(f.minEnd)).toBe(640);
    expect(f.minWeekFrom).toBe('2026-12-07');
    expect(f.weeksBelow).toBe(0);
    expect(cents(f.freeTotal)).toBe(-160);
    expect(cents(f.expensesTotal)).toBe(3765);
  });

  it('counts weeks ending below the cushion', () => {
    const data = scenario();
    data.settings.cushion = 1000;
    expect(forecast(data).weeksBelow).toBe(3);
  });
});

describe('forecast — starting in November', () => {
  const data = scenario();
  data.settings.forecastStart = '2026-11';
  const f = forecast(data);

  it('starts with 2970 and ends November at 2130', () => {
    expect(cents(f.start)).toBe(2970);
    expect(f.months.map((m) => m.ym)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(cents(f.months[0]?.end ?? NaN)).toBe(2130);
  });

  it('first week starts on Monday 26.10', () => {
    expect(f.weeks[0]?.from).toBe('2026-10-26');
  });
});

describe('forecast — accounting month of journal rows', () => {
  it('«ЗП ноябрь» paid 30.10 is November income in months, but dated 30.10 in weeks', () => {
    const data = scenario();
    data.journal.push(zpNovember);
    const f = forecast(data);
    expect([f.months[0]?.income, f.months[1]?.income]).toEqual([3205, 600]);
    expect(f.weeks[4]).toMatchObject({ from: '2026-10-26', income: 400 });
  });

  it('with «ЗП октябрь» paid 29.09 October income is 3275', () => {
    const data = scenario();
    data.journal.push(zpNovember, zpOctober);
    expect(forecast(data).months[0]?.income).toBe(3275);
  });
});

describe('forecast — recurring payments', () => {
  it('leaves out a recurring payment without a day', () => {
    const data = scenario();
    data.recurring.push({ id: 'r-x', what: 'Без дня', kind: 'expense', amount: 50, account: ACC.card, marks: {} });
    expect(forecast(data).months[0]?.recurring).toBe(900);
  });

  it('counts recurring payments in weeks only on dates inside the forecast months', () => {
    const data = scenario();
    data.recurring.push({ id: 'r-x', what: 'Тест', kind: 'expense', day: 29, amount: 70, account: ACC.card, marks: {} });
    const f = forecast(data);
    expect(f.weeks[0]?.recurring).toBe(0); // 29.09 is before the forecast
    expect(f.weeks[4]?.recurring).toBe(70); // 29.10
    expect(f.weeks.reduce((acc, w) => acc + w.recurring, 0)).toBe(900 + 990 + 910 + 140); // 29.12 is after week 13
  });
});

// Weeks count the same rows as the months (nothing already inside the forecast start),
// placed by date; a row dated before the forecast start lands in the week of the start.
describe('forecast — weeks count the same rows as the months', () => {
  const lastWeekEnd = (f: ReturnType<typeof forecast>) => f.weeks[f.weeks.length - 1]?.end;
  const sum = (f: ReturnType<typeof forecast>, pick: (x: { income: number; expenses: number }) => number) =>
    [f.weeks.reduce((acc, w) => acc + pick(w), 0), f.months.reduce((acc, m) => acc + pick(m), 0)].map(cents);

  it('base scenario: the last week ends like December (840) and weekly flows add up to the monthly ones', () => {
    const f = forecast(scenario());
    expect(lastWeekEnd(f)).toBe(840);
    expect(lastWeekEnd(f)).toBe(f.months[2]?.end);
    expect(sum(f, (x) => x.income)).toEqual([3605, 3605]);
    expect(sum(f, (x) => x.expenses)).toEqual([3765, 3765]);
  });

  it('an operation dated 29.09, before the balances date and the forecast start, is left out of the weeks', () => {
    const data = scenario();
    data.operations.push({ id: 'o-x', date: '2026-09-29', kind: 'expense', what: 'До старта', amount: 70, account: ACC.card });
    const f = forecast(data);
    expect(f.start).toBe(1000);
    expect(f.weeks[0]?.oneOff).toBe(0);
    expect(f.weeks.map((w) => cents(w.end))).toEqual([4000, 2715, 2665, 2870, 2870, 1920, 1830, 2030, 2030, 1130, 640, 840, 840]);
    expect(lastWeekEnd(f)).toBe(f.months[2]?.end);
  });

  it('November start: an operation of 28.10 is inside the start (2920) and not taken again in week 1', () => {
    const data = scenario();
    data.settings.forecastStart = '2026-11';
    data.operations.push({ id: 'o-x', date: '2026-10-28', kind: 'expense', what: 'Октябрь', amount: 50, account: ACC.card });
    const f = forecast(data);
    const w1 = f.weeks[0];
    expect(cents(f.start)).toBe(2920);
    expect(w1 && [w1.from, w1.income, w1.expenses]).toEqual(['2026-10-26', 0, 0]);
    expect(cents(w1?.end ?? NaN)).toBe(cents(f.start + (w1?.income ?? NaN) - (w1?.expenses ?? NaN)));
    expect(cents(w1?.end ?? NaN)).toBe(2920);
    expect(cents(lastWeekEnd(f) ?? NaN)).toBe(cents(f.months[2]?.end ?? NaN));
  });

  it('a journal row dated 02.11 but counted in October is taken once: October in months, the week of 02.11 in weeks', () => {
    const data = scenario();
    data.journal.push({ id: 'j-x', date: '2026-11-02', kind: 'expense', what: 'За октябрь', plan: 40, account: ACC.card, month: '2026-10' });
    const f = forecast(data);
    expect(f.months.map((m) => m.oneOff)).toEqual([475, 50, 0]);
    expect(f.weeks[5]).toMatchObject({ from: '2026-11-02', oneOff: 40 });
    expect(f.weeks.reduce((acc, w) => acc + w.oneOff, 0)).toBe(525);
    expect(lastWeekEnd(f)).toBe(800);
    expect(lastWeekEnd(f)).toBe(f.months[2]?.end);
  });

  it('November start: a journal row dated 02.11 but counted in October is inside the start, not in the weeks', () => {
    const data = scenario();
    data.settings.forecastStart = '2026-11';
    data.journal.push({ id: 'j-x', date: '2026-11-02', kind: 'expense', what: 'За октябрь', plan: 40, status: 'paid', account: ACC.card, month: '2026-10' });
    const f = forecast(data);
    expect(cents(f.start)).toBe(2930);
    expect(f.weeks[1]).toMatchObject({ from: '2026-11-02', oneOff: 0 });
    expect(cents(lastWeekEnd(f) ?? NaN)).toBe(cents(f.months[2]?.end ?? NaN));
  });

  it('a journal row dated 15.09 but counted in October lands in the week of the forecast start', () => {
    const data = scenario();
    data.journal.push({ id: 'j-x', date: '2026-09-15', kind: 'income', what: 'Аванс за октябрь', plan: 70, status: 'paid', account: ACC.card, month: '2026-10' });
    const f = forecast(data);
    expect(f.months[0]?.income).toBe(3275);
    expect(f.weeks[0]?.income).toBe(3070);
    expect(lastWeekEnd(f)).toBe(910);
    expect(lastWeekEnd(f)).toBe(f.months[2]?.end);
  });
});
