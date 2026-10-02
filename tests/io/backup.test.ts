import type { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../../src/engine/model';
import type { Data } from '../../src/engine/model';
import { BackupError, backupFilename, checkReadsBack, difference, exportBackup, importBackup } from '../../src/io/backup';
import { DATE_FORMAT, MONEY_FORMAT } from '../../src/io/excel';
import { ACC, scenario } from '../engine/scenario';

const EXPORTED_AT = '2026-10-01T09:30:00.000Z';
const NOT_A_BACKUP = 'Это не резервная копия приложения «Трекер расходов».';
const NEWER_VERSION = 'Копия сделана более новой версией приложения. Обновите приложение.';
const SHEETS = ['Настройки', 'Категории', 'Счета', 'Операции', 'Запланированные', 'Постоянные', 'Отметки', 'Покупки', 'Долги', '_schema'];

/** Every optional field in use, every enum value, awkward numbers, text and dates. */
function rich(): Data {
  const d = scenario();
  d.settings = { accountingStart: '2027-01', forecastStart: '2027-03', cushion: 250.5, balancesDate: '2026-12-31' };
  d.categories = {
    expense: [{ name: 'Жильё', limit: 900 }, { name: 'Продукты', limit: 0 }, { name: 'Техника' }, { name: 'Кафе', limit: 120.75 }, { name: '', limit: 10 }],
    income: [{ name: 'Зарплата' }, { name: 'Премия' }, { name: '' }],
  };
  d.accounts = [
    { id: 'acc-card', name: 'Карта', type: 'debit', start: 1234.56 },
    { id: 'acc-cash', name: 'Наличные', type: 'cash', start: 0 },
    { id: 'acc-credit', name: 'Кредитка', type: 'credit', start: -310.2 },
    { id: 'acc-save', name: 'Копилка', type: 'savings', start: 5000 },
    { id: 'acc-noname', name: '', type: 'cash', start: 0 },
  ];
  d.credit = { accountId: 'acc-credit', auto: false, fromAccountId: 'acc-save', closeDay: 25, payDay: 5 };
  d.operations = [
    { id: 'o-1', date: '2028-02-29', kind: 'expense', category: 'Кафе', what: '=SUM(A1) & «кавычки» <b>', amount: 0.1 + 0.2, account: 'acc-card' },
    { id: 'o-2', date: '2026-12-31', kind: 'transfer', what: 'В копилку', amount: 500, account: 'acc-card', toAccount: 'acc-save' },
    { id: 'o-3', date: '2027-01-01', kind: 'income', what: ' с пробелами ', amount: 12 },
    { id: 'o-4', date: '2027-03-01', kind: 'expense', what: '', amount: -7.5, account: 'acc-unknown' },
  ];
  d.journal = [
    { id: 'j-1', date: '2026-12-31', kind: 'income', category: 'Зарплата', what: 'ЗП январь', plan: 3000, fact: 3000.01, status: 'paid', account: 'acc-card', month: '2027-01' },
    { id: 'j-2', date: '2028-02-29', kind: 'expense', category: 'Техника', what: 'Телефон', plan: 800, status: 'postponed', priority: 'Желательно' },
    { id: 'j-3', date: '2027-02-28', kind: 'expense', what: 'Концерт', plan: 60, status: 'cancelled', priority: 'Можно отложить', account: 'acc-credit' },
    { id: 'j-4', date: '2027-01-15', kind: 'expense', category: 'Продукты', what: 'Возврат', fact: -20, status: 'planned' },
    { id: 'j-5', date: '2027-01-16', kind: 'expense', what: 'Без статуса' },
    { id: 'j-6', date: '2027-01-17', kind: 'expense', what: '', plan: 5 }, // the tracker import makes such rows
  ];
  d.recurring = [
    { id: 'r-1', what: 'Аренда', kind: 'expense', category: 'Жильё', day: 31, amount: 900, every: 1, from: '2027-01-01', to: '2028-02-29', account: 'acc-card', marks: { '2027-01': '✓', '2027-02': 950.5, '2027-03': 0 } },
    { id: 'r-2', what: 'Страховка', kind: 'expense', amount: 300, every: 12, from: '2026-12-31', marks: {} },
    { id: 'r-3', what: 'Бонус', kind: 'income', category: 'Премия', amount: 50, marks: { '2027-02': '✓' } },
    { id: 'r-4', what: '', kind: 'expense', amount: 10, marks: { '2027-01': 10 } },
  ];
  d.purchases = [
    { id: 'p-1', what: 'Пылесос', category: 'Техника', cost: 250, saved: 100, priority: 'Обязательно', bought: false },
    { id: 'p-2', what: 'Кресло', cost: 400, saved: 400, date: '2028-02-29', bought: true, price: 389.99, account: 'acc-credit' },
    { id: 'p-3', what: 'Мечта', bought: false },
    { id: 'p-4', what: '', cost: 15, bought: false },
  ];
  d.debts = [
    { id: 'd-1', name: 'Кредит на машину', whom: 'Банк', total: 12000, paid: 3500.5, rate: 0.049, payment: 350, nextDate: '2027-01-31' },
    { id: 'd-2', name: 'Долг другу' },
    { id: 'd-3', name: '' },
  ];
  return d;
}

async function load(buf: ArrayBuffer): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<Workbook['xlsx']['load']>[0]);
  return wb;
}

/** The backup of `data`, changed by `edit` as a person editing it in Excel would. */
async function edited(data: Data, edit: (wb: Workbook) => void): Promise<ArrayBuffer> {
  const wb = await load(await exportBackup(data, EXPORTED_AT));
  edit(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer()).buffer;
}

async function roundTrip(data: Data): Promise<Data> {
  return importBackup(await exportBackup(data, EXPORTED_AT));
}

async function importError(buf: ArrayBuffer): Promise<BackupError> {
  const error = await importBackup(buf).then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(BackupError);
  return error as BackupError;
}

describe('backupFilename', () => {
  it('names the copy by the day', () => {
    expect(backupFilename('2026-10-01')).toBe('Трекер расходов — копия 2026-10-01.xlsx');
  });
});

describe('backup round trip', () => {
  it('restores the scenario exactly, ids included', async () => {
    expect(await roundTrip(scenario())).toStrictEqual(scenario());
  });

  it('restores every optional field, enum value and awkward value exactly', async () => {
    expect(await roundTrip(rich())).toStrictEqual(rich());
  });

  it('leaves empty optional fields out instead of setting them to undefined', async () => {
    const back = await roundTrip(rich());
    expect(Object.keys(back.operations[2]!)).toEqual(['id', 'date', 'kind', 'what', 'amount']);
    expect(Object.keys(back.purchases[2]!)).toEqual(['id', 'what', 'bought']);
    expect(Object.keys(back.debts[1]!)).toEqual(['id', 'name']);
    expect(Object.keys(back.credit)).toEqual(['accountId', 'auto', 'fromAccountId', 'closeDay', 'payDay']);
    expect(Object.keys((await roundTrip(scenario())).credit)).toEqual(['auto', 'fromAccountId', 'closeDay', 'payDay']);
  });

  // Date.UTC reads the years 0–99 as 1900–1999, so a backup of 0050-01-01 used to be refused by the
  // self-check. ExcelJS writes such a date as a negative serial number and reads it back exactly, so the
  // copy is made and restores to the same year (Excel itself shows ###### for a date before 1900).
  it.each(['0001-01-01', '0050-01-01', '0099-12-31', '0100-01-01', '1899-12-31'])(
    'keeps the year of %s in every date field, never turns it into 19xx', async (iso) => {
      const d = scenario();
      d.settings.balancesDate = iso;
      d.operations[0]!.date = iso;
      d.journal[0]!.date = iso;
      d.recurring[0]!.from = iso;
      d.recurring[0]!.to = iso;
      d.purchases[0]!.date = iso;
      d.debts = [{ id: 'd', name: 'd', nextDate: iso }];
      const back = await roundTrip(d);
      expect(back).toStrictEqual(d);
      expect(back.operations[0]!.date).toBe(iso);
    });

  it('keeps dates across month, year and leap-year boundaries', async () => {
    const d = scenario();
    const dates = ['2028-02-29', '2026-12-31', '2027-01-01', '2027-02-28', '2028-03-01', '2026-10-31'];
    d.operations = dates.map((date, i) => ({ id: `o-${i}`, date, kind: 'expense', what: date, amount: 1 }));
    d.journal = dates.map((date, i) => ({ id: `j-${i}`, date, kind: 'income', what: date }));
    d.recurring = [{ id: 'r', what: 'r', kind: 'expense', amount: 1, from: '2028-02-29', to: '2026-12-31', marks: {} }];
    d.purchases = [{ id: 'p', what: 'p', date: '2028-02-29', bought: false }];
    d.debts = [{ id: 'd', name: 'd', nextDate: '2026-12-31' }];
    d.settings.balancesDate = '2028-02-29';
    expect(await roundTrip(d)).toStrictEqual(d);
  });

  it('keeps text that looks like an Excel escape such as _x0041_', async () => {
    const d = scenario();
    const tricky = ['_x0041_', '_x0041_x0042_', '__x0041_', '_x005F_', '_x00e9_', 'a_x000D_b', '_X0041_', '_x004_'];
    d.operations = tricky.map((text, i) => ({ id: `o-${i}`, date: '2026-10-01', kind: 'expense', category: text, what: text, amount: 1 }));
    d.accounts[0]!.name = '_x0041_';
    d.categories.income[0]!.name = '_x0041_';
    d.debts = [{ id: 'd-_x0041_', name: '_x0041_', whom: '_x0041_' }];
    expect(await roundTrip(d)).toStrictEqual(d);
    const wb = await load(await exportBackup(d, EXPORTED_AT));
    expect(wb.getWorksheet('Операции')!.getCell('E2').value).toBe('_x0041_'); // what Excel shows
  });

  it('escapes _xHHHH_ with upper- or lower-case hex in the file itself, as Excel reads both', async () => {
    const JSZip = (await import('jszip')).default; // exceljs's own zip library
    const d = scenario();
    d.operations[0]!.what = '_x00e9_ и _x00E9_';
    const zip = await JSZip.loadAsync(await exportBackup(d, EXPORTED_AT));
    const strings = await zip.file('xl/sharedStrings.xml')!.async('string');
    expect(strings).toContain('_x005F_x00e9_ и _x005F_x00E9_');
  });

  it('writes text as the file gives it back: \\n line breaks, no control characters, no lone surrogates', async () => {
    const messy = (): Data => {
      const d = scenario();
      d.operations[0]!.what = 'a\r\nb\rc\td\u0000e\u0001f\u001Fg\u007Fh\u0085i😀';
      d.operations[1]!.what = 'x\uD800y\uDC00z\uFFFE\uFFFF';
      d.journal[0]!.category = 'Про\u0007дукты';
      d.accounts[0]!.name = 'Кар\r\nта';
      return d;
    };
    const expected = scenario();
    expected.operations[0]!.what = 'a\nb\nc\tdefgh\u0085i😀';
    expected.operations[1]!.what = 'x\uFFFDy\uFFFDz\uFFFD\uFFFD';
    expected.journal[0]!.category = 'Продукты';
    expected.accounts[0]!.name = 'Кар\nта';
    const data = messy();
    expect(await roundTrip(data)).toStrictEqual(expected);
    expect(data).toStrictEqual(messy()); // the data given to exportBackup is not changed
  });

  it('keeps an empty list of every kind', async () => {
    const d = scenario();
    d.categories = { expense: [], income: [] };
    d.accounts = [];
    d.operations = [];
    d.journal = [];
    d.recurring = [];
    d.purchases = [];
    d.debts = [];
    expect(await roundTrip(d)).toStrictEqual(d);
  });
});

describe('exportBackup checks that the copy reads back', () => {
  const unreadable = (where: string): string =>
    `Не удалось сделать копию: данные не читаются обратно (${where}). Сообщите разработчику.`;

  async function exportError(data: Data): Promise<BackupError> {
    const error = await exportBackup(data, EXPORTED_AT).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(BackupError);
    return error as BackupError;
  }

  it.each<[string, (d: Data) => void, string]>([
    ['a date that does not exist', (d) => { d.operations[1]!.date = '2026-02-30'; }, 'лист «Операции», строка 3, поле «Дата»'],
    ['an id with spaces around it', (d) => { d.operations[0]!.id = ' o-magazin '; }, 'лист «Операции», строка 2, поле «id»'],
    ['a field the file has no column for', (d) => { Object.assign(d.debts, [{ id: 'd-1', name: 'Долг', note: 'x' }]); }, 'лист «Долги», строка 2, поле «note»'],
    ['a number held as text', (d) => { Object.assign(d.accounts[0]!, { start: '1000' }); }, 'лист «Счета», строка 2, поле «На начало»'],
    ['a setting', (d) => { d.settings.balancesDate = '2026-02-30'; }, 'лист «Настройки», параметр «Дата остатков»'],
    ['a credit card setting', (d) => { d.credit.fromAccountId = ' acc-card'; }, 'лист «Настройки», параметр «Кредитка: со счёта»'],
    ['an income category with a limit', (d) => { Object.assign(d.categories.income[1]!, { limit: 5 }); }, 'лист «Категории», строка 8, поле «Лимит»'],
    ['a month of a mark', (d) => { d.recurring[1]!.marks = { ' 2026-11': '✓' }; }, 'лист «Отметки», строка 4'],
    ['a number that is not finite', (d) => { d.journal[2]!.plan = Number.NaN; }, 'лист «Запланированные», строка 4: «План» — не число'],
    ['a day out of range', (d) => { d.recurring[0]!.day = 40; }, 'лист «Постоянные», строка 2: «День» — ожидается целое число от 1 до 31'],
    ['a mark of a month that does not exist', (d) => { d.recurring[1]!.marks = { '2026-13': 5 }; }, 'лист «Отметки», строка 4: «Месяц» — не месяц в виде ГГГГ-ММ'],
  ])('refuses to hand out a copy that does not restore: %s', async (_, change, where) => {
    const d = scenario();
    change(d);
    expect((await exportError(d)).message).toBe(unreadable(where));
  });

  it('writes −0 as 0 and an empty optional text as not set', async () => {
    const d = scenario();
    d.accounts[1]!.start = -0;
    d.operations[0]!.category = '';
    d.operations[1]!.toAccount = '';
    d.journal[0]!.priority = '';
    d.journal[0]!.month = '';
    d.recurring[0]!.to = '';
    d.purchases[0]!.date = '';
    d.credit.accountId = '';
    d.debts = [{ id: 'd-1', name: 'Долг', whom: '', nextDate: '' }];
    const back = await roundTrip(d);
    const expected = scenario();
    delete expected.operations[0]!.category;
    delete expected.operations[1]!.toAccount;
    delete expected.purchases[0]!.date;
    expected.debts = [{ id: 'd-1', name: 'Долг' }];
    expect(back).toStrictEqual(expected);
    expect(Object.is(back.accounts[1]!.start, 0)).toBe(true);
  });

  it('leaves out fields set to undefined', async () => {
    const d = scenario();
    d.operations[0]!.category = undefined;
    d.credit.accountId = undefined;
    const expected = scenario();
    delete expected.operations[0]!.category;
    expect(await roundTrip(d)).toStrictEqual(expected);
  });
});

// The read-back check compares the data written with the data read back, in both directions: a value that
// differs, a key that only the original has (covered above: «a field the file has no column for») and a key
// that only the read-back has. The last one cannot be made by exportBackup itself (the file is written from
// the data), so it is pinned here on the comparison and on the check with a reader that invents a key.
describe('the read-back comparison', () => {
  it('finds nothing in equal data', () => {
    expect(difference(scenario(), scenario())).toBeUndefined();
    expect(difference([], [])).toBeUndefined();
    expect(difference(Number.NaN, Number.NaN)).toBeUndefined();
  });

  it('reports the path of a value that differs', () => {
    expect(difference({ a: { b: [1, 2, 3] } }, { a: { b: [1, 2, 4] } })).toEqual(['a', 'b', 2]);
    expect(difference({ x: 0 }, { x: -0 })).toEqual(['x']);
  });

  it('reports a key that only the read-back has', () => {
    expect(difference({ a: 1 }, { a: 1, b: 2 })).toEqual(['b']);
    expect(difference({ credit: { auto: true } }, { credit: { auto: true, accountId: 'acc-x' } })).toEqual(['credit', 'accountId']);
    expect(difference({ rows: [{ id: 'a' }] }, { rows: [{ id: 'a', note: 'x' }] })).toEqual(['rows', 0, 'note']);
    expect(difference({ a: {} }, { a: { b: null } })).toEqual(['a', 'b']);
  });

  it('reports a key that only the original has', () => {
    expect(difference({ a: 1, b: 2 }, { a: 1 })).toEqual(['b']);
    expect(difference({ rows: [{ id: 'a', note: 'x' }] }, { rows: [{ id: 'a' }] })).toEqual(['rows', 0, 'note']);
  });

  it('reports a row that only one side has', () => {
    expect(difference({ rows: [1, 2] }, { rows: [1, 2, 3] })).toEqual(['rows', 2]);
    expect(difference({ rows: [1, 2, 3] }, { rows: [1, 2] })).toEqual(['rows', 2]);
  });
});

describe('checkReadsBack', () => {
  const unreadable = (where: string): string =>
    `Не удалось сделать копию: данные не читаются обратно (${where}). Сообщите разработчику.`;

  async function refusal(data: Data, back: Data): Promise<string | undefined> {
    const error = await checkReadsBack(new ArrayBuffer(0), data, async () => back).then(() => undefined, (e: unknown) => e);
    if (error === undefined) return undefined;
    expect(error).toBeInstanceOf(BackupError);
    return (error as BackupError).message;
  }

  it('accepts a read-back equal to the data', async () => {
    expect(await refusal(scenario(), scenario())).toBeUndefined();
  });

  it('refuses a read-back with a key the data does not have, and says where', async () => {
    const back = scenario();
    Object.assign(back.operations[1]!, { note: 'x' });
    expect(await refusal(scenario(), back)).toBe(unreadable('лист «Операции», строка 3, поле «note»'));
  });

  it('refuses a read-back with a setting the data does not have', async () => {
    const back = scenario();
    back.credit.accountId = 'acc-credit'; // the scenario leaves it out
    expect(await refusal(scenario(), back)).toBe(unreadable('лист «Настройки», параметр «Кредитка: счёт»'));
  });

  it('refuses a read-back with an extra row', async () => {
    const back = scenario();
    back.accounts.push({ id: 'acc-extra', name: 'Лишний', type: 'cash', start: 0 });
    expect(await refusal(scenario(), back)).toBe(unreadable('лист «Счета», строка 5'));
  });

  it('turns a read that fails into the same kind of refusal', async () => {
    const error = await checkReadsBack(new ArrayBuffer(0), scenario(), async () => { throw new BackupError('Лист «Операции», строка 2: не заполнено «id».'); })
      .then(() => undefined, (e: unknown) => e);
    expect((error as BackupError).message).toBe(unreadable('лист «Операции», строка 2: не заполнено «id»'));
  });
});

describe('backup workbook', () => {
  it('has the sheets in order and a hidden _schema sheet', async () => {
    const wb = await load(await exportBackup(scenario(), EXPORTED_AT));
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(SHEETS);
    const schema = wb.getWorksheet('_schema')!;
    expect(schema.state).toBe('hidden');
    expect([1, 2, 3].map((r) => [schema.getCell(r, 1).value, schema.getCell(r, 2).value])).toEqual([
      ['schemaVersion', SCHEMA_VERSION], ['exportedAt', EXPORTED_AT], ['app', 'money-planner'],
    ]);
    for (const ws of wb.worksheets.filter((s) => s.name !== '_schema')) {
      expect(ws.getRow(1).getCell(1).font?.bold, ws.name).toBe(true);
      expect(ws.views[0], ws.name).toMatchObject({ state: 'frozen', ySplit: 1 });
    }
  });

  it('writes readable headers, labels, account names, real dates and money cells', async () => {
    const wb = await load(await exportBackup(scenario(), EXPORTED_AT));
    const ops = wb.getWorksheet('Операции')!;
    expect(ops.getRow(1).values).toEqual([
      undefined, 'id', 'Дата', 'Тип', 'Категория', 'Что', 'Сумма', 'Счёт (id)', 'На счёт (id)', 'Счёт (название)', 'На счёт (название)',
    ]);
    // o-snyatie: transfer 100 from the card to cash on 13.10.2026
    const snyatie = ops.getRow(3);
    expect(snyatie.getCell(1).value).toBe('o-snyatie');
    expect(snyatie.getCell(2).value).toEqual(new Date(Date.UTC(2026, 9, 13)));
    expect(snyatie.getCell(2).numFmt).toBe(DATE_FORMAT);
    expect(snyatie.getCell(3).value).toBe('Перевод');
    expect(snyatie.getCell(6).value).toBe(100);
    expect(snyatie.getCell(6).numFmt).toBe(MONEY_FORMAT);
    expect([7, 8, 9, 10].map((c) => snyatie.getCell(c).value)).toEqual([ACC.card, ACC.cash, 'Карта', 'Наличные']);

    const settings = wb.getWorksheet('Настройки')!;
    expect(settings.getSheetValues().slice(1).map((r) => (r as unknown[]).slice(1))).toEqual([
      ['Параметр', 'Значение'],
      ['Учёт с', '2026-10'],
      ['Прогноз с', '2026-10'],
      ['Подушка', 100],
      ['Дата остатков', new Date(Date.UTC(2026, 9, 1))],
      ['Кредитка: счёт'],
      ['Кредитка: гасится автоматически', 'Да'],
      ['Кредитка: со счёта', ACC.card],
      ['Кредитка: выписка', 4],
      ['Кредитка: списание', 10],
    ]);

    // the formats come from src/io/excel.ts, the same ones the reports use
    expect(settings.getCell(4, 2).numFmt).toBe(MONEY_FORMAT); // Подушка
    expect(settings.getCell(5, 2).numFmt).toBe(DATE_FORMAT); // Дата остатков

    const journal = wb.getWorksheet('Запланированные')!;
    expect(journal.getRow(3).getCell(8).value).toBe('Оплачено'); // j-kafe
    expect(journal.getRow(3).getCell(12).value).toBe('Карта');
    const accounts = wb.getWorksheet('Счета')!;
    expect(accounts.getRow(4).values).toEqual([undefined, ACC.credit, 'Кредитка', 'Кредитная', 0]);
    const marks = wb.getWorksheet('Отметки')!;
    expect(marks.getRow(2).values).toEqual([undefined, 'r-arenda', '2026-10', '✓']);
    expect(marks.getRow(3).values).toEqual([undefined, 'r-arenda', '2026-11', 950]);
    expect(marks.getRow(3).getCell(3).numFmt).toBe(MONEY_FORMAT);
    expect(wb.getWorksheet('Покупки')!.getRow(2).getCell(8).value).toBe('✓');
  });
});

describe('importBackup rejects what it cannot restore', () => {
  it('rejects a file that is not a workbook', async () => {
    expect((await importError(new TextEncoder().encode('не таблица').buffer)).message).toBe(NOT_A_BACKUP);
  });

  it.each(SHEETS)('rejects a workbook without the sheet «%s»', async (name) => {
    const buf = await edited(scenario(), (wb) => wb.removeWorksheet(wb.getWorksheet(name)!.id));
    expect((await importError(buf)).message).toBe(NOT_A_BACKUP);
  });

  it('rejects a workbook of another app', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('_schema')!.getCell('B3').value = 'other-app'; });
    expect((await importError(buf)).message).toBe(NOT_A_BACKUP);
  });

  it('rejects a copy made by a newer version of the app', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('_schema')!.getCell('B1').value = SCHEMA_VERSION + 1; });
    expect((await importError(buf)).message).toBe(NEWER_VERSION);
  });

  it('rejects a copy whose schema version is not a number', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('_schema')!.getCell('B1').value = 'abc'; });
    expect((await importError(buf)).message).toBe(NOT_A_BACKUP);
  });

  it('reads a copy of an older schema version as the current one', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('_schema')!.getCell('B1').value = 0; });
    expect(await importBackup(buf)).toStrictEqual(scenario());
  });

  it('names the sheet and the row of an operation without a date', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('Операции')!.getCell('B3').value = null; });
    const { message } = await importError(buf);
    expect(message).toContain('«Операции»');
    expect(message).toContain('строка 3');
  });

  it.each([
    ['Счета', 'A3', null, 'строка 3'], // no id
    ['Счета', 'D2', null, 'строка 2'], // no start balance
    ['Счета', 'C2', 'Золотая', 'строка 2'], // unknown account type
    ['Операции', 'C4', 'Подарок', 'строка 4'], // unknown kind
    ['Операции', 'F2', 'много', 'строка 2'], // amount is not a number
    ['Запланированные', 'B5', 'вчера', 'строка 5'], // not a date
    ['Запланированные', 'C2', 'Перевод', 'строка 2'], // journal rows are expenses or incomes
    ['Запланированные', 'H3', 'Потом', 'строка 3'], // unknown status
    ['Запланированные', 'K2', 'ноябрь', 'строка 2'], // accounting month is not YYYY-MM
    ['Постоянные', 'F3', null, 'строка 3'], // no amount
    ['Отметки', 'A2', 'r-nobody', 'строка 2'], // mark of an unknown recurring row
    ['Отметки', 'C2', 'да', 'строка 2'], // mark is neither ✓ nor a number
    ['Покупки', 'H2', 'может быть', 'строка 2'], // bought is ✓ or empty
    ['Категории', 'A2', 'Перевод', 'строка 2'], // categories are expenses or incomes
    ['Долги', 'A2', null, 'строка 2'], // no id
  ])('names the sheet «%s» and the row when %s is %j', async (sheet, cell, value, rowText) => {
    const d = scenario();
    d.debts = [{ id: 'd-1', name: 'Долг' }];
    const buf = await edited(d, (wb) => { wb.getWorksheet(sheet)!.getCell(cell).value = value; });
    const { message } = await importError(buf);
    expect(message).toContain(`«${sheet}»`);
    expect(message).toContain(rowText);
  });

  // A number outside Excel's dates (1 … 2958465) is no date. In a date-formatted cell ExcelJS turns the number into a Date,
  // and a Date after the year 9999 is no date either; a date before 1900 in such a cell is a date (the copy writes those).
  it.each([0, -1, 2958466, 5000000])('says that a number cell holding %s is not a date', async (serial) => {
    const buf = await edited(scenario(), (wb) => {
      const cell = wb.getWorksheet('Операции')!.getCell('B3');
      cell.value = serial;
      cell.numFmt = 'General';
    });
    const { message } = await importError(buf);
    expect(message).toContain('«Операции»');
    expect(message).toContain('строка 3');
    expect(message).toContain('не дата');
  });

  it.each([2958466, 5000000])('says that a date-formatted cell holding %s is not a date', async (serial) => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('Операции')!.getCell('B3').value = serial; });
    const { message } = await importError(buf);
    expect(message).toContain('«Операции»');
    expect(message).toContain('строка 3');
    expect(message).toContain('не дата');
  });

  it.each([
    ['Запланированные', 'K2', true, 'строка 2'], // «Месяц учёта» is a boolean
    ['Запланированные', 'K3', { error: '#N/A' } as const, 'строка 3'],
    ['Отметки', 'B2', 202701, 'строка 2'],
    ['Настройки', 'B2', true, 'Учёт с'],
    ['Настройки', 'B3', { error: '#N/A' } as const, 'Прогноз с'],
  ])('says that «%s» %s is not a month when it holds %j', async (sheet, cell, value, where) => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet(sheet)!.getCell(cell).value = value; });
    const { message } = await importError(buf);
    expect(message).toContain(`«${sheet}»`);
    expect(message).toContain(where);
    expect(message).toContain('не месяц');
  });

  it.each([
    ['Постоянные', 'E2', 0, 'строка 2', 'от 1 до 31'], // «День»
    ['Постоянные', 'E2', 32, 'строка 2', 'от 1 до 31'],
    ['Постоянные', 'E3', 5.5, 'строка 3', 'от 1 до 31'],
    ['Постоянные', 'G2', 0, 'строка 2', 'от 1 до 12'], // «Раз в N мес.»
    ['Постоянные', 'G5', 13, 'строка 5', 'от 1 до 12'],
    ['Постоянные', 'G5', 1.5, 'строка 5', 'от 1 до 12'],
    ['Настройки', 'B9', 0, 'Кредитка: выписка', 'от 1 до 28'],
    ['Настройки', 'B9', 29, 'Кредитка: выписка', 'от 1 до 28'],
    ['Настройки', 'B10', 2.5, 'Кредитка: списание', 'от 1 до 28'],
    ['Операции', 'F2', Infinity, 'строка 2', 'не число'],
    ['Счета', 'D3', -Infinity, 'строка 3', 'не число'],
  ])('checks the range of «%s» %s = %j', async (sheet, cell, value, where, problem) => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet(sheet)!.getCell(cell).value = value; });
    const { message } = await importError(buf);
    expect(message).toContain(`«${sheet}»`);
    expect(message).toContain(where);
    expect(message).toContain(problem);
  });

  it('accepts the edge values of the ranges', async () => {
    const d = scenario();
    d.credit.closeDay = 1;
    d.credit.payDay = 28;
    d.recurring[0]!.day = 1;
    d.recurring[1]!.day = 31;
    d.recurring[0]!.every = 1;
    d.recurring[1]!.every = 12;
    expect(await roundTrip(d)).toStrictEqual(d);
  });

  it.each([
    ['Запланированные', 'E2', new Date(Date.UTC(2027, 0, 1)), 'строка 2', '«Что» — не текст'],
    ['Операции', 'D2', true, 'строка 2', '«Категория» — не текст'],
    ['Счета', 'B2', { error: '#REF!' } as const, 'строка 2', '«Название» — не текст'],
    ['Запланированные', 'H2', new Date(Date.UTC(2027, 0, 1)), 'строка 2', '«Статус» — не текст'],
    ['Операции', 'G2', false, 'строка 2', '«Счёт (id)» — не текст'],
    ['Покупки', 'H2', true, 'строка 2', '«Куплено» — ожидается «✓» или пустая ячейка'],
  ])('does not drop a non-text value in «%s» %s (%j)', async (sheet, cell, value, where, problem) => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet(sheet)!.getCell(cell).value = value; });
    const { message } = await importError(buf);
    expect(message).toContain(`«${sheet}»`);
    expect(message).toContain(where);
    expect(message).toContain(problem);
  });

  it('rejects two recurring payments with the same id', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('Постоянные')!.getCell('A3').value = 'r-arenda'; });
    expect((await importError(buf)).message).toBe('Лист «Постоянные», строка 3: id «r-arenda» уже есть в строке 2.');
  });

  it.each([
    ['Счета', 'acc-card'],
    ['Операции', 'o-1'],
    ['Запланированные', 'j-1'],
    ['Покупки', 'p-1'],
    ['Долги', 'd-1'],
  ])('rejects two rows with the same id in «%s», naming the sheet and both rows', async (sheet, id) => {
    const buf = await edited(rich(), (wb) => {
      const ws = wb.getWorksheet(sheet)!;
      expect(ws.getCell('A2').value).toBe(id);
      ws.getCell('A4').value = ` ${id} `; // the spaces around an id do not make it another one
    });
    expect((await importError(buf)).message).toBe(`Лист «${sheet}», строка 4: id «${id}» уже есть в строке 2.`);
  });

  it('the same id in two different lists is allowed (each list has its own ids)', async () => {
    const d = rich();
    d.debts[0]!.id = 'o-1';
    expect((await roundTrip(d)).debts[0]!.id).toBe('o-1');
  });

  it('rejects two marks of one recurring payment for the same month', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('Отметки')!.getCell('B3').value = '2026-10'; });
    expect((await importError(buf)).message).toBe('Лист «Отметки», строка 3: отметка «r-arenda» за 2026-10 уже есть в строке 2.');
  });

  it('names a missing column', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('Операции')!.getCell('F1').value = 'Сумма, €'; });
    expect((await importError(buf)).message).toBe('Лист «Операции»: нет столбца «Сумма».');
  });

  it('names the setting that is wrong', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('Настройки')!.getCell('B3').value = 'март'; });
    const { message } = await importError(buf);
    expect(message).toContain('«Настройки»');
    expect(message).toContain('Прогноз с');
  });
});

describe('importBackup reads a copy edited by hand', () => {
  it('skips blank rows', async () => {
    const buf = await edited(scenario(), (wb) => {
      const ws = wb.getWorksheet('Операции')!;
      ws.spliceRows(3, 0, []);
    });
    expect(await importBackup(buf)).toStrictEqual(scenario());
  });

  it('reads an emptied «Что» or name as an empty text', async () => {
    const d = scenario();
    d.debts = [{ id: 'd-1', name: 'Долг' }];
    const buf = await edited(d, (wb) => {
      for (const [sheet, cell] of [['Запланированные', 'E2'], ['Постоянные', 'B2'], ['Покупки', 'B2'], ['Счета', 'B2'], ['Категории', 'B2'], ['Категории', 'B7'], ['Долги', 'B2']] as const) {
        wb.getWorksheet(sheet)!.getCell(cell).value = null;
      }
    });
    const back = await importBackup(buf);
    expect([back.journal[0]!.what, back.recurring[0]!.what, back.purchases[0]!.what, back.accounts[0]!.name]).toEqual(['', '', '', '']);
    expect([back.categories.expense[0]!.name, back.categories.income[0]!.name, back.debts[0]!.name]).toEqual(['', '', '']);
  });

  it('reads a date typed into a month column as the month of its UTC day', async () => {
    const buf = await edited(scenario(), (wb) => {
      wb.getWorksheet('Настройки')!.getCell('B2').value = new Date(Date.UTC(2026, 8, 1)); // Учёт с
      wb.getWorksheet('Настройки')!.getCell('B3').value = new Date(Date.UTC(2026, 11, 31)); // Прогноз с
      wb.getWorksheet('Запланированные')!.getCell('K2').value = new Date(Date.UTC(2026, 10, 1)); // Месяц учёта of j-eda
      wb.getWorksheet('Отметки')!.getCell('B3').value = new Date(Date.UTC(2027, 0, 1)); // r-arenda 950 → January
    });
    const expected = scenario();
    expected.settings.accountingStart = '2026-09';
    expected.settings.forecastStart = '2026-12';
    expected.journal[0]!.month = '2026-11';
    expected.recurring[0]!.marks = { '2026-10': '✓', '2027-01': 950 };
    expect(await importBackup(buf)).toStrictEqual(expected);
  });

  it('ignores the account name columns', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet('Операции')!.getCell('I2').value = 'Другое имя'; });
    expect(await importBackup(buf)).toStrictEqual(scenario());
  });
});

// The tracker sheet «Журнал» is now «Запланированные»; the journal sheet of a copy made before that keeps its old name.
describe('the sheet of the journal rows: «Запланированные», or «Журнал» in a copy made before the rename', () => {
  const NEW = 'Запланированные';
  const OLD = 'Журнал';

  it('a new copy names it «Запланированные» and has no sheet «Журнал»', async () => {
    const wb = await load(await exportBackup(scenario(), EXPORTED_AT));
    expect(wb.getWorksheet(NEW)).toBeDefined();
    expect(wb.getWorksheet(OLD)).toBeUndefined();
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(SHEETS); // in the place of the old sheet, the format is the same
  });

  it('keeps the format version 1', async () => {
    const wb = await load(await exportBackup(scenario(), EXPORTED_AT));
    expect(SCHEMA_VERSION).toBe(1);
    expect(wb.getWorksheet('_schema')!.getCell('B1').value).toBe(1);
  });

  it('restores a copy whose sheet is named «Журнал» to the same data', async () => {
    const buf = await edited(rich(), (wb) => { wb.getWorksheet(NEW)!.name = OLD; });
    expect(await importBackup(buf)).toStrictEqual(rich());
  });

  it('restores the scenario from the old name as well', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet(NEW)!.name = OLD; });
    expect(await importBackup(buf)).toStrictEqual(scenario());
  });

  it('names the sheet it found in the message about a bad cell', async () => {
    for (const name of [NEW, OLD]) {
      const buf = await edited(scenario(), (wb) => {
        const ws = wb.getWorksheet(NEW)!;
        ws.name = name;
        ws.getCell('B2').value = 'вчера'; // Дата
      });
      expect((await importError(buf)).message).toContain(`Лист «${name}», строка 2: «Дата» — не дата.`);
    }
  });

  it('refuses a copy that has both sheets: it cannot tell which holds the rows', async () => {
    const buf = await edited(scenario(), (wb) => { wb.addWorksheet(OLD); });
    expect((await importError(buf)).message).toBe(`В копии есть и лист «${NEW}», и лист «${OLD}» — должен остаться один.`);
  });

  it('a copy without either sheet is not a backup', async () => {
    const buf = await edited(scenario(), (wb) => { wb.getWorksheet(NEW)!.name = 'Другой лист'; });
    expect((await importError(buf)).message).toBe(NOT_A_BACKUP);
  });
});
