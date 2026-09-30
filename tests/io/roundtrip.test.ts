// End to end: the tracker is imported, backed up, restored — the restored data equals the imported
// data, and the engine gives the same numbers on both. Same for the synthetic scenario.
import type ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountingMonths, balances, creditStatements, forecast, monthSummary, warnings, yearStats } from '../../src/engine';
import type { Data } from '../../src/engine';
import { exportBackup, importBackup } from '../../src/io/backup';
import { importTracker } from '../../src/io/importTracker';
import { scenario } from '../engine/scenario';
import { fixture, patchedFixture } from './fixture';

const EXPORTED_AT = '2026-10-15T09:30:00.000Z';
/** Two days inside the accounting year of the fixture and the scenario (October 2026 – September 2027). */
const TODAYS = ['2026-10-15', '2027-03-20'] as const;

/** Everything the app shows, computed from the data. */
function numbers(d: Data) {
  return {
    balances: TODAYS.map((today) => balances(d, today)),
    creditStatements: TODAYS.map((today) => creditStatements(d, today)),
    forecast: forecast(d),
    monthSummary: accountingMonths(d.settings).map((ym) => monthSummary(d, ym)),
    yearStats: yearStats(d),
    warnings: warnings(d),
  };
}

/** The fixture as a careless user leaves a tracker: days out of range, numbers as text, an unknown account, a bad date, a note. */
async function messyFixture(): Promise<ArrayBuffer> {
  return patchedFixture((wb) => {
    const at = (name: string) => wb.getWorksheet(name) as ExcelJS.Worksheet;
    const set = (name: string, cells: Record<string, ExcelJS.CellValue>) => {
      for (const [address, value] of Object.entries(cells)) at(name).getCell(address).value = value;
    };
    set('Постоянные', { F8: 45, H8: 24, F9: '15', G10: '200,5', H11: 1.5 });
    set('Счета', { C35: 45, C36: '4,5' });
    set('Операции', {
      C20: new Date(Date.UTC(2026, 9, 20)), D20: 'Расход', F20: 'Текстом', G20: '1 234,50', H20: 'Карта',
      C21: new Date(Date.UTC(2026, 9, 21)), D21: 'Расход', F21: 'Чужой счёт', G21: 12, H21: 'Сбер',
    });
    set('Журнал', { C30: '31.12.2026', D30: 'Расход', F30: 'Дата текстом', G30: '50', C31: 'вчера', D31: 'Расход', F31: 'Без даты', G31: 5 });
    at('Журнал').getCell('F10').note = 'Проверить сумму по чеку';
  });
}

describe.each<[string, () => Promise<Data>]>([
  ['the tracker fixture, imported', async () => (await importTracker(fixture())).data],
  ['the tracker fixture with values out of range, numbers as text, a bad date and a note', async () => (await importTracker(await messyFixture())).data],
  ['the synthetic scenario', async () => scenario()],
])('import → backup → restore: %s', (_name, source) => {
  let original: Data;
  let restored: Data;
  beforeAll(async () => {
    original = await source();
    restored = await importBackup(await exportBackup(original, EXPORTED_AT));
  }, 30_000);

  it('restores exactly the data that was backed up', () => {
    expect(restored).toStrictEqual(original);
  });

  it('the data is not empty, so the comparison means something', () => {
    expect(original.accounts.length).toBeGreaterThanOrEqual(3);
    expect(original.operations.length).toBeGreaterThan(0);
    expect(original.journal.length).toBeGreaterThan(0);
    expect(original.recurring.length).toBeGreaterThan(0);
    expect(original.purchases.length).toBeGreaterThan(0);
    expect(numbers(original).balances[0]?.rows.length).toBe(original.accounts.length);
  });

  it.each([
    ['balances on the day', (n: ReturnType<typeof numbers>) => n.balances],
    ['creditStatements', (n: ReturnType<typeof numbers>) => n.creditStatements],
    ['forecast', (n: ReturnType<typeof numbers>) => n.forecast],
    ['monthSummary of every accounting month', (n: ReturnType<typeof numbers>) => n.monthSummary],
    ['yearStats', (n: ReturnType<typeof numbers>) => n.yearStats],
    ['warnings', (n: ReturnType<typeof numbers>) => n.warnings],
  ])('%s are identical', (_part, pick) => {
    expect(pick(numbers(restored))).toStrictEqual(pick(numbers(original)));
  });

  it('checks 12 accounting months and both days', () => {
    expect(numbers(restored).monthSummary).toHaveLength(12);
    expect(numbers(restored).balances).toHaveLength(TODAYS.length);
  });
});

describe('import → backup → restore: the messy fixture really is noted', () => {
  it('has a note for every kind of mess, and the data is still backed up', async () => {
    const { data, notes } = await importTracker(await messyFixture());
    expect(notes.filter((n) => n.includes('не подходит'))).toHaveLength(3); // day 45, every 24, every 1.5
    expect(notes.filter((n) => n.includes('в Excel это текст'))).toHaveLength(5); // «15», «200,5», «4,5», «1 234,50», «50»
    expect(notes.some((n) => n.includes('Счёт «Сбер» не найден'))).toBe(true);
    expect(notes.some((n) => n.includes('дата «вчера» не распознана'))).toBe(true);
    expect(notes.some((n) => n.includes('есть примечание'))).toBe(true);
    expect([data.credit.closeDay, data.credit.payDay]).toEqual([28, 4]);
    await expect(exportBackup(data, EXPORTED_AT)).resolves.toBeInstanceOf(ArrayBuffer);
  }, 30_000);
});

describe('import → backup → restore: the fixture keeps its known numbers', () => {
  it('October 2026: 3200 / 3205 / 1180 / 1235 and the forecast ends December at 840', async () => {
    const { data } = await importTracker(fixture());
    const back = await importBackup(await exportBackup(data, EXPORTED_AT));
    const cents = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 100) / 100);
    const oct = yearStats(back).months[0];
    expect([oct?.incomePlan, oct?.incomeFact, oct?.expensePlan, oct?.expenseFact].map(cents)).toEqual([3200, 3205, 1180, 1235]);
    expect(cents(forecast(back).months[2]?.end)).toBe(840);
  }, 30_000);
});
