// The tracker sheet «Журнал» is now «Запланированные»; a tracker has one of the two names and the import reads both.
// The fixture still has the old name: a copy of it with the sheet renamed stands for a file of the new generator.
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { balances, forecast, yearStats } from '../../src/engine';
import { isoToExcelDate } from '../../src/io/excel';
import { importTracker, TrackerImportError } from '../../src/io/importTracker';
import type { ImportResult } from '../../src/io/importTracker';
import { fixture, patchedFixture } from './fixture';

const OLD = 'Журнал';
const NEW = 'Запланированные';
const NAMES = [OLD, NEW];
/** Every test builds a workbook from the fixture and reads it back: a few seconds, more when the whole suite runs. */
const SLOW = { timeout: 60_000 };

/** The fixture with the tracker sheet named `name`, changed by `edit` (the sheet is passed in under that name). */
function named(name: string, edit: (ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void = () => undefined): Promise<ArrayBuffer> {
  return patchedFixture((wb) => {
    const ws = wb.getWorksheet(OLD);
    if (!ws) throw new Error(`no sheet ${OLD}`);
    ws.name = name;
    edit(ws, wb);
  });
}

async function importError(buf: ArrayBuffer): Promise<TrackerImportError> {
  const error = await importTracker(buf).then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(TrackerImportError);
  return error as TrackerImportError;
}

/** What the figures of an import come to, with no ids in it. */
function figures({ data }: ImportResult) {
  return {
    journal: data.journal.map(({ id: _id, account: _account, ...rest }) => rest),
    year: yearStats(data),
    forecast: forecast(data),
    balances: balances(data, '2026-09-30').rows.map(({ id: _id, ...rest }) => rest),
  };
}

describe('importTracker — the sheet of the planned rows is «Запланированные» or «Журнал»', SLOW, () => {
  let plain: ImportResult;
  const results = new Map<string, ImportResult>();
  beforeAll(async () => {
    plain = await importTracker(fixture());
    for (const name of NAMES) results.set(name, await importTracker(await named(name)));
  }, SLOW.timeout);

  it.each(NAMES)('reads a tracker whose sheet is named «%s» as the fixture, with no notes and no overrides', (name) => {
    const result = results.get(name)!;
    expect(result.data.journal.length).toBeGreaterThan(5);
    expect(figures(result)).toEqual(figures(plain));
    expect(result.notes).toEqual([]);
    expect(result.overrides).toEqual([]);
  });

  it.each(NAMES)('«%s»: the October figures of the fixture hold (3200 / 3205 / 1180 / 1235)', (name) => {
    const oct = yearStats(results.get(name)!.data).months[0];
    expect([oct?.incomePlan, oct?.incomeFact, oct?.expensePlan, oct?.expenseFact]).toEqual([3200, 3205, 1180, 1235]);
  });

  it('the fixture itself, which still says «Журнал», is read with no notes', () => {
    expect([plain.notes, plain.overrides]).toEqual([[], []]);
  });
});

describe('importTracker — the notes name the sheet the file has', SLOW, () => {
  it.each(NAMES)('«%s»: a month label that does not parse, a row without a date, an unknown account, an unreadable amount', async (name) => {
    const other = name === NEW ? OLD : NEW;
    const { notes } = await importTracker(await named(name, (ws) => {
      ws.getCell('M10').value = 'ноябрь';
      ws.getCell('C11').value = null;
      ws.getCell('J12').value = 'Сбер';
      ws.getCell('G13').value = 'сто';
    }));
    expect(notes).toEqual(expect.arrayContaining([
      `${name}, строка 10: месяц учёта «ноябрь» не распознан — взят месяц даты`,
      `${name}, строка 11: нет даты — строка не загружена`,
      `Счёт «Сбер» не найден (${name}, строка 12)`,
      `Лист «${name}», строка 13, столбец G: «сто» не распознано — не загружено`,
    ]));
    expect(notes.filter((n) => n.includes(other))).toEqual([]);
  });

  it.each(NAMES)('«%s»: a month label outside the accounting year and a row without a name', async (name) => {
    const { notes } = await importTracker(await named(name, (ws) => {
      ws.getCell('M10').value = 'Сентябрь 2026';
      ws.getCell('F12').value = null;
    }));
    expect(notes).toContain(`${name}, строка 10: месяц учёта «Сентябрь 2026» не входит в 12 месяцев учёта — взят месяц даты`);
    expect(notes).toContain(`Лист «${name}», строка 12: нет «Что» — загружено без названия`);
    expect(notes.every((n) => !n.includes(name === NEW ? OLD : NEW))).toBe(true);
  });

  it.each(NAMES)('«%s»: a cell note is reported under that name', async (name) => {
    const { notes } = await importTracker(await named(name, (ws) => { ws.getCell('F10').note = 'Проверить сумму'; }));
    expect(notes).toEqual([`Лист «${name}», ячейка F10: есть примечание «Проверить сумму» — в приложение не переносится`]);
  });

  it.each(NAMES)('«%s»: the notes of the sheet stay in the place of its tab', async (name) => {
    const { notes } = await importTracker(await named(name, (ws, wb) => {
      ws.getCell('G10').value = 'сто';
      wb.getWorksheet('Операции')!.getCell('G10').value = 'двести';
      wb.getWorksheet('Постоянные')!.getCell('G8').value = 'триста';
    }));
    const at = (needle: string) => notes.findIndex((n) => n.includes(needle));
    expect([at('«Операции»'), at(`«${name}»`), at('«Постоянные»')].every((i) => i >= 0)).toBe(true);
    expect(at('«Операции»')).toBeLessThan(at(`«${name}»`));
    expect(at(`«${name}»`)).toBeLessThan(at('«Постоянные»'));
  });
});

describe('importTracker — the notes about the layout of the sheet name it too', SLOW, () => {
  const FORMULAS = ['B', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U']; // of each table row of the fixture

  it.each(NAMES)('«%s»: a row below the formulas of the table, and one under its footer', async (name) => {
    const { data, notes } = await importTracker(await named(name, (ws) => {
      for (const col of FORMULAS) ws.getCell(`${col}1509`).value = null;
      ws.getCell('C1509').value = isoToExcelDate('2026-10-20');
      ws.getCell('D1509').value = 'Расход';
      ws.getCell('F1509').value = 'Поздняя';
      ws.getCell('G1509').value = 40;
      ws.getCell('F1513').value = 'Под примечанием'; // the footer is on row 1511
    }));
    expect(data.journal.at(-1)).toMatchObject({ date: '2026-10-20', what: 'Поздняя', plan: 40 });
    expect(notes).toEqual([
      `Лист «${name}», строка 1509: ниже формул трекера — в суммах Excel не учитывается; загружено`,
      `Лист «${name}», строка 1513: ниже примечания под таблицей — в Excel не учитывается; не загружено: F «Под примечанием»`,
    ]);
  });
});

describe('importTracker — numbers typed over formulas on the renamed sheet', SLOW, () => {
  it.each(NAMES)('«%s»: constants over the helpers are listed under that name and not used', async (name) => {
    const plain = figures(await importTracker(await named(name)));
    const result = await importTracker(await named(name, (ws) => {
      ws.getCell('P10').value = 999; // the fact helper of the first row
      ws.getCell('V12').value = 0; // «в балансе» of a row's account
      ws.getCell('B14').value = 7; // the row number
    }));
    expect(result.overrides).toEqual([`${name}!P10 = 999`, `${name}!V12 = 0`, `${name}!B14 = 7`]); // by row
    expect(figures(result)).toEqual(plain);
  });

  it.each(NAMES)('«%s»: the area of the table runs down to its last row (1509 in the fixture)', async (name) => {
    const result = await importTracker(await named(name, (ws) => {
      ws.getCell('P40').value = 6;
      ws.getCell('P1509').value = 5;
    }));
    expect(result.overrides).toEqual([`${name}!P40 = 6`, `${name}!P1509 = 5`]);
  });

  it('a tracker with the old name and one with the new name list the same cells', async () => {
    const edit = (ws: ExcelJS.Worksheet) => { ws.getCell('N20').value = 'дубль'; ws.getCell('U30').value = 7; };
    const oldList = (await importTracker(await named(OLD, edit))).overrides.map((o) => o.replace(OLD, ''));
    const newList = (await importTracker(await named(NEW, edit))).overrides.map((o) => o.replace(NEW, ''));
    expect(newList).toEqual(oldList);
    expect(newList.length).toBe(2);
  });
});

describe('importTracker — which sheets the file has', SLOW, () => {
  it('a file with both «Запланированные» and «Журнал» is refused with a message that names both', async () => {
    const buf = await named(NEW, (_ws, wb) => { wb.addWorksheet(OLD); });
    const error = await importError(buf);
    expect(error.message).toBe('В файле есть и лист «Запланированные», и лист «Журнал» — в трекере должен остаться один.');
  });

  it('a file with neither lists «Запланированные» among the missing sheets, not «Журнал»', async () => {
    const error = await importError(await named('Другой лист'));
    expect(error.message).toMatch(/^Это не «Трекер и планер расходов» или его старая версия/);
    expect(error.message).toContain('не найдены листы «Запланированные».');
    expect(error.message).not.toContain('«Журнал»');
  });

  it.each(NAMES)('«%s» present, another sheet missing: only that one is listed', async (name) => {
    const error = await importError(await named(name, (_ws, wb) => { wb.removeWorksheet(wb.getWorksheet('Долги')!.id); }));
    expect(error.message).toContain('не найдены листы «Долги».');
    expect(error.message).not.toContain('Запланированные');
    expect(error.message).not.toContain('«Журнал»');
  });
});
