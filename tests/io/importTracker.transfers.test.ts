// importTracker and the tracker's transfers on «Запланированные» and «Постоянные» (layout contract
// .internal/specs/2026-10-02-transfers-layout.md, excel-planners feature/transfers): the type «Перевод», «На счёт»
// (Запланированные O, Постоянные the column right after the 12 months, headed «На счёт»), the helpers of the free
// money (Запланированные X, Постоянные AL/AM/AN) in FORMULA_AREAS. A file of the layout before (no «На счёт» headers)
// is read as before: «Перевод» there is an expense, as that file's formulas count it.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Data } from '../../src/engine';
import { isoToExcelDate } from '../../src/io/excel';
import { importTracker } from '../../src/io/importTracker';
import type { ImportResult } from '../../src/io/importTracker';

const SHEETS = ['Настройки', 'Операции', 'Счета', 'Запланированные', 'Постоянные', 'Покупки', 'Месяц', 'Долги'];
const MONTH_COLS = ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];

const date = (iso: string) => isoToExcelDate(iso);

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`no sheet ${name}`);
  return ws;
}

function set(ws: ExcelJS.Worksheet, cells: Record<string, ExcelJS.CellValue>): void {
  for (const [address, value] of Object.entries(cells)) ws.getCell(address).value = value;
}

/**
 * A tracker of the layout with transfers (`transfers`: «На счёт» headed on both sheets) or of the one before; October
 * 2026, accounts Карта / Наличные / Кредитка / Копилка (savings).
 */
function tracker(transfers = true): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const name of SHEETS) wb.addWorksheet(name);
  set(sheet(wb, 'Настройки'), {
    C6: 2026, C7: 'Октябрь', C8: 2026, C9: 'Октябрь',
    J6: 'Жильё', J7: 'Продукты', L6: 'Зарплата',
    N6: 'Карта', N7: 'Наличные', N8: 'Кредитка', N9: 'Копилка',
  });
  set(sheet(wb, 'Счета'), {
    C10: 'Дебетовая', D10: 1000, C11: 'Наличные', D11: 0, C12: 'Кредитная', D12: 0, C13: 'Сберегательная', D13: 500,
    C33: 'Да', C34: { formula: 'Настройки!$N$6' } as ExcelJS.CellFormulaValue, C35: 4, C36: 10,
  });
  const rec = sheet(wb, 'Постоянные');
  set(rec, {
    B7: '№', C7: 'Что', D7: 'Тип', E7: 'Категория', F7: 'День', G7: 'Сумма', H7: 'Раз в\nN мес.',
    I7: 'Действует с', J7: 'по', K7: 'Счёт',
  });
  MONTH_COLS.forEach((col, k) => { rec.getCell(`${col}7`).value = { formula: `Настройки!$X$${6 + k}` }; });
  if (transfers) {
    set(rec, { X7: 'На счёт', Y7: 'Дата', Z7: 'Тип', AL7: 'Куда' });
    set(sheet(wb, 'Запланированные'), { N9: 'Дубль или\nпроверка', O9: 'На счёт\n(для перевода)' });
  } else {
    set(sheet(wb, 'Запланированные'), { N9: 'Возможный\nдубль' });
  }
  return wb;
}

async function load(wb: ExcelJS.Workbook): Promise<ImportResult> {
  const written = new Uint8Array(await wb.xlsx.writeBuffer());
  return importTracker(written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength));
}

const idOf = (data: Data, name: string) => data.accounts.find((a) => a.name === name)?.id;

/** The note on «Перевод» in a file of the layout before transfers: its formulas count such a row as an expense. */
const OLD_TRANSFER = (sheetName: string, address: string): string => {
  const [, col, row] = /^([A-Z]+)(\d+)$/.exec(address) ?? [];
  return `Лист «${sheetName}», строка ${row}, столбец ${col}: «Перевод» — в этой версии трекера нет «На счёт», `
    + 'его формулы считают такую строку расходом; загружено как «Расход»';
};

/** The note on «На счёт» of a row that is not a transfer: Excel reads it only of a transfer, the app does not load it. */
const NOT_TRANSFER = (sheetName: string, address: string, value: string): string => {
  const [, col, row] = /^([A-Z]+)(\d+)$/.exec(address) ?? [];
  return `Лист «${sheetName}», строка ${row}, столбец ${col}: «На счёт» «${value}» указан у строки, которая не перевод — не загружено`;
};

describe('importTracker — transfers on «Запланированные» (O «На счёт»)', () => {
  it('reads «Перевод» as a transfer with «На счёт»; no notes', async () => {
    const wb = tracker();
    set(sheet(wb, 'Запланированные'), {
      C10: date('2026-10-07'), D10: 'Перевод', F10: 'В копилку', G10: 300, I10: 'Оплачено', J10: 'Карта', O10: 'Копилка',
      C11: date('2026-10-08'), D11: 'Перевод', F11: 'Без «На счёт»', G11: 10, J11: 'Карта',
      C12: date('2026-10-09'), D12: 'Расход', E12: 'Продукты', F12: 'Еда', G12: 50, J12: 'Карта',
    });
    const { data, notes, overrides } = await load(wb);
    expect(data.journal.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: '2026-10-07', kind: 'transfer', what: 'В копилку', plan: 300, status: 'paid', account: idOf(data, 'Карта'), toAccount: idOf(data, 'Копилка') },
      { date: '2026-10-08', kind: 'transfer', what: 'Без «На счёт»', plan: 10, account: idOf(data, 'Карта') },
      { date: '2026-10-09', kind: 'expense', category: 'Продукты', what: 'Еда', plan: 50, account: idOf(data, 'Карта') },
    ]);
    expect(notes).toEqual([]);
    expect(overrides).toEqual([]);
  });

  it('«На счёт» of a row that is not a transfer is not loaded, with one note per row (Excel does not read it)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Запланированные'), {
      C10: date('2026-10-09'), D10: 'Расход', E10: 'Продукты', F10: 'Еда', G10: 50, J10: 'Карта', O10: 'Копилка',
      C11: date('2026-10-10'), D11: 'Доход', F11: 'Возврат', G11: 20, J11: 'Карта', O11: 'Вклад', // no such account: the same note
      C12: date('2026-10-11'), F12: 'Без типа', G12: 5, J12: 'Карта', O12: 'Наличные', // no type: an expense
    });
    const { data, notes, overrides } = await load(wb);
    expect(data.journal.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: '2026-10-09', kind: 'expense', category: 'Продукты', what: 'Еда', plan: 50, account: idOf(data, 'Карта') },
      { date: '2026-10-10', kind: 'income', what: 'Возврат', plan: 20, account: idOf(data, 'Карта') },
      { date: '2026-10-11', kind: 'expense', what: 'Без типа', plan: 5, account: idOf(data, 'Карта') },
    ]);
    expect(notes).toEqual([
      NOT_TRANSFER('Запланированные', 'O10', 'Копилка'),
      NOT_TRANSFER('Запланированные', 'O11', 'Вклад'),
      NOT_TRANSFER('Запланированные', 'O12', 'Наличные'),
    ]);
    expect(overrides).toEqual([]);
  });

  it('a «Перевод» with spaces around it is loaded as a transfer, with the note that Excel does not recognise it', async () => {
    const wb = tracker();
    set(sheet(wb, 'Запланированные'), {
      C10: date('2026-10-07'), D10: ' Перевод ', F10: 'В копилку', G10: 300, J10: 'Карта', O10: 'Копилка',
    });
    const { data, notes } = await load(wb);
    expect(data.journal[0]?.kind).toBe('transfer');
    expect(notes).toEqual([
      'Лист «Запланированные», строка 10, столбец D: « Перевод » — в Excel с пробелами не распознаётся; загружено как «Перевод»',
    ]);
  });

  it('«На счёт» that names no account is noted and left out', async () => {
    const wb = tracker();
    set(sheet(wb, 'Запланированные'), { C10: date('2026-10-07'), D10: 'Перевод', F10: 'Куда-то', G10: 30, J10: 'Карта', O10: 'Вклад' });
    const { data, notes } = await load(wb);
    expect(data.journal[0]).not.toHaveProperty('toAccount');
    expect(notes).toEqual(['Счёт «Вклад» не найден (Запланированные, строка 10)']);
  });

  it('a row with only «На счёт» is a row with input (it is noted, not lost)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Запланированные'), { O11: 'Копилка' });
    const { data, notes } = await load(wb);
    expect(data.journal).toEqual([]);
    expect(notes).toEqual(['Запланированные, строка 11: нет даты — строка не загружена']);
  });

  it('the layout before transfers: «Перевод» is an expense (as its formulas count it), with a note; O is not read', async () => {
    const wb = tracker(false);
    set(sheet(wb, 'Запланированные'), {
      C10: date('2026-10-07'), D10: 'Перевод', F10: 'В копилку', G10: 300, J10: 'Карта', O10: 'Копилка',
      O11: 'Копилка', // an empty narrow column there: nothing reads it
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: '2026-10-07', kind: 'expense', what: 'В копилку', plan: 300, account: idOf(data, 'Карта') },
    ]);
    expect(notes).toEqual([OLD_TRANSFER('Запланированные', 'D10')]);
  });
});

describe('importTracker — transfers on «Постоянные» («На счёт» right after the 12 months)', () => {
  it('reads «Перевод» as a transfer with «На счёт»; no notes', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), {
      C8: 'В копилку', D8: 'Перевод', F8: 5, G8: 500, K8: 'Карта', L8: '✓', M8: 400, X8: 'Копилка',
      C9: 'Аренда', D9: 'Расход', E9: 'Жильё', F9: 3, G9: 1000, K9: 'Карта',
      C10: 'Перевод куда-то', D10: 'Перевод', F10: 12, G10: 70, K10: 'Карта',
    });
    const { data, notes } = await load(wb);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([
      { what: 'В копилку', kind: 'transfer', day: 5, amount: 500, account: idOf(data, 'Карта'), toAccount: idOf(data, 'Копилка'), marks: { '2026-10': '✓', '2026-11': 400 } },
      { what: 'Аренда', kind: 'expense', category: 'Жильё', day: 3, amount: 1000, account: idOf(data, 'Карта'), marks: {} },
      { what: 'Перевод куда-то', kind: 'transfer', day: 12, amount: 70, account: idOf(data, 'Карта'), marks: {} },
    ]);
    expect(notes).toEqual([]);
  });

  it('«На счёт» of a row that is not a transfer is not loaded, with one note per row (Excel does not read it)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), {
      C8: 'Аренда', D8: 'Расход', E8: 'Жильё', F8: 3, G8: 1000, K8: 'Карта', L8: '✓', X8: 'Копилка',
      C9: 'Зарплата', D9: 'Доход', E9: 'Зарплата', F9: 1, G9: 3000, K9: 'Карта', X9: 'Вклад', // no such account: the same note
    });
    const { data, notes, overrides } = await load(wb);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([
      { what: 'Аренда', kind: 'expense', category: 'Жильё', day: 3, amount: 1000, account: idOf(data, 'Карта'), marks: { '2026-10': '✓' } },
      { what: 'Зарплата', kind: 'income', category: 'Зарплата', day: 1, amount: 3000, account: idOf(data, 'Карта'), marks: {} },
    ]);
    expect(notes).toEqual([NOT_TRANSFER('Постоянные', 'X8', 'Копилка'), NOT_TRANSFER('Постоянные', 'X9', 'Вклад')]);
    expect(overrides).toEqual([]);
  });

  it('a row with only «На счёт» is a row with input', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { X9: 'Копилка' });
    const { data, notes } = await load(wb);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([{ what: '', kind: 'expense', amount: 0, marks: {} }]);
    expect(notes).toEqual([
      'Лист «Постоянные», строка 9: нет «Что» — в Excel такая строка не учитывается (кроме итога «в среднем в месяц»); загружено без названия и учитывается',
      NOT_TRANSFER('Постоянные', 'X9', 'Копилка'),
    ]);
  });

  it('the layout before transfers (no «На счёт» header): «Перевод» is an expense, with a note; the column is not read', async () => {
    const wb = tracker(false);
    set(sheet(wb, 'Постоянные'), { C8: 'В копилку', D8: 'Перевод', F8: 5, G8: 500, K8: 'Карта', X8: 'Копилка' });
    const { data, notes } = await load(wb);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([
      { what: 'В копилку', kind: 'expense', day: 5, amount: 500, account: idOf(data, 'Карта'), marks: {} },
    ]);
    expect(notes).toEqual([OLD_TRANSFER('Постоянные', 'D8')]);
  });

  it('a header other than «На счёт» after the months is not «На счёт»', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { X7: 'Заметки', C8: 'В копилку', D8: 'Перевод', F8: 5, G8: 500, K8: 'Карта', X8: 'Копилка' });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]).toMatchObject({ kind: 'expense' });
    expect(data.recurring[0]).not.toHaveProperty('toAccount');
    expect(notes).toEqual([OLD_TRANSFER('Постоянные', 'D8')]);
  });
});

describe('importTracker — the helpers of transfers (Запланированные X, Постоянные AL/AM/AN)', () => {
  it('a constant typed over one is listed in overrides and ignored; below the expansions it is not', async () => {
    const wb = tracker();
    set(sheet(wb, 'Запланированные'), { C10: date('2026-10-07'), D10: 'Расход', F10: 'Еда', G10: 5, P10: { formula: '0' }, X10: -1 });
    set(sheet(wb, 'Постоянные'), { AL8: 'Копилка', AL367: 'x', AL368: 9, AM8: -1, AM367: 1, AM368: 9, AN8: 1, AN97: -1, AN98: 9 });
    const { overrides } = await load(wb);
    expect(overrides).toEqual([
      'Запланированные!X10 = -1',
      'Постоянные!AL8 = Копилка', 'Постоянные!AM8 = -1', 'Постоянные!AL367 = x', 'Постоянные!AM367 = 1',
      'Постоянные!AN8 = 1', 'Постоянные!AN97 = -1',
    ]);
  });
});
