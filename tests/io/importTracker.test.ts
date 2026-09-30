import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import { balances, creditCardId, forecast, monthSummary, payFromId, yearStats } from '../../src/engine';
import type { Data } from '../../src/engine';
import { exportBackup, importBackup } from '../../src/io/backup';
import { isoToExcelDate } from '../../src/io/excel';
import { importTracker, TrackerImportError } from '../../src/io/importTracker';
import type { ImportResult } from '../../src/io/importTracker';
import { row, scenario } from '../engine/scenario';
import { fixture, patchedFixture } from './fixture';

const cents = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 100) / 100);

/** The data with account ids replaced by names and row ids dropped, so two data sets compare. */
function normalise(data: Data) {
  const name = (id: string | undefined) => (id === undefined ? undefined : data.accounts.find((a) => a.id === id)?.name ?? `? ${id}`);
  return {
    schemaVersion: data.schemaVersion,
    settings: data.settings,
    categories: data.categories,
    accounts: data.accounts.map(({ name: n, type, start }) => ({ name: n, type, start })),
    credit: {
      auto: data.credit.auto, closeDay: data.credit.closeDay, payDay: data.credit.payDay,
      card: name(creditCardId(data)), from: name(payFromId(data)),
    },
    operations: data.operations.map(({ id: _id, account, toAccount, ...rest }) => ({ ...rest, account: name(account), toAccount: name(toAccount) })),
    journal: data.journal.map(({ id: _id, account, ...rest }) => ({ ...rest, account: name(account) })),
    recurring: data.recurring.map(({ id: _id, account, ...rest }) => ({ ...rest, account: name(account) })),
    purchases: data.purchases.map(({ id: _id, account, ...rest }) => ({ ...rest, account: name(account) })),
    debts: data.debts.map(({ id: _id, ...rest }) => rest),
  };
}

describe('importTracker — the scenario fixture', () => {
  let result: ImportResult;
  beforeAll(async () => {
    result = await importTracker(fixture());
  });

  it('reads everything the scenario has', () => {
    const expected = scenario();
    // The fixture spells this transfer out in full; everything else is written as in the scenario.
    // row() throws when the scenario no longer has the row, so the patch cannot silently do nothing.
    row(expected.operations, 'o-pogashenie').what = 'Погашение кредитки';
    const got = normalise(result.data);
    const want = normalise(expected);
    expect(got.settings).toEqual(want.settings);
    expect(got.categories).toEqual(want.categories);
    expect(got.accounts).toEqual(want.accounts);
    expect(got.credit).toEqual(want.credit);
    expect(result.data.credit.accountId).toBeUndefined();
    expect(result.data.credit.fromAccountId).toBeUndefined(); // C34 is the default formula
    expect(got.operations).toEqual(want.operations);
    expect(got.journal).toEqual(want.journal);
    expect(got.recurring).toEqual(want.recurring);
    expect(got.purchases).toEqual(want.purchases);
    expect(got).toEqual(want);
  });

  it('has no notes and no numbers typed over formulas', () => {
    expect(result.notes).toEqual([]);
    expect(result.overrides).toEqual([]);
  });

  it('gives every account and row a new id', () => {
    const d = result.data;
    const ids = [d.accounts, d.operations, d.journal, d.recurring, d.purchases, d.debts].flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => scenario().accounts.some((a) => a.id === id))).toBe(false);
  });

  it('yearStats October: 3200 / 3205 / 1180 / 1235, balance 1970, cumulative 1970', () => {
    const oct = yearStats(result.data).months[0];
    expect([oct?.incomePlan, oct?.incomeFact, oct?.expensePlan, oct?.expenseFact, oct?.balance, oct?.cumulative].map(cents))
      .toEqual([3200, 3205, 1180, 1235, 1970, 1970]);
  });

  it('balances on 2026-09-30: Карта 1410, Наличные 80, Кредитка −10', () => {
    expect(balances(result.data, '2026-09-30').rows.map((r) => [r.name, cents(r.now)]))
      .toEqual([['Карта', 1410], ['Наличные', 80], ['Кредитка', -10]]);
  });

  it('forecast ends December at 840', () => {
    const dec = forecast(result.data).months[2];
    expect([dec?.ym, cents(dec?.end)]).toEqual(['2026-12', 840]);
  });
});

// ---------------------------------------------------------------------------------------------
// Small workbooks built in memory

const SHEETS = ['Настройки', 'Операции', 'Счета', 'Журнал', 'Постоянные', 'Покупки', 'Месяц', 'Долги'];
const MONTH_COLS = ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'];

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`no sheet ${name}`);
  return ws;
}

function set(ws: ExcelJS.Worksheet, cells: Record<string, ExcelJS.CellValue>): void {
  for (const [address, value] of Object.entries(cells)) ws.getCell(address).value = value;
}

const date = (iso: string) => isoToExcelDate(iso);

/** A tracker with the current layout: October 2026, accounts Карта / Наличные / Кредитка. */
function tracker(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const name of SHEETS) wb.addWorksheet(name);
  set(sheet(wb, 'Настройки'), {
    C6: 2026, C7: 'Октябрь', C8: 2026, C9: 'Октябрь',
    J6: 'Жильё', J7: 'Продукты', L6: 'Зарплата',
    N6: 'Карта', N7: 'Наличные', N8: 'Кредитка',
  });
  set(sheet(wb, 'Счета'), {
    C10: 'Дебетовая', D10: 1000, C11: 'Наличные', D11: 0, C12: 'Кредитная', D12: 0,
    // the credit block as the generator writes it
    C33: 'Да', C34: { formula: 'Настройки!$N$6' } as ExcelJS.CellFormulaValue, C35: 4, C36: 10,
  });
  const rec = sheet(wb, 'Постоянные');
  set(rec, {
    B7: '№', C7: 'Что', D7: 'Тип', E7: 'Категория', F7: 'День', G7: 'Сумма', H7: 'Раз в\nN мес.',
    I7: 'Действует с', J7: 'по', K7: 'Счёт',
  });
  MONTH_COLS.forEach((col, k) => { rec.getCell(`${col}7`).value = { formula: `Настройки!$X$${6 + k}` }; });
  return wb;
}

async function load(wb: ExcelJS.Workbook): Promise<ImportResult> {
  const written = new Uint8Array(await wb.xlsx.writeBuffer());
  return importTracker(written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength));
}

const idOf = (data: Data, name: string) => data.accounts.find((a) => a.name === name)?.id;

describe('importTracker — not a tracker', () => {
  it('rejects a workbook without the tracker sheets and names the missing ones', async () => {
    const wb = tracker();
    wb.removeWorksheet(sheet(wb, 'Журнал').id);
    wb.removeWorksheet(sheet(wb, 'Долги').id);
    const error = await load(wb).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrackerImportError);
    expect((error as Error).message).toMatch(/^Это не «Трекер и планер расходов» или его старая версия/);
    expect((error as Error).message).toContain('«Журнал», «Долги»');
  });

  it('rejects a file that is not an Excel workbook', async () => {
    const error = await importTracker(new TextEncoder().encode('просто текст').buffer as ArrayBuffer).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrackerImportError);
    expect((error as Error).message).toMatch(/Excel/);
  });

  it('rejects a tracker whose accounting year is not set', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C8: null });
    const error = await load(wb).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TrackerImportError);
    expect((error as Error).message).toContain('Настройки');
  });

  it('rejects «Постоянные» without the «Что» header', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C7: null });
    await expect(load(wb)).rejects.toBeInstanceOf(TrackerImportError);
  });
});

describe('importTracker — settings, categories, accounts, credit', () => {
  it('reads the forecast and accounting months, the cushion and a balances date typed in Счета!C4', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C6: 2026, C7: 'Декабрь', C8: 2026, C9: 'Сентябрь', C11: 250 });
    set(sheet(wb, 'Счета'), { C4: date('2026-09-15') });
    const { data } = await load(wb);
    expect(data.settings).toEqual({ forecastStart: '2026-12', accountingStart: '2026-09', cushion: 250, balancesDate: '2026-09-15' });
  });

  it('without a cushion and with the balances-date formula: cushion 0, first day of the accounting year', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C4: { formula: 'Настройки!$F$8', result: date('2026-10-01') } });
    const { data } = await load(wb);
    expect(data.settings).toEqual({ forecastStart: '2026-10', accountingStart: '2026-10', cushion: 0, balancesDate: '2026-10-01' });
  });

  it('matches limits on «Месяц» to categories by row, before blank categories are skipped', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { J6: 'Жильё', J7: null, J8: 'Продукты', J9: 'Кафе', L6: 'Зарплата', L7: null, L8: 'Премия' });
    set(sheet(wb, 'Месяц'), { C12: 900, C13: 55, C14: 300 });
    const { data } = await load(wb);
    expect(data.categories).toEqual({
      expense: [{ name: 'Жильё', limit: 900 }, { name: 'Продукты', limit: 300 }, { name: 'Кафе' }],
      income: [{ name: 'Зарплата' }, { name: 'Премия' }],
    });
  });

  it('reads accounts by row, skipping blank names; type defaults to debit, start to 0', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { N6: 'Карта', N7: null, N8: 'Кредитка', N9: 'Копилка', N10: 'Кошелёк' });
    set(sheet(wb, 'Счета'), {
      C10: 'Дебетовая', D10: 1000, C11: 'Наличные', D11: 5,
      C12: 'Кредитная', D12: -50, C13: 'Сберегательная', D13: 2000, C14: null, D14: null,
    });
    const { data } = await load(wb);
    expect(data.accounts.map(({ name, type, start }) => [name, type, start])).toEqual([
      ['Карта', 'debit', 1000], ['Кредитка', 'credit', -50], ['Копилка', 'savings', 2000], ['Кошелёк', 'debit', 0],
    ]);
  });

  it('reads the credit card settings; a pay-from account typed as text is matched by name', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C33: 'Нет', C34: 'Наличные', C35: 1, C36: 20 });
    const { data, notes } = await load(wb);
    expect(data.credit).toEqual({ auto: false, fromAccountId: idOf(data, 'Наличные'), closeDay: 1, payDay: 20 });
    expect(notes).toEqual([]);
  });

  it('the generator\'s credit block: auto on, statement on the 4th, payment on the 10th, pay-from left to the engine', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C34: { formula: 'Настройки!$N$6', result: 'Карта' } });
    const { data, notes } = await load(wb);
    expect(data.credit).toEqual({ auto: true, closeDay: 4, payDay: 10 });
    expect(notes).toEqual([]);
  });

  it('empty credit cells are read as Excel reads them: only «Да» turns auto on, a missing day is 1, with notes', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C33: null, C35: null, C36: null });
    const { data, notes } = await load(wb);
    expect(data.credit).toEqual({ auto: false, closeDay: 1, payDay: 1 });
    expect(notes).toEqual([
      'Кредитка: день закрытия выписки (Счета, C35) не указан — взят 1, как в Excel',
      'Кредитка: день списания долга (Счета, C36) не указан — взят 1, как в Excel',
    ]);
  });

  it('an unknown pay-from account is left to the engine with a note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C33: 'Да', C34: 'Сбер' });
    const { data, notes } = await load(wb);
    expect(data.credit.fromAccountId).toBeUndefined();
    expect(data.credit.auto).toBe(true);
    expect(notes).toEqual(['Счёт «Сбер» не найден (Счета, C34)']);
  });

  describe('the default pay-from formula (=Настройки!$N$6) when the first account is the credit card', () => {
    /** Кредитка first (Настройки N6), then Карта and Наличные; C34 is the generator's formula. */
    function cardFirst(): ExcelJS.Workbook {
      const wb = tracker();
      set(sheet(wb, 'Настройки'), { N6: 'Кредитка', N7: 'Карта', N8: 'Наличные' });
      set(sheet(wb, 'Счета'), { C10: 'Кредитная', D10: 0, C11: 'Дебетовая', D11: 1000, C12: 'Наличные', D12: 0 });
      return wb;
    }
    const NOTE = 'Лист «Счета», строка 34, столбец C: в Excel списание идёт со счёта «Кредитка», в приложении — со счёта «Карта»; '
      + 'проверьте «Со счёта» в «Счета и кредитка»';

    it('Excel pays the card from itself, the app from the first other account: one note naming both', async () => {
      const { data, notes } = await load(cardFirst());
      expect(data.credit.fromAccountId).toBeUndefined(); // still left to the engine…
      expect(payFromId(data)).toBe(idOf(data, 'Карта')); // …which takes the first account that is not a credit card
      expect(creditCardId(data)).toBe(idOf(data, 'Кредитка'));
      expect(notes).toEqual([NOTE]);
    });

    it('the same reference written another way is the same formula', async () => {
      const wb = cardFirst();
      set(sheet(wb, 'Счета'), { C34: { formula: "'Настройки'!N6", result: 'Кредитка' } as ExcelJS.CellFormulaValue });
      expect((await load(wb)).notes).toEqual([NOTE]);
    });

    it('no note when they are the same account: the first account is not the credit card', async () => {
      expect((await load(tracker())).notes).toEqual([]);
    });

    it('no note when auto-payment is off: nothing is paid in either', async () => {
      const wb = cardFirst();
      set(sheet(wb, 'Счета'), { C33: 'Нет' });
      expect((await load(wb)).notes).toEqual([]);
    });

    it('no note when the pay-from account is typed in (both pay from it)', async () => {
      const wb = cardFirst();
      set(sheet(wb, 'Счета'), { C34: 'Наличные' });
      const { data, notes } = await load(wb);
      expect(payFromId(data)).toBe(idOf(data, 'Наличные'));
      expect(notes).toEqual([]);
    });

    it('no note when there is no other account to pay from (the app makes no auto-payment)', async () => {
      const wb = cardFirst();
      set(sheet(wb, 'Настройки'), { N7: null, N8: null });
      const { data, notes } = await load(wb);
      expect(payFromId(data)).toBeUndefined();
      expect(notes).toEqual([]);
    });
  });
});

describe('importTracker — Журнал', () => {
  it('takes the accounting month only from a constant month label that differs from the date', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-30'), D10: 'Доход', E10: 'Зарплата', F10: 'ЗП ноябрь', G10: 400, I10: 'Оплачено', J10: 'Карта', M10: 'Ноябрь 2026',
      C11: date('2026-10-05'), D11: 'Расход', F11: 'Еда', G11: 100, M11: { formula: 'C11', result: 'Октябрь 2026' },
      C12: date('2026-10-06'), D12: 'Расход', F12: 'Кафе', G12: 20, M12: 'Октябрь 2026',
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => [r.what, r.month])).toEqual([['ЗП ноябрь', '2026-11'], ['Еда', undefined], ['Кафе', undefined]]);
    expect(data.journal[0]).toMatchObject({ date: '2026-10-30', kind: 'income', category: 'Зарплата', plan: 400, status: 'paid', account: idOf(data, 'Карта') });
    expect(notes).toEqual([]);
  });

  it('a month label that does not parse is noted and the month of the date is used', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 100, M10: 'ноябрь' });
    const { data, notes } = await load(wb);
    expect(data.journal[0]?.month).toBeUndefined();
    expect(notes).toEqual(['Журнал, строка 10: месяц учёта «ноябрь» не распознан — взят месяц даты']);
  });

  it('a month label outside the 12 accounting months is not kept: Excel falls back to the month of the date', async () => {
    const wb = tracker(); // accounting year October 2026 … September 2027
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-05'), D10: 'Расход', F10: 'Раньше', G10: 100, M10: 'Сентябрь 2026',
      C11: date('2026-10-06'), D11: 'Расход', F11: 'Позже', G11: 100, M11: 'Октябрь 2027',
      C12: date('2026-10-07'), D12: 'Расход', F12: 'Последний', G12: 100, M12: 'Сентябрь 2027',
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => [r.what, r.month])).toEqual([['Раньше', undefined], ['Позже', undefined], ['Последний', '2027-09']]);
    expect(data.journal.slice(0, 2).every((r) => !('month' in r))).toBe(true);
    expect(notes).toEqual([
      'Журнал, строка 10: месяц учёта «Сентябрь 2026» не входит в 12 месяцев учёта — взят месяц даты',
      'Журнал, строка 11: месяц учёта «Октябрь 2027» не входит в 12 месяцев учёта — взят месяц даты',
    ]);
  });

  it('reads fact, status, priority; kind other than «Доход» is an expense; a row without a date is not loaded', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-09'), D10: 'Расход', E10: 'Транспорт', F10: 'Штраф', G10: 100, H10: 15, I10: 'Отменено', K10: 'Можно отложить',
      D11: 'Расход', E11: 'Продукты', I11: 'Запланировано', // no date, what, plan or fact: still typed in, so noted
      C12: date('2026-10-10'), F12: 'Возврат', H12: -20, I12: 'Перенесено',
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: '2026-10-09', kind: 'expense', category: 'Транспорт', what: 'Штраф', plan: 100, fact: 15, status: 'cancelled', priority: 'Можно отложить' },
      { date: '2026-10-10', kind: 'expense', what: 'Возврат', fact: -20, status: 'postponed' },
    ]);
    expect(notes).toEqual(['Журнал, строка 11: нет даты — строка не загружена']);
  });

  it('a row without a date is skipped with a note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { D12: 'Расход', F12: 'Аренда', G12: 900 });
    const { data, notes } = await load(wb);
    expect(data.journal).toEqual([]);
    expect(notes).toEqual(['Журнал, строка 12: нет даты — строка не загружена']);
  });
});

describe('importTracker — Операции', () => {
  it('reads the rows with the amount as written', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: 'Расход', E10: 'Продукты', F10: 'Магазин', G10: -30, H10: 'Кредитка',
      C11: date('2026-10-13'), D11: 'Перевод', F11: 'Снятие', G11: 100, H11: 'Карта', I11: 'Наличные',
    });
    const { data, notes } = await load(wb);
    expect(data.operations.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: '2026-10-12', kind: 'expense', category: 'Продукты', what: 'Магазин', amount: -30, account: idOf(data, 'Кредитка') },
      { date: '2026-10-13', kind: 'transfer', what: 'Снятие', amount: 100, account: idOf(data, 'Карта'), toAccount: idOf(data, 'Наличные') },
    ]);
    expect(notes).toEqual([]);
  });

  it('rows with a missing or unreadable date or kind are skipped with a note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), {
      D10: 'Расход', F10: 'Без даты', G10: 5,
      C11: 'вчера', D11: 'Расход', F11: 'Кривая дата', G11: 5,
      C12: date('2026-10-12'), D12: 'Покупка', F12: 'Странный тип', G12: 5,
      C13: date('2026-10-12'), F13: 'Без типа', G13: 5,
      E14: 'Продукты', H14: 'Карта', // no date, what or amount: still typed in, so noted
    });
    const { data, notes } = await load(wb);
    expect(data.operations).toEqual([]);
    expect(notes).toEqual([
      'Операции, строка 10: нет даты — строка не загружена',
      'Операции, строка 11: дата «вчера» не распознана — строка не загружена',
      'Операции, строка 12: тип «Покупка» не распознан — строка не загружена',
      'Операции, строка 13: нет типа — строка не загружена',
      'Операции, строка 14: нет даты — строка не загружена',
    ]);
  });
});

describe('importTracker — Операции «На счёт»', () => {
  it('is read only for transfers: an expense or income ignores column I, without notes', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: 'Расход', F10: 'Магазин', G10: 30, H10: 'Карта', I10: 'Тинькофф',
      C11: date('2026-10-13'), D11: 'Доход', F11: 'Кэшбэк', G11: 5, H11: 'Карта', I11: 'Наличные',
    });
    const { data, notes } = await load(wb);
    expect(data.operations.map((o) => [o.what, o.toAccount])).toEqual([['Магазин', undefined], ['Кэшбэк', undefined]]);
    expect(data.operations.every((o) => !('toAccount' in o))).toBe(true);
    expect(notes).toEqual([]);
  });
});

describe('importTracker — unknown accounts', () => {
  it('keeps the row without an account and notes the name', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 100, J10: 'Сбер' });
    set(sheet(wb, 'Операции'), { C10: date('2026-10-13'), D10: 'Перевод', F10: 'Снятие', G10: 100, H10: 'карта', I10: 'Тинькофф' });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, K8: 'Сбер' });
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', E7: 500, P7: 'Сбер' });
    const { data, notes } = await load(wb);
    expect(data.journal[0]?.what).toBe('Еда');
    expect(data.journal[0]?.account).toBeUndefined();
    expect(data.operations[0]?.account).toBe(idOf(data, 'Карта')); // names match like in Excel, ignoring case
    expect(data.operations[0]?.toAccount).toBeUndefined();
    expect(data.recurring[0]?.account).toBeUndefined();
    expect(data.purchases[0]?.account).toBeUndefined();
    expect(notes).toEqual([
      'Счёт «Тинькофф» не найден (Операции, строка 10)',
      'Счёт «Сбер» не найден (Журнал, строка 10)',
      'Счёт «Сбер» не найден (Постоянные, строка 8)',
      'Счёт «Сбер» не найден (Покупки, строка 7)',
    ]);
  });
});

describe('importTracker — numbers typed over formulas', () => {
  it('lists constants in formula cells and ignores them', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { E10: 1234, I21: 'долг', H11: { formula: 'N($D11)', result: 0 } });
    set(sheet(wb, 'Журнал'), { B10: 1, L1509: 3, N20: 'дубль', P10: 100, U30: 7, M10: 'Ноябрь 2026', O10: 5 });
    set(sheet(wb, 'Операции'), { B10: 1, J1009: 'Октябрь 2026', K10: 'дубль', Q10: 5, P10: 7 }); // P is not listed
    set(sheet(wb, 'Покупки'), { R12: 40, S12: 1 }); // the plan helper R is listed (it tells where the formulas end), S not
    set(sheet(wb, 'Настройки'), { C10: 2500 });
    const { overrides } = await load(wb);
    expect(overrides).toEqual([
      'Настройки!C10 = 2500',
      'Операции!B10 = 1', 'Операции!K10 = дубль', 'Операции!Q10 = 5', 'Операции!J1009 = Октябрь 2026',
      'Счета!E10 = 1234', 'Счета!I21 = долг',
      'Журнал!B10 = 1', 'Журнал!P10 = 100', 'Журнал!N20 = дубль', 'Журнал!U30 = 7', 'Журнал!L1509 = 3',
      'Покупки!R12 = 40',
    ]);
  });
});

describe('importTracker — the helpers of savings accounts outside the balance (excel-planners 1aff566)', () => {
  // The flag «в балансе» of a row's account: Журнал V, Операции T, Постоянные AF (accounting-year expansion, rows
  // 8–367) and AK (forecast expansion, 8–97), Покупки U; Операции U is a transfer's effect on the free money
  // (build_tracker.py 43–45, 233, 334–338, 659, 682, 731).
  it('a constant typed over one is listed in overrides and ignored; below the expansions it is not', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { V10: 0, V1509: 1 });
    set(sheet(wb, 'Операции'), { T10: 0, U12: -300 });
    set(sheet(wb, 'Постоянные'), { AF8: 1, AF367: 0, AF368: 9, AK8: 1, AK97: 0, AK98: 9 });
    set(sheet(wb, 'Покупки'), { U7: 0, U18: 1 });
    const { overrides } = await load(wb);
    expect(overrides).toEqual([
      'Операции!T10 = 0', 'Операции!U12 = -300',
      'Журнал!V10 = 0', 'Журнал!V1509 = 1',
      'Постоянные!AF8 = 1', 'Постоянные!AF367 = 0', 'Постоянные!AK8 = 1', 'Постоянные!AK97 = 0',
      'Покупки!U7 = 0', 'Покупки!U18 = 1',
    ]);
  });
});

const unreadable = (sheetName: string, address: string, value: string): string => {
  const [, col, row] = /^([A-Z]+)(\d+)$/.exec(address) ?? [];
  return `Лист «${sheetName}», строка ${row}, столбец ${col}: «${value}» не распознано — не загружено`;
};

const asText = (sheetName: string, address: string, value: string): string => {
  const [, col, row] = /^([A-Z]+)(\d+)$/.exec(address) ?? [];
  return `Лист «${sheetName}», строка ${row}, столбец ${col}: «${value}» — в Excel это текст и не учитывается; загружено как число`;
};

/** «Лист «X», строка N, столбец Y» for an address like «F8». */
const at = (sheetName: string, address: string): string => {
  const [, col, row] = /^([A-Z]+)(\d+)$/.exec(address) ?? [];
  return `Лист «${sheetName}», строка ${row}, столбец ${col}`;
};

/**
 * The note of a row that is loaded although its name («Что») is empty, on a sheet whose formulas count such a
 * row too (Журнал, Операции, Долги).
 */
const noWhat = (sheetName: string, row: number, header = 'Что'): string =>
  `Лист «${sheetName}», строка ${row}: нет «${header}» — загружено без названия`;

/** The same, on a sheet whose formulas skip a row without a name (Покупки not bought): the app counts it. */
const noWhatExcelSkips = (sheetName: string, row: number, header = 'Что'): string =>
  `Лист «${sheetName}», строка ${row}: нет «${header}» — в Excel такая строка не учитывается; загружено без названия и учитывается`;

/**
 * Постоянные: every helper of the expansions starts with IF($C="",…), so Excel skips a row without «Что», except the
 * display-only «в среднем в месяц» totals (G38, G39: SUMPRODUCT over D, G and H, which do not look at C).
 */
const noWhatRecurring = (row: number): string =>
  `Лист «Постоянные», строка ${row}: нет «Что» — в Excel такая строка не учитывается (кроме итога «в среднем в месяц»); загружено без названия и учитывается`;

/** A bought purchase without a name: Excel counts its fact (column S) but not its plan (R is IF(C="",0,…)). */
const noWhatExcelFactOnly = (row: number): string =>
  `Лист «Покупки», строка ${row}: нет «Что покупаем» — в Excel у такой строки учитывается только факт, без плана; загружено без названия и учитывается`;

/** The one note of a number typed as text that does not fit its range: what it was, what the app did. */
const textNoFit = (sheetName: string, address: string, value: string, fit: string, outcome: string): string =>
  `${at(sheetName, address)}: «${value}» — текст и не ${fit} — ${outcome}`;

/** The one note of a text credit day: what Excel does with text (day 1) and what the app loaded. */
const textCreditDay = (address: string, value: string, excel: string, app: string): string =>
  `${at('Счета', address)}: «${value}» — в Excel это текст${excel}; ${app}`;

describe('importTracker — values that do not parse are noted, never dropped silently', () => {
  it('Операции G: the row is kept with amount 0', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', F10: 'Магазин', G10: 'много', H10: 'Карта' });
    const { data, notes } = await load(wb);
    expect(data.operations.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: '2026-10-12', kind: 'expense', what: 'Магазин', amount: 0, account: idOf(data, 'Карта') },
    ]);
    expect(notes).toEqual([unreadable('Операции', 'G10', 'много')]);
  });

  it('Журнал G, H, I: plan, fact and status are left out (an error result shows as its text)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 'сто',
      H10: { formula: 'G10*2', result: { error: '#VALUE!' } } as ExcelJS.CellFormulaValue, I10: 'Оплачен',
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map(({ id: _id, ...rest }) => rest)).toEqual([{ date: '2026-10-05', kind: 'expense', what: 'Еда' }]);
    expect(notes).toEqual([unreadable('Журнал', 'G10', 'сто'), unreadable('Журнал', 'H10', '#VALUE!'), unreadable('Журнал', 'I10', 'Оплачен')]);
  });

  it('Постоянные «День», «Сумма», «Раз в N мес.», «Действует с», «по» and (added) month marks', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), {
      C8: 'Аренда', D8: 'Расход', F8: 'пятое', G8: 'девятьсот', H8: 'квартал', I8: 'скоро', J8: '31.02.2027', L8: 'x', M8: '✓',
    });
    const { data, notes } = await load(wb);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([
      { what: 'Аренда', kind: 'expense', amount: 0, marks: { '2026-11': '✓' } },
    ]);
    expect(notes).toEqual([
      unreadable('Постоянные', 'F8', 'пятое'), unreadable('Постоянные', 'G8', 'девятьсот'), unreadable('Постоянные', 'H8', 'квартал'),
      unreadable('Постоянные', 'I8', 'скоро'), unreadable('Постоянные', 'J8', '31.02.2027'), unreadable('Постоянные', 'L8', 'x'),
    ]);
  });

  it('Покупки E, F, G, O and (added) «Куплено» other than ✓', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', E7: 'дорого', F7: 'n/a', G7: 'весной', N7: 'да', O7: '?' });
    const { data, notes } = await load(wb);
    expect(data.purchases.map(({ id: _id, ...rest }) => rest)).toEqual([{ what: 'Ноутбук', bought: false }]);
    expect(notes).toEqual([
      unreadable('Покупки', 'E7', 'дорого'), unreadable('Покупки', 'F7', 'n/a'), unreadable('Покупки', 'G7', 'весной'),
      unreadable('Покупки', 'N7', 'да'), unreadable('Покупки', 'O7', '?'),
    ]);
  });

  it('Долги E, F, H, I, J', async () => {
    const wb = tracker();
    set(sheet(wb, 'Долги'), { C7: 'Ипотека', E7: 'много', F7: 'x', H7: '5 процентов', I7: 'полтыщи', J7: 'завтра' });
    const { data, notes } = await load(wb);
    expect(data.debts.map(({ id: _id, ...rest }) => rest)).toEqual([{ name: 'Ипотека' }]);
    expect(notes).toEqual([
      unreadable('Долги', 'E7', 'много'), unreadable('Долги', 'F7', 'x'), unreadable('Долги', 'H7', '5 процентов'),
      unreadable('Долги', 'I7', 'полтыщи'), unreadable('Долги', 'J7', 'завтра'),
    ]);
  });

  it('Настройки C11, Счета C4, account type and start, and (added) Счета C33, C35 and «Месяц» limits', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C11: 'много' });
    set(sheet(wb, 'Счета'), { C4: 'вчера', C10: 'Дебет', D10: 'тысяча', C33: 'Yes', C35: 'четвёртое' });
    set(sheet(wb, 'Месяц'), { C12: 'нет', C13: 300 });
    const { data, notes } = await load(wb);
    expect(data.settings).toMatchObject({ cushion: 0, balancesDate: '2026-10-01' });
    expect(data.accounts[0]).toMatchObject({ name: 'Карта', type: 'debit', start: 0 });
    expect(data.credit).toEqual({ auto: false, closeDay: 1, payDay: 10 });
    expect(data.categories.expense).toEqual([{ name: 'Жильё' }, { name: 'Продукты', limit: 300 }]);
    expect(notes).toEqual([
      unreadable('Настройки', 'C11', 'много'),
      unreadable('Счета', 'C4', 'вчера'), unreadable('Счета', 'C10', 'Дебет'), unreadable('Счета', 'D10', 'тысяча'),
      unreadable('Счета', 'C33', 'Yes'),
      'Кредитка: день закрытия выписки (Счета, C35) «четвёртое» не распознан — взят 1, как в Excel',
      unreadable('Месяц', 'C12', 'нет'),
    ]);
  });

  it('notes come in the order of the tracker\'s tabs', async () => {
    const wb = tracker();
    set(sheet(wb, 'Долги'), { C7: 'Ипотека', E7: 'много' });
    set(sheet(wb, 'Месяц'), { C12: 'нет' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), F10: 'Еда', G10: 'сто' });
    set(sheet(wb, 'Счета'), { D10: 'тысяча' });
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', F10: 'Магазин', G10: 'много' });
    set(sheet(wb, 'Настройки'), { C11: 'много' });
    const { notes } = await load(wb);
    expect(notes).toEqual([
      unreadable('Настройки', 'C11', 'много'), unreadable('Операции', 'G10', 'много'), unreadable('Счета', 'D10', 'тысяча'),
      unreadable('Журнал', 'G10', 'сто'), unreadable('Месяц', 'C12', 'нет'), unreadable('Долги', 'E7', 'много'),
    ]);
  });
});

describe('importTracker — error values', () => {
  it('shows an Excel error value by its text, e.g. «#N/A»', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { E10: { error: '#N/A' } as ExcelJS.CellErrorValue });
    const { overrides } = await load(wb);
    expect(overrides).toEqual(['Счета!E10 = #N/A']);
  });
});

describe('importTracker — Постоянные', () => {
  it('maps the current layout by headers: every N months, dates, account, marks by accounting month', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), {
      C8: 'Аренда', D8: 'Расход', E8: 'Жильё', F8: 5, G8: 900, H8: 1, I8: date('2026-10-01'), J8: date('2027-06-30'), K8: 'Карта', L8: '✓', M8: 950, N8: '12,5',
      C9: 'Страховка', D9: 'Расход', G9: 30, H9: 3,
      C10: null, G10: 500, // no «Что»: loaded without a name, with a note
      C11: 'ЗП бонус', D11: 'Доход', G11: 200, W11: ' ✓ ',
    });
    const { data, notes } = await load(wb);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([
      {
        what: 'Аренда', kind: 'expense', category: 'Жильё', day: 5, amount: 900, from: '2026-10-01', to: '2027-06-30',
        account: idOf(data, 'Карта'), marks: { '2026-10': '✓', '2026-11': 950, '2026-12': 12.5 },
      },
      { what: 'Страховка', kind: 'expense', amount: 30, every: 3, marks: {} },
      { what: '', kind: 'expense', amount: 500, marks: {} },
      { what: 'ЗП бонус', kind: 'income', amount: 200, marks: { '2027-09': '✓' } },
    ]);
    expect(notes).toEqual([asText('Постоянные', 'N8', '12,5'), noWhatRecurring(10), spacedCheck('Постоянные', 'W11', ' ✓ ')]);
  });

  it('maps the old layout (no «Раз в N мес.» and «Счёт», months from column J)', async () => {
    const wb = tracker();
    const rec = sheet(wb, 'Постоянные');
    for (let col = 2; col <= 30; col++) rec.getRow(7).getCell(col).value = null;
    set(rec, { B7: '№', C7: 'Что', D7: 'Тип', E7: 'Категория', F7: 'День', G7: 'Сумма', H7: 'Действует с', I7: 'по' });
    ['J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'].forEach((col, k) => {
      rec.getCell(`${col}7`).value = { formula: `Настройки!$X$${6 + k}` };
    });
    // Columns to the right of the month grid repeat some headers; they must not be picked up.
    set(rec, { W7: 'Тип', X7: 'Категория', Y7: 'Счёт', Y8: 'Карта' });
    set(rec, { C8: 'Аренда', D8: 'Расход', E8: 'Жильё', F8: 5, G8: 900, H8: date('2026-10-01'), I8: null, J8: '✓', K8: 950 });
    const { data } = await load(wb);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([
      { what: 'Аренда', kind: 'expense', category: 'Жильё', day: 5, amount: 900, from: '2026-10-01', marks: { '2026-10': '✓', '2026-11': 950 } },
    ]);
  });
});

describe('importTracker — Покупки and Долги', () => {
  it('reads purchases', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), {
      C7: 'Ноутбук', D7: 'Техника', E7: 500, F7: 100, G7: date('2026-12-10'), L7: 'Желательно', N7: '✓', O7: 480, P7: 'Карта',
      C8: 'Велосипед', E8: 300,
      C9: null, E9: 50, // no «Что»: loaded without a name, with a note
    });
    const { data, notes } = await load(wb);
    expect(data.purchases.map(({ id: _id, ...rest }) => rest)).toEqual([
      { what: 'Ноутбук', category: 'Техника', cost: 500, saved: 100, date: '2026-12-10', priority: 'Желательно', bought: true, price: 480, account: idOf(data, 'Карта') },
      { what: 'Велосипед', cost: 300, bought: false },
      { what: '', cost: 50, bought: false },
    ]);
    expect(notes).toEqual([noWhatExcelSkips('Покупки', 9, 'Что покупаем')]);
  });

  it('reads debts', async () => {
    const wb = tracker();
    set(sheet(wb, 'Долги'), {
      C7: 'Ипотека', D7: 'Банк', E7: 10000, F7: 2000, H7: 0.05, I7: 500, J7: date('2026-11-01'),
      C8: 'Другу', E8: 100,
      C9: null, E9: 50, // no name: loaded without one, with a note
    });
    const { data, notes } = await load(wb);
    expect(data.debts.map(({ id: _id, ...rest }) => rest)).toEqual([
      { name: 'Ипотека', whom: 'Банк', total: 10000, paid: 2000, rate: 0.05, payment: 500, nextDate: '2026-11-01' },
      { name: 'Другу', total: 100 },
      { name: '', total: 50 },
    ]);
    expect(notes).toEqual([noWhat('Долги', 9, 'Название')]);
  });
});

// ---------------------------------------------------------------------------------------------
// A row without a name: loaded with '' and a note, never skipped silently

describe('importTracker — a row with input but no name is loaded without a name, with a note', () => {
  it.each([
    ['«Тип»', 'D8', 'Доход'], ['«Категория»', 'E8', 'Жильё'], ['«День»', 'F8', 5], ['«Сумма»', 'G8', 900], ['«Раз в N мес.»', 'H8', 3],
    ['«Действует с»', 'I8', new Date(Date.UTC(2026, 9, 1))], ['«по»', 'J8', new Date(Date.UTC(2027, 5, 30))], ['«Счёт»', 'K8', 'Карта'],
    ['the first month mark', 'L8', '✓'], ['the last month mark', 'W8', 7],
  ])('Постоянные: %s alone keeps the row', async (_what, address, value) => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { [address]: value });
    const { data, notes } = await load(wb);
    expect(data.recurring).toHaveLength(1);
    expect(data.recurring[0]?.what).toBe('');
    expect(notes).toEqual([noWhatRecurring(8)]);
  });

  it('Постоянные: spaces in «Что» are no name for the app, but Excel counts the row ($C="" is false): the plain note, first in its row', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: '   ', F8: 'пятое', G8: 5 });
    const { data, notes } = await load(wb);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([{ what: '', kind: 'expense', amount: 5, marks: {} }]);
    expect(notes).toEqual([noWhat('Постоянные', 8), unreadable('Постоянные', 'F8', 'пятое')]);
  });

  it.each([
    ['a non-breaking space', ' '], ['a line break', '\n'], ['a formula that gives a space', { formula: '" "', result: ' ' }],
  ])('Постоянные: %s in «Что» is not empty for Excel either: the plain note', async (_what, value) => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: value as ExcelJS.CellValue, G8: 900 });
    const { data, notes } = await load(wb);
    expect(data.recurring.map((r) => r.what)).toEqual(['']);
    expect(notes).toEqual([noWhat('Постоянные', 8)]);
  });

  it('Постоянные: a formula that gives "" in «Что» is empty for Excel: it skips the row', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: { formula: '""', result: '' } as ExcelJS.CellFormulaValue, G8: 900 });
    const { data, notes } = await load(wb);
    expect(data.recurring.map((r) => r.what)).toEqual(['']);
    expect(notes).toEqual([noWhatRecurring(8)]);
  });

  it('Покупки: spaces in «Что покупаем» are a name for Excel, bought or not (plan R = IF(C="",0,N(E)) counts): the plain note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { C7: '  ', E7: 500, C8: ' ', E8: 300, N8: '✓', O8: 280 });
    const { data, notes } = await load(wb);
    expect(data.purchases.map((p) => [p.what, p.bought])).toEqual([['', false], ['', true]]);
    expect(notes).toEqual([noWhat('Покупки', 7, 'Что покупаем'), noWhat('Покупки', 8, 'Что покупаем')]);
  });

  it('Покупки without a name: whether Excel sees it bought is decided on the raw «Куплено» (N="✓" does not trim)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { E7: 300, N7: ' ✓ ' });
    const { data, notes } = await load(wb);
    expect(data.purchases.map((p) => [p.what, p.bought])).toEqual([['', true]]); // the app still takes it as bought
    // Excel: R = 0 (no name), S = 0 (N is not "✓"): the row is not counted at all
    expect(notes[0]).toBe(noWhatExcelSkips('Покупки', 7, 'Что покупаем'));
  });

  it('Постоянные: a row with nothing in it (only its number, or spaces) is not a row: no row, no note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { B8: 1, C8: '  ', K8: ' ', B9: 2, Y9: { formula: 'IF(C9="","",1)', result: '' } as ExcelJS.CellFormulaValue });
    const { data, notes } = await load(wb);
    expect(data.recurring).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('Журнал: a row with a date and an amount but no «Что» is loaded with a note (a date and no name still counts as a row)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', E10: 'Продукты', G10: 'сто', H10: 40 });
    const { data, notes } = await load(wb);
    expect(data.journal.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: '2026-10-05', kind: 'expense', category: 'Продукты', what: '', fact: 40 },
    ]);
    expect(notes).toEqual([noWhat('Журнал', 10), unreadable('Журнал', 'G10', 'сто')]);
  });

  it('Операции: a row with a date and an amount but no «Что» is loaded with a note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', G10: 30, H10: 'Карта' });
    const { data, notes } = await load(wb);
    expect(data.operations.map(({ id: _id, ...rest }) => rest)).toEqual([
      { date: '2026-10-12', kind: 'expense', what: '', amount: 30, account: idOf(data, 'Карта') },
    ]);
    expect(notes).toEqual([noWhat('Операции', 10)]);
  });

  it('Журнал and Операции: a row without a date is still skipped (and only noted as that), whatever else it holds', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { D10: 'Расход', G10: 100 });
    set(sheet(wb, 'Операции'), { D10: 'Расход', G10: 30 });
    const { data, notes } = await load(wb);
    expect([data.journal, data.operations]).toEqual([[], []]);
    expect(notes).toEqual(['Операции, строка 10: нет даты — строка не загружена', 'Журнал, строка 10: нет даты — строка не загружена']);
  });

  it.each([
    ['«Категория»', 'D7', 'Техника'], ['«Стоимость»', 'E7', 500], ['«Уже отложено»', 'F7', 10],
    ['«Дата покупки»', 'G7', new Date(Date.UTC(2026, 11, 10))], ['«Приоритет»', 'L7', 'Желательно'],
    ['«Цена факт»', 'O7', 480], ['«Счёт»', 'P7', 'Карта'],
  ])('Покупки: %s alone keeps the row', async (_what, address, value) => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { [address]: value });
    const { data, notes } = await load(wb);
    expect(data.purchases).toHaveLength(1);
    expect(data.purchases[0]?.what).toBe('');
    expect(notes).toEqual([noWhatExcelSkips('Покупки', 7, 'Что покупаем')]);
  });

  it('Покупки: «Куплено» alone keeps the row; bought, Excel counts its fact but not its plan', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { N7: '✓' });
    const { data, notes } = await load(wb);
    expect(data.purchases.map(({ id: _id, ...rest }) => rest)).toEqual([{ what: '', bought: true }]);
    expect(notes).toEqual([noWhatExcelFactOnly(7)]);
  });

  it('Покупки: the formulas of the row are not input: a row with only them is not a row', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), {
      B7: 1, H7: { formula: 'IF(E7="","",MAX(E7-F7,0))', result: '' } as ExcelJS.CellFormulaValue,
      K7: { formula: 'IF(E7="","",1)', result: 0 } as ExcelJS.CellFormulaValue,
    });
    const { data, notes } = await load(wb);
    expect(data.purchases).toEqual([]);
    expect(notes).toEqual([]);
  });

  it.each([
    ['«Кому / банк»', 'D7', 'Банк'], ['«Сумма долга»', 'E7', 10000], ['«Выплачено»', 'F7', 2000], ['«Ставка»', 'H7', 0.05],
    ['«Платёж/мес»', 'I7', 500], ['«След. платёж»', 'J7', new Date(Date.UTC(2026, 10, 1))],
  ])('Долги: %s alone keeps the row', async (_what, address, value) => {
    const wb = tracker();
    set(sheet(wb, 'Долги'), { [address]: value });
    const { data, notes } = await load(wb);
    expect(data.debts).toHaveLength(1);
    expect(data.debts[0]?.name).toBe('');
    expect(notes).toEqual([noWhat('Долги', 7, 'Название')]);
  });

  it('Долги: the formulas of the row are not input: a row with only them is not a row', async () => {
    const wb = tracker();
    set(sheet(wb, 'Долги'), {
      B7: 1, G7: { formula: 'IF(E7="","",MAX(E7-F7,0))', result: '' } as ExcelJS.CellFormulaValue,
      L7: { formula: 'IF(E7="","","Открыт")', result: '' } as ExcelJS.CellFormulaValue,
    });
    const { data, notes } = await load(wb);
    expect(data.debts).toEqual([]);
    expect(notes).toEqual([]);
  });

  // What the tracker's formulas do with a row without a name (excel-planners/src/build_tracker.py):
  // Постоянные — every helper of the expansions starts with IF($C="",0,…) or IF($C="","",…): the row is not counted,
  //   except in the display-only «в среднем в месяц» totals (G38, G39: SUMPRODUCT over D, G and H);
  // Покупки — plan R = IF(C="",0,N(E)), fact S = IF(N="✓",IF(O<>"",O,N(E)),0): a bought row counts, its plan does not;
  // Журнал (P…U), Операции (P…R), Долги (G, K, L, the totals) never look at the name: the row counts.
  it('the note says what Excel does: Постоянные and Покупки not bought skip the row, a bought purchase keeps only its fact', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { G8: 900, K8: 'Карта' });
    set(sheet(wb, 'Покупки'), {
      E7: 500, G7: date('2026-12-10'), // not bought
      E8: 300, G8: date('2026-11-05'), N8: '✓', O8: 280, P8: 'Карта', // bought
      E9: 50, N9: 'да', // «Куплено» not read: not bought, the name note first, then the one about N9
    });
    const { data, notes } = await load(wb);
    expect(data.purchases.map((p) => [p.what, p.bought])).toEqual([['', false], ['', true], ['', false]]);
    expect(notes).toEqual([
      noWhatRecurring(8),
      noWhatExcelSkips('Покупки', 7, 'Что покупаем'),
      noWhatExcelFactOnly(8),
      noWhatExcelSkips('Покупки', 9, 'Что покупаем'), unreadable('Покупки', 'N9', 'да'),
    ]);
  });

  it('the note only says the row was loaded without a name where Excel counts it too: Журнал, Операции, Долги', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', G10: 100 });
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', G10: 30, H10: 'Карта' });
    set(sheet(wb, 'Долги'), { E7: 10000 });
    const { notes } = await load(wb);
    expect(notes).toEqual([noWhat('Операции', 10), noWhat('Журнал', 10), noWhat('Долги', 7, 'Название')]);
  });

  it('what was loaded without a name can be backed up and restored', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { G8: 900, L8: '✓' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', G10: 100 });
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', G10: 30, H10: 'Карта' });
    set(sheet(wb, 'Покупки'), { E7: 500 });
    set(sheet(wb, 'Долги'), { E7: 10000 });
    const { data } = await load(wb);
    expect([data.recurring, data.journal, data.operations, data.purchases].map((rows) => rows.map((r) => r.what))).toEqual([[''], [''], [''], ['']]);
    expect(data.debts.map((r) => r.name)).toEqual(['']);
    expect(await importBackup(await exportBackup(data, '2026-10-01T09:30:00.000Z'))).toStrictEqual(data);
  });
});

// ---------------------------------------------------------------------------------------------
// A name that is not text

/** The one note of a name («Что», «Название») that holds a value other than text. */
const notText = (sheetName: string, address: string, value: string): string =>
  `${at(sheetName, address)}: «${value}» — не текст; загружено как текст`;

describe('importTracker — a name that is not text is loaded as it is shown, with one note', () => {
  it.each([
    ['TRUE', true, 'true'], ['an error', { error: '#N/A' }, '#N/A'], ['a date', date('2026-10-05'), '2026-10-05'],
    ['a number', 12.5, '12.5'], ['a formula that gives a number', { formula: '2+3', result: 5 }, '5'],
  ])('%s, on every sheet', async (_what, value, shownAs) => {
    const wb = tracker();
    const v = value as ExcelJS.CellValue;
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', F10: v, G10: 30, H10: 'Карта' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: v, G10: 100 });
    set(sheet(wb, 'Постоянные'), { C8: v, G8: 900 });
    set(sheet(wb, 'Покупки'), { C7: v, E7: 500 });
    set(sheet(wb, 'Долги'), { C7: v, E7: 10000 });
    const { data, notes } = await load(wb);
    expect([data.operations, data.journal, data.recurring, data.purchases].map((rows) => rows.map((r) => r.what)))
      .toEqual([[shownAs], [shownAs], [shownAs], [shownAs]]);
    expect(data.debts.map((r) => r.name)).toEqual([shownAs]);
    expect(notes).toEqual([
      notText('Операции', 'F10', shownAs), notText('Журнал', 'F10', shownAs), notText('Постоянные', 'C8', shownAs),
      notText('Покупки', 'C7', shownAs), notText('Долги', 'C7', shownAs),
    ]);
  });

  it('text, rich text and a formula that gives text are text: no note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), {
      C8: ' Аренда ', G8: 900, C9: { richText: [{ text: 'Свя' }, { text: 'зь' }] }, G9: 20,
      C10: { formula: '"Под"&"писка"', result: 'Подписка' } as ExcelJS.CellFormulaValue, G10: 5,
    });
    const { data, notes } = await load(wb);
    expect(data.recurring.map((r) => r.what)).toEqual(['Аренда', 'Связь', 'Подписка']);
    expect(notes).toEqual([]);
  });

  it('a row whose only input is such a name is a row', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), { F10: date('2026-10-05') });
    set(sheet(wb, 'Журнал'), { F10: true });
    set(sheet(wb, 'Постоянные'), { C8: true });
    set(sheet(wb, 'Покупки'), { C7: 5 });
    set(sheet(wb, 'Долги'), { C7: { error: '#REF!' } as ExcelJS.CellErrorValue });
    const { data, notes } = await load(wb);
    expect([data.operations, data.journal]).toEqual([[], []]);
    expect(data.recurring.map(({ id: _id, ...rest }) => rest)).toEqual([{ what: 'true', kind: 'expense', amount: 0, marks: {} }]);
    expect(data.purchases.map(({ id: _id, ...rest }) => rest)).toEqual([{ what: '5', bought: false }]);
    expect(data.debts.map(({ id: _id, ...rest }) => rest)).toEqual([{ name: '#REF!' }]);
    expect(notes).toEqual([
      'Операции, строка 10: нет даты — строка не загружена', 'Журнал, строка 10: нет даты — строка не загружена',
      notText('Постоянные', 'C8', 'true'), notText('Покупки', 'C7', '5'), notText('Долги', 'C7', '#REF!'),
    ]);
    expect(await importBackup(await exportBackup(data, '2026-10-01T09:30:00.000Z'))).toStrictEqual(data);
  });

  it('the name note comes first among the notes of its row', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 7, F8: 'пятое', G8: 900 });
    const { notes } = await load(wb);
    expect(notes).toEqual([notText('Постоянные', 'C8', '7'), unreadable('Постоянные', 'F8', 'пятое')]);
  });
});

// ---------------------------------------------------------------------------------------------
// A ✓ with spaces around it

/** The one note of a ✓ with spaces around it: the app takes it as ✓, Excel's ="✓" does not (it does not trim). */
const spacedCheck = (sheetName: string, address: string, raw: string): string =>
  `${at(sheetName, address)}: «${raw}» — в Excel с пробелами это не отметка; загружено как ✓`;

describe('importTracker — a ✓ with spaces around it is loaded as ✓, with one note: Excel\'s ="✓" does not match it', () => {
  it('Покупки «Куплено» (Excel: S = IF(N="✓",…) — not bought there)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), {
      C7: 'Ноутбук', E7: 500, N7: ' ✓ ', O7: 480, P7: 'Карта',
      C8: 'Велосипед', E8: 300, N8: '✓ ',
    });
    const { data, notes } = await load(wb);
    expect(data.purchases.map((p) => [p.what, p.bought, p.price])).toEqual([['Ноутбук', true, 480], ['Велосипед', true, undefined]]);
    expect(notes).toEqual([spacedCheck('Покупки', 'N7', ' ✓ '), spacedCheck('Покупки', 'N8', '✓ ')]);
  });

  it('Постоянные month marks (Excel: IF(mark="✓",N($G),IF(ISNUMBER(mark),mark,0)) — nothing paid there)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), {
      C8: 'Аренда', G8: 900, L8: ' ✓', M8: '✓', N8: { formula: '" ✓ "', result: ' ✓ ' } as ExcelJS.CellFormulaValue, O8: 950,
    });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]?.marks).toEqual({ '2026-10': '✓', '2026-11': '✓', '2026-12': '✓', '2027-01': 950 });
    expect(notes).toEqual([spacedCheck('Постоянные', 'L8', ' ✓'), spacedCheck('Постоянные', 'N8', ' ✓ ')]);
  });

  it('a line break or a tab around the ✓ is shown as a space, so the note stays on one line', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', N7: '✓\n' });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, L8: '\t✓' });
    const { data, notes } = await load(wb);
    expect([data.purchases[0]?.bought, data.recurring[0]?.marks]).toEqual([true, { '2026-10': '✓' }]);
    expect(notes).toEqual([spacedCheck('Постоянные', 'L8', ' ✓'), spacedCheck('Покупки', 'N7', '✓ ')]);
  });

  it('a clean ✓ (typed, or given by a formula) gets no note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', N7: '✓', C8: 'Велосипед', N8: { formula: '"✓"', result: '✓' } as ExcelJS.CellFormulaValue });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, L8: '✓', M8: { formula: '"✓"', result: '✓' } as ExcelJS.CellFormulaValue });
    const { data, notes } = await load(wb);
    expect(data.purchases.map((p) => p.bought)).toEqual([true, true]);
    expect(data.recurring[0]?.marks).toEqual({ '2026-10': '✓', '2026-11': '✓' });
    expect(notes).toEqual([]);
  });

  it('a Покупки row without a name and « ✓ »: Excel counts none of it (no plan without a name, no fact without ✓); the name note first', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { E7: 300, N7: ' ✓ ', O7: 280 });
    const { data, notes } = await load(wb);
    expect(data.purchases.map(({ id: _id, ...rest }) => rest)).toEqual([{ what: '', cost: 300, bought: true, price: 280 }]);
    expect(notes).toEqual([noWhatExcelSkips('Покупки', 7, 'Что покупаем'), spacedCheck('Покупки', 'N7', ' ✓ ')]);
  });
});

// ---------------------------------------------------------------------------------------------
// A label with spaces around it (a type, a status, «Да», a month)

/** The one note of a label the app matched after trimming, where Excel's formulas (which do not trim) look for it. */
const spacedLabel = (sheetName: string, address: string, raw: string, label: string): string =>
  `${at(sheetName, address)}: «${raw}» — в Excel с пробелами не распознаётся; загружено как «${label}»`;

// Excel's =, SUMIFS, COUNTIFS and MATCH ignore letter case but not spaces (excel-planners/src/build_tracker.py).
describe('importTracker — a label with spaces around it is matched, with one note where Excel\'s formulas look for it', () => {
  it('Счета «Тип»: all four types are looked for (SUMIFS "Дебетовая", "Наличные", "Сберегательная"; COUNTIFS "Сберегательная" and "Кредитная"; MATCH "Кредитная")', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { N9: 'Копилка' });
    set(sheet(wb, 'Счета'), { C10: ' Дебетовая', D10: 1000, C11: 'Наличные ', C12: ' кредитная ', C13: '\tСберегательная', D13: 50 });
    const { data, notes } = await load(wb);
    expect(data.accounts.map((a) => [a.name, a.type])).toEqual([['Карта', 'debit'], ['Наличные', 'cash'], ['Кредитка', 'credit'], ['Копилка', 'savings']]);
    expect(notes).toEqual([
      spacedLabel('Счета', 'C10', ' Дебетовая', 'Дебетовая'), spacedLabel('Счета', 'C11', 'Наличные ', 'Наличные'),
      spacedLabel('Счета', 'C12', ' кредитная ', 'Кредитная'), spacedLabel('Счета', 'C13', ' Сберегательная', 'Сберегательная'),
    ]);
  });

  it.each([
    ['« Да » is looked for (IF(C33="Да",…)): noted', ' Да ', true, [spacedLabel('Счета', 'C33', ' Да ', 'Да')]],
    ['«Нет » is not looked for: anything but «Да» is off in Excel, as here', 'Нет ', false, []],
  ])('Счета C33 «Гасится автоматически»: %s', async (_what, value, auto, expected) => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C33: value });
    const { data, notes } = await load(wb);
    expect(data.credit.auto).toBe(auto);
    expect(notes).toEqual(expected);
  });

  it('Журнал «Статус»: «Оплачено» and «Отменено» are looked for ($I="Оплачено", $I="Отменено", SUMIFS "<>…"); «Запланировано» and «Перенесено» are not', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-05'), F10: 'Еда', G10: 100, I10: ' Оплачено ',
      C11: date('2026-10-06'), F11: 'Кафе', G11: 20, I11: 'отменено ',
      C12: date('2026-10-07'), F12: 'Кино', G12: 15, I12: ' Запланировано',
      C13: date('2026-10-08'), F13: 'Театр', G13: 30, I13: 'Перенесено  ',
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => r.status)).toEqual(['paid', 'cancelled', 'planned', 'postponed']);
    expect(notes).toEqual([spacedLabel('Журнал', 'I10', ' Оплачено ', 'Оплачено'), spacedLabel('Журнал', 'I11', 'отменено ', 'Отменено')]);
  });

  it('Журнал «Тип»: « Доход » is looked for ($D="Доход", SUMIFS "Доход" and "<>Доход"); « Расход » is an expense in Excel too', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-05'), D10: ' Доход ', F10: 'ЗП', G10: 400,
      C11: date('2026-10-06'), D11: ' Расход ', F11: 'Еда', G11: 100,
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => r.kind)).toEqual(['income', 'expense']);
    expect(notes).toEqual([spacedLabel('Журнал', 'D10', ' Доход ', 'Доход')]);
  });

  it('Постоянные «Тип»: « Доход » is looked for (IF($D="Доход","Доход","Расход") in the expansions); « Расход » is not', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'ЗП', D8: 'Доход ', G8: 3000, C9: 'Аренда', D9: ' Расход', G9: 900 });
    const { data, notes } = await load(wb);
    expect(data.recurring.map((r) => r.kind)).toEqual(['income', 'expense']);
    expect(notes).toEqual([spacedLabel('Постоянные', 'D8', 'Доход ', 'Доход')]);
  });

  it('Операции «Тип»: all three are looked for (SUMIFS "Доход", "Расход", "Перевод"; $D="Расход", $D="Перевод")', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: ' Расход', F10: 'Магазин', G10: 30, H10: 'Карта',
      C11: date('2026-10-13'), D11: 'Доход ', F11: 'Возврат', G11: 10, H11: 'Карта',
      C12: date('2026-10-14'), D12: ' перевод ', F12: 'В кошелёк', G12: 50, H12: 'Карта', I12: 'Наличные',
    });
    const { data, notes } = await load(wb);
    expect(data.operations.map((o) => [o.kind, o.toAccount])).toEqual([['expense', undefined], ['income', undefined], ['transfer', idOf(data, 'Наличные')]]);
    expect(notes).toEqual([
      spacedLabel('Операции', 'D10', ' Расход', 'Расход'), spacedLabel('Операции', 'D11', 'Доход ', 'Доход'),
      spacedLabel('Операции', 'D12', ' перевод ', 'Перевод'),
    ]);
  });

  it('Журнал «Месяц учёта»: MATCH looks for every label, so one with spaces is noted (Excel takes the month of the date)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-30'), F10: 'ЗП', G10: 400, M10: ' Ноябрь 2026 ',
      C11: date('2026-10-30'), F11: 'Премия', G11: 50, M11: 'Ноябрь  2026', // two spaces inside: not the label either
      C12: date('2026-10-05'), F12: 'Еда', G12: 100, M12: 'Октябрь 2026 ', // the month of the date: nothing kept, still not the label
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => r.month)).toEqual(['2026-11', '2026-11', undefined]);
    expect(notes).toEqual([
      spacedLabel('Журнал', 'M10', ' Ноябрь 2026 ', 'Ноябрь 2026'), spacedLabel('Журнал', 'M11', 'Ноябрь  2026', 'Ноябрь 2026'),
      spacedLabel('Журнал', 'M12', 'Октябрь 2026 ', 'Октябрь 2026'),
    ]);
  });

  it('Журнал «Месяц учёта» outside the 12 months keeps its one note, spaces or not', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), F10: 'Еда', G10: 100, M10: ' Сентябрь 2026 ' });
    const { notes } = await load(wb);
    expect(notes).toEqual(['Журнал, строка 10: месяц учёта «Сентябрь 2026» не входит в 12 месяцев учёта — взят месяц даты']);
  });

  it('Настройки C7 and C9: MATCH(C7,V6:V17,0) looks for every month name (with spaces Excel falls back to January)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C6: 2027, C7: ' Январь ', C8: 2026, C9: 'Октябрь ' });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2027-01', '2026-10']);
    expect(notes).toEqual([spacedLabel('Настройки', 'C7', ' Январь ', 'Январь'), spacedLabel('Настройки', 'C9', 'Октябрь ', 'Октябрь')]);
  });

  it('a letter case other than the label\'s is no note: Excel compares ignoring case', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C7: 'октябрь', C9: 'ОКТЯБРЬ' });
    set(sheet(wb, 'Счета'), { C10: 'дебетовая', C12: 'КРЕДИТНАЯ', C33: 'ДА' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-30'), D10: 'доход', F10: 'ЗП', G10: 400, I10: 'оплачено', M10: 'ноябрь 2026' });
    set(sheet(wb, 'Постоянные'), { C8: 'ЗП', D8: 'ДОХОД', G8: 3000 });
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'расход', F10: 'Магазин', G10: 30, H10: 'Карта' });
    const { data, notes } = await load(wb);
    expect([data.accounts[0]?.type, data.accounts[2]?.type, data.credit.auto]).toEqual(['debit', 'credit', true]);
    expect(data.journal.map((r) => [r.kind, r.status, r.month])).toEqual([['income', 'paid', '2026-11']]);
    expect([data.recurring[0]?.kind, data.operations[0]?.kind]).toEqual(['income', 'expense']);
    expect(notes).toEqual([]);
  });

  it('«Приоритет» (Журнал K, Покупки L) is free text that no formula reads (only the drop-down): trimmed, no note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), F10: 'Еда', G10: 100, K10: ' Обязательно ' });
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', E7: 500, L7: 'Желательно ' });
    const { data, notes } = await load(wb);
    expect([data.journal[0]?.priority, data.purchases[0]?.priority]).toEqual(['Обязательно', 'Желательно']);
    expect(notes).toEqual([]);
  });

  it('the notes of a row come in the order of its columns', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-30'), D10: ' Доход', G10: 'сто', I10: 'Оплачено ', M10: 'Ноябрь 2026 ' });
    set(sheet(wb, 'Постоянные'), { D8: ' Доход', F8: 'пятое', G8: 900 });
    const { notes } = await load(wb);
    expect(notes).toEqual([
      spacedLabel('Журнал', 'D10', ' Доход', 'Доход'), noWhat('Журнал', 10), unreadable('Журнал', 'G10', 'сто'),
      spacedLabel('Журнал', 'I10', 'Оплачено ', 'Оплачено'), spacedLabel('Журнал', 'M10', 'Ноябрь 2026 ', 'Ноябрь 2026'),
      noWhatRecurring(8), spacedLabel('Постоянные', 'D8', ' Доход', 'Доход'), unreadable('Постоянные', 'F8', 'пятое'),
    ]);
  });

  it('the data with such labels can be backed up and restored', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C10: ' Дебетовая ', C33: ' Да' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-30'), D10: ' Доход', F10: 'ЗП', G10: 400, I10: 'Оплачено ', M10: ' Ноябрь 2026' });
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: ' Перевод ', F10: 'В кошелёк', G10: 50, H10: 'Карта', I10: 'Наличные' });
    const { data } = await load(wb);
    expect(await importBackup(await exportBackup(data, '2026-10-01T09:30:00.000Z'))).toStrictEqual(data);
  });
});

// ---------------------------------------------------------------------------------------------
// Журнал and Операции: input in any column the import reads makes a row

describe('importTracker — Журнал and Операции: a row with input in any column the import reads is a row', () => {
  it('the probe: Журнал «Категория» and «Счёт» only — noted as a row without a date', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { E10: 'Продукты', J10: 'Карта' });
    const { data, notes } = await load(wb);
    expect(data.journal).toEqual([]);
    expect(notes).toEqual(['Журнал, строка 10: нет даты — строка не загружена']);
  });

  it.each([
    ['«Тип»', 'D10', 'Расход'], ['«Категория»', 'E10', 'Продукты'], ['«Статус»', 'I10', 'Оплачено'], ['«Счёт»', 'J10', 'Карта'],
    ['«Приоритет»', 'K10', 'Можно отложить'], ['a month typed over the formula of «Месяц учёта»', 'M10', 'Ноябрь 2026'],
    ['a number in «Сумма план»', 'G10', 100], ['a formula with a result in «Сумма факт»', 'H10', { formula: '10*2', result: 20 }],
  ])('Журнал: %s alone is a row, noted as having no date', async (_what, address, value) => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { [address]: value as ExcelJS.CellValue });
    const { data, notes } = await load(wb);
    expect(data.journal).toEqual([]);
    expect(notes).toEqual(['Журнал, строка 10: нет даты — строка не загружена']);
  });

  it.each([
    ['«Тип»', 'D10', 'Расход'], ['«Категория»', 'E10', 'Продукты'], ['«Счёт»', 'H10', 'Карта'], ['«На счёт»', 'I10', 'Наличные'],
  ])('Операции: %s alone is a row, noted as having no date', async (_what, address, value) => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), { [address]: value });
    const { data, notes } = await load(wb);
    expect(data.operations).toEqual([]);
    expect(notes).toEqual(['Операции, строка 10: нет даты — строка не загружена']);
  });

  it('the formulas of a row (row number, «Месяц учёта», «Дней до», «Возможный дубль», helpers) and spaces are not input', async () => {
    const wb = tracker();
    const f = (formula: string, result: ExcelJS.CellValue) => ({ formula, result }) as ExcelJS.CellFormulaValue;
    set(sheet(wb, 'Журнал'), {
      B10: f('IF(AND($C10="",$F10=""),"",ROW()-9)', ''), L10: f('IF($C10="","",$C10-TODAY())', ''),
      M10: f('IF($C10="","",INDEX(Настройки!$V$6:$V$17,MONTH($C10))&" "&YEAR($C10))', ''), N10: f('IF($F10="","",1)', ''),
      P10: f('IF($H10<>"",$H10,0)', 0), Q10: f('N($H10)', 0), U10: f('0', 0), E10: '   ', K10: ' ',
      M11: f('IF($C11="","",1)', 'Октябрь 2026'), // a formula in M with a text result is still the default formula
    });
    set(sheet(wb, 'Операции'), {
      B10: f('IF(AND($C10="",$F10=""),"",ROW()-9)', ''), J10: f('IF($C10="","",1)', ''), K10: f('IF($F10="","",1)', ''),
      P10: f('IF($C10="","",1)', ''), Q10: f('IF(ISNUMBER($G10),ABS($G10),0)', 0), R10: f('0', 0), S10: f('DATE(2026,10,1)', date('2026-10-01')),
      D10: '  ',
    });
    const { data, notes } = await load(wb);
    expect([data.journal, data.operations]).toEqual([[], []]);
    expect(notes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Ranges: the backup only holds a day 1..31, «Раз в N мес.» 1..12 and credit days 1..28, all whole

const outOfRange = (sheetName: string, address: string, value: string, rule: string, outcome: string): string => {
  const [, col, row] = /^([A-Z]+)(\d+)$/.exec(address) ?? [];
  return `Лист «${sheetName}», строка ${row}, столбец ${col}: «${value}» не подходит (${rule}) — ${outcome}`;
};
const DAY_RULE = 'нужно целое число от 1 до 31';
const EVERY_RULE = 'нужно целое число от 1 до 12';

describe('importTracker — Постоянные «День»: a whole number from 1 to 31', () => {
  it.each([1, 5, 28, 31])('%s is loaded as it is, without a note', async (day) => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', F8: day, G8: 900 });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]?.day).toBe(day);
    expect(notes).toEqual([]);
  });

  it.each([[0, '0'], [32, '32'], [-1, '-1'], [100, '100'], [4.5, '4.5'], [0.5, '0.5']])(
    '%s is noted and the day is not set', async (day, shownAs) => {
      const wb = tracker();
      set(sheet(wb, 'Постоянные'), { C8: 'Аренда', F8: day, G8: 900 });
      const { data, notes } = await load(wb);
      const [row] = data.recurring;
      expect(row?.what).toBe('Аренда');
      expect(row?.amount).toBe(900);
      expect(row).not.toHaveProperty('day');
      expect(notes).toEqual([outOfRange('Постоянные', 'F8', shownAs, DAY_RULE, 'не загружено')]);
    });
});

describe('importTracker — Постоянные «Раз в N мес.»: a whole number from 1 to 12, otherwise 1', () => {
  it.each([2, 3, 12])('%s is loaded as it is, without a note', async (every) => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Страховка', G8: 30, H8: every });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]?.every).toBe(every);
    expect(notes).toEqual([]);
  });

  it('1 is the same as empty: no field, no note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Страховка', G8: 30, H8: 1 });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]).not.toHaveProperty('every');
    expect(notes).toEqual([]);
  });

  it.each([[0, '0'], [13, '13'], [24, '24'], [-2, '-2'], [1.5, '1.5'], [2.5, '2.5']])(
    '%s is noted and every is 1 (the field is left out)', async (every, shownAs) => {
      const wb = tracker();
      set(sheet(wb, 'Постоянные'), { C8: 'Страховка', G8: 30, H8: every });
      const { data, notes } = await load(wb);
      expect(data.recurring[0]?.what).toBe('Страховка');
      expect(data.recurring[0]).not.toHaveProperty('every');
      expect(notes).toEqual([outOfRange('Постоянные', 'H8', shownAs, EVERY_RULE, 'взято 1')]);
    });

  it('a value that is not a number gets the «не распознано» note only, not a second one', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Страховка', G8: 30, F8: 'пятое', H8: 'квартал' });
    const { notes } = await load(wb);
    expect(notes).toEqual([unreadable('Постоянные', 'F8', 'пятое'), unreadable('Постоянные', 'H8', 'квартал')]);
  });
});

describe('importTracker — credit days: Excel takes MAX(1, MIN(28, N(x))) and DATE drops the fraction', () => {
  const credit = async (close: ExcelJS.CellValue, pay: ExcelJS.CellValue) => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C35: close, C36: pay });
    const { data, notes } = await load(wb);
    return { close: data.credit.closeDay, pay: data.credit.payDay, notes };
  };

  it.each([1, 4, 10, 28])('%s is loaded as it is, without a note', async (day) => {
    expect(await credit(day, day)).toEqual({ close: day, pay: day, notes: [] });
  });

  it.each([
    [29, 28, 'вне 1–28'], [31, 28, 'вне 1–28'], [100, 28, 'вне 1–28'], [28.5, 28, 'вне 1–28'],
    [0, 1, 'вне 1–28'], [-3, 1, 'вне 1–28'], [0.5, 1, 'вне 1–28'],
    [4.5, 4, 'не целое'], [1.9, 1, 'не целое'], [27.99, 27, 'не целое'],
  ])('%s becomes the whole day %s (%s)', async (typed, taken, why) => {
    const result = await credit(typed, 10);
    expect(result.close).toBe(taken);
    expect(Number.isInteger(result.close)).toBe(true);
    expect(result.pay).toBe(10);
    expect(result.notes).toEqual([`Кредитка: день закрытия выписки (Счета, C35) «${typed}» ${why} — взят ${taken}, как в Excel`]);
  });

  it('the payment day is read the same way', async () => {
    const result = await credit(4, 31);
    expect(result).toEqual({
      close: 4, pay: 28, notes: ['Кредитка: день списания долга (Счета, C36) «31» вне 1–28 — взят 28, как в Excel'],
    });
  });
});

describe('importTracker — the data can always be backed up', () => {
  it('the fixture patched with out-of-range days is imported and exportBackup accepts it', async () => {
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Постоянные'), { F8: 45, H8: 24, F9: 0, H9: 1.5, F10: 4.5, H10: 13, F11: 31, H11: 12 });
      set(sheet(wb, 'Счета'), { C35: 45, C36: 4.5 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.recurring.map((r) => [r.what, r.day, r.every])).toEqual([
      ['Аренда', undefined, undefined], ['Подписка', undefined, undefined], ['ЗП бонус', undefined, undefined], ['Страховка', 31, 12],
    ]);
    expect([data.credit.closeDay, data.credit.payDay]).toEqual([28, 4]);
    expect(notes).toEqual([
      'Кредитка: день закрытия выписки (Счета, C35) «45» вне 1–28 — взят 28, как в Excel',
      'Кредитка: день списания долга (Счета, C36) «4.5» не целое — взят 4, как в Excel',
      outOfRange('Постоянные', 'F8', '45', DAY_RULE, 'не загружено'), outOfRange('Постоянные', 'H8', '24', EVERY_RULE, 'взято 1'),
      outOfRange('Постоянные', 'F9', '0', DAY_RULE, 'не загружено'), outOfRange('Постоянные', 'H9', '1.5', EVERY_RULE, 'взято 1'),
      outOfRange('Постоянные', 'F10', '4.5', DAY_RULE, 'не загружено'), outOfRange('Постоянные', 'H10', '13', EVERY_RULE, 'взято 1'),
    ]);
    await expect(exportBackup(data, '2026-10-01T09:30:00.000Z')).resolves.toBeInstanceOf(ArrayBuffer);
  }, 30_000);
});

describe('importTracker — a serial number outside Excel\'s dates is not a date', () => {
  it('in «Действует с»: noted as not recognised, and the data can still be backed up', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, I8: 5000000, J8: 0 });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]).not.toHaveProperty('from');
    expect(data.recurring[0]).not.toHaveProperty('to');
    expect(notes).toEqual([unreadable('Постоянные', 'I8', '5000000'), unreadable('Постоянные', 'J8', '0')]);
    await expect(exportBackup(data, '2026-10-01T09:30:00.000Z')).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it('as the date of a row: the row is skipped with the usual note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: 2958466, D10: 'Расход', F10: 'Еда', G10: 100 });
    const { data, notes } = await load(wb);
    expect(data.journal).toEqual([]);
    expect(notes).toEqual(['Журнал, строка 10: дата «2958466» не распознана — строка не загружена']);
  });

  it('the fixture, whose date cells are date-formatted, with such a date in «Действует с» and «Дата покупки»: imported and backed up', async () => {
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Постоянные'), { I8: 5000000 });
      set(sheet(wb, 'Покупки'), { G7: 2958466 });
    });
    const { data, notes } = await importTracker(buf);
    expect(notes).toEqual([unreadable('Постоянные', 'I8', '5000000'), unreadable('Покупки', 'G7', '2958466')]);
    await expect(exportBackup(data, '2026-10-01T09:30:00.000Z')).resolves.toBeInstanceOf(ArrayBuffer);
  }, 30_000);
});

describe('importTracker — a date-formatted cell holding a serial number below 1 is not a date', () => {
  /** A number in a date-formatted cell: ExcelJS reads it back as a Date (serial 0 is 1899-12-30, 1 is 1899-12-31). */
  const dateFormatted = (ws: ExcelJS.Worksheet, address: string, serial: number): void => {
    const c = ws.getCell(address);
    c.value = serial;
    c.numFmt = 'dd.mm.yyyy';
  };
  const BELOW_ONE: [number, string][] = [[0, '0'], [0.5, '0.5'], [-1, '-1'], [-45000, '-45000']];

  it('ExcelJS does read such a number back as a Date (so these tests go through the Date path)', async () => {
    const wb = tracker();
    dateFormatted(sheet(wb, 'Постоянные'), 'I8', 0);
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    expect(sheet(back, 'Постоянные').getCell('I8').value).toEqual(new Date(Date.UTC(1899, 11, 30)));
  });

  it.each(BELOW_ONE)('%s in «Действует с»: noted as not recognised, not loaded; the data can be backed up', async (serial, shownAs) => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900 });
    dateFormatted(sheet(wb, 'Постоянные'), 'I8', serial);
    const { data, notes } = await load(wb);
    expect(data.recurring[0]).not.toHaveProperty('from');
    expect(notes).toEqual([unreadable('Постоянные', 'I8', shownAs)]);
    await expect(exportBackup(data, '2026-10-01T09:30:00.000Z')).resolves.toBeInstanceOf(ArrayBuffer);
  });

  it.each(BELOW_ONE)('%s in a General cell: the same note', async (serial, shownAs) => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, I8: serial });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]).not.toHaveProperty('from');
    expect(notes).toEqual([unreadable('Постоянные', 'I8', shownAs)]);
  });

  it.each(BELOW_ONE)('%s as the date of a Журнал row (date-formatted): the row is skipped with the usual note', async (serial, shownAs) => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { D10: 'Расход', F10: 'Еда', G10: 100 });
    dateFormatted(sheet(wb, 'Журнал'), 'C10', serial);
    const { data, notes } = await load(wb);
    expect(data.journal).toEqual([]);
    expect(notes).toEqual([`Журнал, строка 10: дата «${shownAs}» не распознана — строка не загружена`]);
  });

  it('in «Дата покупки», «След. платёж» and Счета C4 too', async () => {
    const wb = tracker();
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', E7: 500 });
    dateFormatted(sheet(wb, 'Покупки'), 'G7', 0);
    set(sheet(wb, 'Долги'), { C7: 'Ипотека', E7: 10000 });
    dateFormatted(sheet(wb, 'Долги'), 'J7', -1);
    dateFormatted(sheet(wb, 'Счета'), 'C4', 0.5);
    const { data, notes } = await load(wb);
    expect(data.purchases[0]).not.toHaveProperty('date');
    expect(data.debts[0]).not.toHaveProperty('nextDate');
    expect(data.settings.balancesDate).toBe('2026-10-01');
    expect(notes).toEqual([unreadable('Счета', 'C4', '0.5'), unreadable('Покупки', 'G7', '0'), unreadable('Долги', 'J7', '-1')]);
  });

  it('serial 1 and a time on it are still a date: 1899-12-31 here (Excel shows 1900-01-01), as in a General cell', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, C9: 'Связь', G9: 20, I9: 1 });
    dateFormatted(sheet(wb, 'Постоянные'), 'I8', 1);
    dateFormatted(sheet(wb, 'Постоянные'), 'J8', 1.75);
    const { data, notes } = await load(wb);
    expect(data.recurring.map((r) => [r.from, r.to])).toEqual([['1899-12-31', '1899-12-31'], ['1899-12-31', undefined]]);
    expect(notes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Numbers typed as text

describe('importTracker — a number typed as text is read as a number, with a note', () => {
  it('Операции G, Журнал G and H, Покупки E, Долги E, Настройки C11, Месяц limits, Счета D', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C11: '250' });
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', F10: 'Магазин', G10: '1 234,50', H10: 'Карта' });
    set(sheet(wb, 'Счета'), { D10: ' 1000.5 ' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: '100', H10: '95,5' });
    set(sheet(wb, 'Месяц'), { C12: '900' });
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', E7: '500' });
    set(sheet(wb, 'Долги'), { C7: 'Ипотека', E7: '10000' });
    const { data, notes } = await load(wb);
    expect(data.settings.cushion).toBe(250);
    expect(data.operations[0]?.amount).toBe(1234.5);
    expect(data.accounts[0]?.start).toBe(1000.5);
    expect(data.journal[0]).toMatchObject({ plan: 100, fact: 95.5 });
    expect(data.categories.expense[0]).toEqual({ name: 'Жильё', limit: 900 });
    expect(data.purchases[0]?.cost).toBe(500);
    expect(data.debts[0]?.total).toBe(10000);
    expect(notes).toEqual([
      asText('Настройки', 'C11', '250'),
      asText('Операции', 'G10', '1 234,50'),
      asText('Счета', 'D10', '1000.5'),
      asText('Журнал', 'G10', '100'), asText('Журнал', 'H10', '95,5'),
      asText('Покупки', 'E7', '500'),
      asText('Месяц', 'C12', '900'),
      asText('Долги', 'E7', '10000'),
    ]);
  });

  it('Постоянные «День», «Сумма», «Раз в N мес.» and a month mark', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Страховка', F8: '15', G8: '30,5', H8: '3', L8: '12,5' });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]).toMatchObject({ day: 15, amount: 30.5, every: 3, marks: { '2026-10': 12.5 } });
    expect(notes).toEqual([
      asText('Постоянные', 'F8', '15'), asText('Постоянные', 'G8', '30,5'), asText('Постоянные', 'H8', '3'),
      asText('Постоянные', 'L8', '12,5'),
    ]);
  });

  it('a text day or number of months that does not fit gets one note: it says it is text and what the app did', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', F8: '45', H8: '24' });
    const { data, notes } = await load(wb);
    expect(data.recurring[0]).not.toHaveProperty('day');
    expect(data.recurring[0]).not.toHaveProperty('every');
    expect(notes).toEqual([
      textNoFit('Постоянные', 'F8', '45', 'день месяца 1–31', 'не загружено'),
      textNoFit('Постоянные', 'H8', '24', 'число месяцев 1–12', 'взято 1'),
    ]);
  });

  it('a text day that is not whole is one note too', async () => {
    const wb = tracker();
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', F8: '4,5', H8: '2,5' });
    const { notes } = await load(wb);
    expect(notes).toEqual([
      textNoFit('Постоянные', 'F8', '4,5', 'день месяца 1–31', 'не загружено'),
      textNoFit('Постоянные', 'H8', '2,5', 'число месяцев 1–12', 'взято 1'),
    ]);
  });

  it('the credit days and the years of the accounting and forecast start', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C6: '2026', C8: '2026' }); // DATE(C6,…) takes the text "2026" as 2026: no note
    set(sheet(wb, 'Счета'), { C35: '4', C36: '31' });
    const { data, notes } = await load(wb);
    expect(data.settings).toMatchObject({ forecastStart: '2026-10', accountingStart: '2026-10' });
    expect([data.credit.closeDay, data.credit.payDay]).toEqual([4, 28]);
    expect(notes).toEqual([
      textCreditDay('C35', '4', ', там взят день 1', 'загружен день 4'),
      textCreditDay('C36', '31', ', там взят день 1', 'взят 28'),
    ]);
  });

  it('a text credit day that is not whole, or is day 1 in Excel too, is one note as well', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C35: '4,5', C36: '1' });
    const { data, notes } = await load(wb);
    expect([data.credit.closeDay, data.credit.payDay]).toEqual([4, 1]);
    expect(notes).toEqual([
      textCreditDay('C35', '4,5', ', там взят день 1', 'взят 4'),
      textCreditDay('C36', '1', '', 'загружен день 1'), // Excel takes day 1 for text: it does not differ, so it is not said
    ]);
  });

  it('a real number credit day out of range keeps its note: Excel does take 28', async () => {
    const wb = tracker();
    set(sheet(wb, 'Счета'), { C35: 45, C36: 4 });
    const { notes } = await load(wb);
    expect(notes).toEqual(['Кредитка: день закрытия выписки (Счета, C35) «45» вне 1–28 — взят 28, как в Excel']);
  });

  /** The cell a note is about, from either of the two ways the importer names one. */
  const cellOf = (note: string): string | undefined => {
    const place = /^Лист «(.+?)», строка (\d+), столбец ([A-Z]+):/.exec(note);
    if (place) return `${place[1]}!${place[3]}${place[2]}`;
    const credit = /\((Счета), ([A-Z]+\d+)\)/.exec(note);
    return credit ? `${credit[1]}!${credit[2]}` : undefined;
  };

  it('every number reader gives exactly one note for a cell: read, the month year, whole, marks and the credit days', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C6: '2026,0', C11: '250' }); // month (year) and read
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: '100' }); // read
    set(sheet(wb, 'Постоянные'), {
      C8: 'Аренда', F8: '45', H8: '24', L8: '12,5', // whole (does not fit), whole (does not fit), a mark
      C9: 'Страховка', F9: '15', H9: '3', // whole (fits)
    });
    set(sheet(wb, 'Счета'), { C35: '45', C36: '4' }); // credit days
    const { notes } = await load(wb);
    const cells = notes.map(cellOf);
    expect(cells).toEqual([
      'Настройки!C6', 'Настройки!C11', 'Счета!C35', 'Счета!C36', 'Журнал!G10',
      'Постоянные!F8', 'Постоянные!H8', 'Постоянные!L8', 'Постоянные!F9', 'Постоянные!H9',
    ]); // in the order of the tabs; no cell twice, and no note that is about none
    expect(notes).toHaveLength(10);
  });

  it('rich text and a formula that gives text are text too', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: 'Расход', F10: 'Магазин', G10: { richText: [{ text: '12' }, { text: ',5' }] },
      C11: date('2026-10-13'), D11: 'Расход', F11: 'Кафе', G11: { formula: 'TEXT(A1,"0")', result: '7' } as ExcelJS.CellFormulaValue,
    });
    const { data, notes } = await load(wb);
    expect(data.operations.map((o) => o.amount)).toEqual([12.5, 7]);
    expect(notes).toEqual([asText('Операции', 'G10', '12,5'), asText('Операции', 'G11', '7')]);
  });

  it('numbers stored as numbers, empty cells and text that is no number get no such note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', F10: 'Магазин', G10: 1234.5, H10: 'Карта' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 'сто' });
    const { notes } = await load(wb);
    expect(notes).toEqual([unreadable('Журнал', 'G10', 'сто')]);
  });
});

// ---------------------------------------------------------------------------------------------
// Cell notes (comments): the model has no place for them

const hasNote = (sheetName: string, address: string, quotedText?: string): string =>
  `Лист «${sheetName}», ячейка ${address}: есть примечание${quotedText === undefined ? '' : ` «${quotedText}»`} — в приложение не переносится`;

describe('importTracker — cell notes are reported, not carried over', () => {
  /** Puts `text` (a note) on a cell of the header area, where the import reads nothing; ExcelJS keeps a note only on a cell with a value or a style. */
  function noted(wb: ExcelJS.Workbook, name: string, address: string, text: string | ExcelJS.Comment): void {
    const cell = sheet(wb, name).getCell(address);
    cell.value = 'заголовок';
    cell.note = text;
  }

  it('the scenario fixture with a note: one import note, the data is the same as without it', async () => {
    const plain = await importTracker(fixture());
    const buf = await patchedFixture((wb) => { sheet(wb, 'Журнал').getCell('F10').note = 'Проверить сумму по чеку'; });
    const { data, notes, overrides } = await importTracker(buf);
    expect(notes).toEqual([hasNote('Журнал', 'F10', 'Проверить сумму по чеку')]);
    expect(overrides).toEqual([]);
    expect(normalise(data)).toEqual(normalise(plain.data));
  }, 30_000);

  it('every data sheet is looked at, in the order of the tabs and, within a sheet, row by row', async () => {
    const wb = tracker();
    const cells = [
      ['Долги', 'E4'], ['Месяц', 'C2'], ['Покупки', 'C5'], ['Постоянные', 'M3'], ['Постоянные', 'C4'], ['Журнал', 'F5'],
      ['Журнал', 'A1'], ['Журнал', 'C5'], ['Счета', 'C2'], ['Операции', 'G3'], ['Настройки', 'B1'],
    ] as const;
    for (const [name, address] of cells) noted(wb, name, address, `${name} ${address}`);
    const { notes } = await load(wb);
    expect(notes).toEqual([
      hasNote('Настройки', 'B1', 'Настройки B1'),
      hasNote('Операции', 'G3', 'Операции G3'),
      hasNote('Счета', 'C2', 'Счета C2'),
      hasNote('Журнал', 'A1', 'Журнал A1'), hasNote('Журнал', 'C5', 'Журнал C5'), hasNote('Журнал', 'F5', 'Журнал F5'),
      hasNote('Постоянные', 'M3', 'Постоянные M3'), hasNote('Постоянные', 'C4', 'Постоянные C4'),
      hasNote('Покупки', 'C5', 'Покупки C5'),
      hasNote('Месяц', 'C2', 'Месяц C2'),
      hasNote('Долги', 'E4', 'Долги E4'),
    ]);
  });

  /** The workbook as a file where `address` is an empty formatted cell (`<c r=… s=…/>`) that still has its note, as Excel writes it. */
  async function withEmptyNotedCell(wb: ExcelJS.Workbook, name: string, address: string, note: string): Promise<ArrayBuffer> {
    const cell = sheet(wb, name).getCell(address);
    cell.value = ''; // ExcelJS writes no cell without a value; the value is removed from the file below
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; // an input cell has a style
    cell.note = note;
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    const part = zip.file(new RegExp(`^xl/worksheets/sheet${sheet(wb, name).id}\\.xml$`))[0];
    if (!part) throw new Error(`no part for sheet ${name}`);
    const xml = await part.async('string');
    const emptied = xml.replace(new RegExp(`<c r="${address}"([^>]*?) t="s"><v>\\d+</v></c>`), `<c r="${address}"$1/>`);
    if (emptied === xml) throw new Error(`cell ${address} not found in the sheet XML`);
    zip.file(part.name, emptied);
    return zip.generateAsync({ type: 'arraybuffer' });
  }

  it('a note on an empty formatted cell counts, and comes after the value notes of its sheet', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 'сто' });
    const { notes } = await importTracker(await withEmptyNotedCell(wb, 'Журнал', 'B3', 'пустая ячейка'));
    expect(notes).toEqual([unreadable('Журнал', 'G10', 'сто'), hasNote('Журнал', 'B3', 'пустая ячейка')]);
  });

  it('shows at most the first 60 characters of the note, on one line', async () => {
    const wb = tracker();
    noted(wb, 'Журнал', 'F1', 'а'.repeat(59) + 'бв' + 'г'.repeat(20));
    noted(wb, 'Журнал', 'F2', 'б'.repeat(60)); // exactly 60: shown in full
    noted(wb, 'Журнал', 'F3', '  Иван:\n  проверить\r\n\tсумму  ');
    const { notes } = await load(wb);
    expect(notes).toEqual([
      hasNote('Журнал', 'F1', `${'а'.repeat(59)}б…`),
      hasNote('Журнал', 'F2', 'б'.repeat(60)),
      hasNote('Журнал', 'F3', 'Иван: проверить сумму'),
    ]);
  });

  // What Excel for Mac stores as the legacy text of a threaded comment: a notice first, the text after «Comment:».
  const threaded = (marker: string, text: string): string =>
    '[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment; however, any edits to it will get removed '
    + 'if the file is opened in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924\n\n'
    + `${marker}\n    ${text}`;

  it('a threaded comment shows only its text, not Excel\'s notice (English and Russian Excel)', async () => {
    const wb = tracker();
    noted(wb, 'Журнал', 'F1', threaded('Comment:', 'Проверить сумму по чеку'));
    noted(wb, 'Журнал', 'F2', threaded('Комментарий:', 'Сверить с выпиской'));
    const { notes } = await load(wb);
    expect(notes).toEqual([hasNote('Журнал', 'F1', 'Проверить сумму по чеку'), hasNote('Журнал', 'F2', 'Сверить с выпиской')]);
  });

  it('with replies it is the text after the last marker; formatted text and a long text are handled as for any note', async () => {
    const wb = tracker();
    noted(wb, 'Журнал', 'F1', `${threaded('Comment:', 'Первый')}\nComment:\n    Второй`);
    noted(wb, 'Журнал', 'F2', { texts: [{ text: `${threaded('Комментарий:', '')}`, font: { bold: true } }, { text: 'жирный и обычный' }] });
    noted(wb, 'Журнал', 'F3', threaded('Comment:', 'а'.repeat(59) + 'бв'));
    noted(wb, 'Журнал', 'F4', threaded('Comment:', '   ')); // nothing after the marker: like a note without text
    const { notes } = await load(wb);
    expect(notes).toEqual([
      hasNote('Журнал', 'F1', 'Второй'),
      hasNote('Журнал', 'F2', 'жирный и обычный'),
      hasNote('Журнал', 'F3', `${'а'.repeat(59)}б…`),
      hasNote('Журнал', 'F4'),
    ]);
  });

  it('a note without a marker keeps all of its text, also when it holds a colon', async () => {
    const wb = tracker();
    noted(wb, 'Журнал', 'F1', 'Иван: проверить, Comment без двоеточия');
    const { notes } = await load(wb);
    expect(notes).toEqual([hasNote('Журнал', 'F1', 'Иван: проверить, Comment без двоеточия')]);
  });

  it('a note with formatted text is read as its text; one without text is still reported', async () => {
    const wb = tracker();
    noted(wb, 'Операции', 'F1', { texts: [{ text: 'Иван: ', font: { bold: true } }, { text: 'проверить' }] });
    noted(wb, 'Операции', 'F2', '   ');
    const { notes } = await load(wb);
    expect(notes).toEqual([hasNote('Операции', 'F1', 'Иван: проверить'), hasNote('Операции', 'F2')]);
  });

  it('notes on the sheets the import does not read are not reported', async () => {
    const buf = await patchedFixture((wb) => {
      for (const [name, address] of [['Инструкция', 'A1'], ['Прогноз', 'B5'], ['Статистика', 'B5']] as const) {
        const cell = sheet(wb, name).getCell(address);
        cell.value = 'заголовок'; // a note is kept only on a cell with a value
        cell.note = 'подсказка';
      }
    });
    const { notes } = await importTracker(buf);
    expect(notes).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------------------------
// Item 11: a free-text cell that is not text (TRUE, an error, a date, a number) is loaded as it is shown, with one note

describe('importTracker — a free-text cell that is not text is loaded as it is shown, with one note', () => {
  it.each([
    ['TRUE', true, 'true'], ['an error', { error: '#N/A' }, '#N/A'], ['a date', date('2026-10-05'), '2026-10-05'],
    ['a number', 12.5, '12.5'], ['a formula that gives a number', { formula: '2+3', result: 5 }, '5'],
  ])('%s in «Категория», «Приоритет» and «Кому / банк» on every sheet', async (_what, value, shownAs) => {
    const wb = tracker();
    const v = value as ExcelJS.CellValue;
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', E10: v, F10: 'Магазин', G10: 30, H10: 'Карта' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', E10: v, F10: 'Еда', G10: 100, K10: v });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', E8: v, G8: 900 });
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', D7: v, E7: 500, L7: v });
    set(sheet(wb, 'Долги'), { C7: 'Ипотека', D7: v, E7: 10000 });
    const { data, notes } = await load(wb);
    expect([data.operations[0]?.category, data.journal[0]?.category, data.recurring[0]?.category, data.purchases[0]?.category])
      .toEqual([shownAs, shownAs, shownAs, shownAs]);
    expect([data.journal[0]?.priority, data.purchases[0]?.priority, data.debts[0]?.whom]).toEqual([shownAs, shownAs, shownAs]);
    expect(notes).toEqual([
      notText('Операции', 'E10', shownAs), notText('Журнал', 'E10', shownAs), notText('Журнал', 'K10', shownAs),
      notText('Постоянные', 'E8', shownAs), notText('Покупки', 'D7', shownAs), notText('Покупки', 'L7', shownAs),
      notText('Долги', 'D7', shownAs),
    ]);
  });

  it('the names of Настройки (expense and income categories, accounts): a limit on «Месяц» stays with its category', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { J7: true, L7: 2026, N9: { error: '#REF!' } as ExcelJS.CellErrorValue });
    set(sheet(wb, 'Месяц'), { C12: 900, C13: 55 });
    set(sheet(wb, 'Счета'), { C13: 'Сберегательная', D13: 300 });
    const { data, notes } = await load(wb);
    expect(data.categories).toEqual({
      expense: [{ name: 'Жильё', limit: 900 }, { name: 'true', limit: 55 }],
      income: [{ name: 'Зарплата' }, { name: '2026' }],
    });
    expect(data.accounts.map(({ name, type, start }) => [name, type, start])).toEqual([
      ['Карта', 'debit', 1000], ['Наличные', 'cash', 0], ['Кредитка', 'credit', 0], ['#REF!', 'savings', 300],
    ]);
    expect(notes).toEqual([notText('Настройки', 'J7', 'true'), notText('Настройки', 'L7', '2026'), notText('Настройки', 'N9', '#REF!')]);
  });

  it('an account named by a value that is not text: matched by how it is shown, one note; an unknown one is «не найден»', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { N9: '1234' });
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: 'Перевод', F10: 'На счёт', G10: 50, H10: 1234, I10: true,
      C11: date('2026-10-13'), D11: 'Расход', F11: 'Магазин', G11: 30, H11: { error: '#N/A' } as ExcelJS.CellErrorValue,
    });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 100, J10: 1234 });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, K8: 1234 });
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', E7: 500, P7: date('2026-10-05') });
    set(sheet(wb, 'Счета'), { C34: 1234 });
    const { data, notes } = await load(wb);
    const id = idOf(data, '1234');
    expect(id).toBeDefined();
    expect(data.operations.map((o) => [o.account, o.toAccount])).toEqual([[id, undefined], [undefined, undefined]]);
    expect([data.journal[0]?.account, data.recurring[0]?.account, data.purchases[0]?.account, data.credit.fromAccountId])
      .toEqual([id, id, undefined, id]);
    const asAccount = (sheetName: string, address: string) => `${at(sheetName, address)}: «1234» — не текст; загружено как счёт «1234»`;
    expect(notes).toEqual([
      asAccount('Операции', 'H10'), 'Счёт «true» не найден (Операции, строка 10)', 'Счёт «#N/A» не найден (Операции, строка 11)',
      asAccount('Счета', 'C34'),
      asAccount('Журнал', 'J10'),
      asAccount('Постоянные', 'K8'),
      'Счёт «2026-10-05» не найден (Покупки, строка 7)',
    ]);
  });

  it('«Тип» of Операции: a value that is not text is not «нет типа» but a type that is not recognised', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: true, F10: 'Магазин', G10: 30,
      C11: date('2026-10-13'), D11: date('2026-10-13'), F11: 'Кафе', G11: 5,
      C12: date('2026-10-14'), D12: { error: '#N/A' } as ExcelJS.CellErrorValue, F12: 'Кино', G12: 15,
    });
    const { data, notes } = await load(wb);
    expect(data.operations).toEqual([]);
    expect(notes).toEqual([
      'Операции, строка 10: тип «true» не распознан — строка не загружена',
      'Операции, строка 11: тип «2026-10-13» не распознан — строка не загружена',
      'Операции, строка 12: тип «#N/A» не распознан — строка не загружена',
    ]);
  });

  it('«Тип» of Журнал and Постоянные: a value that is not text is an expense, as in Excel (it is not «Доход»), with one note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: true, F10: 'Еда', G10: 100 });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', D8: 5, G8: 900 });
    const { data, notes } = await load(wb);
    expect([data.journal[0]?.kind, data.recurring[0]?.kind]).toEqual(['expense', 'expense']);
    expect(notes).toEqual([
      `${at('Журнал', 'D10')}: «true» — не текст; загружено как «Расход»`,
      `${at('Постоянные', 'D8')}: «5» — не текст; загружено как «Расход»`,
    ]);
  });

  it('text in those cells (a category, a priority, a type) gets no such note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Прочее', E10: ' Транспорт ', F10: 'Штраф', G10: 100, K10: 'Обязательно' });
    set(sheet(wb, 'Долги'), { C7: 'Ипотека', D7: { richText: [{ text: 'Бан' }, { text: 'к' }] }, E7: 10000 });
    const { data, notes } = await load(wb);
    expect([data.journal[0]?.kind, data.journal[0]?.category, data.journal[0]?.priority, data.debts[0]?.whom])
      .toEqual(['expense', 'Транспорт', 'Обязательно', 'Банк']);
    expect(notes).toEqual([]);
  });

  it('what was loaded that way can be backed up and restored', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { J7: true, N9: 1234 });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 5, E10: date('2026-10-05'), F10: 'Еда', G10: 100, J10: 1234, K10: { error: '#N/A' } });
    set(sheet(wb, 'Долги'), { D7: true, E7: 10000 });
    const { data } = await load(wb);
    expect(await importBackup(await exportBackup(data, '2026-10-01T09:30:00.000Z'))).toStrictEqual(data);
  });
});

// ---------------------------------------------------------------------------------------------
// Item 12: account and category references that the app matches after trimming, where Excel's criterion does not

/** The one note of a reference the app matched (trimmed, any case) and Excel's SUMIFS/= does not (spaces around it). */
const spacedRef = (sheetName: string, address: string, raw: string, what: 'счётом' | 'категорией', name: string, loaded = name.trim()): string =>
  `${at(sheetName, address)}: «${raw}» — в Excel с пробелами не совпадает с${what === 'счётом' ? 'о счётом' : ' категорией'} «${name}»; загружено как «${loaded}»`;

/** The one note on a name with *, ? or ~: Excel's SUMIFS criteria read them as wildcards. */
const wildcardName = (address: string, raw: string, what: 'счёта' | 'категории'): string =>
  `${at('Настройки', address)}: «${raw}» — в Excel *, ? и ~ в названии — знаки шаблона: в итоги ${what} могут попасть чужие строки или не попасть ${what === 'счёта' ? 'его' : 'её'} собственные; в приложении — только ${what === 'счёта' ? 'его' : 'её'} строки`;

describe('importTracker — an account named with spaces around it: matched, with one note where Excel\'s criterion does not match', () => {
  it('Операции H and I, Журнал J, Постоянные K, Покупки P (SUMIFS by the name) and Счета C34 (=)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), { C10: date('2026-10-13'), D10: 'Перевод', F10: 'Снятие', G10: 100, H10: ' Карта ', I10: 'Наличные ' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 100, J10: 'Карта  ' });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, K8: '\tКарта' });
    set(sheet(wb, 'Покупки'), { C7: 'Ноутбук', E7: 500, P7: ' кредитка' });
    set(sheet(wb, 'Счета'), { C33: 'Нет', C34: ' Наличные ' });
    const { data, notes } = await load(wb);
    const [card, cash, credit] = ['Карта', 'Наличные', 'Кредитка'].map((n) => idOf(data, n));
    expect([data.operations[0]?.account, data.operations[0]?.toAccount, data.journal[0]?.account]).toEqual([card, cash, card]);
    expect([data.recurring[0]?.account, data.purchases[0]?.account, data.credit.fromAccountId]).toEqual([card, credit, cash]);
    expect(notes).toEqual([
      spacedRef('Операции', 'H10', ' Карта ', 'счётом', 'Карта'), spacedRef('Операции', 'I10', 'Наличные ', 'счётом', 'Наличные'),
      spacedRef('Счета', 'C34', ' Наличные ', 'счётом', 'Наличные'),
      spacedRef('Журнал', 'J10', 'Карта  ', 'счётом', 'Карта'),
      spacedRef('Постоянные', 'K8', ' Карта', 'счётом', 'Карта'),
      spacedRef('Покупки', 'P7', ' кредитка', 'счётом', 'Кредитка'),
    ]);
  });

  it('letter case alone is no note: SUMIFS and = ignore it', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', F10: 'Магазин', G10: 30, H10: 'КАРТА' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 100, J10: 'карта' });
    set(sheet(wb, 'Счета'), { C34: 'наличные' });
    const { data, notes } = await load(wb);
    expect([data.operations[0]?.account, data.journal[0]?.account, data.credit.fromAccountId])
      .toEqual([idOf(data, 'Карта'), idOf(data, 'Карта'), idOf(data, 'Наличные')]);
    expect(notes).toEqual([]);
  });

  it('what counts is the raw name on Настройки: the same spaces on both sides match in Excel; a name with spaces and a reference without do not', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { N6: ' Карта ' });
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-05'), D10: 'Расход', F10: 'Еда', G10: 100, J10: ' Карта ', // picked from the list: the same text
      C11: date('2026-10-06'), D11: 'Расход', F11: 'Кафе', G11: 20, J11: 'Карта', // typed without the spaces
    });
    const { data, notes } = await load(wb);
    expect(data.accounts[0]?.name).toBe('Карта');
    expect(data.journal.map((r) => r.account)).toEqual([idOf(data, 'Карта'), idOf(data, 'Карта')]);
    expect(notes).toEqual([spacedRef('Журнал', 'J11', 'Карта', 'счётом', ' Карта ')]);
  });

  it('Excel\'s criterion is the name with its wildcards: a name that still matches the reference with spaces gets no row note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { N9: '*Копилка*' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', F10: 'Взнос', G10: 100, J10: ' *копилка* ' });
    set(sheet(wb, 'Счета'), { C34: ' *Копилка* ' }); // = has no wildcards: not the name there
    const { data, notes } = await load(wb);
    expect([data.journal[0]?.account, data.credit.fromAccountId]).toEqual([idOf(data, '*Копилка*'), idOf(data, '*Копилка*')]);
    expect(notes).toEqual([
      wildcardName('N9', '*Копилка*', 'счёта'),
      spacedRef('Счета', 'C34', ' *Копилка* ', 'счётом', '*Копилка*'),
    ]);
  });

  it('a name with *, ? or ~ gets one note on Настройки, however many rows name it; other names get none', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { N9: 'Visa *1234', N10: 'Счёт?', N11: 'A~B', N12: 'Обычный' });
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: 'Расход', F10: 'Магазин', G10: 30, H10: 'Visa *1234',
      C11: date('2026-10-13'), D11: 'Расход', F11: 'Кафе', G11: 5, H11: 'visa *1234',
    });
    const { data, notes } = await load(wb);
    expect(data.operations.map((o) => o.account)).toEqual([idOf(data, 'Visa *1234'), idOf(data, 'Visa *1234')]);
    expect(notes).toEqual([wildcardName('N9', 'Visa *1234', 'счёта'), wildcardName('N10', 'Счёт?', 'счёта'), wildcardName('N11', 'A~B', 'счёта')]);
  });
});

describe('importTracker — a category named with spaces around it or in another letter case', () => {
  it('on an expense row it is loaded as the category, with one note where Excel\'s SUMIFS does not match it (spaces)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), { C10: date('2026-10-12'), D10: 'Расход', E10: ' Жильё', F10: 'Магазин', G10: 30, H10: 'Карта' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', E10: 'Продукты ', F10: 'Еда', G10: 100 });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', D8: 'Расход', E8: ' жильё ', G8: 900 });
    set(sheet(wb, 'Покупки'), { C7: 'Холодильник', D7: '\nПродукты', E7: 500 });
    const { data, notes } = await load(wb);
    expect([data.operations[0]?.category, data.journal[0]?.category, data.recurring[0]?.category, data.purchases[0]?.category])
      .toEqual(['Жильё', 'Продукты', 'Жильё', 'Продукты']);
    expect(notes).toEqual([
      spacedRef('Операции', 'E10', ' Жильё', 'категорией', 'Жильё'), spacedRef('Журнал', 'E10', 'Продукты ', 'категорией', 'Продукты'),
      spacedRef('Постоянные', 'E8', ' жильё ', 'категорией', 'Жильё'), spacedRef('Покупки', 'D7', ' Продукты', 'категорией', 'Продукты'),
    ]);
  });

  it('another letter case is loaded as the category without a note: Excel counts it there too, and now the app does', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-05'), D10: 'Расход', E10: 'продукты', F10: 'Еда', G10: 100, H10: 90,
      C11: date('2026-10-06'), D11: 'Расход', E11: 'Продукты', F11: 'Рынок', G11: 20, H11: 25,
    });
    set(sheet(wb, 'Покупки'), { C7: 'Ремонт', D7: 'ЖИЛЬЁ', E7: 500 });
    const { data, notes } = await load(wb);
    expect([data.journal.map((r) => r.category), data.purchases[0]?.category]).toEqual([['Продукты', 'Продукты'], 'Жильё']);
    expect(monthSummary(data, '2026-10').byCategory.find((c) => c.name === 'Продукты')).toMatchObject({ plan: 120, fact: 115 });
    expect(notes).toEqual([]);
  });

  it('income and transfer rows are left as typed (trimmed), without a note: no formula matches their category', async () => {
    const wb = tracker();
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: 'Доход', E10: ' Зарплата ', F10: 'ЗП', G10: 3000, H10: 'Карта',
      C11: date('2026-10-13'), D11: 'Перевод', E11: 'продукты ', F11: 'В кошелёк', G11: 50, H11: 'Карта', I11: 'Наличные',
    });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Доход', E10: 'продукты', F10: 'Возврат', G10: 10 });
    set(sheet(wb, 'Постоянные'), { C8: 'ЗП', D8: 'Доход', E8: 'зарплата ', G8: 3000 });
    const { data, notes } = await load(wb);
    expect([data.operations.map((o) => o.category), data.journal[0]?.category, data.recurring[0]?.category])
      .toEqual([['Зарплата', 'продукты'], 'продукты', 'зарплата']);
    expect(notes).toEqual([]);
  });

  it('a category that is not on the list is left as typed, trimmed, without a note (in Excel it is «Без категории» too)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', E10: ' Прочее ', F10: 'Разное', G10: 10 });
    const { data, notes } = await load(wb);
    expect(data.journal[0]?.category).toBe('Прочее');
    expect(notes).toEqual([]);
  });

  it('an expense category with *, ? or ~ gets one note on Настройки; an income category does not (no formula uses it)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { J8: 'Кафе*', J9: 'Такси?', L7: 'Бонус*' });
    const { data, notes } = await load(wb);
    expect(data.categories.expense.map((c) => c.name)).toEqual(['Жильё', 'Продукты', 'Кафе*', 'Такси?']);
    expect(notes).toEqual([wildcardName('J8', 'Кафе*', 'категории'), wildcardName('J9', 'Такси?', 'категории')]);
  });

  it('a category on the list with spaces around it: the raw names are compared, as in Excel', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { J7: 'Продукты ' });
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-05'), D10: 'Расход', E10: 'Продукты ', F10: 'Еда', G10: 100, // the same text: Excel matches it
      C11: date('2026-10-06'), D11: 'Расход', E11: 'Продукты', F11: 'Рынок', G11: 20,
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => r.category)).toEqual(['Продукты', 'Продукты']);
    expect(notes).toEqual([spacedRef('Журнал', 'E11', 'Продукты', 'категорией', 'Продукты ')]);
  });

  it('the data can be backed up and restored', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { J8: 'Кафе*', N9: 'Visa *1234' });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', E10: ' продукты ', F10: 'Еда', G10: 100, J10: ' visa *1234' });
    const { data } = await load(wb);
    expect(await importBackup(await exportBackup(data, '2026-10-01T09:30:00.000Z'))).toStrictEqual(data);
  });
});

// ---------------------------------------------------------------------------------------------
// Item 13: Настройки C7 / C9 — Excel's D7 = IFERROR(MATCH($C$7,$V$6:$V$17,0),1) (and D9 the same for C9)

describe('importTracker — a month on Настройки that is not a month name: the month Excel takes, with one note', () => {
  const notMonth = (address: string, raw: string, taken: string): string =>
    `${at('Настройки', address)}: «${raw}» — месяц не распознан; взят ${taken}, как в Excel`;
  const pattern = (address: string, raw: string, taken: string): string =>
    `${at('Настройки', address)}: «${raw}» — шаблон, а не название месяца; взят ${taken}, как в Excel`;

  it('a name that is no month: January of the year, as MATCH fails and IFERROR gives 1; the file is not refused', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C6: 2026, C7: 'Октябрьь', C8: 2027, C9: 'Октябрь 2026' });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2026-01', '2027-01']);
    expect(data.settings.balancesDate).toBe('2027-01-01');
    expect(notes).toEqual([notMonth('C7', 'Октябрьь', 'январь'), notMonth('C9', 'Октябрь 2026', 'январь')]);
  });

  it('an empty month, or one of spaces: January, noted as not given', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C7: null, C9: '   ' });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2026-01', '2026-01']);
    expect(notes).toEqual([
      `${at('Настройки', 'C7')}: месяц не указан — взят январь, как в Excel`,
      `${at('Настройки', 'C9')}: месяц не указан — взят январь, как в Excel`,
    ]);
  });

  it.each([
    ['a number', 11, '11'], ['TRUE', true, 'true'], ['a date', date('2026-11-01'), '2026-11-01'], ['an error', { error: '#N/A' }, '#N/A'],
  ])('%s: January (MATCH finds no text among the names)', async (_what, value, shownAs) => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C9: value as ExcelJS.CellValue });
    const { data, notes } = await load(wb);
    expect(data.settings.accountingStart).toBe('2026-01');
    expect(notes).toEqual([notMonth('C9', shownAs, 'январь')]);
  });

  it.each([
    ['Ноя*', '2026-11', 'ноябрь'], ['?юнь', '2026-06', 'июнь'], ['Ию?ь', '2026-06', 'июнь'], ['*ь', '2026-01', 'январь'],
    ['*', '2026-01', 'январь'], ['сен*', '2026-09', 'сентябрь'], ['*арт', '2026-03', 'март'],
  ])('a wildcard «%s» takes the first month Excel\'s MATCH finds: %s', async (raw, ym, taken) => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C9: raw });
    const { data, notes } = await load(wb);
    expect(data.settings.accountingStart).toBe(ym);
    expect(notes).toEqual([pattern('C9', raw, taken)]);
  });

  it('a wildcard that finds no month is January; one with spaces around it finds none either', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C7: 'Xyz*', C9: ' Ноя* ' });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2026-01', '2026-01']);
    expect(notes).toEqual([notMonth('C7', 'Xyz*', 'январь'), notMonth('C9', ' Ноя* ', 'январь')]);
  });

  it('the forecast month is read the same way; the months of the data follow the accounting month taken', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C7: 'Дек*', C9: 'Янв' });
    set(sheet(wb, 'Постоянные'), { C8: 'Аренда', G8: 900, L8: '✓', W8: '✓' });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2026-12', '2026-01']);
    expect(data.recurring[0]?.marks).toEqual({ '2026-01': '✓', '2026-12': '✓' });
    expect(notes).toEqual([pattern('C7', 'Дек*', 'декабрь'), notMonth('C9', 'Янв', 'январь')]);
  });

  it('a year that cannot be read still refuses the file, whatever the month', async () => {
    for (const cells of [{ C8: 'двадцать', C9: 'Ноя*' }, { C8: null, C9: 'Октябрь' }, { C6: 26, C7: 'Октябрь' }, { C6: 2026.5, C7: 'нет' }]) {
      const wb = tracker();
      set(sheet(wb, 'Настройки'), cells);
      const error = await load(wb).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TrackerImportError);
      expect((error as Error).message).toMatch(/^На листе «Настройки» не задан месяц начала (учёта|прогноза): год в C(8|6), месяц в C(9|7)\.$/);
    }
  });

  it('a month name, in any letter case, is taken without a note; one with spaces keeps its own note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C7: 'ДЕКАБРЬ', C9: 'Сентябрь ' });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2026-12', '2026-09']);
    expect(notes).toEqual([spacedLabel('Настройки', 'C9', 'Сентябрь ', 'Сентябрь')]);
  });
});

// ---------------------------------------------------------------------------------------------
// Item 15: rows below the tracker's formulas (a deleted row: the formulas end one row higher, the importer reads on)

/**
 * The one row note of a row below the last row that still has the tracker's formulas. It says «в суммах», as the note
 * on a row inserted inside a table does (noOwnFormulas).
 */
const belowFormulas = (sheetName: string, row: number, except = ''): string =>
  `Лист «${sheetName}», строка ${row}: ниже формул трекера — в суммах Excel не учитывается${except}; загружено`;
const EXCEPT_AVERAGE = ' (кроме итога «в среднем в месяц»)';
/**
 * Покупки: ИТОГО sums E, F, H, J over the table and O = SUM(S) (build_tracker.py 748–753). Of a row without its
 * formulas only the input columns E («Стоимость») and F («Уже отложено») are in them; H, J and S are its formulas.
 */
const EXCEPT_TOTALS = ' (кроме сумм «Стоимость» и «Уже отложено» в строке «ИТОГО»)';

/**
 * The formulas each table row of the fixture's tracker has (build_tracker.py of excel-planners 7c2b55c), by sheet —
 * the fixture predates the helpers of savings accounts (Журнал V, Операции T and U, Покупки U).
 */
const ROW_FORMULAS = {
  Журнал: ['B', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U'], Операции: ['B', 'J', 'K', 'P', 'Q', 'R'],
  Покупки: ['H', 'I', 'J', 'K', 'M', 'Q', 'R', 'S', 'T'], Долги: ['G', 'K', 'L'],
} as const;

function dropFormulas(ws: ExcelJS.Worksheet, cols: readonly string[], row: number): void {
  for (const col of cols) {
    if (!isFormulaValue(ws.getCell(`${col}${row}`).value)) throw new Error(`${ws.name}!${col}${row} holds no formula`);
    ws.getCell(`${col}${row}`).value = null;
  }
}

const isFormulaValue = (v: ExcelJS.CellValue): boolean => typeof v === 'object' && v !== null && ('formula' in v || 'sharedFormula' in v);

/** Clears every formula of «Постоянные» that refers to input row `row` ($C{row}): the expansions of all 12 + 3 months. */
function dropRecurringReferences(ws: ExcelJS.Worksheet, row: number): number {
  let dropped = 0;
  ws.eachRow((r) => r.eachCell((c) => {
    if (isFormulaValue(c.value) && new RegExp(`\\$C${row}(?!\\d)`).test(c.formula)) {
      c.value = null;
      dropped++;
    }
  }));
  return dropped;
}

describe('importTracker — a row below the tracker\'s formulas is loaded, with one note', () => {
  it('the fixture with the formulas of its last row dropped and a row typed there, on every sheet', async () => {
    let droppedRecurring = 0;
    const buf = await patchedFixture((wb) => {
      dropFormulas(sheet(wb, 'Журнал'), ROW_FORMULAS.Журнал, 1509);
      set(sheet(wb, 'Журнал'), { C1509: date('2026-10-20'), D1509: 'Расход', E1509: 'Продукты', F1509: 'Поздняя', G1509: 40, H1509: 'сорок', J1509: 'Карта' });
      dropFormulas(sheet(wb, 'Операции'), ROW_FORMULAS.Операции, 1009);
      set(sheet(wb, 'Операции'), { C1009: date('2026-10-21'), D1009: 'Расход', F1009: 'Кофе', G1009: 3, H1009: 'Наличные' });
      droppedRecurring = dropRecurringReferences(sheet(wb, 'Постоянные'), 37);
      set(sheet(wb, 'Постоянные'), { C37: 'Спортзал', D37: 'Расход', G37: 30, K37: 'Карта' });
      dropFormulas(sheet(wb, 'Покупки'), ROW_FORMULAS.Покупки, 18);
      set(sheet(wb, 'Покупки'), { C18: 'Лампа', E18: 20 });
      dropFormulas(sheet(wb, 'Долги'), ROW_FORMULAS.Долги, 24);
      set(sheet(wb, 'Долги'), { C24: 'Сестре', E24: 100 });
    });
    expect(droppedRecurring).toBe(7 * 12 + 4 * 3); // Y…AE of the 12 accounting months, AG…AJ of the 3 forecast months
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.journal.at(-1)).toMatchObject({ date: '2026-10-20', what: 'Поздняя', category: 'Продукты', plan: 40, account: idOf(data, 'Карта') });
    expect(data.operations.at(-1)).toMatchObject({ date: '2026-10-21', what: 'Кофе', amount: 3, account: idOf(data, 'Наличные') });
    expect(data.recurring.at(-1)).toMatchObject({ what: 'Спортзал', amount: 30, account: idOf(data, 'Карта') });
    expect(data.purchases.at(-1)).toMatchObject({ what: 'Лампа', cost: 20 });
    expect(data.debts.at(-1)).toMatchObject({ name: 'Сестре', total: 100 });
    expect(notes).toEqual([
      belowFormulas('Операции', 1009),
      belowFormulas('Журнал', 1509), unreadable('Журнал', 'H1509', 'сорок'), // the row note first
      belowFormulas('Постоянные', 37, EXCEPT_AVERAGE),
      belowFormulas('Покупки', 18, EXCEPT_TOTALS),
      // none on Долги: its only totals, ИТОГО (SUM(E7:E24), F, G, I), sum over the whole table, so Excel counts row 24
    ]);
    expect(overrides).toEqual([]);
    expect(await importBackup(await exportBackup(data, '2026-10-01T09:30:00.000Z'))).toStrictEqual(data);
  }, 60_000);

  it('Постоянные: while any month still refers to the row, Excel counts it there: no note', async () => {
    const buf = await patchedFixture((wb) => {
      const ws = sheet(wb, 'Постоянные');
      for (const col of ['Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AG', 'AH', 'AI', 'AJ']) ws.getCell(`${col}37`).value = null; // month 1 only
      set(ws, { C37: 'Спортзал', D37: 'Расход', G37: 30 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.recurring.at(-1)?.what).toBe('Спортзал');
    expect(notes).toEqual([]);
  }, 30_000);

  it('a row below the formulas that is not loaded (no date) gets only the note that says so; a nameless one the plain name note', async () => {
    const buf = await patchedFixture((wb) => {
      dropFormulas(sheet(wb, 'Журнал'), ROW_FORMULAS.Журнал, 1509);
      set(sheet(wb, 'Журнал'), { D1509: 'Расход', G1509: 40 });
      dropFormulas(sheet(wb, 'Покупки'), ROW_FORMULAS.Покупки, 18);
      set(sheet(wb, 'Покупки'), { E18: 20, N18: '✓' }); // bought, no name: Excel counts nothing of it here, not even the fact
    });
    const { data, notes } = await importTracker(buf);
    expect(data.purchases.at(-1)).toMatchObject({ what: '', cost: 20, bought: true });
    expect(notes).toEqual([
      'Журнал, строка 1509: нет даты — строка не загружена',
      belowFormulas('Покупки', 18, EXCEPT_TOTALS), noWhat('Покупки', 18, 'Что покупаем'),
    ]);
  }, 30_000);

  it('a workbook without the tracker\'s row formulas says nothing about them (nothing to tell where Excel\'s range ends)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C1509: date('2026-10-05'), D1509: 'Расход', F1509: 'Еда', G1509: 100 });
    set(sheet(wb, 'Постоянные'), { C37: 'Аренда', G37: 900 });
    const { data, notes } = await load(wb);
    expect([data.journal.length, data.recurring.length]).toEqual([1, 1]);
    expect(notes).toEqual([]);
  });

  it('Постоянные with shared formulas (as Excel saves them): the rows they refer to are found through the shared formula', async () => {
    const wb = tracker();
    const ws = sheet(wb, 'Постоянные');
    ws.getCell('Y8').value = { formula: 'IF(OR($C8="",$F8=""),"",1)', shareType: 'shared', ref: 'Y8:Y36', result: '' } as ExcelJS.CellFormulaValue;
    for (let row = 9; row <= 36; row++) ws.getCell(`Y${row}`).value = { sharedFormula: 'Y8', result: '' } as ExcelJS.CellSharedFormulaValue;
    set(ws, { C36: 'Связь', G36: 20, C37: 'Спортзал', G37: 30 });
    const { data, notes } = await load(wb);
    expect(data.recurring.map((r) => r.what)).toEqual(['Связь', 'Спортзал']);
    expect(notes).toEqual([belowFormulas('Постоянные', 37, EXCEPT_AVERAGE)]);
  });
});

/**
 * A cell reference, or a range, with the sheet name in front of it if there is one ('…'! when quoted). Only what the
 * tracker's formulas hold: no whole columns or rows, no R1C1.
 */
const REFERENCE = /(?<![\w.$])((?:'(?:[^']|'')+'|[^\s'"!(),:;=<>&+\-*/^{}]+)!)?(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![\w(])/g;

/**
 * `formula` with its references to rows of sheet `name` below `at` moved up by one, as Excel rewrites them when row
 * `at` is deleted: a range over the row shrinks by one (one that holds nothing else, and a reference to the row
 * itself, become #REF!). `own` says whether the formula is on that sheet (its references without a sheet name are to
 * it). Text in quotes is left as it is.
 */
function shiftReferences(formula: string, own: boolean, name: string, at: number): string {
  const shift = (whole: string, prefix: string | undefined, col: string, first: string, toCol: string | undefined, last: string | undefined): string => {
    const target = prefix === undefined ? undefined : prefix.slice(0, -1).replace(/^'(.*)'$/, '$1').replace(/''/g, '\'');
    if (target === undefined ? !own : target !== name) return whole;
    const from = Number(first) > at ? Number(first) - 1 : Number(first);
    if (toCol === undefined || last === undefined) return Number(first) === at ? '#REF!' : `${prefix ?? ''}${col}${from}`;
    const to = Number(last) >= at ? Number(last) - 1 : Number(last);
    return to < from ? '#REF!' : `${prefix ?? ''}${col}${from}:${toCol}${to}`;
  };
  return formula.split(/("(?:[^"]|"")*")/).map((part, k) => (k % 2 === 1 ? part : part.replace(REFERENCE, shift))).join('');
}

/**
 * Deletes row `at` of sheet `name` as Excel does: the rows below move up with their merges, and every formula of the
 * workbook that refers to a row below it is rewritten (shiftReferences). ExcelJS moves the cells, not the merges or the
 * references, so this does that part.
 */
function deleteRow(wb: ExcelJS.Workbook, name: string, at: number): void {
  const ws = sheet(wb, name);
  const moved = ws.model.merges.flatMap((range) => {
    const [, left, top, right, bottom] = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range) ?? [];
    if (left === undefined || right === undefined || Number(bottom) < at) return [];
    ws.unMergeCells(range);
    const from = Number(top) > at ? Number(top) - 1 : Number(top);
    const to = Number(bottom) - 1;
    return to < from ? [] : [`${left}${from}:${right}${to}`];
  });
  ws.spliceRows(at, 1);
  for (const range of moved) ws.mergeCells(range);
  for (const each of wb.worksheets) {
    each.eachRow((r) => r.eachCell((c) => {
      if (!isFormulaValue(c.value) || c.master.address !== c.address) return; // a merged cell shows its master's value
      const formula = shiftReferences(c.formula, each === ws, name, at);
      if (formula !== c.formula) c.value = { formula, result: c.result } as ExcelJS.CellFormulaValue;
    }));
  }
}

describe('importTracker — after a deleted row the tracker\'s footer moves up into the rows read: it is not data', () => {
  it('the helper deletes a row as Excel does: rows, merges and references move up', async () => {
    const wb = tracker();
    const dg = sheet(wb, 'Долги');
    dg.mergeCells('B25:D25');
    set(dg, {
      B25: 'ИТОГО', E25: { formula: 'SUM(E7:E24)' }, K25: { formula: 'IFERROR(F25/E25,0)' }, E10: { formula: 'E9+E11+$E$30' },
      E11: { formula: 'SUM(E10:E10)' }, F11: { formula: 'LEN("E24")+Долги!E24+\'Долги\'!$E$26+Журнал!E24' },
    });
    set(sheet(wb, 'Счета'), { E10: { formula: 'SUM(Долги!E7:E25)+E25' } });
    deleteRow(wb, 'Долги', 10);
    expect(dg.getCell('B24').value).toBe('ИТОГО');
    expect([dg.getCell('C24').master.address, dg.getCell('E24').isMerged, dg.getCell('B25').isMerged]).toEqual(['B24', false, false]);
    expect([dg.getCell('E24').formula, dg.getCell('K24').formula]).toEqual(['SUM(E7:E23)', 'IFERROR(F24/E24,0)']);
    expect([dg.getCell('E10').formula, dg.getCell('F10').formula])
      .toEqual(['SUM(#REF!)', 'LEN("E24")+Долги!E23+\'Долги\'!$E$25+Журнал!E24']);
    expect(sheet(wb, 'Счета').getCell('E10').formula).toBe('SUM(Долги!E7:E24)+E25');
  });

  it('a row deleted inside Постоянные, Покупки and Долги, two inside Журнал: the moved totals and note end the tables; no rows, no notes from them', async () => {
    const buf = await patchedFixture((wb) => {
      deleteRow(wb, 'Постоянные', 20); // the totals 38 and 39 move to 37 and 38; the input rows end on 36
      deleteRow(wb, 'Покупки', 10); // ИТОГО 19 → 18, its note 21 → 20
      deleteRow(wb, 'Долги', 10); // ИТОГО 25 → 24
      deleteRow(wb, 'Журнал', 1500);
      deleteRow(wb, 'Журнал', 1500); // the helpers end on 1507; the empty row under them 1510 → 1508, the note 1511 → 1509
      set(sheet(wb, 'Журнал'), { C1508: date('2026-10-20'), D1508: 'Расход', F1508: 'Поздняя', G1508: 40 });
      const rec = sheet(wb, 'Постоянные');
      expect([rec.getCell('B37').value, rec.getCell('B38').value, rec.getCell('B39').value]).toEqual(['Оплачено расходов', 'Получено доходов', null]);
      expect([rec.getCell('G37').formula, rec.getCell('L38').formula]).toEqual([
        'SUMPRODUCT(($D$8:$D$36<>"Доход")*$G$8:$G$36/(($H$8:$H$36<=1)+($H$8:$H$36>1)*$H$8:$H$36))',
        'SUMIFS(Постоянные!$AC$8:$AC$366,Постоянные!$Z$8:$Z$366,"Доход",Постоянные!$AD$8:$AD$366,L$6)',
      ]);
      expect([sheet(wb, 'Покупки').getCell('E18').formula, sheet(wb, 'Покупки').getCell('O18').formula]).toEqual(['SUM(E7:E17)', 'SUM(S7:S17)']);
      expect([sheet(wb, 'Долги').getCell('E24').formula, sheet(wb, 'Долги').getCell('K24').formula]).toEqual(['SUM(E7:E23)', 'IFERROR(F24/E24,0)']);
      expect(sheet(wb, 'Журнал').getCell('N1509').master.address).toBe('C1509');
    });
    const plain = await importTracker(fixture());
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.recurring.map((r) => r.what)).toEqual(plain.data.recurring.map((r) => r.what));
    expect(data.purchases.map((r) => r.what)).toEqual(plain.data.purchases.map((r) => r.what));
    expect(data.debts.map((r) => r.name)).toEqual(plain.data.debts.map((r) => r.name));
    expect(data.journal.map((r) => r.what)).toEqual([...plain.data.journal.map((r) => r.what), 'Поздняя']);
    expect(notes).toEqual([belowFormulas('Журнал', 1508)]);
    expect(overrides).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Fix round 1, item 1: a criterion is not a regular expression (a hyphen once made the whole import fail)

describe('importTracker — names and months with characters a regular expression treats specially', () => {
  it('an account «Т-Банк» named «Т-Банк », a category «Кафе-бары» named «Кафе-бары »: loaded, with the spaces note', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { N6: 'Т-Банк', N9: 'Альфа-Банк (зарплата)', J7: 'Кафе-бары' });
    set(sheet(wb, 'Операции'), {
      C10: date('2026-10-12'), D10: 'Расход', E10: 'Кафе-бары ', F10: 'Обед', G10: 30, H10: 'Т-Банк ',
      C11: date('2026-10-13'), D11: 'Перевод', F11: 'На зарплатную', G11: 50, H11: 'т-банк', I11: ' Альфа-Банк (зарплата)',
    });
    set(sheet(wb, 'Журнал'), { C10: date('2026-10-05'), D10: 'Расход', E10: 'кафе-бары', F10: 'Ужин', G10: 40, J10: 'Т-Банк' });
    const { data, notes } = await load(wb);
    const [tbank, alfa] = ['Т-Банк', 'Альфа-Банк (зарплата)'].map((n) => idOf(data, n));
    expect(data.operations.map((o) => [o.category, o.account, o.toAccount])).toEqual([['Кафе-бары', tbank, undefined], [undefined, tbank, alfa]]);
    expect(data.journal.map((r) => [r.category, r.account])).toEqual([['Кафе-бары', tbank]]);
    expect(notes).toEqual([
      spacedRef('Операции', 'E10', 'Кафе-бары ', 'категорией', 'Кафе-бары'), spacedRef('Операции', 'H10', 'Т-Банк ', 'счётом', 'Т-Банк'),
      spacedRef('Операции', 'I11', ' Альфа-Банк (зарплата)', 'счётом', 'Альфа-Банк (зарплата)'),
    ]);
  });

  it('Настройки C7 «10-2026» is no month name: January, as in Excel, with the note; the file is not refused', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C7: '10-2026', C9: '[Октябрь]' });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2026-01', '2026-01']);
    expect(notes).toEqual([
      `${at('Настройки', 'C7')}: «10-2026» — месяц не распознан; взят январь, как в Excel`,
      `${at('Настройки', 'C9')}: «[Октябрь]» — месяц не распознан; взят январь, как в Excel`,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 1, item 2: the footer is only the generator's own (build_tracker.py: Журнал C:N 261–264, Операции C:K
// 356–358, Постоянные B:F «Оплачено расходов»/«Получено доходов» 628–629, Покупки B:D «ИТОГО» 748 and its note
// C:P 756–758, Долги B:D «ИТОГО» 1162); a row with input below it is not loaded, but never silently

/** The one note of a row with input below the tracker's footer; `values` lists what it holds. */
const belowFooter = (sheetName: string, row: number, values: string): string =>
  `Лист «${sheetName}», строка ${row}: ниже ${['Журнал', 'Операции'].includes(sheetName) ? 'примечания под таблицей' : 'итоговой строки'}`
  + ` — в Excel не учитывается; не загружено: ${values}`;

describe('importTracker — the tracker\'s footer is told by its shape and label; nothing below it is lost silently', () => {
  it('the probe D: Долги with «Статус» cleared and a merged name: every row above ИТОГО is loaded (Excel sums them all)', async () => {
    const buf = await patchedFixture((wb) => {
      const dg = sheet(wb, 'Долги');
      for (let r = 20; r <= 24; r++) dg.getCell(`L${r}`).value = null;
      set(dg, { C21: 'Ипотека', E21: 1000 });
      dg.mergeCells('C22:D22');
      set(dg, { C22: 'Машина — кредит в банке', E22: 500, C23: 'Долг другу', E23: 200 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.debts.map(({ id: _id, ...rest }) => rest)).toEqual([
      { name: 'Ипотека', total: 1000 },
      { name: 'Машина — кредит в банке', total: 500 }, // D22 is merged into C22: empty, as in Excel, not the name again
      { name: 'Долг другу', total: 200 },
    ]);
    expect(notes).toEqual([]);
  }, 60_000);

  it('the probe E: Журнал with its helpers cleared at the end and a merged row there: every row is loaded, with its notes', async () => {
    const buf = await patchedFixture((wb) => {
      const jr = sheet(wb, 'Журнал');
      for (let r = 1500; r <= 1509; r++) for (const c of 'PQRSTU') jr.getCell(`${c}${r}`).value = null;
      set(jr, { C1501: date('2026-10-03'), D1501: 'Расход', F1501: 'A', G1501: 10 });
      jr.mergeCells('E1502:F1502');
      set(jr, { C1502: date('2026-10-04'), D1502: 'Расход', E1502: 'B merged', G1502: 20 });
      set(jr, { C1503: date('2026-10-05'), D1503: 'Расход', F1503: 'C', G1503: 30 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.journal.slice(-3).map((r) => [r.date, r.category, r.what, r.plan])).toEqual([
      ['2026-10-03', undefined, 'A', 10], ['2026-10-04', 'B merged', '', 20], ['2026-10-05', undefined, 'C', 30],
    ]);
    expect(notes).toEqual([
      belowFormulas('Журнал', 1501),
      belowFormulas('Журнал', 1502), noWhat('Журнал', 1502), // F1502 is merged into E1502: empty in Excel too
      belowFormulas('Журнал', 1503),
    ]);
  }, 60_000);

  it('a row with input below the footer, on every sheet: not loaded (nothing in Excel sums it), one note with its values', async () => {
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Журнал'), { C1513: date('2026-10-20'), D1513: 'Расход', F1513: 'Под примечанием', G1513: 40 }); // note on 1511
      set(sheet(wb, 'Операции'), { C1012: date('2026-10-21'), F1012: 'Кофе', G1012: 3 }); // note on 1011
      set(sheet(wb, 'Постоянные'), { C41: 'Спортзал', G41: 30, L41: '✓' }); // totals on 38 and 39
      set(sheet(wb, 'Покупки'), { C20: 'Лампа', E20: 20, C23: 'Стол', N23: '✓' }); // ИТОГО on 19, the generator's note on 21
      set(sheet(wb, 'Долги'), { C27: 'Сестре', E27: { formula: 'E7', result: 100 } }); // ИТОГО on 25
    });
    const plain = await importTracker(fixture());
    const { data, notes, overrides } = await importTracker(buf);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(notes).toEqual([
      belowFooter('Операции', 1012, 'C «2026-10-21», F «Кофе», G «3»'),
      belowFooter('Журнал', 1513, 'C «2026-10-20», D «Расход», F «Под примечанием», G «40»'),
      belowFooter('Постоянные', 41, 'C «Спортзал», G «30», L «✓»'),
      belowFooter('Покупки', 20, 'C «Лампа», E «20»'), belowFooter('Покупки', 23, 'C «Стол», N «✓»'),
      belowFooter('Долги', 27, 'C «Сестре», E «100»'),
    ]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('a merge that is not the footer\'s shape, or has not its label, does not end the table', async () => {
    const buf = await patchedFixture((wb) => {
      const dg = sheet(wb, 'Долги');
      dg.mergeCells('B20:D20'); // anchored in B like ИТОГО, but another label
      set(dg, { B20: 'Итого по кредитам', E20: 50, C21: 'Сестре', E21: 100 });
      const bu = sheet(wb, 'Покупки');
      bu.mergeCells('C15:D15'); // not anchored in B
      set(bu, { C15: 'ИТОГО', E15: 10, C16: 'Лампа', E16: 20 });
      const op = sheet(wb, 'Операции');
      op.mergeCells('C500:J500'); // C:J, not C:K
      set(op, { C500: 'Знак суммы не важен', C501: date('2026-10-21'), D501: 'Расход', F501: 'Кофе', G501: 3 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.debts.map((r) => [r.name, r.total])).toEqual([['', 50], ['Сестре', 100]]);
    expect(data.purchases.slice(-2).map((r) => [r.what, r.cost])).toEqual([['ИТОГО', 10], ['Лампа', 20]]);
    expect(data.operations.at(-1)).toMatchObject({ date: '2026-10-21', what: 'Кофе', amount: 3 });
    expect(notes).toEqual([
      'Операции, строка 500: дата «Знак суммы не важен» не распознана — строка не загружена',
      noWhat('Долги', 20, 'Название'),
    ]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Fix round 1, item 3: a table is read down to its footer (or, without one, to its last row), not to a fixed row

/**
 * Inserts `count` empty rows before row `at`, as Excel does: the rows below move down with their formulas. ExcelJS
 * moves the cells but does not rewrite references, so `rewrite` does that for references to input rows as $C{row}
 * (what «Постоянные» expansions use to find their rows).
 */
function insertRows(ws: ExcelJS.Worksheet, at: number, count: number, rewrite = false): void {
  ws.spliceRows(at, 0, ...Array.from({ length: count }, (): ExcelJS.CellValue[] => []));
  if (!rewrite) return;
  ws.eachRow((r) => r.eachCell((c) => {
    if (!isFormulaValue(c.value)) return;
    const formula = c.formula.replace(/(?<![!\w$])\$C(\d+)/g, (whole, n: string) => (Number(n) >= at ? `$C${Number(n) + count}` : whole));
    c.value = { formula } as ExcelJS.CellFormulaValue;
  }));
}

describe('importTracker — rows inserted by the user: every table is read down to its footer', () => {
  /** Input in the last rows of every table, where inserted rows push it past the rows the tracker was made with. */
  function lastRows(wb: ExcelJS.Workbook): void {
    set(sheet(wb, 'Журнал'), {
      C1507: date('2026-10-18'), D1507: 'Расход', F1507: 'Первая', G1507: 10, J1507: 'Карта',
      C1509: date('2026-10-20'), D1509: 'Доход', F1509: 'Последняя', H1509: 40, M1509: 'Ноябрь 2026',
    });
    set(sheet(wb, 'Операции'), { C1009: date('2026-10-21'), D1009: 'Расход', E1009: 'Продукты', F1009: 'Кофе', G1009: 3, H1009: 'Наличные' });
    set(sheet(wb, 'Постоянные'), { C37: 'Спортзал', D37: 'Расход', G37: 30, K37: 'Карта', L37: '✓' });
    set(sheet(wb, 'Покупки'), { C18: 'Лампа', E18: 20 });
    set(sheet(wb, 'Долги'), { C24: 'Сестре', E24: 100 });
  }

  it('3 rows inserted in Журнал and Операции (and some in the other tables): every row is imported, with no notes', async () => {
    const plain = await importTracker(await patchedFixture(lastRows));
    const buf = await patchedFixture((wb) => {
      lastRows(wb);
      insertRows(sheet(wb, 'Журнал'), 12, 3); // the last row moves to 1512, the note under the table to 1514
      insertRows(sheet(wb, 'Операции'), 12, 3); // 1009 → 1012, the note 1011 → 1014
      insertRows(sheet(wb, 'Постоянные'), 20, 1, true); // 37 → 38, the totals 38/39 → 39/40
      insertRows(sheet(wb, 'Покупки'), 10, 2); // 18 → 20, ИТОГО 19 → 21
      insertRows(sheet(wb, 'Долги'), 10, 2); // 24 → 26, ИТОГО 25 → 27
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(plain.notes).toEqual([]);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(data.journal.at(-1)).toMatchObject({ what: 'Последняя', fact: 40, month: '2026-11' });
    expect([data.operations.at(-1)?.what, data.recurring.at(-1)?.what, data.purchases.at(-1)?.what, data.debts.at(-1)?.name])
      .toEqual(['Кофе', 'Спортзал', 'Лампа', 'Сестре']);
    expect(notes).toEqual([]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('a number typed over a formula of a row moved below the tracker\'s original last row is still listed', async () => {
    const buf = await patchedFixture((wb) => {
      lastRows(wb);
      insertRows(sheet(wb, 'Журнал'), 12, 3);
      insertRows(sheet(wb, 'Операции'), 12, 3);
      set(sheet(wb, 'Журнал'), { N1512: 'дубль?' });
      set(sheet(wb, 'Операции'), { K1012: 'нет' });
    });
    const { overrides } = await importTracker(buf);
    expect(overrides).toEqual(['Операции!K1012 = нет', 'Журнал!N1512 = дубль?']);
  }, 60_000);

  it('a table without the generator\'s footer (a hand-made workbook) is read down to its last row with input', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), { C2000: date('2026-10-05'), D2000: 'Расход', F2000: 'Далеко', G2000: 100 });
    set(sheet(wb, 'Операции'), { C1500: date('2026-10-06'), D1500: 'Расход', F1500: 'Тоже', G1500: 5 });
    set(sheet(wb, 'Постоянные'), { C60: 'Аренда', G60: 900 });
    set(sheet(wb, 'Покупки'), { C30: 'Лампа', E30: 20 });
    set(sheet(wb, 'Долги'), { C40: 'Сестре', E40: 100 });
    const { data, notes } = await load(wb);
    expect([data.journal, data.operations, data.recurring, data.purchases].map((rows) => rows.map((r) => r.what)))
      .toEqual([['Далеко'], ['Тоже'], ['Аренда'], ['Лампа']]);
    expect(data.debts.map((r) => r.name)).toEqual(['Сестре']);
    expect(notes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 1, item 4: a helper typed over is an override, not a row below the formulas

describe('importTracker — a value typed over the helper that tells where the formulas end is listed, not noted', () => {
  it('Журнал P, Операции Q, Покупки R on the last row with input: in overrides; the row gets no «ниже формул» note', async () => {
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Журнал'), { C1509: date('2026-10-20'), D1509: 'Расход', F1509: 'Поздняя', G1509: 40, H1509: 40, P1509: 40 });
      set(sheet(wb, 'Операции'), { C1009: date('2026-10-21'), D1009: 'Расход', F1009: 'Кофе', G1009: 3, H1009: 'Наличные', Q1009: 3 });
      set(sheet(wb, 'Покупки'), { C18: 'Лампа', E18: 20, R18: 20 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect([data.journal.at(-1)?.what, data.operations.at(-1)?.what, data.purchases.at(-1)?.what]).toEqual(['Поздняя', 'Кофе', 'Лампа']);
    expect(notes).toEqual([]);
    expect(overrides).toEqual(['Операции!Q1009 = 3', 'Журнал!P1509 = 40', 'Покупки!R18 = 20']);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Fix round 1, item 5: the year on Настройки goes through DATE (which takes a number typed as text); Журнал «Месяц
// учёта» through MATCH($M, ACC_LABELS, 0) (build_tracker.py 227–228), which reads wildcards

describe('importTracker — Настройки C6/C8: a year typed as text is what Excel\'s DATE takes it for', () => {
  it('digits typed as text: no note (DATE(C6,…) and DATE(C8,…) turn "2026" into 2026, the same year)', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C6: '2027', C8: { richText: [{ text: '2026' }] } });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2027-10', '2026-10']);
    expect(notes).toEqual([]);
  });

  it('other text the app reads as a whole year: loaded as the number, with a note that says only that', async () => {
    const wb = tracker();
    set(sheet(wb, 'Настройки'), { C6: '2026,0', C8: ' 2026 ' });
    const { data, notes } = await load(wb);
    expect([data.settings.forecastStart, data.settings.accountingStart]).toEqual(['2026-10', '2026-10']);
    expect(notes).toEqual([
      `${at('Настройки', 'C6')}: «2026,0» — текст; загружено как число`,
      `${at('Настройки', 'C8')}: «2026» — текст; загружено как число`,
    ]);
  });
});

describe('importTracker — Журнал «Месяц учёта» with wildcards: the accounting month Excel\'s MATCH takes', () => {
  it('the first of the 12 labels the text matches (ignoring case, not spaces), with a note; none: the month of the date', async () => {
    const wb = tracker(); // accounting year October 2026 … September 2027
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-30'), D10: 'Доход', F10: 'ЗП', G10: 400, M10: 'ноя*',
      C11: date('2026-10-05'), D11: 'Расход', F11: 'Еда', G11: 100, M11: '*2027', // the first label of 2027: January
      C12: date('2026-10-06'), F12: 'Кафе', G12: 20, M12: 'Окт??рь 2026', // the month of the date: nothing kept, still a note
      C13: date('2026-10-07'), F13: 'Кино', G13: 20, M13: 'Дек?', // matches no label: the month of the date
      C14: date('2026-10-08'), F14: 'Такси', G14: 20, M14: ' Ноя*', // with a space in front it matches none either
      C15: date('2026-10-09'), F15: 'Книга', G15: 20, M15: 'Ноябрь-2026',
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => r.month)).toEqual(['2026-11', '2027-01', undefined, undefined, undefined, undefined]);
    const pattern = (row: number, raw: string, label: string): string =>
      `Журнал, строка ${row}: месяц учёта «${raw}» — шаблон, а не название месяца; взят «${label}», как в Excel`;
    expect(notes).toEqual([
      pattern(10, 'ноя*', 'Ноябрь 2026'), pattern(11, '*2027', 'Январь 2027'), pattern(12, 'Окт??рь 2026', 'Октябрь 2026'),
      'Журнал, строка 13: месяц учёта «Дек?» не распознан — взят месяц даты',
      'Журнал, строка 14: месяц учёта « Ноя*» не распознан — взят месяц даты', // as typed: the space is why none matches
      'Журнал, строка 15: месяц учёта «Ноябрь-2026» не распознан — взят месяц даты',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 2, item 1: a totals row is told by its formulas, whatever its label (build_tracker.py: Постоянные G =
// SUMPRODUCT(…$G$8:$G$37…) on R_BOT+1 and +2, 628–631, months SUMIFS 633–634; Покупки ИТОГО E, F, H, J = SUM,
// O = SUM(S) on B_BOT+1, 747–752; Долги ИТОГО E, F, G, I = SUM, K = IFERROR(F/E,0) on DG_BOT+1, 1161–1166)

/** Gives the formulas of a row the results Excel stores with them (a file saved by Excel has them). */
function cache(ws: ExcelJS.Worksheet, row: number, results: Record<string, ExcelJS.CellValue>): void {
  for (const [col, result] of Object.entries(results)) {
    const c = ws.getCell(`${col}${row}`);
    if (!isFormulaValue(c.value)) throw new Error(`${ws.name}!${col}${row} holds no formula`);
    c.value = { formula: c.formula, result } as ExcelJS.CellFormulaValue;
  }
}

/** The totals rows of the fixture with the results of its data (Долги gets a debt on row 7 to sum). */
function cachedTotals(wb: ExcelJS.Workbook): void {
  const dg = sheet(wb, 'Долги');
  set(dg, { C7: 'Кредит', E7: 1000, F7: 100, I7: 50 });
  cache(dg, 25, { E: 1000, F: 100, G: 900, I: 50, K: 0.1 });
  cache(sheet(wb, 'Покупки'), 19, { E: 500, F: 0, H: 500, J: 100, O: 0 });
  const rec = sheet(wb, 'Постоянные');
  // the months' results as the scenario has them (ExcelJS drops a cached 0, so only the others are written)
  cache(rec, 38, { G: 940, L: 900, M: 960 });
  cache(rec, 39, { G: 200, L: 200 });
}

/** The one note of a row without a name whose cells the import reads hold only formulas. */
const formulaRow = (sheetName: string, row: number): string =>
  `Лист «${sheetName}», строка ${row}: строка из формул без названия — не загружена`;

describe('importTracker — a totals row is told by its formulas: renamed or unmerged, it is never loaded as data', () => {
  it('each totals label renamed, the results cached as Excel saves them: the table ends there, no extra row, no notes', async () => {
    const plain = await importTracker(await patchedFixture(cachedTotals));
    const buf = await patchedFixture((wb) => {
      cachedTotals(wb);
      set(sheet(wb, 'Долги'), { B25: 'Итого:' });
      set(sheet(wb, 'Покупки'), { B19: 'Всего' });
      set(sheet(wb, 'Постоянные'), { B38: 'Расходы', B39: 'Доходы' });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(plain.notes).toEqual([]);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(data.debts.map((d) => [d.name, d.total, d.paid])).toEqual([['Кредит', 1000, 100]]);
    expect(notes).toEqual([]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('each totals label unmerged (the label left in B), the results cached: the same', async () => {
    const plain = await importTracker(await patchedFixture(cachedTotals));
    const buf = await patchedFixture((wb) => {
      cachedTotals(wb);
      sheet(wb, 'Долги').unMergeCells('B25:D25');
      sheet(wb, 'Покупки').unMergeCells('B19:D19');
      sheet(wb, 'Постоянные').unMergeCells('B38:F38');
      sheet(wb, 'Постоянные').unMergeCells('B39:F39');
      sheet(wb, 'Постоянные').unMergeCells('H38:J38');
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(notes).toEqual([]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('a table without a footer (a hand-made workbook) still stops at a totals row: SUM or SUMPRODUCT over the rows above', async () => {
    const wb = tracker();
    set(sheet(wb, 'Долги'), {
      C7: 'Кредит', E7: 1000, C8: 'Сестре', E8: 200,
      E9: { formula: 'SUM(E7:E8)', result: 1200 } as ExcelJS.CellFormulaValue, B9: 'Всего',
    });
    set(sheet(wb, 'Покупки'), { C7: 'Лампа', E7: 20, F10: { formula: 'SUM($F$7:$F$9)', result: 0 } as ExcelJS.CellFormulaValue });
    set(sheet(wb, 'Постоянные'), {
      C8: 'Аренда', G8: 900,
      G9: { formula: 'SUMPRODUCT(($D$8:$D$8<>"Доход")*$G$8:$G$8/(($H$8:$H$8<=1)+($H$8:$H$8>1)*$H$8:$H$8))', result: 900 } as ExcelJS.CellFormulaValue,
    });
    const { data, notes } = await load(wb);
    expect(data.debts.map((d) => [d.name, d.total])).toEqual([['Кредит', 1000], ['Сестре', 200]]);
    expect(data.purchases.map((p) => [p.what, p.cost])).toEqual([['Лампа', 20]]);
    expect(data.recurring.map((r) => [r.what, r.amount])).toEqual([['Аренда', 900]]);
    expect(notes).toEqual([]);
  });

  it('a row without a name whose read cells hold only formulas is not loaded, with one note; one typed value makes it a row', async () => {
    const f = (formula: string, result: ExcelJS.CellValue) => ({ formula, result }) as ExcelJS.CellFormulaValue;
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Постоянные'), { G20: f('G8+G9', 1100), L20: f('L8', '✓'), G21: f('G8', 900), K21: 'Карта' });
      set(sheet(wb, 'Покупки'), { E12: f('E7', 500), O12: f('E7-20', 480), E13: f('E7', 500), N13: '✓' });
      set(sheet(wb, 'Долги'), { C20: f('""', ''), E20: f('E7*2', 2000), I20: f('I7', 50), E21: f('E7+7', 7), H21: 0.1 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.recurring.at(-1)).toMatchObject({ what: '', amount: 900 });
    expect(data.purchases.at(-1)).toMatchObject({ what: '', cost: 500, bought: true });
    expect(data.debts.map((d) => [d.name, d.total, d.rate])).toEqual([['', 7, 0.1]]);
    expect(notes).toEqual([
      formulaRow('Постоянные', 20), noWhatRecurring(21),
      formulaRow('Покупки', 12), noWhatExcelFactOnly(13),
      formulaRow('Долги', 20), noWhat('Долги', 21, 'Название'),
    ]);
  }, 60_000);

  it('Журнал and Операции have no totals row: a row there needs a date and, without a name, is loaded with its note, as before', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: { formula: 'DATE(2026,10,5)', result: date('2026-10-05') } as ExcelJS.CellFormulaValue, G10: { formula: '50*2', result: 100 } as ExcelJS.CellFormulaValue,
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => [r.date, r.what, r.plan])).toEqual([['2026-10-05', '', 100]]);
    expect(notes).toEqual([noWhat('Журнал', 10)]);
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 2, item 2: a copy of the footer inside a table does not end it. A note under the table (Журнал,
// Операции, Покупки) is the footer only below the last row with the sheet's helper (P, Q, R: every row of the table
// has it); a totals row only by its formulas: SUM over the table from its top down to a row above (a copy of the
// row pasted higher up sums from above the table's top), SUMPRODUCT on «Постоянные»

describe('importTracker — a copy of the footer or its label inside a table does not end it', () => {
  it('the probes: Долги B21:D21 «ИТОГО» with a number in E21; Журнал C1400:N1400 «Факт: …»: every row below is loaded', async () => {
    const buf = await patchedFixture((wb) => {
      const dg = sheet(wb, 'Долги');
      dg.mergeCells('B21:D21');
      set(dg, { B21: 'ИТОГО', E21: 1000, C22: 'Долг другу', E22: 200 });
      const jr = sheet(wb, 'Журнал');
      jr.mergeCells('C1400:N1400');
      set(jr, { C1400: 'Факт: заметка на полях' });
      set(jr, { C1401: date('2026-10-08'), D1401: 'Расход', F1401: 'Y', G1401: 8 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.debts.map((d) => [d.name, d.total])).toEqual([['', 1000], ['Долг другу', 200]]); // Excel's ИТОГО sums both
    expect(data.journal.at(-1)).toMatchObject({ date: '2026-10-08', what: 'Y', plan: 8 });
    expect(notes).toEqual([
      noWhat('Долги', 21, 'Название'), // C21 is merged into B21: empty, as in Excel
    ]); // the note-shaped row of Журнал is skipped without a note, as the generator's own note is (round 4)
  }, 60_000);

  it('the same on the other sheets: the Операции note, the labels of Постоянные and Покупки with a number beside them', async () => {
    const buf = await patchedFixture((wb) => {
      const op = sheet(wb, 'Операции');
      op.mergeCells('C500:K500');
      set(op, { C500: 'Знак суммы не важен: копия', C501: date('2026-10-21'), D501: 'Расход', F501: 'Кофе', G501: 3, H501: 'Карта' });
      const rec = sheet(wb, 'Постоянные');
      rec.mergeCells('B20:F20');
      set(rec, { B20: 'Оплачено расходов', G20: 30, C21: 'Спортзал', G21: 40 });
      const bu = sheet(wb, 'Покупки');
      bu.mergeCells('B12:D12');
      set(bu, { B12: 'ИТОГО', E12: 50, C13: 'Лампа', E13: 20 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.operations.at(-1)).toMatchObject({ date: '2026-10-21', what: 'Кофе', amount: 3 });
    expect(data.recurring.slice(-2).map((r) => [r.what, r.amount])).toEqual([['', 30], ['Спортзал', 40]]);
    expect(data.purchases.slice(-2).map((p) => [p.what, p.cost])).toEqual([['', 50], ['Лампа', 20]]);
    expect(notes).toEqual([
      noWhatRecurring(20), // the note-shaped row 500 of Операции is skipped without a note (round 4)
      noWhatExcelSkips('Покупки', 12, 'Что покупаем'),
    ]);
  }, 60_000);

  it('the whole Долги ИТОГО row copied higher up, as Excel pastes it (SUM(E3:E20) on row 21): not the end; a row of formulas', async () => {
    const buf = await patchedFixture((wb) => {
      const dg = sheet(wb, 'Долги');
      dg.mergeCells('B21:D21');
      set(dg, { B21: 'ИТОГО', C7: 'Кредит', E7: 1000, C22: 'Долг другу', E22: 200 });
      for (const col of ['E', 'F', 'G', 'I']) dg.getCell(`${col}21`).value = { formula: `SUM(${col}3:${col}20)`, result: 1000 } as ExcelJS.CellFormulaValue;
    });
    const { data, notes } = await importTracker(buf);
    expect(data.debts.map((d) => [d.name, d.total])).toEqual([['Кредит', 1000], ['Долг другу', 200]]);
    expect(notes).toEqual([formulaRow('Долги', 21)]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Fix round 2, item 3: a value typed on a totals row itself is not lost silently: over one of the generator's
// formulas it is listed in overrides (Excel shows it as the total; the app ignores it), anywhere else it gets one
// note. Nothing reads a cell of a totals row: every range of the tracker ends above it

/** The one note of a totals row with values typed in cells the generator leaves empty. */
const onTotals = (sheetName: string, row: number, values: string, several = false): string =>
  `Лист «${sheetName}», строка ${row}: ${several ? 'значения в итоговой строке — не загружены' : 'значение в итоговой строке — не загружено'}: ${values}`;

/** Types a date into a cell as Excel does: the cell takes a date format (the totals rows' cells have none). */
function typeDate(ws: ExcelJS.Worksheet, address: string, iso: string): void {
  ws.getCell(address).value = date(iso);
  ws.getCell(address).numFmt = 'dd.mm.yyyy';
}

describe('importTracker — a value typed on a totals row: an override over its formula, a note elsewhere; the row is still the totals', () => {
  it('the probe: Долги E25 typed over the SUM, a date in Покупки G19', async () => {
    const plain = await importTracker(fixture());
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Долги'), { E25: 12345 });
      typeDate(sheet(wb, 'Покупки'), 'G19', '2026-12-01');
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(notes).toEqual([onTotals('Покупки', 19, 'G «2026-12-01»')]);
    expect(overrides).toEqual(['Долги!E25 = 12345']);
  }, 60_000);

  it('on every totals row, «Постоянные» G38 typed over too (the row is still told by its months\' SUMIFS), results cached', async () => {
    const plain = await importTracker(await patchedFixture(cachedTotals));
    const buf = await patchedFixture((wb) => {
      cachedTotals(wb);
      set(sheet(wb, 'Постоянные'), { G38: 940, K38: 'Карта', M39: 5, K39: 'Карта' });
      set(sheet(wb, 'Покупки'), { O19: 480, L19: 'Срочно', N19: '✓' });
      set(sheet(wb, 'Долги'), { H25: 0.1, K25: 0.5 });
      typeDate(sheet(wb, 'Долги'), 'J25', '2026-11-01');
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(notes).toEqual([
      onTotals('Постоянные', 38, 'K «Карта»'), onTotals('Постоянные', 39, 'K «Карта»'),
      onTotals('Покупки', 19, 'L «Срочно», N «✓»', true),
      onTotals('Долги', 25, 'H «0.1», J «2026-11-01»', true),
    ]);
    expect(overrides).toEqual(['Постоянные!G38 = 940', 'Постоянные!M39 = 5', 'Покупки!O19 = 480', 'Долги!K25 = 0.5']);
  }, 60_000);

  it('the generator\'s own label on a totals row («← в среднем в месяц», merged or not) is not a value typed there', async () => {
    const buf = await patchedFixture((wb) => {
      sheet(wb, 'Постоянные').unMergeCells('H38:J38');
    });
    const { notes, overrides } = await importTracker(buf);
    expect(notes).toEqual([]);
    expect(overrides).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Fix round 2, item 4: the Журнал «Месяц учёта» note shows the value as typed, spaces and all (as C7/C9 do): the
// spaces are why MATCH($M, …, 0) (build_tracker.py 227–228) finds nothing

describe('importTracker — Журнал «Месяц учёта» not recognised: the note shows the value as it was typed', () => {
  it('spaces around a pattern or a word are kept in the note; a line break is shown as a space', async () => {
    const wb = tracker();
    set(sheet(wb, 'Журнал'), {
      C10: date('2026-10-08'), F10: 'Такси', G10: 20, M10: ' Ноя*',
      C11: date('2026-10-09'), F11: 'Книга', G11: 20, M11: 'ноя* ',
      C12: date('2026-10-10'), F12: 'Кино', G12: 20, M12: 'ноябрь\n',
      C13: date('2026-10-11'), F13: 'Чай', G13: 20, M13: 7,
    });
    const { data, notes } = await load(wb);
    expect(data.journal.map((r) => r.month)).toEqual([undefined, undefined, undefined, undefined]);
    expect(notes).toEqual([
      'Журнал, строка 10: месяц учёта « Ноя*» не распознан — взят месяц даты',
      'Журнал, строка 11: месяц учёта «ноя* » не распознан — взят месяц даты',
      'Журнал, строка 12: месяц учёта «ноябрь » не распознан — взят месяц даты',
      'Журнал, строка 13: месяц учёта «7» не распознан — взят месяц даты',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Fix round 2, item 5 (follow-up 21): a row the user inserts inside a table gets none of the sheet's formulas (Excel
// does not fill them in), so Excel does not count it through them, while the app loads it. Журнал, Операции and
// Покупки: its own helper P, Q or R (224, 331, 728); Постоянные: no expansion refers to it (651–658, 676–681).
// The totals over the input columns do grow over it (Постоянные G38, Покупки ИТОГО E and F), as the note says

/**
 * The one row note of a row with input among the table's rows that has none of the tracker's formulas. «В суммах»: the
 * tracker's row counters over the input columns, whose ranges grow over an inserted row, do count it (Операции
 * «Строк без счёта», Счета «Оплачено без счёта — строк» and «Переводов без «на счёт»», build_tracker.py 281, 442–447).
 */
const noOwnFormulas = (sheetName: string, row: number, except = ''): string =>
  `Лист «${sheetName}», строка ${row}: у строки нет формул трекера — в суммах Excel не учитывается${except}; загружено`;

describe('importTracker — a row inserted inside a table (none of the tracker\'s formulas) is loaded, with one note', () => {
  it('on every sheet with such formulas; none on Долги (its ИТОГО sums its input columns, so Excel counts the row)', async () => {
    const buf = await patchedFixture((wb) => {
      insertRows(sheet(wb, 'Журнал'), 12, 1);
      set(sheet(wb, 'Журнал'), { C12: date('2026-10-20'), D12: 'Расход', F12: 'Вставка', G12: 40, H12: 'сорок' });
      insertRows(sheet(wb, 'Операции'), 12, 1);
      set(sheet(wb, 'Операции'), { C12: date('2026-10-21'), D12: 'Расход', F12: 'Кофе', G12: 3, H12: 'Наличные' });
      insertRows(sheet(wb, 'Постоянные'), 20, 1, true);
      set(sheet(wb, 'Постоянные'), { C20: 'Спортзал', D20: 'Расход', G20: 30, K20: 'Карта' });
      insertRows(sheet(wb, 'Покупки'), 10, 1);
      set(sheet(wb, 'Покупки'), { C10: 'Лампа', E10: 20 });
      insertRows(sheet(wb, 'Долги'), 10, 1);
      set(sheet(wb, 'Долги'), { C10: 'Сестре', E10: 100 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.journal.find((r) => r.what === 'Вставка')).toMatchObject({ date: '2026-10-20', plan: 40 });
    expect(data.operations.find((r) => r.what === 'Кофе')).toMatchObject({ date: '2026-10-21', amount: 3 });
    expect(data.recurring.find((r) => r.what === 'Спортзал')).toMatchObject({ amount: 30, account: idOf(data, 'Карта') });
    expect(data.purchases.find((r) => r.what === 'Лампа')).toMatchObject({ cost: 20 });
    expect(data.debts.map((r) => [r.name, r.total])).toEqual([['Сестре', 100]]);
    expect(notes).toEqual([
      noOwnFormulas('Операции', 12),
      noOwnFormulas('Журнал', 12), unreadable('Журнал', 'H12', 'сорок'), // the row note first
      noOwnFormulas('Постоянные', 20, EXCEPT_AVERAGE),
      noOwnFormulas('Покупки', 10, EXCEPT_TOTALS),
    ]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('a row not loaded (no date) gets only the note that says so; a nameless one the plain name note; a typed helper is no gap', async () => {
    const buf = await patchedFixture((wb) => {
      insertRows(sheet(wb, 'Журнал'), 12, 2);
      set(sheet(wb, 'Журнал'), { D12: 'Расход', G12: 40, C13: date('2026-10-22'), F13: 'С хелпером', G13: 5, P13: 5 });
      insertRows(sheet(wb, 'Постоянные'), 20, 1, true);
      set(sheet(wb, 'Постоянные'), { G20: 35 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.recurring.find((r) => r.amount === 35)?.what).toBe('');
    expect(notes).toEqual([
      'Журнал, строка 12: нет даты — строка не загружена',
      noOwnFormulas('Постоянные', 20, EXCEPT_AVERAGE), noWhat('Постоянные', 20),
    ]);
    expect(overrides).toEqual(['Журнал!P13 = 5']);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Fix round 3, item 1: a totals row inside a table does not end it. The table ends at the first of the generator's
// rows under it that no later totals row reaches: a later SUM or SUMPRODUCT over the rows above whose range ends at or
// below that row means Excel counts the rows in between. A totals row a later one reaches is not loaded, with one note

/** The one note of a totals row inside a table: a later totals row sums over it. */
const insideTotals = (sheetName: string, row: number): string =>
  `Лист «${sheetName}», строка ${row}: строка с суммой строк выше — не загружена`;

/** A formula with the result Excel stores with it (none when `result` is undefined, as ExcelJS writes a new formula). */
const formulaOf = (formula: string, result?: ExcelJS.CellValue): ExcelJS.CellFormulaValue =>
  (result === undefined ? { formula } : { formula, result }) as ExcelJS.CellFormulaValue;

/**
 * The reviewer's probes A1–A3b: Долги debts on 7 and 8, the user's subtotal on 9 (SUM(X7:X8) in `cols`), more debts on
 * 10 and 11. ИТОГО (25) sums them all, the subtotal too, as Excel has it.
 */
function debtSubtotal(wb: ExcelJS.Workbook, name: string | null, cached: boolean, cols = ['E']): void {
  const dg = sheet(wb, 'Долги');
  set(dg, { C7: 'К1', E7: 100, C8: 'К2', E8: 200, C10: 'После', E10: 400, C11: 'Ещё', E11: 50 });
  const results: Record<string, number> = { E: 300, F: 0, G: 300, I: 0 };
  for (const col of cols) dg.getCell(`${col}9`).value = formulaOf(`SUM(${col}7:${col}8)`, cached ? results[col] : undefined);
  if (name !== null) set(dg, { C9: name });
  cache(dg, 25, { E: 1050, G: 1050 });
}

describe('importTracker — a totals row inside a table: a later totals row sums over it, so the table goes on', () => {
  it.each([
    ['A1: without a name, its result cached', null, true, ['E']],
    ['A2: named «Подытог» (the same note, no second one)', 'Подытог', true, ['E']],
    ['A3: without its result (as ExcelJS writes a formula)', null, false, ['E']],
    ['A3b: in E, F, G and I, as ИТОГО has them', null, true, ['E', 'F', 'G', 'I']],
  ] as const)('the probe %s: every debt is loaded; only the subtotal row gets a note', async (_, name, cached, cols) => {
    const buf = await patchedFixture((wb) => debtSubtotal(wb, name, cached, [...cols]));
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.debts.map((d) => [d.name, d.total])).toEqual([['К1', 100], ['К2', 200], ['После', 400], ['Ещё', 50]]);
    expect(notes).toEqual([insideTotals('Долги', 9)]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('the probe A5: the user\'s SUM(E7:E24) under ИТОГО ends above it, so ИТОГО ends the table; the row between is noted, not loaded', async () => {
    const buf = await patchedFixture((wb) => {
      const dg = sheet(wb, 'Долги');
      set(dg, { C7: 'К1', E7: 100, C27: 'Под итогом', E27: 5, E30: formulaOf('SUM(E7:E24)', 100) });
      cache(dg, 25, { E: 100, G: 100 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.debts.map((d) => [d.name, d.total])).toEqual([['К1', 100]]);
    expect(notes).toEqual([belowFooter('Долги', 27, 'C «Под итогом», E «5»')]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('Покупки (the probe A8): subtotals among the rows with the helper, named or not, are not purchases', async () => {
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Покупки'), {
        C8: 'Лампа', E8: 20, E12: formulaOf('SUM(E7:E11)', 520), C14: 'Подытог', E14: formulaOf('SUM(E7:E13)', 1040), C15: 'Стол', E15: 40,
      });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.purchases.map((p) => [p.what, p.cost])).toEqual([['Ноутбук', 500], ['Лампа', 20], ['Стол', 40]]);
    expect(notes).toEqual([insideTotals('Покупки', 12), insideTotals('Покупки', 14)]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('Постоянные: the second totals row sums the table, not the first one (its range ends above 38), so 38 ends it', async () => {
    const plain = await importTracker(await patchedFixture(cachedTotals));
    const buf = await patchedFixture((wb) => {
      cachedTotals(wb);
      set(sheet(wb, 'Постоянные'), { C40: 'Спортзал', G40: 30 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(plain.notes).toEqual([]);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(notes).toEqual([belowFooter('Постоянные', 40, 'C «Спортзал», G «30»')]);
    expect(overrides).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Fix round 3, item 2: a totals row with every one of the generator's formulas typed over («Вставить значения») is no
// totals row by its formulas any more; by its label — merged from B as the generator writes it, «Оплачено расходов» and
// «Получено доходов» over B:F (build_tracker.py 629), «ИТОГО» over B:D (748, 1162) — it is not data either

/** The one note of a totals row without its formulas; `values` lists what it holds. */
const bareTotals = (sheetName: string, row: number, values: string): string =>
  `Лист «${sheetName}», строка ${row}: итоговая строка без формул — не загружена: ${values}`;

describe('importTracker — a totals row with its formulas typed over is not loaded: one note, and the table goes on', () => {
  it('the probe B1: values pasted over Долги ИТОГО (E, F, G, I, K); a debt typed below it is still read', async () => {
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Долги'), { C7: 'К1', E7: 100, F7: 10, E25: 100, F25: 10, G25: 90, I25: 0, K25: 0.1, C27: 'Под итогом', E27: 5 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.debts.map((d) => [d.name, d.total])).toEqual([['К1', 100], ['Под итогом', 5]]);
    expect(notes).toEqual([bareTotals('Долги', 25, 'E «100», F «10», I «0»')]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('the probe B2: values pasted over Покупки ИТОГО (E, F, H, J, O)', async () => {
    const plain = await importTracker(fixture());
    const buf = await patchedFixture((wb) => { set(sheet(wb, 'Покупки'), { E19: 500, F19: 0, H19: 500, J19: 100, O19: 0 }); });
    const { data, notes, overrides } = await importTracker(buf);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(notes).toEqual([bareTotals('Покупки', 19, 'E «500», F «0», O «0»')]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('the probe B3: values pasted over both totals rows of Постоянные (G and the months): the income total is no expense', async () => {
    const plain = await importTracker(fixture());
    const zeros = (row: number) => Object.fromEntries(MONTH_COLS.map((col) => [`${col}${row}`, 0]));
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Постоянные'), { ...zeros(38), ...zeros(39), G38: 940, L38: 900, G39: 200, L39: 200 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(normalise(data)).toEqual(normalise(plain.data));
    const months = (first: number) => [`L «${first}»`, ...MONTH_COLS.slice(1).map((col) => `${col} «0»`)].join(', ');
    expect(notes).toEqual([
      bareTotals('Постоянные', 38, `G «940», ${months(900)}`), // the generator's «← в среднем в месяц» in H is no value
      bareTotals('Постоянные', 39, `G «200», ${months(200)}`),
    ]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('the same note below the end of the table: values pasted over the second totals row of Постоянные only', async () => {
    const buf = await patchedFixture((wb) => {
      const rec = sheet(wb, 'Постоянные');
      for (const col of MONTH_COLS) rec.getCell(`${col}39`).value = null;
      set(rec, { G39: 200, L39: 200 });
    });
    const { notes, overrides } = await importTracker(buf);
    expect(notes).toEqual([bareTotals('Постоянные', 39, 'G «200», L «200»')]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('totals rows with their formulas cleared hold nothing typed: not loaded, no note', async () => {
    const plain = await importTracker(fixture());
    const buf = await patchedFixture((wb) => {
      const rec = sheet(wb, 'Постоянные');
      for (const row of [38, 39]) for (const col of ['G', ...MONTH_COLS]) rec.getCell(`${col}${row}`).value = null;
      for (const col of ['E', 'F', 'H', 'J', 'O']) sheet(wb, 'Покупки').getCell(`${col}19`).value = null;
      for (const col of ['E', 'F', 'G', 'I', 'K']) sheet(wb, 'Долги').getCell(`${col}25`).value = null;
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(normalise(data)).toEqual(normalise(plain.data));
    expect(notes).toEqual([]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('the label with a value beside it among rows a totals row further down sums is data, as Excel sums it (round 2)', async () => {
    const buf = await patchedFixture((wb) => {
      const dg = sheet(wb, 'Долги');
      dg.mergeCells('B21:D21');
      set(dg, { B21: 'ИТОГО', E21: 1000, C22: 'Долг другу', E22: 200 });
    });
    const { data, notes } = await importTracker(buf);
    expect(data.debts.map((d) => [d.name, d.total])).toEqual([['', 1000], ['Долг другу', 200]]);
    expect(notes).toEqual([noWhat('Долги', 21, 'Название')]);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------
// Fix round 4: the note the generator writes under a table (Журнал, Операции, Покупки: FOOTER_NOTES) is not data
// wherever it lies. A later SUM of the user's (Покупки: the note is summed, so it does not end the table) or helper
// formulas typed below it (all three) put it inside the table, and its row was read as a row of the table: on Покупки
// as a purchase named after the note, with no cost. On Постоянные and Долги the generator writes no note

const PURCHASE_NOTE = /^Покупка живёт только здесь/;

describe('importTracker — the generator\'s note inside a table is skipped, as it is below it', () => {
  it('the probe A6p: the ИТОГО row copied to row 30 (relative SUMs over 18:29) sums the note on 21: no purchase is named after it', async () => {
    const buf = await patchedFixture((wb) => {
      const bu = sheet(wb, 'Покупки');
      set(bu, { C23: 'Под итогом', E23: 5 });
      for (const col of ['E', 'F', 'H', 'J']) bu.getCell(`${col}30`).value = formulaOf(`SUM(${col}18:${col}29)`, 5);
      bu.getCell('O30').value = formulaOf('SUM(S18:S29)', 0);
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.purchases.map((p) => [p.what, p.cost])).toEqual([['Ноутбук', 500], ['Под итогом', 5]]);
    expect(data.purchases.some((p) => PURCHASE_NOTE.test(p.what))).toBe(false);
    expect(notes).toEqual([insideTotals('Покупки', 19), belowFormulas('Покупки', 23, EXCEPT_TOTALS)]); // nothing on 21
    expect(overrides).toEqual([]);
  }, 60_000);

  it('the probe P1c: two purchases typed on 22 and 23 with SUM(E22:E23) under them on 24: they load, the note on 21 does not', async () => {
    const buf = await patchedFixture((wb) => {
      set(sheet(wb, 'Покупки'), { C22: 'Под1', E22: 1, C23: 'Под2', E23: 2, E24: formulaOf('SUM(E22:E23)', 3) });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.purchases.map((p) => [p.what, p.cost])).toEqual([['Ноутбук', 500], ['Под1', 1], ['Под2', 2]]);
    expect(notes).toEqual([
      insideTotals('Покупки', 19), belowFormulas('Покупки', 22, EXCEPT_TOTALS), belowFormulas('Покупки', 23, EXCEPT_TOTALS),
    ]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('Журнал and Операции: the helper filled down past the note puts it inside the table; it is not a row, and no note tells so', async () => {
    const plain = await importTracker(fixture());
    const buf = await patchedFixture((wb) => {
      const jr = sheet(wb, 'Журнал'); // the note is on 1511, C:N
      for (let r = 1512; r <= 1514; r++) jr.getCell(`P${r}`).value = formulaOf('1', 1);
      set(jr, { C1513: date('2026-10-20'), D1513: 'Расход', F1513: 'Под примечанием', G1513: 40 });
      const op = sheet(wb, 'Операции'); // the note is on 1011, C:K
      for (let r = 1012; r <= 1014; r++) op.getCell(`Q${r}`).value = formulaOf('1', 1);
      set(op, { C1013: date('2026-10-21'), D1013: 'Расход', F1013: 'Кофе', G1013: 3 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.journal).toHaveLength(plain.data.journal.length + 1);
    expect(data.journal.at(-1)).toMatchObject({ date: '2026-10-20', what: 'Под примечанием', plan: 40 });
    expect(data.operations).toHaveLength(plain.data.operations.length + 1);
    expect(data.operations.at(-1)).toMatchObject({ date: '2026-10-21', what: 'Кофе', amount: 3 });
    expect(notes).toEqual([]);
    expect(overrides).toEqual([]);
  }, 60_000);

  it('Покупки: the helper filled down past the note puts it inside the table; it is not a purchase, and no note tells so', async () => {
    const buf = await patchedFixture((wb) => {
      const bu = sheet(wb, 'Покупки'); // the note is on 21, C:P
      for (let r = 22; r <= 24; r++) bu.getCell(`R${r}`).value = formulaOf('0', 0);
      set(bu, { C23: 'Под запиской', E23: 7 });
    });
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.purchases.map((p) => [p.what, p.cost])).toEqual([['Ноутбук', 500], ['Под запиской', 7]]);
    expect(notes).toEqual([]); // ИТОГО (19), now above the last row with the helper, is a row of formulas only: no input, no row
    expect(overrides).toEqual([]);
  }, 60_000);
});
