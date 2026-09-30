// Savings scenarios (spec 2026-10-01-savings-accounts). Every call returns a fresh copy, so tests may modify it freely.
// - savingsScenario: the one of the tracker's reviewer (excel-planners, savings accounts outside the balance) — the
//   same inputs as its fill.py, so the tracker built from them must show the numbers the engine computes. Forecast
//   from June 2026, accounting year from April 2026, balances on 15.04.2026, cushion 1500.
// - withBox: the engine scenario plus «Копилка», as the tracker's own test adds it (test_tracker.py, fill_savings).
import { SCHEMA_VERSION, emptyData } from '../../src/engine/model';
import type { Data, Operation } from '../../src/engine/model';
import { ACC, scenario } from './scenario';

export const SAV = {
  card: 'acc-karta', cash: 'acc-nal', credit: 'acc-kreditka', box: 'acc-kopilka', deposit: 'acc-vklad',
} as const;

/** Where the credit card is paid from: «Копилка» (savings, variant S of the reviewer) or «Карта» (variant D). */
export type PayFrom = 'box' | 'card';

const op = (
  id: string, date: string, kind: Operation['kind'], category: string | undefined, what: string, amount: number,
  account?: string, toAccount?: string,
): Operation => ({
  id, date, kind, what, amount,
  ...(category !== undefined ? { category } : {}),
  ...(account !== undefined ? { account } : {}),
  ...(toAccount !== undefined ? { toAccount } : {}),
});

export function savingsScenario(payFrom: PayFrom = 'box'): Data {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { accountingStart: '2026-04', forecastStart: '2026-06', cushion: 1500, balancesDate: '2026-04-15' },
    categories: emptyData('2026-04-15').categories, // the tracker's default categories
    accounts: [
      { id: SAV.card, name: 'Карта', type: 'debit', start: 1000 },
      { id: SAV.cash, name: 'Нал', type: 'cash', start: 200 },
      { id: SAV.credit, name: 'Кредитка', type: 'credit', start: 0 },
      { id: SAV.box, name: 'Копилка', type: 'savings', start: 5000 },
      { id: SAV.deposit, name: 'Вклад', type: 'savings', start: 3000 },
    ],
    credit: { auto: true, fromAccountId: SAV[payFrom], closeDay: 4, payDay: 10 },
    operations: [
      op('o-01', '2026-04-05', 'expense', 'Продукты', 'еда до', 50, SAV.card),
      op('o-02', '2026-04-10', 'transfer', undefined, 'в копилку до', 100, SAV.card, SAV.box),
      op('o-03', '2026-04-20', 'transfer', undefined, 'в копилку', 300, SAV.card, SAV.box),
      op('o-04', '2026-04-25', 'transfer', undefined, 'из копилки', 120, SAV.box, SAV.card),
      op('o-05', '2026-04-28', 'transfer', undefined, 'копилка-вклад', 500, SAV.box, SAV.deposit),
      op('o-06', '2026-05-02', 'transfer', undefined, 'снятие', 80, SAV.card, SAV.cash),
      op('o-07', '2026-05-05', 'expense', 'Продукты', 'еда с копилки', 60, SAV.box),
      op('o-08', '2026-05-06', 'income', 'Проценты и инвестиции', 'проценты', 15, SAV.deposit),
      op('o-09', '2026-05-07', 'expense', 'Кафе и доставка', 'кафе кредиткой', 40, SAV.credit),
      op('o-10', '2026-04-20', 'expense', 'Одежда и обувь', 'куртка', 70, SAV.credit),
      op('o-11', '2026-05-12', 'income', 'Зарплата', 'зп май', 2000, SAV.card),
      op('o-12', '2026-05-15', 'expense', 'Продукты', 'рынок', 90, SAV.cash),
      op('o-13', '2026-06-03', 'transfer', undefined, 'на вклад', 400, SAV.card, SAV.deposit),
      op('o-14', '2026-06-17', 'transfer', undefined, 'с вклада', 250, SAV.deposit, SAV.card),
      op('o-15', '2026-06-24', 'transfer', undefined, 'копилка-вклад 2', 100, SAV.box, SAV.deposit),
      op('o-16', '2026-07-01', 'transfer', undefined, 'снятие 2', 50, SAV.card, SAV.cash),
      op('o-17', '2026-07-08', 'expense', 'Развлечения', 'кино со вклада', 30, SAV.deposit),
      op('o-18', '2026-07-10', 'income', 'Прочие поступления', 'кэшбэк в копилку', 25, SAV.box),
      op('o-19', '2026-07-15', 'expense', 'Кафе и доставка', 'кафе кредиткой 2', 35, SAV.credit),
      op('o-20', '2026-07-20', 'income', 'Зарплата', 'зп июль', 2000, SAV.card),
      op('o-21', '2026-08-05', 'transfer', undefined, 'нал-копилка', 20, SAV.cash, SAV.box),
      op('o-22', '2026-08-12', 'transfer', undefined, 'копилка-кредитка', 10, SAV.box, SAV.credit),
      op('o-23', '2026-08-14', 'transfer', undefined, 'без на счёт', 5, SAV.card),
      op('o-24', '2026-08-18', 'transfer', undefined, 'без со счёта', 7, undefined, SAV.deposit),
    ],
    journal: [
      { id: 'j-1', date: '2026-04-10', kind: 'expense', category: 'Подарки', what: 'подарок', plan: 100, status: 'paid', account: SAV.card },
      { id: 'j-2', date: '2026-05-10', kind: 'expense', category: 'Техника', what: 'наушники', plan: 250, status: 'paid', account: SAV.box },
      { id: 'j-3', date: '2026-06-15', kind: 'expense', category: 'Образование', what: 'курс', plan: 180, status: 'planned', account: SAV.box },
      { id: 'j-4', date: '2026-06-20', kind: 'expense', category: 'Здоровье и аптека', what: 'врач', plan: 120, status: 'planned', account: SAV.card },
      { id: 'j-5', date: '2026-07-01', kind: 'income', category: 'Премия', what: 'премия на вклад', plan: 300, status: 'planned', account: SAV.deposit },
      { id: 'j-6', date: '2026-08-05', kind: 'expense', category: 'Дом и ремонт', what: 'ремонт', plan: 90, status: 'planned' },
      { id: 'j-7', date: '2026-06-10', kind: 'expense', category: 'Красота и уход', what: 'салон', plan: 60, status: 'planned', account: SAV.credit },
    ],
    recurring: [
      { id: 'r-1', what: 'Аренда', kind: 'expense', category: 'Жильё и коммуналка', day: 5, amount: 500, account: SAV.card, marks: { '2026-04': '✓', '2026-05': '✓', '2026-06': '✓' } },
      { id: 'r-2', what: 'Подписка сбер', kind: 'expense', category: 'Подписки и связь', day: 12, amount: 20, account: SAV.box, marks: { '2026-05': '✓' } },
      { id: 'r-3', what: 'Проценты вклад', kind: 'income', category: 'Проценты и инвестиции', day: 28, amount: 12, account: SAV.deposit, marks: { '2026-05': '✓' } },
      { id: 'r-4', what: 'Связь', kind: 'expense', category: 'Подписки и связь', day: 15, amount: 30, account: SAV.credit, marks: { '2026-05': '✓', '2026-06': '✓' } },
    ],
    purchases: [
      { id: 'p-1', what: 'Ноутбук', category: 'Техника', cost: 800, date: '2026-07-10', bought: false, account: SAV.box },
      { id: 'p-2', what: 'Велосипед', category: 'Развлечения', cost: 600, date: '2026-07-22', bought: false, account: SAV.card },
      { id: 'p-3', what: 'Кресло', category: 'Дом и ремонт', cost: 150, date: '2026-05-20', bought: true, price: 140, account: SAV.box },
      { id: 'p-4', what: 'Лампа', category: 'Дом и ремонт', cost: 50, date: '2026-04-10', bought: true, price: 50, account: SAV.card },
    ],
    debts: [],
  };
}

export const BOX = 'acc-kopilka';

/** The engine scenario plus the savings account «Копилка» (start 500) and its rows, as the tracker's test adds them. */
export function withBox(change?: (d: Data) => void): Data {
  const d = scenario();
  d.accounts.push({ id: BOX, name: 'Копилка', type: 'savings', start: 500 });
  d.operations.push(
    { id: 'o-v-kopilku', date: '2026-10-15', kind: 'transfer', what: 'В копилку', amount: 300, account: ACC.card, toAccount: BOX },
    { id: 'o-iz-kopilki', date: '2026-11-16', kind: 'transfer', what: 'Из копилки', amount: 50, account: BOX, toAccount: ACC.card },
    { id: 'o-rynok', date: '2026-10-17', kind: 'expense', category: 'Продукты', what: 'Рынок', amount: 40, account: BOX },
  );
  d.journal.push({ id: 'j-otpusk', date: '2026-11-12', kind: 'expense', category: 'Транспорт', what: 'Отпуск', plan: 200, account: BOX });
  d.recurring.push({
    id: 'r-procenty', what: 'Проценты', kind: 'income', category: 'Премия', day: 28, amount: 5, from: '2026-10-01', account: BOX,
    marks: { '2026-10': '✓' },
  });
  d.purchases.push({ id: 'p-velo', what: 'Велосипед', category: 'Техника', cost: 300, saved: 0, date: '2026-11-20', bought: false, account: BOX });
  d.credit.fromAccountId = BOX; // the credit card is paid from «Копилка»
  change?.(d);
  return d;
}
