// The parity scenario of the tracker's transfers (excel-planners feature/transfers, src/test_transfers.py: ACCS, REC,
// JR, OPS, fill(); report transfers-tracker-report.md «Сценарий паритета»): planned and recurring transfers into and
// out of savings, inside one group, to the credit card and without «На счёт»; «Доход» on a savings account; three
// months of credit statements. Accounting and forecast from October 2026, balances on 01.10.2026, cushion 0,
// «сегодня» 20.12.2026. Every call returns a fresh copy, so tests may modify it freely.
import { SCHEMA_VERSION } from '../../src/engine/model';
import type { Data, JournalRow, Operation, Recurring } from '../../src/engine/model';

export const TR = {
  card: 'acc-karta', cash: 'acc-nal', credit: 'acc-kreditka', box: 'acc-kopilka', deposit: 'acc-vklad',
} as const;

/** «Сегодня» of the tracker's scenario (Счета!Y4). */
export const TR_TODAY = '2026-12-20';

/** Marks of the accounting months by their index (0 = October 2026), as REC writes them. */
const marks = (byIndex: Record<number, '✓' | number>): Recurring['marks'] =>
  Object.fromEntries(Object.entries(byIndex).map(([k, v]) => [`2026-${String(10 + Number(k)).padStart(2, '0')}`, v]));

const rec = (r: Omit<Recurring, 'marks'> & { m: Record<number, '✓' | number> }): Recurring => {
  const { m, ...rest } = r;
  return { ...rest, marks: marks(m) };
};

const recurring: Recurring[] = [
  rec({ id: 'r-zp', what: 'Зарплата', kind: 'income', category: 'Зарплата', day: 1, amount: 3000, account: TR.card, m: { 0: '✓', 1: '✓', 2: '✓' } }),
  rec({ id: 'r-arenda', what: 'Аренда', kind: 'expense', category: 'Жильё', day: 3, amount: 1000, account: TR.card, m: { 0: '✓', 1: '✓', 2: '✓' } }),
  // −1: into savings
  rec({ id: 'r-kopilka', what: 'В копилку', kind: 'transfer', day: 5, amount: 500, account: TR.card, toAccount: TR.box, m: { 0: '✓', 1: 400 } }),
  // +1: out of savings; every 2 months from 01.11.2026 (November, January, …)
  rec({ id: 'r-vklad', what: 'Из вклада', kind: 'transfer', day: 20, amount: 200, every: 2, from: '2026-11-01', account: TR.deposit, toAccount: TR.card, m: { 1: '✓' } }),
  // 0: inside the savings group
  rec({ id: 'r-vnutri', what: 'Копилка → вклад', kind: 'transfer', day: 25, amount: 50, account: TR.box, toAccount: TR.deposit, m: { 0: '✓' } }),
  // 0: inside the balance; a repayment in the card's statement
  rec({ id: 'r-kredit', what: 'На кредитку', kind: 'transfer', day: 15, amount: 30, account: TR.card, toAccount: TR.credit, m: { 0: '✓', 1: '✓' } }),
  rec({ id: 'r-podpiska', what: 'Подписка', kind: 'expense', category: 'Подписки', day: 8, amount: 20, account: TR.credit, m: { 0: '✓', 1: '✓', 2: '✓' } }),
  // income on a savings account
  rec({ id: 'r-procenty', what: 'Проценты', kind: 'income', category: 'Проценты', day: 28, amount: 10, account: TR.box, m: { 0: '✓' } }),
  // without «На счёт»
  rec({ id: 'r-kuda', what: 'Перевод куда-то', kind: 'transfer', day: 12, amount: 70, account: TR.card, m: { 0: '✓' } }),
];

const journal: JournalRow[] = [
  { id: 'j-1', date: '2026-10-07', kind: 'transfer', what: 'В копилку разово', plan: 300, status: 'paid', account: TR.card, toAccount: TR.box },
  { id: 'j-2', date: '2026-11-18', kind: 'transfer', what: 'Из копилки на отпуск', plan: 150, status: 'planned', account: TR.box, toAccount: TR.card },
  { id: 'j-3', date: '2026-12-09', kind: 'transfer', what: 'Наличные на карту', plan: 40, fact: 40, account: TR.cash, toAccount: TR.card },
  { id: 'j-4', date: '2026-10-22', kind: 'transfer', what: 'Погашение кредитки вручную', plan: 25, status: 'paid', account: TR.card, toAccount: TR.credit },
  { id: 'j-5', date: '2026-10-12', kind: 'income', category: 'Проценты', what: 'Перевод с карты', plan: 100, status: 'paid', account: TR.box },
  { id: 'j-6', date: '2026-10-14', kind: 'expense', category: 'Продукты', what: 'Ужин', plan: 60, status: 'paid', account: TR.credit },
  { id: 'j-7', date: '2026-11-03', kind: 'transfer', what: 'Перевод без счёта', plan: 10, status: 'paid', account: TR.card },
  { id: 'j-8', date: '2026-11-16', kind: 'transfer', what: 'Сам себе', plan: 5, status: 'paid', account: TR.card, toAccount: TR.card },
];

const op = (id: string, date: string, kind: Operation['kind'], category: string | undefined, what: string, amount: number, account: string, toAccount?: string): Operation => ({
  id, date, kind, what, amount, account,
  ...(category !== undefined ? { category } : {}),
  ...(toAccount !== undefined ? { toAccount } : {}),
});

const operations: Operation[] = [
  op('o-1', '2026-10-06', 'expense', 'Продукты', 'Магазин', 80, TR.credit),
  op('o-2', '2026-11-11', 'expense', 'Продукты', 'Рынок', 45, TR.credit),
  op('o-3', '2026-11-05', 'income', 'Проценты', 'Возврат', 15, TR.credit),
  op('o-4', '2026-10-20', 'transfer', undefined, 'Во вклад', 100, TR.card, TR.deposit),
  op('o-5', '2026-12-02', 'income', 'Проценты', 'Кэшбэк на копилку', 7, TR.box),
  op('o-6', '2026-11-21', 'transfer', undefined, 'С кредитки на карту', 20, TR.credit, TR.card),
];

const base: Data = {
  schemaVersion: SCHEMA_VERSION,
  settings: { accountingStart: '2026-10', forecastStart: '2026-10', cushion: 0, balancesDate: '2026-10-01' },
  categories: {
    expense: [{ name: 'Продукты' }, { name: 'Жильё' }, { name: 'Подписки' }],
    income: [{ name: 'Зарплата' }, { name: 'Проценты' }],
  },
  accounts: [
    { id: TR.card, name: 'Карта', type: 'debit', start: 2000 },
    { id: TR.cash, name: 'Наличные', type: 'cash', start: 100 },
    { id: TR.credit, name: 'Кредитка', type: 'credit', start: 0 },
    { id: TR.box, name: 'Копилка', type: 'savings', start: 1000 },
    { id: TR.deposit, name: 'Вклад', type: 'savings', start: 500 },
  ],
  // the tracker's defaults: the first credit account, paid automatically from the first account (C34), on 4 / 10
  credit: { auto: true, closeDay: 4, payDay: 10 },
  operations,
  journal,
  recurring,
  purchases: [],
  debts: [],
};

export function transfersScenario(): Data {
  return structuredClone(base);
}

/** The same scenario with the forecast from November 2026 (from_november of the tracker's test). */
export function fromNovember(): Data {
  const d = transfersScenario();
  d.settings.forecastStart = '2026-11';
  return d;
}
