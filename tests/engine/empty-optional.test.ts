// An empty string in an optional id / date / month field means "not set", exactly like undefined:
// the backup restores an empty optional cell as a missing field, the UI may still produce ''.
// Whatever the engine computes must not change after such a round trip.
import { describe, expect, it } from 'vitest';
import {
  accountMovements,
  accountingMonths,
  addMonths,
  balances,
  cashAtForecastStart,
  creditCardId,
  creditStatements,
  dailySpend,
  forecast,
  monthItems,
  monthSummary,
  nextCreditDebit,
  opt,
  payFromId,
  purchasePlan,
  recurringDue,
  upcoming,
  warnings,
  yearStats,
} from '../../src/engine';
import type { Data, JournalRow, Operation, Purchase, Recurring } from '../../src/engine';
import { ACC, scenario, zpNovember, zpOctober } from './scenario';

// ── Every optional id / date / month field of the model (src/engine/model.ts) ──────────────
const OPTIONAL_FIELDS = {
  operations: ['account', 'toAccount', 'category'],
  journal: ['month', 'account', 'category'],
  recurring: ['from', 'to', 'account', 'category'],
  purchases: ['date', 'account', 'category'],
  debts: ['nextDate'],
} as const;
const OPTIONAL_CREDIT_FIELDS = ['accountId', 'fromAccountId'] as const;

/** A copy of the data where every in-scope optional field that is not set holds '' instead. */
function withEmptyOptionals(data: Data): { data: Data; replaced: number } {
  const copy = structuredClone(data);
  let replaced = 0;
  const fill = (row: object, fields: readonly string[]): void => {
    const r = row as Record<string, unknown>;
    for (const f of fields) {
      if (r[f] === undefined) {
        r[f] = '';
        replaced += 1;
      }
    }
  };
  for (const [key, fields] of Object.entries(OPTIONAL_FIELDS)) {
    for (const row of copy[key as keyof typeof OPTIONAL_FIELDS]) fill(row, fields);
  }
  fill(copy.credit, OPTIONAL_CREDIT_FIELDS);
  return { data: copy, replaced };
}

/** The tracker scenario plus rows that leave every optional field unset in as many ways as possible. */
function richScenario(): Data {
  const d = scenario();
  d.journal.push(
    zpNovember,
    zpOctober,
    { id: 'j-bez-scheta', date: '2026-10-16', kind: 'expense', what: 'Без счёта', plan: 40, status: 'paid' },
    { id: 'j-kredit', date: '2026-10-03', kind: 'expense', category: 'Продукты', what: 'Кредитка расход', fact: 60, status: 'paid', account: ACC.credit },
    { id: 'j-kredit-bez', date: '2026-10-02', kind: 'expense', what: 'Кредитка без категории', fact: 12, status: 'paid', account: ACC.credit },
    { id: 'j-mesyac', date: '2026-10-31', kind: 'expense', category: 'Продукты', what: 'Другой месяц', plan: 25, status: 'paid', account: ACC.card, month: '2026-11' },
  );
  d.operations.push(
    { id: 'o-bez-scheta', date: '2026-10-22', kind: 'expense', what: 'Без счёта', amount: 15 },
    { id: 'o-bez-celi', date: '2026-10-23', kind: 'transfer', what: 'Перевод без цели', amount: 10, account: ACC.card },
    { id: 'o-kredit-dohod', date: '2026-10-03', kind: 'income', what: 'Возврат на кредитку', amount: 8, account: ACC.credit },
    { id: 'o-perevod-na-kartu', date: '2026-10-24', kind: 'transfer', what: 'Перевод на карту', amount: 12, toAccount: ACC.card },
  );
  d.recurring.push(
    { id: 'r-bez-scheta', what: 'Без счёта', kind: 'expense', day: 12, amount: 20, marks: { '2026-10': '✓' } },
    { id: 'r-do', what: 'До марта', kind: 'expense', day: 8, amount: 15, every: 2, to: '2027-03-31', account: ACC.cash, marks: {} },
    // every 3 months and no from: the rhythm is anchored at the accounting start (October, January, April, July)
    { id: 'r-kvartal', what: 'Раз в квартал', kind: 'expense', category: 'Подписки', day: 7, amount: 45, every: 3, account: ACC.cash, marks: {} },
    { id: 'r-bez-dnya', what: 'Без дня', kind: 'income', amount: 50, marks: { '2026-11': '✓' } },
    { id: 'r-kredit', what: 'Кредитка', kind: 'expense', day: 3, amount: 9, account: ACC.credit, marks: { '2026-10': '✓', '2026-11': 12 } },
  );
  d.purchases.push(
    { id: 'p-bez-daty', what: 'Куплено без даты', bought: true, cost: 60, price: 55, account: ACC.card },
    { id: 'p-plan', what: 'План', cost: 200, date: '2026-11-20', bought: false },
    { id: 'p-mechta', what: 'Мечта', cost: 999, bought: false },
    { id: 'p-bez-scheta', what: 'Куплено без счёта', cost: 40, date: '2026-10-25', bought: true },
    { id: 'p-kredit', what: 'На кредитку', cost: 70, date: '2026-10-02', bought: true, account: ACC.credit },
  );
  d.debts.push({ id: 'd-1', name: 'Долг', total: 1000, paid: 100, rate: 5, payment: 50 });
  return d;
}

const TODAYS = ['2026-10-15', '2026-12-01'] as const;
const CREDIT_VARIANTS: [string, (d: Data) => void][] = [
  ['pay-from account chosen', () => {}],
  ['pay-from account not chosen', (d) => { delete d.credit.fromAccountId; }],
];

function months(d: Data): string[] {
  const m = accountingMonths(d.settings);
  return [addMonths(d.settings.accountingStart, -1), ...m, addMonths(d.settings.accountingStart, 12)];
}

type Part = (d: Data) => unknown;
const PARTS: [string, Part][] = [
  ['balances', (d) => TODAYS.map((t) => balances(d, t))],
  ['creditStatements', (d) => TODAYS.map((t) => creditStatements(d, t))],
  ['nextCreditDebit', (d) => TODAYS.map((t) => nextCreditDebit(d, t))],
  ['creditCardId and payFromId', (d) => [creditCardId(d), payFromId(d)]],
  ['cashAtForecastStart', cashAtForecastStart],
  ['forecast', forecast],
  ['monthSummary of every accounting month', (d) => accountingMonths(d.settings).map((m) => monthSummary(d, m))],
  ['yearStats', yearStats],
  ['dailySpend of every accounting month', (d) => accountingMonths(d.settings).map((m) => dailySpend(d, m))],
  ['monthItems of every month around the year', (d) => months(d).map((m) => monthItems(d, m))],
  ['upcoming', (d) => TODAYS.map((t) => upcoming(d, t, 30))],
  ['warnings', warnings],
  [
    'accountMovements of every account',
    (d) => TODAYS.flatMap((t) => d.accounts.map((a) => accountMovements(d, a.id, '2026-09-01', '2027-12-31', t))),
  ],
];

describe('opt', () => {
  it("turns '' into undefined and leaves everything else as it is", () => {
    expect(opt('')).toBeUndefined();
    expect(opt(undefined)).toBeUndefined();
    expect(opt('2026-10-05')).toBe('2026-10-05');
    expect(opt('acc-card')).toBe('acc-card');
  });
});

describe.each(CREDIT_VARIANTS)("'' in optional fields equals not set (%s)", (_name, tweak) => {
  const base = richScenario();
  tweak(base);
  const { data: empty, replaced } = withEmptyOptionals(base);

  it("the scenario really holds '' where the base has nothing", () => {
    expect(replaced).toBeGreaterThan(30);
    expect(empty.credit.accountId).toBe('');
    expect(empty.recurring.find((r) => r.id === 'r-bez-scheta')).toMatchObject({ from: '', to: '', account: '', category: '' });
    expect(empty.purchases.find((p) => p.id === 'p-mechta')).toMatchObject({ date: '', account: '', category: '' });
    expect(empty.journal.find((r) => r.id === 'j-bez-scheta')).toMatchObject({ month: '', account: '', category: '' });
    expect(empty.operations.find((o) => o.id === 'o-bez-celi')).toMatchObject({ toAccount: '', category: '' });
    expect(empty.debts[0]).toMatchObject({ nextDate: '' });
  });

  it('the scenario exercises what the comparison is about', () => {
    const kvartal = base.recurring.find((r) => r.id === 'r-kvartal');
    expect(kvartal).toMatchObject({ every: 3 });
    expect(kvartal).not.toHaveProperty('from');
    expect(empty.recurring.find((r) => r.id === 'r-kvartal')).toMatchObject({ from: '', to: '' });
    expect(accountingMonths(base.settings).filter((ym) => recurringDue(kvartal as Recurring, ym, base.settings)))
      .toEqual(['2026-10', '2027-01', '2027-04', '2027-07']);
    const w = warnings(base);
    expect(w.unassigned.count).toBeGreaterThanOrEqual(4);
    expect(w.transfersWithoutTarget).toBeGreaterThanOrEqual(1);
    expect(w.boughtWithoutDate).toBe(1);
    expect(w.unknownAccounts).toBe(0);
    expect(creditStatements(base, TODAYS[0]).some((r) => r.purchases < 0)).toBe(true);
    expect(monthSummary(base, '2026-10').uncategorized.fact).not.toBe(0);
  });

  it.each(PARTS)('%s is identical', (_part, compute) => {
    expect(compute(empty)).toStrictEqual(compute(base));
  });
});

describe("credit settings with ''", () => {
  it("accountId '' uses the first credit account", () => {
    const d = scenario();
    d.credit.accountId = '';
    expect(creditCardId(d)).toBe(ACC.credit);
    // statements really see the card's purchases, as when accountId is not set
    const st = creditStatements(d, '2026-10-15');
    expect(st.some((r) => r.purchases < 0)).toBe(true);
    expect(st).toStrictEqual(creditStatements(scenario(), '2026-10-15'));
    expect(warnings(d).unknownAccounts).toBe(0);
  });

  it("fromAccountId '' uses the first account that is not a credit card", () => {
    const d = richScenario();
    d.accounts = [
      { id: ACC.credit, name: 'Кредитка', type: 'credit', start: -50 },
      { id: ACC.cash, name: 'Наличные', type: 'cash', start: 0 },
      { id: ACC.card, name: 'Карта', type: 'debit', start: 1000 },
    ];
    const unset = structuredClone(d);
    delete unset.credit.fromAccountId;
    d.credit.fromAccountId = '';
    expect(payFromId(unset)).toBe(ACC.cash);
    expect(payFromId(d)).toBe(ACC.cash);
    expect(nextCreditDebit(d, '2026-10-15')).toStrictEqual(nextCreditDebit(unset, '2026-10-15'));
    expect(balances(d, '2026-12-01')).toStrictEqual(balances(unset, '2026-12-01'));
    // the auto-payments really leave the cash account
    expect(balances(d, '2026-12-01').rows.find((r) => r.id === ACC.cash)?.transfers).toBeLessThan(0);
  });

  it("neither '' setting is reported as an unknown account", () => {
    const d = scenario();
    d.credit.accountId = '';
    d.credit.fromAccountId = '';
    expect(warnings(d).unknownAccounts).toBe(0);
  });

  it('a chosen account that does not exist is still reported', () => {
    const d = scenario();
    d.credit.accountId = 'acc-gone';
    expect(warnings(d).unknownAccounts).toBe(1);
  });
});

describe("recurring from / to with ''", () => {
  const settings = scenario().settings; // accountingStart 2026-10
  const rec = (over: Partial<Recurring>): Recurring => ({
    id: 'r', what: 'Страховка', kind: 'expense', amount: 30, every: 3, marks: {}, ...over,
  });

  it("from '' anchors the rhythm at the accounting start, like an unset from", () => {
    const unset = rec({});
    const empty = rec({ from: '' });
    const due = (r: Recurring) => accountingMonths(settings).filter((ym) => recurringDue(r, ym, settings));
    expect(due(unset)).toEqual(['2026-10', '2027-01', '2027-04', '2027-07']);
    expect(due(empty)).toEqual(due(unset));
  });

  it("to '' does not end the payment", () => {
    expect(recurringDue(rec({ to: '' }), '2027-07', settings)).toBe(true);
    expect(recurringDue(rec({ from: '', to: '' }), '2026-10', settings)).toBe(true);
  });

  it('a real from and to still limit the payment', () => {
    expect(recurringDue(rec({ from: '2026-11-15' }), '2026-10', settings)).toBe(false);
    expect(recurringDue(rec({ from: '2026-11-15' }), '2027-02', settings)).toBe(true);
    expect(recurringDue(rec({ to: '2026-11-30' }), '2026-12', settings)).toBe(false);
  });
});

describe("purchase date '' is no date", () => {
  const purchase = (over: Partial<Purchase>): Purchase => ({ id: 'p', what: 'Мечта', cost: 300, bought: false, ...over });

  it('has no plan', () => {
    expect(purchasePlan(purchase({ date: '' }))).toBe(0);
    expect(purchasePlan(purchase({ date: '' }))).toBe(purchasePlan(purchase({})));
    expect(purchasePlan(purchase({ date: '2026-11-01' }))).toBe(300);
  });

  it('is not in the month feed, the month totals or the upcoming list', () => {
    const d = scenario();
    d.purchases.push(purchase({ id: 'p-empty', date: '' }));
    for (const ym of months(d)) {
      expect(monthItems(d, ym).some((i) => i.id === 'p-empty')).toBe(false);
    }
    expect(upcoming(d, '2026-10-15', 400).some((i) => i.id === 'p-empty')).toBe(false);
    expect(yearStats(d)).toStrictEqual(yearStats(scenario()));
  });

  it('a bought one still counts in the balance of its account, like one without a date', () => {
    const noDate = scenario();
    noDate.purchases.push(purchase({ id: 'p-bought', bought: true, price: 250, account: ACC.cash }));
    const empty = structuredClone(noDate);
    (empty.purchases.find((p) => p.id === 'p-bought') as Purchase).date = '';
    const cash = (d: Data) => balances(d, '2026-10-15').rows.find((r) => r.id === ACC.cash)?.now;
    expect(cash(noDate)).toBe(-250 - 20 + 100);
    expect(cash(empty)).toBe(cash(noDate));
    expect(warnings(empty).boughtWithoutDate).toBe(1);
  });
});

describe("'' account is no account", () => {
  it('is unassigned, never an unknown account', () => {
    const d = scenario();
    (d.journal.find((r) => r.id === 'j-kafe') as JournalRow).account = ''; // paid: fact 100
    (d.operations.find((o) => o.id === 'o-magazin') as Operation).account = ''; // fact 30
    const unset = scenario();
    delete (unset.journal.find((r) => r.id === 'j-kafe') as JournalRow).account;
    delete (unset.operations.find((o) => o.id === 'o-magazin') as Operation).account;
    expect(warnings(d)).toStrictEqual(warnings(unset));
    expect(warnings(d).unknownAccounts).toBe(0);
    expect(warnings(d).unassigned).toStrictEqual({ count: 2, sum: 130 });
  });

  it("transfer with toAccount '' is a transfer without a target", () => {
    const d = scenario();
    (d.operations.find((o) => o.id === 'o-snyatie') as Operation).toAccount = '';
    expect(warnings(d).transfersWithoutTarget).toBe(1);
    expect(warnings(d).unknownAccounts).toBe(0);
  });
});

describe("'' category groups with «Без категории»", () => {
  it('lands in uncategorized, exactly like an unset category', () => {
    const d = scenario();
    d.journal.push({ id: 'j-x', date: '2026-10-11', kind: 'expense', what: 'Без категории', plan: 33, fact: 33, status: 'paid', category: '', account: ACC.card });
    const unset = scenario();
    unset.journal.push({ id: 'j-x', date: '2026-10-11', kind: 'expense', what: 'Без категории', plan: 33, fact: 33, status: 'paid', account: ACC.card });
    expect(monthSummary(d, '2026-10').uncategorized).toStrictEqual(monthSummary(unset, '2026-10').uncategorized);
    expect(monthSummary(d, '2026-10').uncategorized.fact).toBe(monthSummary(scenario(), '2026-10').uncategorized.fact + 33);
    expect(monthSummary(d, '2026-10').byCategory).toStrictEqual(monthSummary(unset, '2026-10').byCategory);
  });

  it("feed items with '' category / account carry no such fields", () => {
    const d = scenario();
    const op = d.operations.find((o) => o.id === 'o-bilet') as Operation;
    op.category = '';
    op.account = '';
    const item = monthItems(d, '2026-10').find((i) => i.id === 'o-bilet');
    expect(item).toBeDefined();
    expect('category' in (item ?? {})).toBe(false);
    expect('account' in (item ?? {})).toBe(false);
  });
});
