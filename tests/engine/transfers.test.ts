// Planned and recurring transfers into savings (spec 2026-10-01-planned-transfers, rules 1–8, 6a, warning 7, the
// automatic card repayment), exactly as the tracker computes them: the tracker's parity scenario (test_transfers.py)
// with its expected cells (transfers-tracker-report.md, «Ожидаемые ячейки»), cell by cell.
import { describe, expect, it } from 'vitest';
import {
  accountMovements, balances, cardRepayments, cashAtForecastStart, creditStatements, dailySpend, duplicatesForJournal,
  duplicatesForOperation, forecast, freeMoneyFactor, markPaid, monthCardRepayment, monthItems, monthSummary,
  monthlyAverage, nextCreditDebit, rowCheck, upcoming, warnings, yearStats,
} from '../../src/engine';
import type { Data } from '../../src/engine';
import { TR, TR_TODAY, fromNovember, transfersScenario } from './transfersScenario';
import { row } from './scenario';

const cents = (x: number) => Math.round(x * 100) / 100;

describe('the tracker’s transfers scenario, today 20.12.2026', () => {
  const data = transfersScenario();

  it('«Запланированные» X: −1 into savings, +1 out of them, 0 inside a group / not a transfer / without «На счёт»', () => {
    expect(data.journal.map((r) => freeMoneyFactor(data, r))).toEqual([-1, 1, 0, 0, 0, 0, 0, 0]);
  });

  it('«Постоянные» AM / AN: the same ±1 for the recurring transfers', () => {
    expect(data.recurring.map((r) => freeMoneyFactor(data, r))).toEqual([0, 0, -1, 1, 0, 0, 0, 0, 0]);
  });

  it('«Дубль или проверка»: the hint on «Доход» to savings, no «На счёт», the same account; no duplicate marks', () => {
    expect(data.journal.map((r) => rowCheck(data, r))).toEqual([
      null, null, null, null, 'looksLikeTransfer', null, 'noTarget', 'sameAccount',
    ]);
    expect(data.operations.map((o) => rowCheck(data, o))).toEqual([null, null, null, null, 'looksLikeTransfer', null]);
    expect(data.journal.map((r) => duplicatesForJournal(data, r))).toEqual(Array(8).fill(null));
    expect(data.operations.map((o) => duplicatesForOperation(data, o))).toEqual(Array(6).fill(null));
  });

  it('«Постоянные»: on average 1020 of expenses a month (transfers are not expenses)', () => {
    expect(monthlyAverage(data.recurring, 'expense')).toBe(1020);
    expect(monthlyAverage(data.recurring, 'income')).toBe(3010);
  });

  it('«Счета»: income, spending, transfers, now of every account', () => {
    const b = balances(data, TR_TODAY);
    expect(b.rows.map((r) => [r.name, r.income, r.expense, r.transfers, r.now].map((v) => (typeof v === 'number' ? cents(v) : v))))
      .toEqual([
        ['Карта', 9000, 3000, -1350, 6650],
        ['Наличные', 0, 0, -40, 60],
        ['Кредитка', 15, 245, 210, -20],
        ['Копилка', 117, 0, 1150, 2267],
        ['Вклад', 0, 0, -50, 450],
      ]);
  });

  it('«Счета» cards: on cards 6650, cash 60, credit debt −20, total 6690, savings 2717', () => {
    const b = balances(data, TR_TODAY);
    expect([b.cards, b.cash, b.creditDebt, b.total, b.savings].map(cents)).toEqual([6650, 60, -20, 6690, 2717]);
  });

  it('«Счета» checks: nothing without an account, 2 transfers without «на счёт» (a planned and a recurring one)', () => {
    const w = warnings(data);
    expect(w.unassigned).toEqual({ count: 0, sum: 0 });
    expect(w.transfersWithoutTarget).toBe(2);
    expect(w.transfersToSameAccount).toBe(1);
    expect(w.incomeToSavings).toBe(3); // «Перевод с карты», «Кэшбэк на копилку», recurring «Проценты»
    expect(w.duplicates).toBe(0);
    expect(w.outOfYear).toBe(0);
  });

  it('credit statements on the 4th (carried, repaid, purchases, other, debt, amount): transfers to the card repay it', () => {
    const st = creditStatements(data, TR_TODAY).slice(0, 4);
    expect(st.map((s) => [s.close, s.carried, s.repaid, s.purchases, s.other, s.debt, s.payAmount].map((v) => (typeof v === 'number' ? cents(v) : v))))
      .toEqual([
        ['2026-10-04', 0, 0, 0, 0, 0, 0],
        ['2026-11-04', 0, 0, -160, 55, -105, 105],
        ['2026-12-04', -105, 105, -65, 25, -40, 40],
        ['2027-01-04', -40, 40, -20, 0, -20, 20],
      ]);
    expect(nextCreditDebit(data, TR_TODAY)).toEqual({ date: '2027-01-10', amount: 20 });
  });

  it('the automatic card repayments: one a month on the debit day, «Списано» up to today, «Ожидается» after', () => {
    const rows = cardRepayments(data, TR_TODAY);
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 5).map((r) => [r.date, cents(r.amount), r.debited, r.card, r.from])).toEqual([
      ['2026-10-10', 0, true, TR.credit, TR.card],
      ['2026-11-10', 105, true, TR.credit, TR.card],
      ['2026-12-10', 40, true, TR.credit, TR.card],
      ['2027-01-10', 20, false, TR.credit, TR.card],
      ['2027-02-10', 0, false, TR.credit, TR.card],
    ]);
    expect(rows[11]?.date).toBe('2027-09-10');
  });

  it('«Месяц» November: income and expenses without transfers', () => {
    const s = monthSummary(data, '2026-11');
    expect([s.incomePlan, s.incomeFact, s.expensePlan, s.expenseFact, s.balanceFact]).toEqual([3010, 3015, 1020, 1065, 1950]);
    const sum = (k: 'plan' | 'fact') => s.byCategory.reduce((a, c) => a + c[k], 0);
    expect([sum('plan'), sum('fact')]).toEqual([1020, 1065]);
    expect(s.uncategorized).toEqual({ plan: 0, fact: 0 });
  });

  it('«Месяц» November: «Переводы в накопления» plan 150, fact 200; «Свободно после накоплений» 1840 / 1750', () => {
    const s = monthSummary(data, '2026-11');
    expect(s.toSavings).toEqual({ plan: 150, fact: 200 });
    expect(s.freeAfterSavings).toEqual({ plan: 1840, fact: 1750 });
  });

  it('«Месяц» October: «Переводы в накопления» plan 800, fact 900 — the fact takes the operation «Во вклад» too', () => {
    // plan: «В копилку» 500 (recurring) + «В копилку разово» 300 (planned); fact: those two done + «Во вклад» 100 (operation)
    expect(monthSummary(data, '2026-10').toSavings).toEqual({ plan: 800, fact: 900 });
  });

  it('«Месяц» November: «Погашение кредитки (10-го)» plan 105, fact 105 — in no sum', () => {
    expect(monthCardRepayment(data, '2026-11', TR_TODAY)).toEqual({ day: 10, plan: 105, fact: 105 });
    expect(monthCardRepayment(data, '2027-01', TR_TODAY)).toEqual({ day: 10, plan: 20, fact: 0 });
  });

  it('«Статистика» October / November / December: transfers are neither income nor expenses', () => {
    const y = yearStats(data);
    expect(y.months.slice(0, 3).map((m) => [m.incomePlan, m.incomeFact, m.expensePlan, m.expenseFact, m.balance])).toEqual([
      [3110, 3110, 1080, 1160, 1950],
      [3010, 3015, 1020, 1065, 1950],
      [3010, 3007, 1020, 1020, 1987],
    ]);
  });

  it('daily spending has no transfers', () => {
    const days = dailySpend(data, '2026-10');
    expect(days.reduce((a, v) => a + v, 0)).toBe(1160);
    expect(days[4]).toBe(0); // 05.10: «В копилку» is a transfer
  });

  it('«Прогноз»: start 2100; months income, recurring, one-off, expenses, free, transfers, end', () => {
    const f = forecast(data);
    expect(cashAtForecastStart(data)).toBe(2100);
    expect(f.start).toBe(2100);
    expect(f.months.map((m) => [m.income, m.recurring, m.oneOff, m.expenses, m.free, m.transfers, m.end].map(cents))).toEqual([
      [3000, 1020, 140, 1160, 1840, -900, 3040],
      [3015, 1020, 45, 1065, 1950, -50, 4940],
      [3000, 1020, 0, 1020, 1980, -500, 6420],
    ]);
  });

  it('«Прогноз» weeks: transfers 0, −800, 0, −100, 0, −400, 0, 350, 0, −500, 0, 0, 0; the last week ends at 6420', () => {
    const f = forecast(data);
    expect(f.weeks.map((w) => cents(w.transfers))).toEqual([0, -800, 0, -100, 0, -400, 0, 350, 0, -500, 0, 0, 0]);
    expect(cents(f.weeks[12]?.end ?? NaN)).toBe(6420);
  });

  it('«Прогноз» from November: the start takes October’s facts, transfers across the line included (3040)', () => {
    const d = fromNovember();
    const f = forecast(d);
    expect(cashAtForecastStart(d)).toBe(3040);
    expect([f.months[0]?.transfers, f.months[0]?.end]).toEqual([-50, 4940]);
  });
});

describe('transfers in the feed, «Сегодня» and the account movements', () => {
  it('a planned and a recurring transfer are in the month feed with «На счёт» and no category', () => {
    const data = transfersScenario();
    const items = monthItems(data, '2026-11');
    const j = items.find((i) => i.id === 'j-2');
    expect(j).toMatchObject({ source: 'journal', kind: 'transfer', account: TR.box, toAccount: TR.card, plan: 150, fact: 0, status: 'planned' });
    const r = items.find((i) => i.id === 'r-kopilka');
    expect(r).toMatchObject({ source: 'recurring', kind: 'transfer', account: TR.card, toAccount: TR.box, plan: 500, fact: 400 });
    expect(items.find((i) => i.id === 'j-7')?.check).toBe('noTarget');
    expect(items.find((i) => i.id === 'j-8')?.check).toBe('sameAccount');
    expect(items.find((i) => i.id === 'r-kuda')).toMatchObject({ kind: 'transfer', plan: 70, fact: 0, check: 'noTarget' });
    expect(items.find((i) => i.id === 'r-kuda')?.toAccount).toBeUndefined();
  });

  it('upcoming transfers can be marked done in one tap (and are never overdue)', () => {
    const data = transfersScenario();
    const items = upcoming(data, '2026-11-18');
    const j = items.find((i) => i.id === 'j-2');
    expect(j).toMatchObject({ source: 'journal', kind: 'transfer', amount: 150, overdue: false });
    const late = upcoming(data, '2026-11-25').find((i) => i.id === 'j-2');
    expect(late?.overdue).toBe(false);
    const paid = markPaid(data, { source: 'journal', id: 'j-2' });
    expect(row(paid.journal, 'j-2').status).toBe('paid');
    // done: 150 out of «Копилка» into «Карта»; the forecast no longer counts it as planned but as a fact
    expect(balances(paid, '2026-12-20').rows.find((r) => r.id === TR.card)?.now).toBe(6800);
  });

  it('the account movements show transfers in and out', () => {
    const data = transfersScenario();
    const moves = accountMovements(data, TR.box, '2026-10-01', '2026-10-31', TR_TODAY);
    expect(moves.map((m) => [m.date, m.source, m.what, m.amount])).toEqual([
      ['2026-10-05', 'recurring', 'В копилку', 500],
      ['2026-10-07', 'journal', 'В копилку разово', 300],
      ['2026-10-12', 'journal', 'Перевод с карты', 100],
      ['2026-10-25', 'recurring', 'Копилка → вклад', -50],
      ['2026-10-28', 'recurring', 'Проценты', 10],
    ]);
    expect(moves[moves.length - 1]?.running).toBe(1860);
  });
});

describe('transfers — edge rules', () => {
  const withRows = (patch: (d: Data) => void): Data => {
    const d = transfersScenario();
    patch(d);
    return d;
  };

  it('a transfer without «Со счёта» comes from the balance: into savings it is −1', () => {
    const d = withRows((x) => {
      x.journal = [{ id: 'j', date: '2026-10-07', kind: 'transfer', what: 't', plan: 10, toAccount: TR.box }];
    });
    expect(freeMoneyFactor(d, d.journal[0]!)).toBe(-1);
  });

  it('an empty «На счёт» (\'\') is the same as none', () => {
    const d = withRows((x) => {
      x.journal = [{ id: 'j', date: '2026-10-07', kind: 'transfer', what: 't', plan: 10, account: TR.card, toAccount: '' }];
    });
    expect(freeMoneyFactor(d, d.journal[0]!)).toBe(0);
    expect(rowCheck(d, d.journal[0]!)).toBe('noTarget');
  });

  it('an expense or an income is never a transfer for the free money', () => {
    const d = transfersScenario();
    expect(freeMoneyFactor(d, { kind: 'income', account: TR.box, toAccount: TR.card })).toBe(0);
    expect(freeMoneyFactor(d, { kind: 'expense', account: TR.card, toAccount: TR.box })).toBe(0);
  });

  it('a cancelled planned transfer plans nothing', () => {
    const d = withRows((x) => {
      row(x.journal, 'j-2').status = 'cancelled';
    });
    expect(monthSummary(d, '2026-11').toSavings).toEqual({ plan: 300, fact: 200 });
    expect(forecast(d).months[1]?.transfers).toBe(-200);
  });

  it('a planned transfer counts in its accounting month («Месяц учёта»), not in the month of its date', () => {
    const d = withRows((x) => {
      x.journal.push({ id: 'j-m', date: '2026-10-28', month: '2026-11', kind: 'transfer', what: 'В копилку с октябрьской', plan: 70, status: 'paid', account: TR.card, toAccount: TR.box });
    });
    expect(monthSummary(d, '2026-10').toSavings).toEqual({ plan: 800, fact: 900 });
    expect(monthSummary(d, '2026-11').toSavings).toEqual({ plan: 220, fact: 270 });
  });

  it('on the debit day itself the repayment is «Списано» (debited up to and including today)', () => {
    const d = transfersScenario();
    const nov = (today: string) => cardRepayments(d, today).find((r) => r.date === '2026-11-10');
    expect(nov('2026-11-09')).toMatchObject({ amount: 105, debited: false });
    expect(nov('2026-11-10')).toMatchObject({ amount: 105, debited: true });
    expect(monthCardRepayment(d, '2026-11', '2026-11-09')).toEqual({ day: 10, plan: 105, fact: 0 });
    expect(monthCardRepayment(d, '2026-11', '2026-11-10')).toEqual({ day: 10, plan: 105, fact: 105 });
  });

  it('no card or no auto-payment: no automatic repayment rows', () => {
    const off = withRows((x) => {
      x.credit.auto = false;
    });
    expect(cardRepayments(off, TR_TODAY)).toEqual([]);
    const none = withRows((x) => {
      x.accounts = x.accounts.filter((a) => a.type !== 'credit');
    });
    expect(cardRepayments(none, TR_TODAY)).toEqual([]);
    expect(monthCardRepayment(off, '2026-11', TR_TODAY)).toEqual({ day: 10, plan: 0, fact: 0 });
  });
});
