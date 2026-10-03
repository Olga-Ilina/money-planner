// The tracker's «Лимиты» sheet (spec 2026-10-03-month-limits): C — the usual limit, D…O — the 12 accounting months;
// rows 6…35 belong to Настройки J6:J35 as «Месяц» rows 12…41 do. Without the sheet, «Месяц» C12:C41 are the usual limits.
import type ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { addMonths, monthLabel } from '../../src/engine';
import { importTracker } from '../../src/io/importTracker';
import { patchedFixture } from './fixture';

/** Each case loads, edits and writes the whole fixture: slow when the suite runs in parallel. */
const SLOW = 60_000;
const MONTH_COLS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];

/** Adds «Лимиты» as the generator lays it out (the fixture's accounting year starts in October 2026). */
function addLimitsSheet(wb: ExcelJS.Workbook, values: Record<string, number | string>): void {
  const ws = wb.addWorksheet('Лимиты');
  ws.getCell('B5').value = 'Категория';
  ws.getCell('C5').value = 'Обычный лимит';
  MONTH_COLS.forEach((col, k) => {
    ws.getCell(`${col}5`).value = { formula: `TEXT(DATE(Настройки!$C$8,${k + 1},1),"ММММ ГГГГ")`, result: monthLabel(addMonths('2026-10', k)) };
  });
  const settings = wb.getWorksheet('Настройки')!;
  for (let i = 0; i < 30; i++) {
    const name = settings.getCell(`J${6 + i}`).value;
    ws.getCell(`B${6 + i}`).value = { formula: `IF(Настройки!J${6 + i}="","",Настройки!J${6 + i})`, result: typeof name === 'string' ? name : '' };
  }
  for (const [address, v] of Object.entries(values)) ws.getCell(address).value = v;
  // «Месяц» C12:C41 become formulas (the effective limit of the chosen month); their cached values are not read
  const month = wb.getWorksheet('Месяц')!;
  for (let r = 12; r <= 41; r++) month.getCell(`C${r}`).value = { formula: `INDEX(Лимиты!C${r - 6}:O${r - 6},1,1)`, result: 999 };
}

describe('importTracker — «Лимиты»', { timeout: SLOW }, () => {
  it('reads the usual limit from C and the month limits from D…O by accounting month; «Месяц» C is not read', async () => {
    // fixture categories: Жильё, Продукты, Транспорт, Подписки, Техника (Настройки J6…J10)
    const buf = await patchedFixture((wb) => addLimitsSheet(wb, { C6: 900, D7: 250, F7: 0, O7: 330, C8: 120, N10: 75 }));
    const { data, notes, overrides } = await importTracker(buf);
    expect(data.categories.expense).toEqual([
      { name: 'Жильё', limit: 900 },
      { name: 'Продукты', monthLimits: { '2026-10': 250, '2026-12': 0, '2027-09': 330 } },
      { name: 'Транспорт', limit: 120 },
      { name: 'Подписки' },
      { name: 'Техника', monthLimits: { '2027-08': 75 } },
    ]);
    expect(notes).toEqual([]);
    expect(overrides).toEqual([]);
  });

  it('without «Лимиты» the old «Месяц» C12:C41 are the usual limits, with no notes', async () => {
    const buf = await patchedFixture((wb) => {
      const month = wb.getWorksheet('Месяц')!;
      month.getCell('C12').value = 900;
      month.getCell('C13').value = 300;
    });
    const { data, notes } = await importTracker(buf);
    expect(data.categories.expense.slice(0, 3)).toEqual([{ name: 'Жильё', limit: 900 }, { name: 'Продукты', limit: 300 }, { name: 'Транспорт' }]);
    expect(notes).toEqual([]);
  });

  it('numeric text is read and noted; other text is noted and left out', async () => {
    const buf = await patchedFixture((wb) => addLimitsSheet(wb, { C6: '900', E7: 'много' }));
    const { data, notes } = await importTracker(buf);
    expect(data.categories.expense[0]).toEqual({ name: 'Жильё', limit: 900 });
    expect(data.categories.expense[1]).toEqual({ name: 'Продукты' });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toBe('Лист «Лимиты», строка 6, столбец C: «900» — в Excel это текст и не учитывается; загружено как число');
    expect(notes[1]).toBe('Лист «Лимиты», строка 7, столбец E: «много» не распознано — не загружено');
  });

  it('a constant typed over a formula of «Лимиты» (B, the month labels) or «Месяц» C12:C41 is listed as an override', async () => {
    const buf = await patchedFixture((wb) => {
      addLimitsSheet(wb, { C6: 900 });
      wb.getWorksheet('Лимиты')!.getCell('B7').value = 'Еда';
      wb.getWorksheet('Лимиты')!.getCell('E5').value = 'Ноябрь';
      wb.getWorksheet('Месяц')!.getCell('C12').value = 1000;
    });
    const { data, overrides } = await importTracker(buf);
    expect(overrides).toEqual(['Месяц!C12 = 1000', 'Лимиты!E5 = Ноябрь', 'Лимиты!B7 = Еда']);
    expect(data.categories.expense[0]).toEqual({ name: 'Жильё', limit: 900 }); // names come from Настройки J
  });
});
