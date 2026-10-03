// The backup's optional sheet «Лимиты по месяцам» (spec 2026-10-03-month-limits): «Категория», «Месяц» (YYYY-MM),
// «Лимит» — a row per own month limit of an expense category. A copy made before it restores as before.
import type { Workbook } from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Data } from '../../src/engine/model';
import { BackupError, exportBackup, importBackup } from '../../src/io/backup';
import { MONEY_FORMAT } from '../../src/io/excel';
import { scenario } from '../engine/scenario';

const EXPORTED_AT = '2026-10-03T18:00:00.000Z';
const SHEET = 'Лимиты по месяцам';

function withMonthLimits(): Data {
  const d = scenario();
  d.categories.expense[0] = { name: 'Жильё', limit: 900, monthLimits: { '2026-12': 950 } };
  d.categories.expense[1] = { name: 'Продукты', monthLimits: { '2026-11': 0, '2027-09': 330.5, '2025-12': 70 } };
  return d;
}

async function load(buf: ArrayBuffer): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<Workbook['xlsx']['load']>[0]);
  return wb;
}

async function edited(data: Data, edit: (wb: Workbook) => void): Promise<ArrayBuffer> {
  const wb = await load(await exportBackup(data, EXPORTED_AT));
  edit(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer()).buffer;
}

async function importError(buf: ArrayBuffer): Promise<string> {
  const error = await importBackup(buf).then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(BackupError);
  return (error as BackupError).message;
}

describe('backup — «Лимиты по месяцам»', () => {
  it('restores the month limits exactly (0, without a usual limit, outside the accounting year)', async () => {
    expect(await importBackup(await exportBackup(withMonthLimits(), EXPORTED_AT))).toStrictEqual(withMonthLimits());
  });

  it('writes a row per month limit after «Категории»: the category, the month as YYYY-MM text, a money cell', async () => {
    const wb = await load(await exportBackup(withMonthLimits(), EXPORTED_AT));
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names.indexOf(SHEET)).toBe(names.indexOf('Категории') + 1);
    const ws = wb.getWorksheet(SHEET)!;
    const rows = [1, 2, 3, 4, 5].map((r) => [1, 2, 3].map((c) => ws.getCell(r, c).value));
    expect(rows).toEqual([
      ['Категория', 'Месяц', 'Лимит'],
      ['Жильё', '2026-12', 950],
      ['Продукты', '2025-12', 70],
      ['Продукты', '2026-11', 0],
      ['Продукты', '2027-09', 330.5],
    ]);
    expect(ws.getCell(2, 3).numFmt).toBe(MONEY_FORMAT);
    expect(ws.getRow(1).font?.bold).toBe(true);
  });

  it('a copy without the sheet (made before it) restores as before', async () => {
    const buf = await edited(scenario(), (wb) => wb.removeWorksheet(wb.getWorksheet(SHEET)!.id));
    expect(await importBackup(buf)).toStrictEqual(scenario());
  });

  it('expense categories with one name (an imported tracker) keep their own month limits, listed in their order', async () => {
    const d = scenario();
    d.categories.expense[0] = { name: 'Жильё', monthLimits: { '2026-11': 5 } };
    d.categories.expense.push({ name: 'Жильё', monthLimits: { '2026-11': 10 } }, { name: 'Жильё', monthLimits: { '2026-11': 20, '2026-12': 30 } });
    expect(await importBackup(await exportBackup(d, EXPORTED_AT))).toStrictEqual(d);
  });

  it('empty month limits are left out (as the copy gives them back)', async () => {
    const d = scenario();
    d.categories.expense[1] = { name: 'Продукты', monthLimits: {} };
    const back = await importBackup(await exportBackup(d, EXPORTED_AT));
    expect(back.categories.expense[1]).toStrictEqual({ name: 'Продукты' });
  });

  it('names the row of an unknown category, a month twice, a bad month or limit', async () => {
    const cases: [address: string, value: string | number, message: string][] = [
      ['A2', 'Кафе', `Лист «${SHEET}», строка 2: неизвестная категория расходов «Кафе».`],
      ['B3', '2026-12', `Лист «${SHEET}», строка 3: лимит «Продукты» за 2026-12 уже есть в строке 2.`],
      ['B2', 'декабрь', `Лист «${SHEET}», строка 2: «Месяц» — не месяц в виде ГГГГ-ММ.`],
      ['C2', 'много', `Лист «${SHEET}», строка 2: «Лимит» — не число.`],
    ];
    for (const [address, value, message] of cases) {
      const d = scenario();
      d.categories.expense[1] = { name: 'Продукты', monthLimits: { '2026-12': 1, '2027-01': 2 } };
      const buf = await edited(d, (wb) => { wb.getWorksheet(SHEET)!.getCell(address).value = value; });
      expect(await importError(buf)).toBe(message);
    }
  });
});
