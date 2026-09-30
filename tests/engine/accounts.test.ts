import { describe, expect, it } from 'vitest';
import {
  accountMovements,
  balances,
  cashAtForecastStart,
  creditCardId,
  creditStatements,
  dateInBalances,
  marksInBalances,
  monthInBalances,
  nextCreditDebit,
  payFromId,
} from '../../src/engine/accounts';
import type { Data } from '../../src/engine/model';
import { ACC, scenario, zpNovember, zpOctober } from './scenario';

const cents = (x: number) => Math.round(x * 100) / 100;

function nowByName(data: Data, today: string) {
  return Object.fromEntries(balances(data, today).rows.map((r) => [r.name, cents(r.now)]));
}

function withCreditStart(start: number): Data {
  const data = scenario();
  const card = data.accounts.find((a) => a.id === ACC.credit);
  if (!card) throw new Error('no credit card in scenario');
  card.start = start;
  return data;
}

const statementRow = (s: { carried: number; repaid: number; purchases: number; other: number; debt: number; payAmount: number }) =>
  [s.carried, s.repaid, s.purchases, s.other, s.debt, s.payAmount].map(cents);

describe('credit card settings', () => {
  it('uses the first credit account and the chosen pay-from account', () => {
    const data = scenario();
    expect(creditCardId(data)).toBe(ACC.credit);
    expect(payFromId(data)).toBe(ACC.card);
  });

  it('prefers explicit ids and falls back to the first non-credit account for paying', () => {
    const data = scenario();
    data.credit = { ...data.credit, accountId: ACC.cash, fromAccountId: undefined };
    expect(creditCardId(data)).toBe(ACC.cash);
    expect(payFromId(data)).toBe(ACC.card);
  });

  it('without a pay-from account takes auto-payments from the first account that is not a credit card', () => {
    const data = withCreditStart(-200);
    data.accounts = [...data.accounts.filter((a) => a.type === 'credit'), ...data.accounts.filter((a) => a.type !== 'credit')];
    data.credit = { ...data.credit, fromAccountId: undefined };
    expect(data.accounts.map((a) => a.name)).toEqual(['Кредитка', 'Карта', 'Наличные']);
    expect(payFromId(data)).toBe(ACC.card);
    const now = nowByName(data, '2026-12-31');
    expect([now['Карта'], now['Кредитка']]).toEqual([1200, 0]);
  });

  it('with only credit accounts nothing pays the card automatically', () => {
    const data = withCreditStart(-100);
    data.accounts = data.accounts.filter((a) => a.type === 'credit');
    data.credit = { ...data.credit, fromAccountId: undefined };
    data.journal = [];
    data.recurring = [];
    data.purchases = [];
    data.operations = [];
    expect(payFromId(data)).toBeUndefined();
    expect(creditStatements(data, '2026-12-31').every((r) => r.payAmount === 0 && r.counted === 0)).toBe(true);
    expect(nowByName(data, '2026-12-31')['Кредитка']).toBe(-100);
    expect(accountMovements(data, ACC.credit, '2026-10-01', '2026-12-31', '2026-12-31')).toEqual([]);
  });

  it('has no credit card without a credit account', () => {
    const data = scenario();
    data.accounts = data.accounts.filter((a) => a.type !== 'credit');
    expect(creditCardId(data)).toBeUndefined();
  });
});

describe('balances — scenario, today 2026-09-30', () => {
  const data = scenario();
  const b = balances(data, '2026-09-30');

  it('Карта 1410, Наличные 80, Кредитка −10 with debt −10', () => {
    expect(b.rows.map((r) => [r.name, cents(r.now), r.debt === undefined ? undefined : cents(r.debt)])).toEqual([
      ['Карта', 1410, undefined],
      ['Наличные', 80, undefined],
      ['Кредитка', -10, -10],
    ]);
  });

  it('totals: cards 1410, cash 80, credit debt −10, total 1480', () => {
    expect([b.cards, b.cash, b.creditDebt, b.total].map(cents)).toEqual([1410, 80, -10, 1480]);
  });

  it('splits Карта into income 3205, expense 2665, transfers −130', () => {
    const card = b.rows[0];
    expect(card && [card.id, card.type, card.start, cents(card.income), cents(card.expense), cents(card.transfers)])
      .toEqual([ACC.card, 'debit', 1000, 3205, 2665, -130]);
  });

  it('Кредитка: expense 40 (shop 30 + subscription 10), transfers +30', () => {
    const credit = b.rows[2];
    expect(credit && [cents(credit.income), cents(credit.expense), cents(credit.transfers)]).toEqual([0, 40, 30]);
  });
});

describe('balances — after the December auto-payment', () => {
  it('today 2026-12-31: Карта 1400, Кредитка 0', () => {
    const now = nowByName(scenario(), '2026-12-31');
    expect(now['Карта']).toBe(1400);
    expect(now['Кредитка']).toBe(0);
    const b = balances(scenario(), '2026-12-31');
    expect(b.rows[2]?.debt).toBeUndefined();
    expect(b.creditDebt).toBe(0);
  });

  it('counts the auto-payment only once its date has come', () => {
    expect(nowByName(scenario(), '2026-12-09')['Карта']).toBe(1410);
    expect(nowByName(scenario(), '2026-12-10')['Карта']).toBe(1400);
  });
});

describe('balances — accounting month of journal rows', () => {
  it('«ЗП ноябрь» paid 30.10 → Карта 1810', () => {
    const data = scenario();
    data.journal.push(zpNovember);
    expect(nowByName(data, '2026-09-30')['Карта']).toBe(1810);
  });

  it('«ЗП октябрь» paid 29.09 (before the balances date) still counts → Карта 1880', () => {
    const data = scenario();
    data.journal.push(zpNovember, zpOctober);
    expect(nowByName(data, '2026-09-30')['Карта']).toBe(1880);
  });

  it('ignores rows before the balances date, counts undated purchases', () => {
    const data = scenario();
    data.operations.push({ id: 'o-old', date: '2026-09-30', kind: 'expense', what: 'Старое', amount: 70, account: ACC.card });
    data.purchases.push({ id: 'p-old', what: 'Старая покупка', cost: 40, date: '2026-09-15', bought: true, account: ACC.card });
    data.purchases.push({ id: 'p-undated', what: 'Без даты', cost: 25, bought: true, account: ACC.card });
    expect(nowByName(data, '2026-09-30')['Карта']).toBe(1385);
  });
});

describe('what the balances count (dateInBalances, monthInBalances)', () => {
  const s = { ...scenario().settings, balancesDate: '2026-10-15' };

  it('an operation, a mark or a purchase by its date: from the balances date on', () => {
    expect(dateInBalances('2026-10-15', s)).toBe(true);
    expect(dateInBalances('2027-03-01', s)).toBe(true);
    expect(dateInBalances('2026-10-14', s)).toBe(false);
  });

  it('a journal row by its accounting month: from the month of the balances date on (the whole month)', () => {
    expect(monthInBalances('2026-10', s)).toBe(true);
    expect(monthInBalances('2026-11', s)).toBe(true);
    expect(monthInBalances('2026-09', s)).toBe(false);
  });

  it('agrees with balances()', () => {
    const d = scenario();
    d.settings = s;
    d.operations = [{ id: 'o-a', date: '2026-10-14', kind: 'expense', what: 'A', amount: 5, account: ACC.card }];
    d.journal = [{ id: 'j-a', date: '2026-10-02', kind: 'expense', what: 'B', plan: 7, status: 'paid', account: ACC.card }];
    d.recurring = [];
    d.purchases = [];
    const card = balances(d, '2026-12-31').rows.find((r) => r.id === ACC.card);
    expect(card?.expense).toBe(7); // the journal row (October) counts, the operation (before the 15th) does not
  });
});

describe('marksInBalances: the months whose marks change the balances', () => {
  it('accounting months with a day on or after the balances date and a fact other than 0', () => {
    const s = { ...scenario().settings, balancesDate: '2026-10-10' };
    const rec = {
      id: 'r', what: 'Свет', kind: 'expense' as const, day: 7, amount: 60,
      marks: { '2026-10': '✓' as const, '2026-11': '✓' as const, '2026-12': 0, '2027-01': 5, '2025-12': '✓' as const },
    };
    // October's 7th is before the balances date; December's mark is 0; December 2025 is outside the year
    expect(marksInBalances(rec, s)).toEqual(['2026-11', '2027-01']);
    expect(marksInBalances({ ...rec, day: undefined }, s)).toEqual([]); // no day, no date: no balance
  });

  it('agrees with balances()', () => {
    const d = scenario();
    d.recurring = [{ id: 'r', what: 'Свет', kind: 'expense', day: 7, amount: 60, account: ACC.cash, marks: { '2026-11': '✓', '2027-01': 5 } }];
    d.operations = [];
    d.journal = [];
    d.purchases = [];
    const cash = balances(d, '2027-12-31').rows.find((r) => r.id === ACC.cash);
    expect(cash?.expense).toBe(65);
    expect(marksInBalances(d.recurring[0]!, d.settings)).toEqual(['2026-11', '2027-01']);
  });
});

describe('creditStatements — scenario, today 2026-09-30', () => {
  const rows = creditStatements(scenario(), '2026-09-30');

  it('has 12 statements closing on the 4th of each accounting month', () => {
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 4).map((r) => [r.from, r.close])).toEqual([
      ['2026-10-01', '2026-10-04'],
      ['2026-10-05', '2026-11-04'],
      ['2026-11-05', '2026-12-04'],
      ['2026-12-05', '2027-01-04'],
    ]);
    expect(rows[11]?.close).toBe('2027-09-04');
  });

  it('04.10: nothing yet', () => {
    expect(rows[0] && statementRow(rows[0])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('04.11: shop −30 and a manual payment +30', () => {
    expect(rows[1] && statementRow(rows[1])).toEqual([0, 0, -30, 30, 0, 0]);
  });

  it('04.12: subscription −10, debited 10 on 10.12', () => {
    expect(rows[2] && statementRow(rows[2])).toEqual([0, 0, -10, 0, -10, 10]);
    expect(rows[2]?.payDate).toBe('2026-12-10');
  });

  it('04.01: carries −10, repaid +10', () => {
    expect(rows[3] && statementRow(rows[3])).toEqual([-10, 10, 0, 0, 0, 0]);
  });

  it('counts no payment before its date', () => {
    expect(rows.every((r) => r.counted === 0)).toBe(true);
    const later = creditStatements(scenario(), '2026-12-31');
    expect(later[2]?.counted).toBe(10);
  });

  it('pays nothing automatically when auto-payment is off', () => {
    const data = scenario();
    data.credit.auto = false;
    const manual = creditStatements(data, '2026-12-31');
    expect(manual[2]?.payAmount).toBe(0);
    expect(manual[3]?.carried).toBe(-10);
    expect(manual[3]?.debt).toBe(-10);
    expect(nowByName(data, '2026-12-31')['Кредитка']).toBe(-10);
  });

  it('clamps statement and payment days to 1..28', () => {
    const data = scenario();
    data.credit = { ...data.credit, closeDay: 31, payDay: 0 };
    const clamped = creditStatements(data, '2026-09-30');
    // Pay day 1 ≤ close day 28: the card is paid after the statement closes, in the next month.
    expect([clamped[0]?.close, clamped[0]?.payDate]).toEqual(['2026-10-28', '2026-11-01']);
  });
});

describe('credit card with a starting debt of −200, today 2026-12-31', () => {
  const data = withCreditStart(-200);

  it('first statement carries −200 and debits 200; the next is repaid', () => {
    const rows = creditStatements(data, '2026-12-31');
    expect(rows[0] && [rows[0].carried, rows[0].debt, rows[0].payAmount]).toEqual([-200, -200, 200]);
    expect(rows[1] && [rows[1].repaid, rows[1].debt]).toEqual([200, 0]);
  });

  it('Карта 1200, Кредитка 0', () => {
    const now = nowByName(data, '2026-12-31');
    expect([now['Карта'], now['Кредитка']]).toEqual([1200, 0]);
  });

  it('next debit is on 2027-01-10', () => {
    expect(nextCreditDebit(data, '2026-12-31')).toEqual({ date: '2027-01-10', amount: 0 });
  });

  it('money at forecast start is 800', () => {
    expect(cashAtForecastStart(data)).toBe(800);
  });
});

describe('nextCreditDebit', () => {
  it('is the first payment on or after today', () => {
    expect(nextCreditDebit(scenario(), '2026-09-30')).toEqual({ date: '2026-10-10', amount: 0 });
    expect(nextCreditDebit(scenario(), '2026-12-05')).toEqual({ date: '2026-12-10', amount: 10 });
    expect(nextCreditDebit(scenario(), '2026-12-10')).toEqual({ date: '2026-12-10', amount: 10 });
  });

  it('is null after the last statement of the year', () => {
    expect(nextCreditDebit(scenario(), '2027-09-11')).toBeNull();
  });
});

describe('cashAtForecastStart', () => {
  it('is the sum of account starts when the forecast starts on the balances date', () => {
    expect(cashAtForecastStart(scenario())).toBe(1000);
  });

  it('adds the October fact when the forecast starts in November: 2970', () => {
    const data = scenario();
    data.settings.forecastStart = '2026-11';
    expect(cents(cashAtForecastStart(data))).toBe(2970);
  });

  it('takes journal rows by accounting month: «ЗП октябрь» is not before an October start', () => {
    const data = scenario();
    data.journal.push(zpNovember, zpOctober);
    expect(cashAtForecastStart(data)).toBe(1000);
  });
});

// Compile-time check (npm run typecheck): whether an auto-payment has happened depends on `today`,
// so callers must pass it.
function movementsWithoutToday(data: Data) {
  // @ts-expect-error `today` is required
  return accountMovements(data, ACC.card, '2026-10-01', '2026-10-31');
}
void movementsWithoutToday;

describe('accountMovements', () => {
  it('Карта in October: every movement with a running balance from 1000', () => {
    const list = accountMovements(scenario(), ACC.card, '2026-10-01', '2026-10-31', '2026-10-31');
    expect(list.map((m) => [m.date, m.source, m.what, cents(m.amount), cents(m.running)])).toEqual([
      ['2026-10-01', 'journal', 'ЗП', 3000, 4000],
      ['2026-10-05', 'recurring', 'Аренда', -900, 3100],
      ['2026-10-06', 'operation', 'Кафе', -100, 3000],
      ['2026-10-06', 'journal', 'Кафе', -100, 2900],
      ['2026-10-07', 'journal', 'Такси', -90, 2810],
      ['2026-10-09', 'journal', 'Штраф', -15, 2795],
      ['2026-10-10', 'journal', 'Возврат', 20, 2815],
      ['2026-10-13', 'operation', 'Снятие', -100, 2715],
      ['2026-10-20', 'operation', 'Погашение', -30, 2685],
      ['2026-10-20', 'recurring', 'ЗП бонус', 200, 2885],
      ['2026-10-21', 'operation', 'Кэшбэк', 5, 2890],
    ]);
    expect(list[1]).toMatchObject({ id: 'r-arenda', ym: '2026-10' });
  });

  it('Карта in December: purchase and auto-payment, ending at the balance of 31.12', () => {
    const list = accountMovements(scenario(), ACC.card, '2026-12-01', '2026-12-31', '2026-12-31');
    expect(list.map((m) => [m.date, m.source, cents(m.amount), cents(m.running)])).toEqual([
      ['2026-12-10', 'purchase', -480, 1410],
      ['2026-12-10', 'repayment', -10, 1400],
    ]);
    expect(list[1]?.running).toBe(nowByName(scenario(), '2026-12-31')['Карта']);
  });

  it('Кредитка in December: opening −10, repaid on 10.12', () => {
    const list = accountMovements(scenario(), ACC.credit, '2026-12-01', '2026-12-31', '2026-12-31');
    expect(list.map((m) => [m.date, m.source, m.amount, m.running])).toEqual([['2026-12-10', 'repayment', 10, 0]]);
  });

  it('leaves out an auto-payment that has not happened by today', () => {
    expect(accountMovements(scenario(), ACC.credit, '2026-12-01', '2026-12-31', '2026-12-05')).toEqual([]);
  });

  it('Наличные: transfer in and a ticket', () => {
    const list = accountMovements(scenario(), ACC.cash, '2026-10-01', '2026-10-31', '2026-10-31');
    expect(list.map((m) => [m.date, m.amount, m.running])).toEqual([
      ['2026-10-13', 100, 100],
      ['2026-10-14', -20, 80],
    ]);
  });

  it('opens with rows counted in the balance but dated before `from`', () => {
    const data = scenario();
    data.journal.push(zpOctober); // 29.09, accounting month October
    const list = accountMovements(data, ACC.card, '2026-10-01', '2026-10-01', '2026-10-01');
    expect(list.map((m) => [m.what, m.running])).toEqual([['ЗП', 4070]]);
  });
});

// Balances start on 10.10, after the October statement closed on 04.10. A card purchase of 07.10
// is already inside the card's start (−100), so no statement may count it again.
describe('credit statements never reach back before the balances date', () => {
  function lateStart(): Data {
    const data = withCreditStart(-100);
    data.settings.balancesDate = '2026-10-10';
    data.journal = [];
    data.recurring = [];
    data.purchases = [];
    data.operations = [{ id: 'o-x', date: '2026-10-07', kind: 'expense', what: 'До баланса', amount: 100, account: ACC.credit }];
    return data;
  }

  it('October statement (closed 04.10) has an empty window, carries −100 and debits 100 on 10.10', () => {
    const rows = creditStatements(lateStart(), '2026-11-30');
    expect(rows[0] && [rows[0].from, rows[0].close, rows[0].payDate]).toEqual(['2026-10-10', '2026-10-04', '2026-10-10']);
    expect(rows[0] && statementRow(rows[0])).toEqual([-100, 0, 0, 0, -100, 100]);
    expect(rows[0]?.counted).toBe(100);
    expect(creditStatements(lateStart(), '2026-10-09')[0]?.counted).toBe(0);
  });

  it('no statement counts the purchase of 07.10; the statement of 04.11 starts on 10.10', () => {
    const rows = creditStatements(lateStart(), '2026-11-30');
    expect(rows.every((r) => r.purchases === 0 && r.other === 0)).toBe(true);
    expect(rows[1] && [rows[1].from, rows[1].close]).toEqual(['2026-10-10', '2026-11-04']);
    expect(rows[1] && statementRow(rows[1])).toEqual([-100, 100, 0, 0, 0, 0]);
  });

  it('today 2026-11-30: Кредитка 0, Карта reduced by exactly 100', () => {
    const now = nowByName(lateStart(), '2026-11-30');
    expect([now['Карта'], now['Кредитка']]).toEqual([900, 0]);
    const manual = lateStart();
    manual.credit.auto = false;
    expect(nowByName(manual, '2026-11-30')['Карта']).toBe(1000);
  });
});

// Card start −100 and no card activity: only the balances date moves.
function startOnly(balancesDate: string): Data {
  const data = withCreditStart(-100);
  data.settings.balancesDate = balancesDate;
  data.journal = [];
  data.recurring = [];
  data.purchases = [];
  data.operations = [];
  return data;
}

// The card's start belongs to the first statement paid on or after the balances date.
describe('the starting debt goes to the first statement paid on or after the balances date', () => {
  // Balances on 11.10: the October statement (closed 04.10, paid 10.10) is already inside the starts,
  // so the −100 is carried by the statement of 04.11 and debited on 10.11.
  it('balances date 2026-10-11: 04.10 is empty, 04.11 carries −100 and debits 100 on 10.11', () => {
    const rows = creditStatements(startOnly('2026-10-11'), '2026-11-30');
    expect(rows[0] && statementRow(rows[0])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(rows[0]?.counted).toBe(0);
    expect(rows[1] && [rows[1].close, rows[1].payDate]).toEqual(['2026-11-04', '2026-11-10']);
    expect(rows[1] && statementRow(rows[1])).toEqual([-100, 0, 0, 0, -100, 100]);
    expect(rows[1]?.counted).toBe(100);
    expect(rows[2] && statementRow(rows[2])).toEqual([-100, 100, 0, 0, 0, 0]);
  });

  it('balances date 2026-10-11, today 2026-11-30: Кредитка 0, Карта pays exactly 100', () => {
    const b = balances(startOnly('2026-10-11'), '2026-11-30');
    const byName = Object.fromEntries(b.rows.map((r) => [r.name, [cents(r.transfers), cents(r.now)]]));
    expect(byName['Кредитка']).toEqual([100, 0]);
    expect(byName['Карта']).toEqual([-100, 900]);
    expect(nowByName(startOnly('2026-10-11'), '2026-11-09')['Кредитка']).toBe(-100);
  });

  // Balances on the close day itself: 04.10 is paid on 10.10, after the balances date, so it is the start.
  it('balances date 2026-10-04: the statement of 04.10 is the start statement', () => {
    const data = startOnly('2026-10-04');
    data.operations = [{ id: 'o-x', date: '2026-10-04', kind: 'expense', what: 'В день выписки', amount: 50, account: ACC.credit }];
    const rows = creditStatements(data, '2026-10-31');
    expect(rows[0] && [rows[0].from, rows[0].close, rows[0].payDate]).toEqual(['2026-10-04', '2026-10-04', '2026-10-10']);
    expect(rows[0] && statementRow(rows[0])).toEqual([-100, 0, -50, 0, -150, 150]);
    expect(rows[0]?.counted).toBe(150);
    expect(rows[1] && statementRow(rows[1])).toEqual([-150, 150, 0, 0, 0, 0]);
    expect(nowByName(data, '2026-10-31')).toMatchObject({ Карта: 850, Кредитка: 0 });
  });
});

// Pay day 3 ≤ close day 25: every statement is paid on the 3rd of the NEXT month.
// Card start −100, purchases 20.10 (40) and 28.10 (60), balances date 01.10:
//   statement 25.10: window 01.10–25.10, purchase −40; carried −100 → debt −140, paid 140 on 03.11
//   statement 25.11: window 26.10–25.11, purchase −60; carried −140, repaid +140 → debt −60, paid 60 on 03.12
//   statement 25.12: carried −60, repaid +60 → debt 0
// Today 30.11: only 03.11 has come → Кредитка −100 −40 −60 +140 = −60, Карта 1000 − 140 = 860.
// Today 03.12: both payments → Кредитка 0, Карта 800.
describe('pay day on or before the close day: paid in the month after the statement closes', () => {
  function lateClose(): Data {
    const data = startOnly('2026-10-01');
    data.credit = { ...data.credit, closeDay: 25, payDay: 3 };
    data.operations = [
      { id: 'o-a', date: '2026-10-20', kind: 'expense', what: 'Покупка A', amount: 40, account: ACC.credit },
      { id: 'o-b', date: '2026-10-28', kind: 'expense', what: 'Покупка B', amount: 60, account: ACC.credit },
    ];
    return data;
  }

  it('statements close on the 25th and are paid on the 3rd of the next month', () => {
    const rows = creditStatements(lateClose(), '2026-11-30');
    expect(rows.slice(0, 3).map((r) => [r.from, r.close, r.payDate])).toEqual([
      ['2026-10-01', '2026-10-25', '2026-11-03'],
      ['2026-10-26', '2026-11-25', '2026-12-03'],
      ['2026-11-26', '2026-12-25', '2027-01-03'],
    ]);
    expect(rows[11] && [rows[11].close, rows[11].payDate]).toEqual(['2027-09-25', '2027-10-03']);
    expect(rows.slice(0, 3).map(statementRow)).toEqual([
      [-100, 0, -40, 0, -140, 140],
      [-140, 140, -60, 0, -60, 60],
      [-60, 60, 0, 0, 0, 0],
    ]);
    expect(rows.map((r) => r.counted).slice(0, 2)).toEqual([140, 0]);
  });

  it('balances and the Карта movements agree with the statements', () => {
    expect(nowByName(lateClose(), '2026-11-30')).toMatchObject({ Карта: 860, Кредитка: -60 });
    expect(nowByName(lateClose(), '2026-12-03')).toMatchObject({ Карта: 800, Кредитка: 0 });
    expect(nextCreditDebit(lateClose(), '2026-11-30')).toEqual({ date: '2026-12-03', amount: 60 });
    const list = accountMovements(lateClose(), ACC.card, '2026-11-01', '2026-11-30', '2026-11-30');
    expect(list.map((m) => [m.date, m.id, m.amount, m.running])).toEqual([['2026-11-03', 'credit-2026-10-25', -140, 860]]);
  });

  // Balances on 30.10, between the close (25.10) and the payment (03.11): the statement of 25.10 is
  // still paid after the balances date, so it carries the start; its window is empty.
  it('balances date between close and payment: the closed statement still carries the start', () => {
    const data = lateClose();
    data.settings.balancesDate = '2026-10-30';
    data.operations = [];
    const rows = creditStatements(data, '2026-11-30');
    expect(rows[0] && [rows[0].from, rows[0].close, rows[0].payDate]).toEqual(['2026-10-30', '2026-10-25', '2026-11-03']);
    expect(rows[0] && statementRow(rows[0])).toEqual([-100, 0, 0, 0, -100, 100]);
    expect(nowByName(data, '2026-11-30')).toMatchObject({ Карта: 900, Кредитка: 0 });
  });
});
