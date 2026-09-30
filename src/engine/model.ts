// Data model of the app (schemaVersion 1). Dates are 'YYYY-MM-DD' strings, months 'YYYY-MM',
// amounts are numbers in euro. Accounts are referenced by id everywhere.
import { monthStart, ymOf } from './dates';

export const SCHEMA_VERSION = 1;

export type YM = string; // 'YYYY-MM'
export type ISODate = string; // 'YYYY-MM-DD'

export type AccountType = 'debit' | 'cash' | 'credit' | 'savings';

export interface Settings {
  accountingStart: YM; // first of the 12 accounting months
  forecastStart: YM; // first of the 3 forecast months
  cushion: number;
  balancesDate: ISODate; // account starts are balances on this date
}

export interface ExpenseCategory {
  name: string;
  limit?: number;
}

export interface Categories {
  expense: ExpenseCategory[];
  income: { name: string }[];
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  start: number; // balance on settings.balancesDate (credit card: negative)
}

export interface CreditSettings {
  accountId?: string; // default: first account of type 'credit'
  auto: boolean;
  fromAccountId?: string; // default: first account that is not a credit card
  closeDay: number;
  payDay: number;
}

export type OpKind = 'expense' | 'income' | 'transfer';

export interface Operation {
  id: string;
  date: ISODate;
  kind: OpKind;
  category?: string;
  what: string;
  amount: number; // sign does not matter
  account?: string;
  toAccount?: string; // transfers only
}

export type JournalStatus = 'planned' | 'paid' | 'postponed' | 'cancelled';

export interface JournalRow {
  id: string;
  date: ISODate;
  kind: 'expense' | 'income';
  category?: string;
  what: string;
  plan?: number;
  fact?: number;
  status?: JournalStatus;
  account?: string;
  priority?: string;
  month?: YM; // accounting month when it differs from the month of the date
}

export type Mark = '✓' | number;

export interface Recurring {
  id: string;
  what: string;
  kind: 'expense' | 'income';
  category?: string;
  day?: number;
  amount: number;
  every?: number; // every N months (1..12)
  from?: ISODate;
  to?: ISODate;
  account?: string;
  marks: Record<YM, Mark>;
}

export interface Purchase {
  id: string;
  what: string;
  category?: string;
  cost?: number;
  saved?: number;
  date?: ISODate;
  priority?: string;
  bought: boolean;
  price?: number;
  account?: string;
}

export interface Debt {
  id: string;
  name: string;
  whom?: string;
  total?: number;
  paid?: number;
  rate?: number;
  payment?: number;
  nextDate?: ISODate;
}

export interface Data {
  schemaVersion: number;
  settings: Settings;
  categories: Categories;
  accounts: Account[];
  credit: CreditSettings;
  operations: Operation[];
  journal: JournalRow[];
  recurring: Recurring[];
  purchases: Purchase[];
  debts: Debt[];
}

const DEFAULT_EXPENSES = [
  'Жильё и коммуналка', 'Продукты', 'Кафе и доставка', 'Транспорт', 'Здоровье и аптека',
  'Красота и уход', 'Одежда и обувь', 'Дом и ремонт', 'Техника', 'Подписки и связь',
  'Образование', 'Развлечения', 'Подарки', 'Путешествия', 'Кредиты и долги', 'Прочее',
];

const DEFAULT_INCOMES = [
  'Зарплата', 'Аванс', 'Премия', 'Фриланс', 'Подработка', 'Проценты и инвестиции', 'Прочие поступления',
];

export function newId(): string {
  return crypto.randomUUID();
}

/** Fresh data set with the tracker defaults; accounting and forecast start in the month of `today`. */
export function emptyData(today: ISODate): Data {
  const ym = ymOf(today);
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { accountingStart: ym, forecastStart: ym, cushion: 0, balancesDate: monthStart(ym) },
    categories: {
      expense: DEFAULT_EXPENSES.map((name) => ({ name })),
      income: DEFAULT_INCOMES.map((name) => ({ name })),
    },
    accounts: [
      { id: newId(), name: 'Основная карта', type: 'debit', start: 0 },
      { id: newId(), name: 'Наличные', type: 'cash', start: 0 },
      { id: newId(), name: 'Кредитная карта', type: 'credit', start: 0 },
    ],
    credit: { auto: true, closeDay: 4, payDay: 10 },
    operations: [],
    journal: [],
    recurring: [],
    purchases: [],
    debts: [],
  };
}
