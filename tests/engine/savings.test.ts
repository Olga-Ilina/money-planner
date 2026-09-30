// Savings accounts outside the balance (spec 2026-10-01-savings-accounts, the tracker's rules 1–6): «Всего» and the
// forecast count only the accounts in the balance (debit, cash, credit); transfers across the line and the credit
// card paid from savings move the free money. Numbers of the tracker's own tests and of its reviewer's scenario.
import { describe, expect, it } from 'vitest';
import {
  balances, cashAtForecastStart, forecast, inBalance, monthSummary, purchaseStatus, transferToFree, yearStats,
} from '../../src/engine';
import type { Data, Operation } from '../../src/engine';
import { ACC, scenario } from './scenario';
import { SAV, savingsScenario, withBox } from './savingsScenario';

const cents = (x: number) => Math.round(x * 100) / 100;
const TODAY = '2026-09-30';

const byName = (data: Data, today = TODAY) =>
  Object.fromEntries(balances(data, today).rows.map((r) => [r.name, cents(r.now)]));

const totals = (data: Data, today = TODAY) => {
  const b = balances(data, today);
  return [b.cards, b.cash, b.creditDebt, b.total, b.savings].map(cents);
};

const statuses = (data: Data) => {
  const fc = forecast(data);
  return data.purchases.map((p) => purchaseStatus(p, fc, data));
};

// ── The tracker reviewer's scenario ───────────────────────────────────────────────────────────────────────────────
describe('savings — the reviewer’s scenario, auto-payment from «Копилка» (variant S), today 30.09.2026', () => {
  const data = savingsScenario('box');
  const f = forecast(data);

  it('keeps the balance of every account: Карта 3435, Нал 220, Кредитка 10, Копилка 3940, Вклад 3754', () => {
    expect(byName(data)).toEqual({ 'Карта': 3435, 'Нал': 220, 'Кредитка': 10, 'Копилка': 3940, 'Вклад': 3754 });
  });

  it('«На картах» only debit 3435, «Всего» only the balance 3665, «Сбережения» 7694', () => {
    expect(totals(data)).toEqual([3435, 220, 0, 3665, 7694]);
  });

  it('starts the forecast with the free money on 01.06: 2260 (the Копилка auto-payment of 10.05 included)', () => {
    expect(cashAtForecastStart(data)).toBe(2260);
    expect(f.start).toBe(2260);
  });

  it('months: income, expenses, free money as before; transfers −80 / +30 / +18; ends 1470 / 2335 / 1733', () => {
    expect(f.months.map((m) => [m.ym, m.income, m.recurring, m.oneOff, m.purchases, m.expenses, m.free].map((v) => (typeof v === 'number' ? cents(v) : v))))
      .toEqual([
        ['2026-06', 0, 530, 180, 0, 710, -710],
        ['2026-07', 2000, 530, 35, 600, 1165, 835],
        ['2026-08', 0, 530, 90, 0, 620, -620],
      ]);
    expect(f.months.map((m) => cents(m.transfers))).toEqual([-80, 30, 18]);
    expect(f.months.map((m) => cents(m.end))).toEqual([1470, 2335, 1733]);
    expect(f.months.map((m) => cents(m.overCushion))).toEqual([-30, 835, 233]);
  });

  it('weeks: transfers and ends from Monday 01.06', () => {
    expect(f.weeks[0]).toMatchObject({ from: '2026-06-01', to: '2026-06-07' });
    expect(f.weeks.map((w) => cents(w.transfers))).toEqual([-400, 70, 250, 0, 0, 30, 0, 0, 0, -20, 45, -7, 0]);
    expect(f.weeks.map((w) => cents(w.end))).toEqual([1360, 1370, 1470, 1470, 970, 1000, 935, 2335, 2335, 1725, 1740, 1733, 1733]);
  });

  it('summary: 7 weeks below the cushion, minimum 935 in the week of 13.07, free −495, expenses 2495', () => {
    expect([f.weeksBelow, cents(f.minEnd), f.minWeekFrom, cents(f.freeTotal), cents(f.expensesTotal)])
      .toEqual([7, 935, '2026-07-13', -495, 2495]);
  });

  it('«Хватит ли денег»: the laptop from «Копилка» «Из сбережений», the bike «Хватает», bought ones «Куплено»', () => {
    expect(statuses(data)).toEqual(['savings', 'enough', 'bought', 'bought']);
  });
});

describe('savings — the reviewer’s scenario, auto-payment from «Карта» (variant D)', () => {
  const data = savingsScenario('card');
  const f = forecast(data);

  it('balances: Карта 3230, Копилка 4145; «На картах» 3230, «Всего» 3460, «Сбережения» 7899', () => {
    expect(byName(data)).toEqual({ 'Карта': 3230, 'Нал': 220, 'Кредитка': 10, 'Копилка': 4145, 'Вклад': 3754 });
    expect(totals(data)).toEqual([3230, 220, 0, 3460, 7899]);
  });

  it('an auto-payment inside the balance moves no free money: start 2190, transfers −150 / 0 / −17', () => {
    expect(f.start).toBe(2190);
    expect(f.months.map((m) => cents(m.transfers))).toEqual([-150, 0, -17]);
    expect(f.months.map((m) => cents(m.end))).toEqual([1330, 2165, 1528]);
    expect(f.weeks.map((w) => cents(w.transfers))).toEqual([-400, 0, 250, 0, 0, 0, 0, 0, 0, -20, 10, -7, 0]);
    expect(f.weeks.map((w) => cents(w.end))).toEqual([1290, 1230, 1330, 1330, 830, 830, 765, 2165, 2165, 1555, 1535, 1528, 1528]);
    expect([f.weeksBelow, cents(f.minEnd)]).toEqual([7, 765]);
  });
});

// ── The tracker's own savings test (test_tracker.py, fill_savings): the scenario + «Копилка» ────────────────────────
describe('savings — the tracker’s test: scenario + «Копилка»', () => {
  const data = withBox();
  const f = forecast(data);

  it.each([
    ['2026-09-30', 0],
    ['2026-12-31', 10], // the statement of 04.12 (10) is paid from «Копилка» on 10.12
  ])('balances on %s: Карта 1160, Наличные 80, Кредитка −10 + paid, Копилка 715 − paid', (today, paid) => {
    expect(byName(data, today)).toEqual({ 'Карта': 1160, 'Наличные': 80, 'Кредитка': -10 + paid, 'Копилка': 715 - paid });
    const box = balances(data, today).rows[3];
    expect(box && [box.income, box.expense, box.transfers].map(cents)).toEqual([5, 40, 250 - paid]);
    expect(totals(data, today)).toEqual([1160, 80, -10 + paid, 1230 + paid, 715 - paid]);
  });

  it('the forecast starts with the accounts in the balance: 1000, not 1500', () => {
    expect(f.start).toBe(1000);
  });

  it('months: the income and expenses of the scenario, transfers −300 / +50 / +10, ends 2570 / 1780 / 600', () => {
    expect(f.months.map((m) => [m.income, m.expenses, m.free, m.transfers, m.end, m.overCushion].map(cents))).toEqual([
      [3205, 1335, 1870, -300, 2570, 2470],
      [200, 1040, -840, 50, 1780, 1680],
      [200, 1390, -1190, 10, 600, 500],
    ]);
  });

  it('weeks: transfers in weeks 3, 8 and 11; the ends of the tracker', () => {
    expect(f.weeks.map((w) => w.transfers)).toEqual([0, 0, -300, 0, 0, 0, 0, 50, 0, 0, 10, 0, 0]);
    expect(f.weeks.map((w) => cents(w.end))).toEqual([4000, 2715, 2365, 2570, 2570, 1620, 1530, 1780, 1780, 880, 400, 600, 600]);
    expect([cents(f.minEnd), f.minWeekFrom, cents(f.freeTotal)]).toEqual([400, '2026-12-07', -160]);
    expect(f.weeks[f.weeks.length - 1]?.end).toBe(f.months[2]?.end);
  });

  it('«Хватит ли денег»: the laptop «Куплено», the bike from «Копилка» «Из сбережений»', () => {
    expect(statuses(data)).toEqual(['bought', 'savings']);
  });

  it('statistics and «Месяц» count the savings account’s income and expenses as usual, transfers not at all', () => {
    const year = yearStats(data).months;
    expect(year.slice(0, 2).map((m) => [m.incomePlan, m.incomeFact, m.expensePlan, m.expenseFact])).toEqual([
      [3205, 3210, 1180, 1275],
      [205, 0, 1490, 1010],
    ]);
    const oct = monthSummary(data, '2026-10');
    expect(oct.byCategory.find((c) => c.name === 'Продукты')?.fact).toBe(250);
  });

  it('cushion 1800: 8 weeks below it; the bike from «Копилка» is still «Из сбережений»', () => {
    const d = withBox((x) => {
      x.settings.cushion = 1800;
    });
    const fc = forecast(d);
    expect(fc.months.map((m) => cents(m.overCushion))).toEqual([770, -20, -1200]);
    expect(fc.weeksBelow).toBe(8);
    expect(purchaseStatus(d.purchases[1]!, fc, d)).toBe('savings');
  });

  it('purchases from an account in the balance are compared with the cushion of 1800', () => {
    const d = withBox((x) => {
      x.settings.cushion = 1800;
      x.purchases[1]!.account = ACC.card;
      x.purchases.push({ id: 'p-samokat', what: 'Самокат', category: 'Техника', cost: 100, saved: 0, date: '2026-10-06', bought: false, account: ACC.card });
    });
    const fc = forecast(d);
    expect([fc.weeks[1]?.end, fc.weeks[7]?.end]).toEqual([2615, 1380]);
    expect(statuses(d)).toEqual(['bought', 'short', 'enough']);
  });

  it('forecast from November: start 2670 (October’s transfer into «Копилка» included), November +50', () => {
    const d = withBox((x) => {
      x.settings.forecastStart = '2026-11';
    });
    const fc = forecast(d);
    expect(fc.start).toBe(2670);
    expect([fc.months[0]?.transfers, fc.months[0]?.end]).toEqual([50, 2670 + 200 - 1040 + 50]);
  });

  it('forecast from January 2027: start 1240 — the accounts in the balance after December (the card paid from savings)', () => {
    const d = withBox((x) => {
      x.settings.forecastStart = '2027-01';
    });
    expect(cashAtForecastStart(d)).toBe(1160 + 80 + 0);
    const b = balances(d, '2027-01-01');
    expect(b.total).toBe(1240);
  });
});

// ── The rules one by one ──────────────────────────────────────────────────────────────────────────────────────────
describe('inBalance: which rows count in «Всего» and in the forecast', () => {
  const d = savingsScenario();

  it('every account but a savings one', () => {
    expect([SAV.card, SAV.cash, SAV.credit, SAV.box, SAV.deposit].map((id) => inBalance(d, id))).toEqual([true, true, true, false, false]);
  });

  it('a row without an account, or with a deleted one, counts in the balance (the tracker’s flag)', () => {
    expect([undefined, '', 'acc-deleted'].map((id) => inBalance(d, id))).toEqual([true, true, true]);
  });
});

describe('transferToFree: a transfer across the line between the balance and savings', () => {
  const d = savingsScenario();
  const transfer = (account: string | undefined, toAccount: string | undefined, amount = 100): Operation => ({
    id: 'o', date: '2026-06-10', kind: 'transfer', what: '', amount,
    ...(account !== undefined ? { account } : {}), ...(toAccount !== undefined ? { toAccount } : {}),
  });

  it('into savings −amount, out of savings +amount (the sign of the amount does not matter)', () => {
    expect(transferToFree(d, transfer(SAV.card, SAV.box))).toBe(-100);
    expect(transferToFree(d, transfer(SAV.deposit, SAV.cash, -40))).toBe(40);
  });

  it('inside one group nothing', () => {
    expect(transferToFree(d, transfer(SAV.card, SAV.cash))).toBe(0);
    expect(transferToFree(d, transfer(SAV.box, SAV.deposit))).toBe(0);
  });

  it('without «На счёт» nothing; without «Со счёта» it comes from the balance', () => {
    expect(transferToFree(d, transfer(SAV.box, undefined))).toBe(0);
    expect(transferToFree(d, transfer(SAV.box, ''))).toBe(0);
    expect(transferToFree(d, transfer(undefined, SAV.box))).toBe(-100);
    expect(transferToFree(d, transfer(undefined, SAV.card))).toBe(0);
  });

  it('an expense or an income is not a transfer', () => {
    expect(transferToFree(d, { id: 'o', date: '2026-06-10', kind: 'expense', what: '', amount: 5, account: SAV.box, toAccount: SAV.card })).toBe(0);
  });
});

describe('the forecast leaves out every kind of row of a savings account', () => {
  it('a journal row, a recurring payment, an operation and a purchase of «Копилка» change no week or month', () => {
    const base = savingsScenario();
    const before = forecast(base);
    const d = savingsScenario();
    d.journal.push({ id: 'j-x', date: '2026-06-09', kind: 'expense', what: 'x', plan: 11, account: SAV.box });
    d.recurring.push({ id: 'r-x', what: 'x', kind: 'income', day: 9, amount: 13, account: SAV.deposit, marks: {} });
    d.operations.push({ id: 'o-x', date: '2026-06-09', kind: 'expense', what: 'x', amount: 17, account: SAV.box });
    d.purchases.push({ id: 'p-x', what: 'x', cost: 19, date: '2026-06-09', bought: false, account: SAV.deposit });
    const after = forecast(d);
    expect(after).toEqual(before);
  });

  it('with no savings accounts the forecast is the one of all accounts (transfers 0)', () => {
    const f = forecast(scenario());
    expect(f.months.map((m) => m.transfers)).toEqual([0, 0, 0]);
    expect(f.weeks.every((w) => w.transfers === 0)).toBe(true);
    expect(f.months.map((m) => m.end)).toEqual([2870, 2030, 840]);
  });
});

describe('purchaseStatus of a purchase from a savings account', () => {
  it('«Из сбережений» before it is bought (whatever the week), «Куплено» after; without a date nothing', () => {
    const d = savingsScenario();
    const fc = forecast(d);
    const laptop = d.purchases[0]!;
    expect(purchaseStatus(laptop, fc, d)).toBe('savings');
    expect(purchaseStatus({ ...laptop, date: '2027-03-01' }, fc, d)).toBe('savings'); // outside the 13 weeks too
    expect(purchaseStatus({ ...laptop, bought: true }, fc, d)).toBe('bought');
    expect(purchaseStatus({ ...laptop, date: undefined }, fc, d)).toBeNull();
  });
});
