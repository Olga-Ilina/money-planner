// Full backup of the app data as an .xlsx workbook, and restoring from it.
//
// One sheet per table of the model with Russian headers in row 1, real date cells and money
// formats, so the copy reads well in Excel; a hidden «_schema» sheet carries the format version.
// Columns are found by their headers on import; the account name columns are for reading only.
// exportBackup reads its own copy back before handing it out, so a copy that would not restore to
// the same data is never given to the user.
import type { Workbook, Worksheet } from 'exceljs';
import { SCHEMA_VERSION } from '../engine/model';
import type {
  Account, AccountType, Categories, CreditSettings, Data, Debt, ExpenseCategory, ISODate, JournalRow, JournalStatus, Mark,
  OpKind, Operation, Purchase, Recurring, Settings, YM,
} from '../engine/model';
import { DATE_FORMAT, MONEY_FORMAT, cellDate, cellNumber, cellText, escapeText, isoToExcelDate, unwrap } from './excel';
import { ACCOUNT_TYPE_LABEL, CHECK, JOURNAL_STATUS_LABEL, KIND_LABEL, parseAccountType, parseKind, parseStatus } from './labels';

/** A copy that cannot be made or restored; the message is for the user. */
export class BackupError extends Error {
  override name = 'BackupError';
}

const APP = 'money-planner';
const NOT_A_BACKUP = 'Это не резервная копия приложения «Трекер расходов».';
const NEWER_VERSION = 'Копия сделана более новой версией приложения. Обновите приложение.';
const unreadable = (where: string): string =>
  `Не удалось сделать копию: данные не читаются обратно (${where}). Сообщите разработчику.`;

const YES = 'Да';
const NO = 'Нет';

const SHEET = {
  settings: 'Настройки', categories: 'Категории', accounts: 'Счета', operations: 'Операции', journal: 'Запланированные',
  recurring: 'Постоянные', marks: 'Отметки', purchases: 'Покупки', debts: 'Долги', schema: '_schema',
} as const;

/** The journal sheet of a copy made before the tracker sheet «Журнал» was renamed «Запланированные» (format version 1 both). */
const OLD_JOURNAL_SHEET = 'Журнал';

/** «Настройки» has two columns; each row is a parameter, named here by the model field it holds. */
const SETTINGS_COLUMNS = { name: 'Параметр', value: 'Значение' } as const;
const PARAM = {
  settings: { accountingStart: 'Учёт с', forecastStart: 'Прогноз с', cushion: 'Подушка', balancesDate: 'Дата остатков' },
  credit: {
    accountId: 'Кредитка: счёт', auto: 'Кредитка: гасится автоматически', fromAccountId: 'Кредитка: со счёта',
    closeDay: 'Кредитка: выписка', payDay: 'Кредитка: списание',
  },
} as const satisfies { settings: Record<keyof Settings, string>; credit: Record<keyof CreditSettings, string> };

/** Column headers of each sheet by the model field the column holds, in sheet order. */
const COLUMN = {
  categories: { kind: 'Тип', name: 'Название', limit: 'Лимит' },
  accounts: { id: 'id', name: 'Название', type: 'Тип', start: 'На начало' },
  operations: {
    id: 'id', date: 'Дата', kind: 'Тип', category: 'Категория', what: 'Что', amount: 'Сумма', account: 'Счёт (id)',
    toAccount: 'На счёт (id)',
  },
  journal: {
    id: 'id', date: 'Дата', kind: 'Тип', category: 'Категория', what: 'Что', plan: 'План', fact: 'Факт', status: 'Статус',
    account: 'Счёт (id)', priority: 'Приоритет', month: 'Месяц учёта',
  },
  recurring: {
    id: 'id', what: 'Что', kind: 'Тип', category: 'Категория', day: 'День', amount: 'Сумма', every: 'Раз в N мес.',
    from: 'Действует с', to: 'по', account: 'Счёт (id)',
  },
  marks: { id: 'id постоянного', month: 'Месяц', mark: 'Отметка' },
  purchases: {
    id: 'id', what: 'Что', category: 'Категория', cost: 'Стоимость', saved: 'Отложено', date: 'Дата', priority: 'Приоритет',
    bought: 'Куплено', price: 'Цена факт', account: 'Счёт (id)',
  },
  debts: {
    id: 'id', name: 'Название', whom: 'Кому', total: 'Сумма', paid: 'Выплачено', rate: 'Ставка', payment: 'Платёж',
    nextDate: 'След. платёж',
  },
} as const satisfies {
  categories: Record<'kind' | keyof ExpenseCategory, string>;
  accounts: Record<keyof Account, string>;
  operations: Record<keyof Operation, string>;
  journal: Record<keyof JournalRow, string>;
  recurring: Record<Exclude<keyof Recurring, 'marks'>, string>;
  purchases: Record<keyof Purchase, string>;
  debts: Record<keyof Debt, string>;
  marks: Record<'id' | 'month' | 'mark', string>;
};
const ACCOUNT_NAME = 'Счёт (название)';
const TO_ACCOUNT_NAME = 'На счёт (название)';

export function backupFilename(today: ISODate): string {
  return `Трекер расходов — копия ${today}.xlsx`;
}

// ---------- what the file gives back ----------
//
// Some values cannot be stored in an .xlsx as they are. Before writing, the data is changed into what
// the file will give back, so that a restored copy equals what was written:
//  - in every text, '\r\n' and '\r' become '\n' (XML reads every line break as '\n');
//  - control characters other than '\n' and '\t' are removed (XML cannot hold them; ExcelJS drops them);
//  - a lone half of a surrogate pair, U+FFFE and U+FFFF become U+FFFD (UTF-8 cannot encode the first,
//    and the other two make the whole file unreadable);
//  - −0 becomes 0, and fields set to undefined are left out;
//  - an optional text field (category, priority, whom, an account id, an optional date or month) that
//    is '' is left out: it is written as an empty cell, and an empty cell means «not set».
// Excel reads '_xHHHH_' in a text as the character with the hex code HHHH, and so does ExcelJS. So when a
// text is written, each '_' that starts such a sequence is written as '_x005F_' (the code of '_' itself),
// and Excel and ExcelJS read the text back unchanged (escapeText in excel.ts, shared with the reports).

const LINE_BREAKS = /\r\n?/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SURROGATE_PAIRS_OR_UNSTORABLE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF\uFFFE\uFFFF]/g;

/** The text as a cell of the file gives it back. */
function cleanText(text: string): string {
  return text
    .replace(LINE_BREAKS, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(SURROGATE_PAIRS_OR_UNSTORABLE, (c) => (c.length === 2 ? c : '\uFFFD'));
}

/** A deep copy with every text cleaned, −0 as 0 and the properties set to undefined left out. */
function sanitise<T>(value: T): T {
  if (typeof value === 'string') return cleanText(value) as T;
  if (Object.is(value, -0)) return 0 as T;
  if (Array.isArray(value)) return value.map(sanitise) as T;
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, sanitise(v)])) as T;
  }
  return value;
}

/** The optional text fields of each list, where '' means the same as not set. */
const OPTIONAL_TEXT = {
  credit: ['accountId', 'fromAccountId'],
  operations: ['category', 'account', 'toAccount'],
  journal: ['category', 'account', 'priority', 'month'],
  recurring: ['category', 'from', 'to', 'account'],
  purchases: ['category', 'date', 'priority', 'account'],
  debts: ['whom', 'nextDate'],
} as const satisfies {
  credit: readonly (keyof CreditSettings)[];
  operations: readonly (keyof Operation)[];
  journal: readonly (keyof JournalRow)[];
  recurring: readonly (keyof Recurring)[];
  purchases: readonly (keyof Purchase)[];
  debts: readonly (keyof Debt)[];
};

function withoutEmpty<T extends object>(row: T, fields: readonly string[]): T {
  return Object.fromEntries(Object.entries(row).filter(([k, v]) => !(v === '' && fields.includes(k)))) as T;
}

/** The data as its copy restores it; this is what gets written. */
function restorable(input: Data): Data {
  const d = sanitise(input);
  return {
    ...d,
    credit: withoutEmpty(d.credit, OPTIONAL_TEXT.credit),
    operations: d.operations.map((r) => withoutEmpty(r, OPTIONAL_TEXT.operations)),
    journal: d.journal.map((r) => withoutEmpty(r, OPTIONAL_TEXT.journal)),
    recurring: d.recurring.map((r) => withoutEmpty(r, OPTIONAL_TEXT.recurring)),
    purchases: d.purchases.map((r) => withoutEmpty(r, OPTIONAL_TEXT.purchases)),
    debts: d.debts.map((r) => withoutEmpty(r, OPTIONAL_TEXT.debts)),
  };
}

// ---------- writing ----------

type CellValue = string | number | Date | undefined;

interface Column<T> {
  header: string;
  width: number;
  format?: string;
  value: (row: T) => CellValue;
}

const date = (iso: ISODate | undefined): Date | undefined => (iso === undefined ? undefined : isoToExcelDate(iso));

function addSheet<T>(wb: Workbook, name: string, columns: Column<T>[], rows: T[]): Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width, style: c.format ? { numFmt: c.format } : {} }));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(columns.map((c) => {
      const value = c.value(row);
      return typeof value === 'string' ? escapeText(value) : value;
    }));
  }
  return ws;
}

/** A column `width` characters wide; `format` is the number format of its cells. */
function col<T>(header: string, width: number, value: (row: T) => CellValue, format?: string): Column<T> {
  return format === undefined ? { header, width, value } : { header, width, value, format };
}

async function writeBackup(data: Data, exportedAt: string, opts: ExportOptions): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  // the sync stamp (src/io/sync.ts) goes into docProps/core.xml <dc:description>; nothing reads it as data
  if (opts.stamp !== undefined) wb.description = opts.stamp;
  const names = new Map(data.accounts.map((a) => [a.id, a.name]));
  const accountName = (id: string | undefined): string | undefined => (id === undefined ? undefined : names.get(id));
  const money = <T>(header: string, value: (row: T) => number | undefined): Column<T> => col(header, 13, value, MONEY_FORMAT);
  const day = <T>(header: string, value: (row: T) => ISODate | undefined): Column<T> =>
    col(header, 12, (row) => date(value(row)), DATE_FORMAT);

  const { settings, credit } = data;
  const S = PARAM.settings;
  const C = PARAM.credit;
  type SettingRow = [name: string, value: CellValue, format?: string];
  const settingRows: SettingRow[] = [
    [S.accountingStart, settings.accountingStart],
    [S.forecastStart, settings.forecastStart],
    [S.cushion, settings.cushion, MONEY_FORMAT],
    [S.balancesDate, date(settings.balancesDate), DATE_FORMAT],
    [C.accountId, credit.accountId],
    [C.auto, credit.auto ? YES : NO],
    [C.fromAccountId, credit.fromAccountId],
    [C.closeDay, credit.closeDay],
    [C.payDay, credit.payDay],
  ];
  const settingsSheet = addSheet(wb, SHEET.settings, [
    col<SettingRow>(SETTINGS_COLUMNS.name, 34, (r) => r[0]),
    col<SettingRow>(SETTINGS_COLUMNS.value, 40, (r) => r[1]),
  ], settingRows);
  settingRows.forEach(([, , format], i) => {
    if (format) settingsSheet.getCell(i + 2, 2).numFmt = format;
  });

  type CategoryRow = { kind: 'expense' | 'income'; name: string; limit?: number };
  const K = COLUMN.categories;
  addSheet<CategoryRow>(wb, SHEET.categories, [
    col(K.kind, 10, (r) => KIND_LABEL[r.kind]),
    col(K.name, 28, (r) => r.name),
    money(K.limit, (r) => r.limit),
  ], [
    ...data.categories.expense.map((c): CategoryRow => ({ kind: 'expense', ...c })),
    ...data.categories.income.map((c): CategoryRow => ({ kind: 'income', ...c })),
  ]);

  const A = COLUMN.accounts;
  addSheet<Account>(wb, SHEET.accounts, [
    col(A.id, 38, (r) => r.id),
    col(A.name, 24, (r) => r.name),
    col(A.type, 16, (r) => ACCOUNT_TYPE_LABEL[r.type]),
    money(A.start, (r) => r.start),
  ], data.accounts);

  const O = COLUMN.operations;
  addSheet<Operation>(wb, SHEET.operations, [
    col(O.id, 38, (r) => r.id),
    day(O.date, (r) => r.date),
    col(O.kind, 10, (r) => KIND_LABEL[r.kind]),
    col(O.category, 22, (r) => r.category),
    col(O.what, 28, (r) => r.what),
    money(O.amount, (r) => r.amount),
    col(O.account, 38, (r) => r.account),
    col(O.toAccount, 38, (r) => r.toAccount),
    col(ACCOUNT_NAME, 20, (r) => accountName(r.account)),
    col(TO_ACCOUNT_NAME, 20, (r) => accountName(r.toAccount)),
  ], data.operations);

  const J = COLUMN.journal;
  addSheet<JournalRow>(wb, SHEET.journal, [
    col(J.id, 38, (r) => r.id),
    day(J.date, (r) => r.date),
    col(J.kind, 10, (r) => KIND_LABEL[r.kind]),
    col(J.category, 22, (r) => r.category),
    col(J.what, 28, (r) => r.what),
    money(J.plan, (r) => r.plan),
    money(J.fact, (r) => r.fact),
    col(J.status, 15, (r) => (r.status === undefined ? undefined : JOURNAL_STATUS_LABEL[r.status])),
    col(J.account, 38, (r) => r.account),
    col(J.priority, 16, (r) => r.priority),
    col(J.month, 12, (r) => r.month),
    col(ACCOUNT_NAME, 20, (r) => accountName(r.account)),
  ], data.journal);

  const R = COLUMN.recurring;
  addSheet<Recurring>(wb, SHEET.recurring, [
    col(R.id, 38, (r) => r.id),
    col(R.what, 28, (r) => r.what),
    col(R.kind, 10, (r) => KIND_LABEL[r.kind]),
    col(R.category, 22, (r) => r.category),
    col(R.day, 7, (r) => r.day),
    money(R.amount, (r) => r.amount),
    col(R.every, 12, (r) => r.every),
    day(R.from, (r) => r.from),
    day(R.to, (r) => r.to),
    col(R.account, 38, (r) => r.account),
    col(ACCOUNT_NAME, 20, (r) => accountName(r.account)),
  ], data.recurring);

  type MarkRow = { id: string; month: YM; mark: Mark };
  const M = COLUMN.marks;
  addSheet<MarkRow>(wb, SHEET.marks, [
    col(M.id, 38, (r) => r.id),
    col(M.month, 10, (r) => r.month),
    col(M.mark, 10, (r) => r.mark, MONEY_FORMAT),
  ], data.recurring.flatMap((r) =>
    Object.entries(r.marks).map(([month, mark]): MarkRow => ({ id: r.id, month, mark }))));

  const P = COLUMN.purchases;
  addSheet<Purchase>(wb, SHEET.purchases, [
    col(P.id, 38, (r) => r.id),
    col(P.what, 28, (r) => r.what),
    col(P.category, 22, (r) => r.category),
    money(P.cost, (r) => r.cost),
    money(P.saved, (r) => r.saved),
    day(P.date, (r) => r.date),
    col(P.priority, 16, (r) => r.priority),
    col(P.bought, 9, (r) => (r.bought ? CHECK : undefined)),
    money(P.price, (r) => r.price),
    col(P.account, 38, (r) => r.account),
    col(ACCOUNT_NAME, 20, (r) => accountName(r.account)),
  ], data.purchases);

  const D = COLUMN.debts;
  addSheet<Debt>(wb, SHEET.debts, [
    col(D.id, 38, (r) => r.id),
    col(D.name, 24, (r) => r.name),
    col(D.whom, 20, (r) => r.whom),
    money(D.total, (r) => r.total),
    money(D.paid, (r) => r.paid),
    col(D.rate, 9, (r) => r.rate),
    money(D.payment, (r) => r.payment),
    day(D.nextDate, (r) => r.nextDate),
  ], data.debts);

  const schema = wb.addWorksheet(SHEET.schema, { state: 'hidden' });
  schema.addRows([['schemaVersion', SCHEMA_VERSION], ['exportedAt', exportedAt], ['app', APP]]);

  return new Uint8Array(await wb.xlsx.writeBuffer()).buffer;
}

export interface ExportOptions {
  /** The sync stamp (formatStamp, src/io/sync.ts), written as the document's description («Отправить на Mac»). */
  stamp?: string;
}

export async function exportBackup(data: Data, exportedAt: string, opts: ExportOptions = {}): Promise<ArrayBuffer> {
  const clean = restorable(data);
  const buf = await writeBackup(clean, exportedAt, opts);
  await checkReadsBack(buf, clean);
  return buf;
}

// ---------- checking the copy ----------

type Path = (string | number)[];

/**
 * The path to the first value that differs between `a` and `b` (numbers compared with Object.is);
 * undefined when equal. A key that only one of them has is a difference, whichever side has it.
 * @internal exported for tests
 */
export function difference(a: unknown, b: unknown, path: Path = []): Path | undefined {
  if (Object.is(a, b)) return undefined;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return path;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return path;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) return [...path, i];
      const d = difference(a[i], b[i], [...path, i]);
      if (d) return d;
    }
    return undefined;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const d = difference(x[key], y[key], [...path, key]);
    if (d) return d;
  }
  return undefined;
}

/** The row of «Отметки» that holds the mark `month` of recurring payment number `i`, if the data has that mark. */
function markRow(data: Data, i: number, month: string | number | undefined): number | undefined {
  const marks = data.recurring[i]?.marks;
  const index = marks && typeof month === 'string' ? Object.keys(marks).indexOf(month) : -1;
  if (index < 0) return undefined;
  return 2 + data.recurring.slice(0, i).reduce((n, r) => n + Object.keys(r.marks).length, 0) + index;
}

/** Where the value at `path` of the data is in the copy: sheet, row and column. */
function locate(data: Data, path: Path): string {
  const [list, i, field, key] = path;
  const place = (sheet: string, row: number | undefined, header?: string): string =>
    [`лист «${sheet}»`, row === undefined ? '' : `строка ${row}`, header === undefined ? '' : `поле «${header}»`]
      .filter(Boolean).join(', ');
  const header = (columns: Record<string, string>, name: string | number | undefined): string | undefined =>
    name === undefined ? undefined : columns[name] ?? String(name);
  const row = (index: string | number | undefined, first = 0): number | undefined =>
    typeof index === 'number' ? first + index + 2 : undefined;

  if (list === 'settings' || list === 'credit') {
    const params: Record<string, string> = PARAM[list];
    return i === undefined ? place(SHEET.settings, undefined) : `лист «${SHEET.settings}», параметр «${params[i] ?? i}»`;
  }
  if (list === 'categories') {
    const first = i === 'income' ? data.categories.expense.length : 0;
    return place(SHEET.categories, row(field, first), header(COLUMN.categories, key));
  }
  if (list === 'recurring' && field === 'marks' && typeof i === 'number') {
    return place(SHEET.marks, markRow(data, i, key));
  }
  if (list === 'accounts' || list === 'operations' || list === 'journal' || list === 'recurring' || list === 'purchases' || list === 'debts') {
    return place(SHEET[list], row(i), header(COLUMN[list], field));
  }
  return `лист «${SHEET.schema}», ${path.join('.')}`;
}

/**
 * Throws when the copy does not restore to exactly `data`, so that such a copy is never handed out.
 * `read` restores the copy; it is a parameter so that the tests can make it return what a broken
 * reader would.
 * @internal exported for tests
 */
export async function checkReadsBack(buf: ArrayBuffer, data: Data, read: (buf: ArrayBuffer) => Promise<Data> = importBackup): Promise<void> {
  let back: Data;
  try {
    back = await read(buf);
  } catch (e) {
    const problem = e instanceof Error ? e.message : String(e);
    throw new BackupError(unreadable(problem.replace(/\.$/, '').replace(/^Лист /, 'лист ')));
  }
  const path = difference(data, back);
  if (path) throw new BackupError(unreadable(locate(data, path)));
}

// ---------- reading ----------

type XlsxInput = Parameters<Workbook['xlsx']['load']>[0];

const isBlank = (v: unknown): boolean => {
  const u = unwrap(v);
  return u === null || u === undefined || (typeof u === 'string' && u.trim() === '');
};

const isMonth = (text: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(text);

/** Drops the properties whose value is undefined, so optional fields are left out rather than set. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/** One row of a sheet: its values by column header, and readers that report the sheet and row on bad values. */
class Row {
  constructor(private readonly sheet: string, readonly n: number, private readonly cells: Map<string, unknown>) {}

  fail(problem: string): never {
    throw new BackupError(`Лист «${this.sheet}», строка ${this.n}: ${problem}.`);
  }

  /** The cell value as ExcelJS gives it. */
  value(header: string): unknown {
    return this.cells.get(header);
  }

  private required<T>(header: string, value: T | undefined): T {
    if (value === undefined) this.fail(`не заполнено «${header}»`);
    return value;
  }

  /**
   * Text exactly as written (spaces kept); numbers and rich text as their text. An empty cell gives
   * undefined; a date, boolean or error cell is an error rather than a silently lost value.
   */
  text(header: string): string | undefined {
    const u = unwrap(this.value(header));
    if (u === null || u === undefined || u === '') return undefined;
    if (typeof u === 'string') return u;
    if (typeof u === 'number' && Number.isFinite(u)) return String(u);
    return this.fail(`«${header}» — не текст`);
  }

  /** Text without the spaces around it (ids, labels, parameter names); blank gives undefined. */
  trimmed(header: string): string | undefined {
    return this.text(header)?.trim() || undefined;
  }

  reqTrimmed(header: string): string {
    return this.required(header, this.trimmed(header));
  }

  /** A check box column: «✓» or an empty cell. */
  checkmark(header: string): boolean {
    const v = this.value(header);
    if (isBlank(v)) return false;
    if (cellText(v) !== CHECK) this.fail(`«${header}» — ожидается «${CHECK}» или пустая ячейка`);
    return true;
  }

  /** A finite number (number cell or numeric text). */
  num(header: string): number | undefined {
    const v = this.value(header);
    if (isBlank(v)) return undefined;
    const n = cellNumber(v);
    if (n === undefined) this.fail(`«${header}» — не число`);
    return n;
  }

  reqNum(header: string): number {
    return this.required(header, this.num(header));
  }

  /** A whole number from `min` to `max`. */
  int(header: string, min: number, max: number): number | undefined {
    const n = this.num(header);
    if (n !== undefined && !(Number.isInteger(n) && n >= min && n <= max)) {
      this.fail(`«${header}» — ожидается целое число от ${min} до ${max}`);
    }
    return n;
  }

  reqInt(header: string, min: number, max: number): number {
    return this.required(header, this.int(header, min, max));
  }

  date(header: string): ISODate | undefined {
    const v = this.value(header);
    if (isBlank(v)) return undefined;
    const d = cellDate(v);
    if (d === undefined) this.fail(`«${header}» — не дата`);
    return d;
  }

  reqDate(header: string): ISODate {
    return this.required(header, this.date(header));
  }

  /** 'YYYY-MM' text, or a date cell (Excel turns a typed '2027-01' into 1 January 2027) as the month of its UTC day. */
  month(header: string): YM | undefined {
    const v = unwrap(this.value(header));
    if (isBlank(v)) return undefined;
    const text = v instanceof Date ? cellDate(v)?.slice(0, 7) : cellText(v);
    if (text === undefined || !isMonth(text)) this.fail(`«${header}» — не месяц в виде ГГГГ-ММ`);
    return text;
  }

  reqMonth(header: string): YM {
    return this.required(header, this.month(header));
  }

  /** A label turned into its key by `parse`; only the `allowed` keys are accepted. */
  label<K extends string>(header: string, parse: (text: string | undefined) => K | undefined, allowed: readonly K[]): K | undefined {
    const text = this.trimmed(header);
    if (text === undefined) return undefined;
    const key = parse(text);
    if (key === undefined || !allowed.includes(key)) this.fail(`«${header}»: неизвестное значение «${text}»`);
    return key;
  }

  reqLabel<K extends string>(header: string, parse: (text: string | undefined) => K | undefined, allowed: readonly K[]): K {
    return this.required(header, this.label(header, parse, allowed));
  }
}

const ALL_KINDS: readonly OpKind[] = ['expense', 'income', 'transfer'];
const ROW_KINDS: readonly ('expense' | 'income')[] = ['expense', 'income'];
const STATUSES = Object.keys(JOURNAL_STATUS_LABEL) as JournalStatus[];
const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];
const rowKind = (text: string | undefined): 'expense' | 'income' | undefined => {
  const kind = parseKind(text);
  return kind === 'transfer' ? undefined : kind;
};

/** `key` once more is an error naming the row where it was first; `seen` maps keys to their rows. */
function unique(r: Row, key: string, seen: Map<string, number>, what: string): string {
  const first = seen.get(key);
  if (first !== undefined) r.fail(`${what} уже есть в строке ${first}`);
  seen.set(key, r.n);
  return key;
}

/** The row's id (required, spaces around it dropped); an id already used in the same list is an error naming both rows. */
function uniqueId(r: Row, header: string, seen: Map<string, number>): string {
  const id = r.reqTrimmed(header);
  return unique(r, id, seen, `id «${id}»`);
}

/** The non-blank rows below the header of a sheet, with the values of the `columns`. */
function rowsOf(ws: Worksheet, columns: Record<string, string>): Row[] {
  const headers = Object.values(columns);
  const numbers = new Map<string, number>();
  ws.getRow(1).eachCell((cell, n) => {
    const header = cellText(cell.value);
    if (header !== undefined && !numbers.has(header)) numbers.set(header, n);
  });
  for (const header of headers) {
    if (!numbers.has(header)) throw new BackupError(`Лист «${ws.name}»: нет столбца «${header}».`);
  }
  const rows: Row[] = [];
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const cells = new Map(headers.map((h) => [h, row.getCell(numbers.get(h)!).value as unknown]));
    if ([...cells.values()].every(isBlank)) continue;
    rows.push(new Row(ws.name, n, cells));
  }
  return rows;
}

function readSchemaVersion(wb: Workbook): void {
  const ws = wb.getWorksheet(SHEET.schema);
  if (!ws) throw new BackupError(NOT_A_BACKUP);
  const values = new Map<string, unknown>();
  ws.eachRow((row) => {
    const key = cellText(row.getCell(1).value);
    if (key !== undefined) values.set(key, row.getCell(2).value);
  });
  if (cellText(values.get('app')) !== APP) throw new BackupError(NOT_A_BACKUP);
  const version = cellNumber(values.get('schemaVersion'));
  if (version === undefined || !Number.isInteger(version)) throw new BackupError(NOT_A_BACKUP);
  if (version > SCHEMA_VERSION) throw new BackupError(NEWER_VERSION);
  // Older versions: only version 1 exists, so there is nothing to migrate yet.
}

function readSettings(ws: Worksheet): { settings: Settings; credit: CreditSettings } {
  const params = new Map<string, Row>();
  for (const row of rowsOf(ws, SETTINGS_COLUMNS)) {
    const name = row.trimmed(SETTINGS_COLUMNS.name);
    if (name !== undefined && !params.has(name)) {
      params.set(name, new Row(ws.name, row.n, new Map([[name, row.value(SETTINGS_COLUMNS.value)]])));
    }
  }
  const param = (name: string): Row => {
    const row = params.get(name);
    if (!row) throw new BackupError(`Лист «${ws.name}»: нет параметра «${name}».`);
    return row;
  };
  const S = PARAM.settings;
  const C = PARAM.credit;
  const auto = param(C.auto).reqTrimmed(C.auto).toLowerCase();
  if (auto !== YES.toLowerCase() && auto !== NO.toLowerCase()) {
    param(C.auto).fail(`«${C.auto}» — ожидается «${YES}» или «${NO}»`);
  }
  return {
    settings: {
      accountingStart: param(S.accountingStart).reqMonth(S.accountingStart),
      forecastStart: param(S.forecastStart).reqMonth(S.forecastStart),
      cushion: param(S.cushion).reqNum(S.cushion),
      balancesDate: param(S.balancesDate).reqDate(S.balancesDate),
    },
    credit: compact({
      accountId: param(C.accountId).trimmed(C.accountId),
      auto: auto === YES.toLowerCase(),
      fromAccountId: param(C.fromAccountId).trimmed(C.fromAccountId),
      closeDay: param(C.closeDay).reqInt(C.closeDay, 1, 28),
      payDay: param(C.payDay).reqInt(C.payDay, 1, 28),
    }),
  };
}

/** The sheet of the journal rows under either of its names; a copy that has both cannot be told apart. */
function journalSheet(wb: Workbook): Worksheet | undefined {
  const current = wb.getWorksheet(SHEET.journal);
  const old = wb.getWorksheet(OLD_JOURNAL_SHEET);
  if (current && old) throw new BackupError(`В копии есть и лист «${SHEET.journal}», и лист «${OLD_JOURNAL_SHEET}» — должен остаться один.`);
  return current ?? old;
}

export async function importBackup(buf: ArrayBuffer): Promise<Data> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as XlsxInput); // ExcelJS types say Buffer; it reads an ArrayBuffer as well
  } catch {
    throw new BackupError(NOT_A_BACKUP);
  }
  readSchemaVersion(wb);
  const find = (name: string): Worksheet | undefined => (name === SHEET.journal ? journalSheet(wb) : wb.getWorksheet(name));
  if (Object.values(SHEET).some((name) => find(name) === undefined)) throw new BackupError(NOT_A_BACKUP);
  const sheet = (name: string): Worksheet => find(name)!;

  const { settings, credit } = readSettings(sheet(SHEET.settings));

  // «Что» and names may be empty: the model allows '' there (an operation without a description, a journal
  // row the tracker import made from an amount only), so an empty cell reads as ''.
  const K = COLUMN.categories;
  const categories: Categories = { expense: [], income: [] };
  for (const r of rowsOf(sheet(SHEET.categories), K)) {
    const kind = r.reqLabel(K.kind, rowKind, ROW_KINDS);
    const name = r.text(K.name) ?? '';
    if (kind === 'expense') categories.expense.push(compact({ name, limit: r.num(K.limit) }));
    else categories.income.push({ name });
  }

  // ids are unique within each list (another list may use the same id)
  const A = COLUMN.accounts;
  const accountRows = new Map<string, number>();
  const accounts = rowsOf(sheet(SHEET.accounts), A).map((r): Account => ({
    id: uniqueId(r, A.id, accountRows),
    name: r.text(A.name) ?? '',
    type: r.reqLabel(A.type, parseAccountType, ACCOUNT_TYPES),
    start: r.reqNum(A.start),
  }));

  const O = COLUMN.operations;
  const operationRows = new Map<string, number>();
  const operations = rowsOf(sheet(SHEET.operations), O).map((r): Operation => compact({
    id: uniqueId(r, O.id, operationRows),
    date: r.reqDate(O.date),
    kind: r.reqLabel(O.kind, parseKind, ALL_KINDS),
    category: r.text(O.category),
    what: r.text(O.what) ?? '',
    amount: r.reqNum(O.amount),
    account: r.trimmed(O.account),
    toAccount: r.trimmed(O.toAccount),
  }));

  const J = COLUMN.journal;
  const journalRows = new Map<string, number>();
  const journal = rowsOf(sheet(SHEET.journal), J).map((r): JournalRow => compact({
    id: uniqueId(r, J.id, journalRows),
    date: r.reqDate(J.date),
    kind: r.reqLabel(J.kind, rowKind, ROW_KINDS),
    category: r.text(J.category),
    what: r.text(J.what) ?? '',
    plan: r.num(J.plan),
    fact: r.num(J.fact),
    status: r.label(J.status, parseStatus, STATUSES),
    account: r.trimmed(J.account),
    priority: r.text(J.priority),
    month: r.month(J.month),
  }));

  const R = COLUMN.recurring;
  const recurringRows = new Map<string, number>(); // id → row: marks refer to recurring payments by id
  const recurring = rowsOf(sheet(SHEET.recurring), R).map((r): Recurring => compact({
    id: uniqueId(r, R.id, recurringRows),
    what: r.text(R.what) ?? '',
    kind: r.reqLabel(R.kind, rowKind, ROW_KINDS),
    category: r.text(R.category),
    day: r.int(R.day, 1, 31),
    amount: r.reqNum(R.amount),
    every: r.int(R.every, 1, 12),
    from: r.date(R.from),
    to: r.date(R.to),
    account: r.trimmed(R.account),
    marks: {},
  }));

  const M = COLUMN.marks;
  const byId = new Map(recurring.map((r) => [r.id, r]));
  const markRows = new Map<string, number>();
  for (const r of rowsOf(sheet(SHEET.marks), M)) {
    const id = r.reqTrimmed(M.id);
    const target = byId.get(id) ?? r.fail(`неизвестный постоянный платёж «${id}»`);
    const month = r.reqMonth(M.month);
    unique(r, `${id} ${month}`, markRows, `отметка «${id}» за ${month}`);
    target.marks[month] = cellText(r.value(M.mark)) === CHECK ? CHECK : r.reqNum(M.mark);
  }

  const P = COLUMN.purchases;
  const purchaseRows = new Map<string, number>();
  const purchases = rowsOf(sheet(SHEET.purchases), P).map((r): Purchase => compact({
    id: uniqueId(r, P.id, purchaseRows),
    what: r.text(P.what) ?? '',
    category: r.text(P.category),
    cost: r.num(P.cost),
    saved: r.num(P.saved),
    date: r.date(P.date),
    priority: r.text(P.priority),
    bought: r.checkmark(P.bought),
    price: r.num(P.price),
    account: r.trimmed(P.account),
  }));

  const D = COLUMN.debts;
  const debtRows = new Map<string, number>();
  const debts = rowsOf(sheet(SHEET.debts), D).map((r): Debt => compact({
    id: uniqueId(r, D.id, debtRows),
    name: r.text(D.name) ?? '',
    whom: r.text(D.whom),
    total: r.num(D.total),
    paid: r.num(D.paid),
    rate: r.num(D.rate),
    payment: r.num(D.payment),
    nextDate: r.date(D.nextDate),
  }));

  return { schemaVersion: SCHEMA_VERSION, settings, categories, accounts, credit, operations, journal, recurring, purchases, debts };
}
