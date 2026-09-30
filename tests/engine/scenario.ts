// The synthetic scenario from the Excel tracker tests (plan, section «Сценарий»).
// Every call returns a fresh deep copy, so tests may modify it freely.
import { SCHEMA_VERSION } from '../../src/engine/model';
import type { Data, JournalRow } from '../../src/engine/model';

export const ACC = { card: 'acc-card', cash: 'acc-cash', credit: 'acc-credit' } as const;

const base: Data = {
  schemaVersion: SCHEMA_VERSION,
  settings: { accountingStart: '2026-10', forecastStart: '2026-10', cushion: 100, balancesDate: '2026-10-01' },
  categories: {
    expense: [{ name: 'Жильё' }, { name: 'Продукты' }, { name: 'Транспорт' }, { name: 'Подписки' }, { name: 'Техника' }],
    income: [{ name: 'Зарплата' }, { name: 'Премия' }],
  },
  accounts: [
    { id: ACC.card, name: 'Карта', type: 'debit', start: 1000 },
    { id: ACC.cash, name: 'Наличные', type: 'cash', start: 0 },
    { id: ACC.credit, name: 'Кредитка', type: 'credit', start: 0 },
  ],
  // accountId is left out on purpose: the card is the first account of type 'credit'
  credit: { auto: true, fromAccountId: ACC.card, closeDay: 4, payDay: 10 },
  journal: [
    { id: 'j-eda', date: '2026-10-05', kind: 'expense', category: 'Продукты', what: 'Еда', plan: 100, account: ACC.card },
    { id: 'j-kafe', date: '2026-10-06', kind: 'expense', category: 'Продукты', what: 'Кафе', plan: 100, status: 'paid', account: ACC.card },
    { id: 'j-taxi', date: '2026-10-07', kind: 'expense', category: 'Транспорт', what: 'Такси', plan: 100, fact: 90, status: 'paid', account: ACC.card },
    { id: 'j-otmena', date: '2026-10-08', kind: 'expense', category: 'Транспорт', what: 'Отмена', plan: 100, status: 'cancelled', account: ACC.card },
    { id: 'j-shtraf', date: '2026-10-09', kind: 'expense', category: 'Транспорт', what: 'Штраф', plan: 100, fact: 15, status: 'cancelled', account: ACC.card },
    { id: 'j-vozvrat', date: '2026-10-10', kind: 'expense', category: 'Продукты', what: 'Возврат', fact: -20, status: 'paid', account: ACC.card },
    { id: 'j-zp', date: '2026-10-01', kind: 'income', category: 'Зарплата', what: 'ЗП', plan: 3000, status: 'paid', account: ACC.card },
    { id: 'j-noyabr', date: '2026-11-15', kind: 'expense', category: 'Продукты', what: 'Ноябрь', plan: 50, fact: 50, status: 'paid', account: ACC.card },
    { id: 'j-arenda', date: '2026-10-20', kind: 'expense', category: 'Жильё', what: 'Аренда', account: ACC.card },
    { id: 'j-sentyabr', date: '2026-09-05', kind: 'expense', category: 'Продукты', what: 'Сентябрь', plan: 10, account: ACC.card },
  ],
  recurring: [
    { id: 'r-arenda', what: 'Аренда', kind: 'expense', category: 'Жильё', day: 5, amount: 900, from: '2026-10-01', account: ACC.card, marks: { '2026-10': '✓', '2026-11': 950 } },
    { id: 'r-podpiska', what: 'Подписка', kind: 'expense', category: 'Подписки', day: 10, amount: 10, from: '2026-11-01', account: ACC.credit, marks: { '2026-11': '✓' } },
    { id: 'r-bonus', what: 'ЗП бонус', kind: 'income', category: 'Премия', day: 20, amount: 200, account: ACC.card, marks: { '2026-10': '✓' } },
    { id: 'r-strahovka', what: 'Страховка', kind: 'expense', category: 'Подписки', day: 15, amount: 30, every: 3, from: '2026-11-01', account: ACC.card, marks: {} },
  ],
  purchases: [
    { id: 'p-noutbuk', what: 'Ноутбук', category: 'Техника', cost: 500, saved: 0, date: '2026-12-10', bought: true, price: 480, account: ACC.card },
  ],
  operations: [
    { id: 'o-magazin', date: '2026-10-12', kind: 'expense', category: 'Продукты', what: 'Магазин', amount: -30, account: ACC.credit }, // sign does not matter
    { id: 'o-snyatie', date: '2026-10-13', kind: 'transfer', what: 'Снятие', amount: 100, account: ACC.card, toAccount: ACC.cash },
    { id: 'o-bilet', date: '2026-10-14', kind: 'expense', category: 'Транспорт', what: 'Билет', amount: 20, account: ACC.cash },
    { id: 'o-pogashenie', date: '2026-10-20', kind: 'transfer', what: 'Погашение', amount: 30, account: ACC.card, toAccount: ACC.credit },
    { id: 'o-keshbek', date: '2026-10-21', kind: 'income', category: 'Премия', what: 'Кэшбэк', amount: 5, account: ACC.card },
    { id: 'o-kafe', date: '2026-10-06', kind: 'expense', category: 'Продукты', what: 'Кафе', amount: 100, account: ACC.card }, // duplicate of the journal row
  ],
  debts: [],
};

export function scenario(): Data {
  return structuredClone(base);
}

/** Salary paid on 30.10 but counted in November (accounting month). */
export const zpNovember: JournalRow = {
  id: 'j-zp-nov', date: '2026-10-30', kind: 'income', category: 'Зарплата', what: 'ЗП ноябрь',
  plan: 400, status: 'paid', account: ACC.card, month: '2026-11',
};

/** Salary paid on 29.09 (before the balances date) but counted in October. */
export const zpOctober: JournalRow = {
  id: 'j-zp-oct', date: '2026-09-29', kind: 'income', category: 'Зарплата', what: 'ЗП октябрь',
  plan: 70, status: 'paid', account: ACC.card, month: '2026-10',
};

export function row<T extends { id: string }>(rows: T[], id: string): T {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`scenario has no row ${id}`);
  return found;
}
