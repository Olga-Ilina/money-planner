import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accountMovements,
  accountingMonths,
  balances,
  creditStatements,
  dailySpend,
  forecast,
  monthItems,
  monthLabel,
  monthSummary,
  nextCreditDebit,
  yearStats,
} from '../../src/engine';
import type { Data, FeedItem } from '../../src/engine';
import { DATE_FORMAT, MONEY_FORMAT, cellDate, cellText, unwrap } from '../../src/io/excel';
import { PERCENT_FORMAT, accountsReport, forecastReport, monthReport, yearReport } from '../../src/io/reports';
import type { ReportFile } from '../../src/io/reports';
import { ACC, scenario } from '../engine/scenario';
import { savingsScenario } from '../engine/savingsScenario';

const OCT = '2026-10';
const TODAY = '2026-09-30';
const HEADER_ROW = 3; // title, subtitle, header

async function open(file: ReportFile): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  return wb;
}

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`no sheet «${name}»; have ${wb.worksheets.map((w) => w.name).join(', ')}`);
  return ws;
}

const sheetNames = (wb: ExcelJS.Workbook): string[] => wb.worksheets.map((ws) => ws.name);

function headers(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.getRow(HEADER_ROW).eachCell({ includeEmpty: false }, (cell, col) => {
    out[col - 1] = cellText(cell.value) ?? '';
  });
  return out;
}

/** 1-based column of a header. */
function col(ws: ExcelJS.Worksheet, header: string): number {
  const i = headers(ws).indexOf(header);
  if (i < 0) throw new Error(`no column «${header}» on «${ws.name}»: ${headers(ws).join(' | ')}`);
  return i + 1;
}

/** Row numbers of the table body: from under the header down to (not including) the first empty row. */
function bodyRows(ws: ExcelJS.Worksheet): number[] {
  const out: number[] = [];
  for (let r = HEADER_ROW + 1; r <= ws.rowCount; r++) {
    if (!ws.getRow(r).hasValues) break;
    out.push(r);
  }
  return out;
}

/** Data rows of the table: the body without its bold total lines (ИТОГО, or «Доходы / Расходы / Переводы»). */
function dataRows(ws: ExcelJS.Worksheet): number[] {
  return bodyRows(ws).filter((r) => ws.getRow(r).getCell(1).font?.bold !== true);
}

/** Labels of the bold total lines under the table. */
function totalLabels(ws: ExcelJS.Worksheet): (string | undefined)[] {
  return bodyRows(ws).filter((r) => ws.getRow(r).getCell(1).font?.bold === true).map((r) => cellText(ws.getRow(r).getCell(1).value));
}

const subtitles = (wb: ExcelJS.Workbook): Record<string, string | undefined> =>
  Object.fromEntries(wb.worksheets.map((ws) => [ws.name, cellText(ws.getCell('A2').value)]));

/** The row whose first cell shows `label` (text or a date shown as dd.mm.yyyy). */
function rowOf(ws: ExcelJS.Worksheet, label: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(1).value;
    const date = v instanceof Date ? cellDate(v) : undefined;
    const shown = date ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : cellText(v);
    if (shown === label) return r;
  }
  throw new Error(`no row «${label}» on «${ws.name}»`);
}

function cell(ws: ExcelJS.Worksheet, row: number | string, header: string): ExcelJS.Cell {
  const r = typeof row === 'number' ? row : rowOf(ws, row);
  return ws.getRow(r).getCell(col(ws, header));
}

const value = (ws: ExcelJS.Worksheet, row: number | string, header: string): unknown => unwrap(cell(ws, row, header).value);
const num = (ws: ExcelJS.Worksheet, row: number | string, header: string): number => {
  const v = value(ws, row, header);
  if (typeof v !== 'number') throw new Error(`«${header}» of row ${row} on «${ws.name}» is not a number: ${String(v)}`);
  return v;
};
const text = (ws: ExcelJS.Worksheet, row: number | string, header: string): string | undefined =>
  cellText(cell(ws, row, header).value);
const date = (ws: ExcelJS.Worksheet, row: number | string, header: string): string | undefined =>
  cellDate(cell(ws, row, header).value);

/** The last row whose first cell is the text `label` — the lines written under a table. */
function lastRowOf(ws: ExcelJS.Worksheet, label: string): number {
  for (let r = ws.rowCount; r >= 1; r--) {
    if (cellText(ws.getRow(r).getCell(1).value) === label) return r;
  }
  throw new Error(`no row «${label}» on «${ws.name}»`);
}

/** Value right of a label written under a table («Средний расход в месяц» → the number next to it). */
function besideLabel(ws: ExcelJS.Worksheet, label: string, offset = 1): unknown {
  return unwrap(ws.getRow(lastRowOf(ws, label)).getCell(1 + offset).value);
}

/** The table row of a feed item (rows follow the feed order). */
function rowOfItem(ws: ExcelJS.Worksheet, items: FeedItem[], id: string): number {
  const r = dataRows(ws)[items.findIndex((i) => i.id === id)];
  if (r === undefined) throw new Error(`no row for ${id} on «${ws.name}»`);
  return r;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('reports load ExcelJS lazily', () => {
  it('import exceljs only as types at the top and load it with a dynamic import', () => {
    const source = readFileSync(join(import.meta.dirname, '../../src/io/reports.ts'), 'utf8');
    expect(source).not.toMatch(/^import (?!type )[^;]*['"]exceljs['"]/m);
    expect(source).toMatch(/await import\('exceljs'\)/);
  });
});

describe('monthReport — October of the scenario', () => {
  const data = scenario();
  const summary = monthSummary(data, OCT);
  const items = monthItems(data, OCT);

  it('names the file after the month and gives a real ArrayBuffer', async () => {
    const file = await monthReport(data, OCT);
    expect(file.filename).toBe('Отчёт — Октябрь 2026.xlsx');
    expect(file.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('has the sheets «Итоги», «Категории», «Движения», «По дням»', async () => {
    expect(sheetNames(await open(await monthReport(data, OCT)))).toEqual(['Итоги', 'Категории', 'Движения', 'По дням']);
  });

  describe('«Итоги»', () => {
    it('shows the month totals of the engine', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Итоги');
      expect(headers(ws)).toEqual(['Показатель', 'Сумма']);
      const shown = ['Доход план', 'Доход факт', 'Расход план', 'Расход факт', 'Баланс факт', 'Лимиты всего', 'Остаток лимитов']
        .map((label) => num(ws, label, 'Сумма'));
      expect(shown).toEqual([summary.incomePlan, summary.incomeFact, summary.expensePlan, summary.expenseFact, summary.balanceFact, 0, 0]);
      expect(num(ws, 'Доход факт', 'Сумма')).toBe(3205);
      expect(num(ws, 'Расход факт', 'Сумма')).toBe(1235);
    });

    it('carries the money number format', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Итоги');
      expect(cell(ws, 'Доход факт', 'Сумма').numFmt).toBe(MONEY_FORMAT);
      expect(cell(ws, 'Остаток лимитов', 'Сумма').numFmt).toBe(MONEY_FORMAT);
    });

    it('sums the limits and what is left of them', async () => {
      const limited: Data = scenario();
      limited.categories.expense = limited.categories.expense.map((c) =>
        c.name === 'Продукты' ? { ...c, limit: 200 } : c.name === 'Транспорт' ? { ...c, limit: 150 } : c);
      const ws = sheet(await open(await monthReport(limited, OCT)), 'Итоги');
      expect(num(ws, 'Лимиты всего', 'Сумма')).toBe(350);
      // Продукты 200 − 210, Транспорт 150 − 125
      expect(num(ws, 'Остаток лимитов', 'Сумма')).toBe(15);
    });
  });

  describe('«Категории»', () => {
    it('has one row per expense category, then «Без категории», then ИТОГО', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Категории');
      expect(headers(ws)).toEqual(['Категория', 'Лимит', 'План', 'Факт', 'Остаток лимита', '% лимита']);
      expect(bodyRows(ws).map((r) => cellText(ws.getRow(r).getCell(1).value))).toEqual([
        ...data.categories.expense.map((c) => c.name), 'Без категории', 'ИТОГО',
      ]);
    });

    it('shows plan and fact of the engine per category', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Категории');
      expect([num(ws, 'Продукты', 'План'), num(ws, 'Продукты', 'Факт')]).toEqual([180, 210]);
      for (const c of summary.byCategory) {
        expect([num(ws, c.name, 'План'), num(ws, c.name, 'Факт')]).toEqual([c.plan, c.fact]);
      }
      expect([num(ws, 'Без категории', 'План'), num(ws, 'Без категории', 'Факт')])
        .toEqual([summary.uncategorized.plan, summary.uncategorized.fact]);
      expect([num(ws, 'ИТОГО', 'План'), num(ws, 'ИТОГО', 'Факт')]).toEqual([summary.expensePlan, summary.expenseFact]);
    });

    it('leaves limit columns empty for a category without a limit', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Категории');
      expect(value(ws, 'Продукты', 'Лимит')).toBeNull();
      expect(value(ws, 'Продукты', 'Остаток лимита')).toBeNull();
      expect(value(ws, 'Продукты', '% лимита')).toBeNull();
    });

    it('shows limit, what is left and the share of it in percent', async () => {
      const limited: Data = scenario();
      limited.categories.expense = limited.categories.expense.map((c) => (c.name === 'Продукты' ? { ...c, limit: 200 } : c));
      const ws = sheet(await open(await monthReport(limited, OCT)), 'Категории');
      expect(num(ws, 'Продукты', 'Лимит')).toBe(200);
      expect(num(ws, 'Продукты', 'Остаток лимита')).toBe(-10);
      expect(num(ws, 'Продукты', '% лимита')).toBeCloseTo(1.05, 10);
      expect(cell(ws, 'Продукты', '% лимита').numFmt).toBe(PERCENT_FORMAT);
      expect(cell(ws, 'Продукты', 'Лимит').numFmt).toBe(MONEY_FORMAT);
      expect(num(ws, 'ИТОГО', 'Лимит')).toBe(200);
      expect(num(ws, 'ИТОГО', 'Остаток лимита')).toBe(-10);
    });
  });

  describe('«Движения»', () => {
    const HEADERS = ['Дата', 'Источник', 'Тип', 'Категория', 'Что', 'План', 'Факт', 'Статус', 'Счёт', 'На счёт', 'Возможный дубль'];

    it('lists every item of the month feed', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Движения');
      expect(headers(ws)).toEqual(HEADERS);
      const rows = dataRows(ws);
      expect(rows).toHaveLength(items.length);
      expect(rows.map((r) => num(ws, r, 'Факт'))).toEqual(items.map((i) => i.fact));
      expect(rows.map((r) => num(ws, r, 'План'))).toEqual(items.map((i) => i.plan));
      expect(rows.map((r) => text(ws, r, 'Что'))).toEqual(items.map((i) => i.what));
      expect(rows.map((r) => date(ws, r, 'Дата'))).toEqual(items.map((i) => i.date));
    });

    it('totals income, expenses and transfers apart under the items — no mixed ИТОГО', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Движения');
      expect(totalLabels(ws)).toEqual(['Доходы', 'Расходы', 'Переводы']);
      expect(bodyRows(ws).slice(items.length).map((r) => text(ws, r, 'Дата'))).toEqual(['Доходы', 'Расходы', 'Переводы']);
      expect(() => rowOf(ws, 'ИТОГО')).toThrow();
      expect([num(ws, 'Доходы', 'План'), num(ws, 'Доходы', 'Факт')]).toEqual([3200, 3205]);
      expect([num(ws, 'Расходы', 'План'), num(ws, 'Расходы', 'Факт')]).toEqual([1180, 1235]);
      expect(value(ws, 'Переводы', 'План')).toBeNull();
      expect(num(ws, 'Переводы', 'Факт')).toBe(130); // Снятие 100 + Погашение 30
      expect(num(ws, 'Переводы', 'Факт')).toBe(sum(items.filter((i) => i.kind === 'transfer').map((i) => i.fact)));
    });

    it('gives the same income and expense totals as «Итоги»', async () => {
      const wb = await open(await monthReport(data, OCT));
      const ws = sheet(wb, 'Движения');
      const totals = sheet(wb, 'Итоги');
      expect([num(ws, 'Доходы', 'План'), num(ws, 'Доходы', 'Факт'), num(ws, 'Расходы', 'План'), num(ws, 'Расходы', 'Факт')])
        .toEqual(['Доход план', 'Доход факт', 'Расход план', 'Расход факт'].map((l) => num(totals, l, 'Сумма')));
    });

    it('makes the total lines bold, with a top border over the first one', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Движения');
      for (const label of ['Доходы', 'Расходы', 'Переводы']) {
        expect(cell(ws, label, 'Дата').font?.bold).toBe(true);
        expect(cell(ws, label, 'Факт').font?.bold).toBe(true);
      }
      expect(cell(ws, 'Доходы', 'Факт').border?.top?.style).toBe('thin');
      expect(cell(ws, 'Расходы', 'Факт').border?.top).toBeUndefined();
    });

    it('names an account that no longer exists «(удалённый счёт)», not by its id', async () => {
      const gone: Data = scenario();
      gone.operations.push({ id: 'o-gone', date: '2026-10-20', kind: 'transfer', what: 'Старый перевод', amount: 5, account: 'acc-old', toAccount: 'acc-older' });
      const oct = monthItems(gone, OCT);
      const ws = sheet(await open(await monthReport(gone, OCT)), 'Движения');
      const r = rowOfItem(ws, oct, 'o-gone');
      expect([text(ws, r, 'Счёт'), text(ws, r, 'На счёт')]).toEqual(['(удалённый счёт)', '(удалённый счёт)']);
      expect(text(ws, rowOfItem(ws, oct, 'o-snyatie'), 'Счёт')).toBe('Карта');
    });

    it('shows source, kind, status and account names in Russian', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Движения');
      const line = (id: string) =>
        ['Источник', 'Тип', 'Категория', 'Статус', 'Счёт', 'На счёт', 'Возможный дубль']
          .map((h) => text(ws, rowOfItem(ws, items, id), h) ?? '');
      expect(line('o-snyatie')).toEqual(['Операция', 'Перевод', '', 'Оплачено', 'Карта', 'Наличные', '']);
      expect(line('o-kafe')).toEqual(['Операция', 'Расход', 'Продукты', 'Оплачено', 'Карта', '', 'Журнал']);
      expect(line('j-arenda')).toEqual(['Журнал', 'Расход', 'Жильё', 'Запланировано', 'Карта', '', 'Постоянные']);
      expect(line('j-otmena')).toEqual(['Журнал', 'Расход', 'Транспорт', 'Отменено', 'Карта', '', '']);
      expect(line('r-bonus')).toEqual(['Постоянный', 'Доход', 'Премия', 'Оплачено', 'Карта', '', '']);
      expect(line('o-magazin')).toEqual(['Операция', 'Расход', 'Продукты', 'Оплачено', 'Кредитка', '', '']);
    });

    it('labels purchases, postponed rows and duplicates of purchases', async () => {
      const data2: Data = scenario();
      data2.journal.push({ id: 'j-perenos', date: '2026-12-01', kind: 'expense', what: 'Ноутбук', plan: 10, status: 'postponed' });
      const dec = monthItems(data2, '2026-12');
      const ws = sheet(await open(await monthReport(data2, '2026-12')), 'Движения');
      expect(text(ws, rowOfItem(ws, dec, 'p-noutbuk'), 'Источник')).toBe('Покупка');
      const perenos = rowOfItem(ws, dec, 'j-perenos');
      expect([text(ws, perenos, 'Статус'), text(ws, perenos, 'Возможный дубль'), text(ws, perenos, 'Счёт')])
        .toEqual(['Перенесено', 'Покупки', undefined]);
    });

    it('writes dates as date cells in dd.mm.yyyy and amounts in money format', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Движения');
      const first = dataRows(ws)[0] ?? 0;
      expect(cell(ws, first, 'Дата').value).toBeInstanceOf(Date);
      expect(cell(ws, first, 'Дата').numFmt).toBe(DATE_FORMAT);
      expect(cell(ws, first, 'Факт').numFmt).toBe(MONEY_FORMAT);
      expect(cell(ws, 'Доходы', 'Факт').numFmt).toBe(MONEY_FORMAT);
      expect(cell(ws, 'Переводы', 'Факт').numFmt).toBe(MONEY_FORMAT);
    });

    it('puts an autofilter over the header and the items, not over the total lines', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Движения');
      const last = HEADER_ROW + items.length;
      expect(ws.autoFilter).toBe(`A${HEADER_ROW}:K${last}`);
    });
  });

  describe('«По дням»', () => {
    it('shows the spending of every day of the month', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'По дням');
      expect(headers(ws)).toEqual(['День', 'Потрачено']);
      const days = dailySpend(data, OCT);
      const rows = dataRows(ws);
      expect(rows).toHaveLength(31);
      expect(rows.map((r) => date(ws, r, 'День'))).toEqual(days.map((_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`));
      expect(rows.map((r) => num(ws, r, 'Потрачено'))).toEqual(days);
    });

    it('has no ИТОГО row: day sums need not add up to the month expense fact', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'По дням');
      expect(bodyRows(ws)).toHaveLength(31);
      expect(totalLabels(ws)).toEqual([]);
      expect(() => rowOf(ws, 'ИТОГО')).toThrow();
    });
  });

  describe('styling', () => {
    it('has a bold 14 title merged across the table and a subtitle with the period', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Движения');
      const title = ws.getCell('A1');
      expect(cellText(title.value)).toContain('Октябрь 2026');
      expect(title.font?.bold).toBe(true);
      expect(title.font?.size).toBe(14);
      expect(ws.getCell('K1').isMerged).toBe(true);
      expect(ws.getCell('K1').master.address).toBe('A1');
      expect(cellText(ws.getCell('A2').value)).toMatch(/01\.10\.2026 – 31\.10\.2026.*сформировано \d\d\.\d\d\.\d{4}/);
    });

    it('prints the given generation date in the subtitle of every sheet', async () => {
      const wb = await open(await monthReport(data, OCT, '2026-10-05'));
      const expected = 'Период: 01.10.2026 – 31.10.2026 · сформировано 05.10.2026';
      expect(subtitles(wb)).toEqual({ 'Итоги': expected, 'Категории': expected, 'Движения': expected, 'По дням': expected });
    });

    describe('without a generation date', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('prints the local date of the device', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 9, 7, 23, 30)); // 7 October, late evening local time
        const wb = await open(await monthReport(data, OCT));
        expect(cellText(sheet(wb, 'Итоги').getCell('A2').value)).toBe('Период: 01.10.2026 – 31.10.2026 · сформировано 07.10.2026');
      });
    });

    it('leaves the subtitle unmerged so it runs past narrow tables, and widens columns until the title fits', async () => {
      const files = [await monthReport(data, OCT), await yearReport(data), await accountsReport(data, TODAY, OCT)];
      for (const file of files) {
        for (const ws of (await open(file)).worksheets) {
          expect(ws.getCell('B2').isMerged).toBe(false);
          const title = cellText(ws.getCell('A1').value) ?? '';
          let width = 0;
          for (let c = 1; c <= headers(ws).length; c++) width += ws.getColumn(c).width ?? 0;
          expect(width, `«${ws.name}»`).toBeGreaterThanOrEqual((title.length * 14) / 11); // 14 pt title over 11 pt columns
        }
      }
    });

    it('fills the header dark blue with white bold text and freezes the rows above the data', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Категории');
      const header = ws.getRow(HEADER_ROW).getCell(1);
      expect(header.fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E3A59' } });
      expect(header.font).toMatchObject({ bold: true, color: { argb: 'FFFFFFFF' } });
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: HEADER_ROW, showGridLines: true });
    });

    it('makes the totals row bold with a top border', async () => {
      const ws = sheet(await open(await monthReport(data, OCT)), 'Категории');
      for (const header of ['Категория', 'Факт']) {
        const total = cell(ws, 'ИТОГО', header);
        expect(total.font?.bold).toBe(true);
        expect(total.border?.top?.style).toBe('thin');
      }
    });

    it('fits column widths to the content between 10 and 40', async () => {
      const wb = await open(await monthReport(data, OCT));
      for (const ws of wb.worksheets) {
        for (let c = 1; c <= headers(ws).length; c++) {
          const width = ws.getColumn(c).width ?? 0;
          expect(width).toBeGreaterThanOrEqual(10);
          expect(width).toBeLessThanOrEqual(40);
        }
      }
      const ws = sheet(wb, 'Итоги');
      expect(ws.getColumn(1).width).toBeGreaterThan('Остаток лимитов'.length); // wider than the minimum
    });
  });
});

describe('yearReport — accounting year of the scenario', () => {
  const data = scenario();
  const stats = yearStats(data);
  const labels = accountingMonths(data.settings).map(monthLabel);

  it('prints the accounting year and the given generation date in the subtitle', async () => {
    const wb = await open(await yearReport(data, '2026-11-02'));
    const expected = 'Учётный год: Октябрь 2026 – Сентябрь 2027 · сформировано 02.11.2026';
    expect(subtitles(wb)).toEqual({ 'Месяцы': expected, 'Категории': expected });
  });

  it('names the file after the accounting year and has «Месяцы» and «Категории»', async () => {
    const file = await yearReport(data);
    expect(file.filename).toBe('Статистика — Октябрь 2026 – Сентябрь 2027.xlsx');
    expect(sheetNames(await open(file))).toEqual(['Месяцы', 'Категории']);
  });

  describe('«Месяцы»', () => {
    const HEADERS = ['Месяц', 'Доход план', 'Доход факт', 'Расход план', 'Расход факт', 'Баланс', 'Накоплено', 'Расход факт/план'];

    it('has 12 months and ИТОГО', async () => {
      const ws = sheet(await open(await yearReport(data)), 'Месяцы');
      expect(headers(ws)).toEqual(HEADERS);
      expect(bodyRows(ws).map((r) => cellText(ws.getRow(r).getCell(1).value))).toEqual([...labels, 'ИТОГО']);
    });

    it('shows October as the engine: 3200, 3205, 1180, 1235, 1970, 1970', async () => {
      const ws = sheet(await open(await yearReport(data)), 'Месяцы');
      expect(HEADERS.slice(1, 7).map((h) => num(ws, 'Октябрь 2026', h))).toEqual([3200, 3205, 1180, 1235, 1970, 1970]);
      expect(num(ws, 'Декабрь 2026', 'Накоплено')).toBe(480);
    });

    it('equals the engine in every month', async () => {
      const ws = sheet(await open(await yearReport(data)), 'Месяцы');
      for (const m of stats.months) {
        expect(HEADERS.slice(1).map((h) => num(ws, m.label, h)))
          .toEqual([m.incomePlan, m.incomeFact, m.expensePlan, m.expenseFact, m.balance, m.cumulative, m.ratio]);
      }
      expect(cell(ws, 'Октябрь 2026', 'Расход факт/план').numFmt).toBe(PERCENT_FORMAT);
      expect(cell(ws, 'Октябрь 2026', 'Баланс').numFmt).toBe(MONEY_FORMAT);
    });

    it('totals plan, fact and balance of the year', async () => {
      const ws = sheet(await open(await yearReport(data)), 'Месяцы');
      const total = (pick: (m: (typeof stats.months)[number]) => number) => sum(stats.months.map(pick));
      expect(num(ws, 'ИТОГО', 'Доход план')).toBeCloseTo(total((m) => m.incomePlan), 10);
      expect(num(ws, 'ИТОГО', 'Доход факт')).toBeCloseTo(total((m) => m.incomeFact), 10);
      expect(num(ws, 'ИТОГО', 'Расход план')).toBeCloseTo(total((m) => m.expensePlan), 10);
      expect(num(ws, 'ИТОГО', 'Расход факт')).toBeCloseTo(total((m) => m.expenseFact), 10);
      expect(num(ws, 'ИТОГО', 'Баланс')).toBeCloseTo(total((m) => m.balance), 10);
    });

    it('shows the average monthly expense and the most expensive month below the table', async () => {
      const ws = sheet(await open(await yearReport(data)), 'Месяцы');
      expect(besideLabel(ws, 'Средний расход в месяц')).toBeCloseTo(stats.avgExpense, 10);
      expect(ws.getRow(lastRowOf(ws, 'Средний расход в месяц')).getCell(2).numFmt).toBe(MONEY_FORMAT);
      expect(besideLabel(ws, 'Самый дорогой месяц')).toBe(stats.maxMonth);
    });

    it('shows a dash for the most expensive month of a year without expenses', async () => {
      const empty: Data = { ...scenario(), journal: [], recurring: [], purchases: [], operations: [] };
      const ws = sheet(await open(await yearReport(empty)), 'Месяцы');
      expect(besideLabel(ws, 'Самый дорогой месяц')).toBe('—');
    });
  });

  describe('«Категории»', () => {
    it('has a column per accounting month and Итого', async () => {
      const ws = sheet(await open(await yearReport(data)), 'Категории');
      expect(headers(ws)).toEqual(['Категория', ...labels, 'Итого']);
      expect(bodyRows(ws).map((r) => cellText(ws.getRow(r).getCell(1).value))).toEqual([
        ...data.categories.expense.map((c) => c.name), 'Без категории', 'ИТОГО',
      ]);
    });

    it('shows the category × month matrix of the engine: Жильё 900 in October, 950 in November', async () => {
      const ws = sheet(await open(await yearReport(data)), 'Категории');
      expect([num(ws, 'Жильё', 'Октябрь 2026'), num(ws, 'Жильё', 'Ноябрь 2026')]).toEqual([900, 950]);
      for (const row of stats.matrix) {
        expect(labels.map((l) => num(ws, row.name, l))).toEqual(row.byMonth);
        expect(num(ws, row.name, 'Итого')).toBe(row.total);
      }
      expect(labels.map((l) => num(ws, 'Без категории', l))).toEqual(stats.uncategorized);
      expect(labels.map((l) => num(ws, 'ИТОГО', l))).toEqual(stats.months.map((m) => m.expenseFact));
      expect(num(ws, 'ИТОГО', 'Итого')).toBeCloseTo(sum(stats.months.map((m) => m.expenseFact)), 10);
      expect(cell(ws, 'Жильё', 'Октябрь 2026').numFmt).toBe(MONEY_FORMAT);
    });
  });
});

const IN_BALANCE = 'ИТОГО в балансе (без сбережений)';
const SAVINGS = 'Сбережения (вне баланса)';

describe('accountsReport — scenario, today 2026-09-30, October', () => {
  const data = scenario();
  const b = balances(data, TODAY);

  it('names the file after the month', async () => {
    expect((await accountsReport(data, TODAY, OCT)).filename).toBe('Счета — Октябрь 2026.xlsx');
  });

  it('has «Счета», a sheet per account and «Выписки кредитки»; the account «Кредитка» keeps its name', async () => {
    expect(sheetNames(await open(await accountsReport(data, TODAY, OCT))))
      .toEqual(['Счета', 'Карта', 'Наличные', 'Кредитка', 'Выписки кредитки']);
  });

  it('gives way to the statements sheet when an account is named «Выписки кредитки»', async () => {
    const renamed: Data = scenario();
    renamed.accounts = renamed.accounts.map((a) => (a.id === ACC.credit ? { ...a, name: 'Выписки кредитки' } : a));
    expect(sheetNames(await open(await accountsReport(renamed, TODAY, OCT))))
      .toEqual(['Счета', 'Карта', 'Наличные', 'Выписки кредитки (2)', 'Выписки кредитки']);
  });

  it('prints «today» as the generation date by default', async () => {
    const wb = await open(await accountsReport(data, TODAY, OCT));
    expect(subtitles(wb)).toEqual({
      'Счета': 'Остатки на 30.09.2026 · сформировано 30.09.2026',
      'Карта': 'Октябрь 2026: 01.10.2026 – 31.10.2026 · сформировано 30.09.2026',
      'Наличные': 'Октябрь 2026: 01.10.2026 – 31.10.2026 · сформировано 30.09.2026',
      'Кредитка': 'Октябрь 2026: 01.10.2026 – 31.10.2026 · сформировано 30.09.2026',
      'Выписки кредитки': 'Учётный год: Октябрь 2026 – Сентябрь 2027 · списания на 30.09.2026 · сформировано 30.09.2026',
    });
  });

  it('prints the given generation date when there is one', async () => {
    const wb = await open(await accountsReport(data, TODAY, OCT, '2026-10-05'));
    expect(cellText(sheet(wb, 'Счета').getCell('A2').value)).toBe('Остатки на 30.09.2026 · сформировано 05.10.2026');
    expect(cellText(sheet(wb, 'Карта').getCell('A2').value)).toBe('Октябрь 2026: 01.10.2026 – 31.10.2026 · сформировано 05.10.2026');
  });

  describe('«Счета»', () => {
    it('shows the balances of the engine', async () => {
      const ws = sheet(await open(await accountsReport(data, TODAY, OCT)), 'Счета');
      expect(headers(ws)).toEqual(['Счёт', 'Тип', 'На начало', 'Поступления', 'Траты', 'Переводы', 'Сейчас', 'Долг']);
      expect(dataRows(ws).map((r) => text(ws, r, 'Счёт'))).toEqual(['Карта', 'Наличные', 'Кредитка']);
      expect(num(ws, 'Карта', 'Сейчас')).toBe(1410);
      expect(num(ws, 'Кредитка', 'Долг')).toBe(-10);
      expect(value(ws, 'Карта', 'Долг')).toBeNull();
      expect(text(ws, 'Карта', 'Тип')).toBe('Дебетовая');
      for (const r of b.rows) {
        expect(['На начало', 'Поступления', 'Траты', 'Переводы', 'Сейчас'].map((h) => num(ws, r.name, h)))
          .toEqual([r.start, r.income, r.expense, r.transfers, r.now]);
      }
      expect(cell(ws, 'Карта', 'Сейчас').numFmt).toBe(MONEY_FORMAT);
    });

    it('totals the accounts: those in the balance, then the savings ones (none here: 0)', async () => {
      const ws = sheet(await open(await accountsReport(data, TODAY, OCT)), 'Счета');
      expect(totalLabels(ws)).toEqual([IN_BALANCE, SAVINGS]);
      expect(num(ws, IN_BALANCE, 'Сейчас')).toBeCloseTo(b.total, 10);
      expect(num(ws, IN_BALANCE, 'На начало')).toBe(sum(b.rows.map((r) => r.start)));
      expect(num(ws, IN_BALANCE, 'Долг')).toBe(b.creditDebt);
      expect(['На начало', 'Поступления', 'Траты', 'Переводы', 'Сейчас'].map((h) => num(ws, SAVINGS, h))).toEqual([0, 0, 0, 0, 0]);
      expect(value(ws, SAVINGS, 'Долг')).toBeNull();
    });

    it('shows cards, cash, credit debt, the total and the savings below the table', async () => {
      const ws = sheet(await open(await accountsReport(data, TODAY, OCT)), 'Счета');
      expect(['На картах', 'Наличные', 'Долг по кредитке', 'Всего', 'Сбережения'].map((l) => besideLabel(ws, l)))
        .toEqual([b.cards, b.cash, b.creditDebt, b.total, 0]);
      expect(ws.getRow(lastRowOf(ws, 'Всего')).getCell(2).numFmt).toBe(MONEY_FORMAT);
      expect(ws.getRow(lastRowOf(ws, 'Сбережения')).getCell(2).numFmt).toBe(MONEY_FORMAT);
    });
  });

  describe('«Счета» with savings accounts (the tracker reviewer’s scenario, today 30.09.2026)', () => {
    const sav = savingsScenario();
    const bs = balances(sav, TODAY);

    it('lists every account; ИТОГО counts the accounts in the balance, «Сбережения» the savings ones', async () => {
      const ws = sheet(await open(await accountsReport(sav, TODAY, '2026-06')), 'Счета');
      expect(dataRows(ws).map((r) => [text(ws, r, 'Счёт'), text(ws, r, 'Тип'), num(ws, r, 'Сейчас')])).toEqual([
        ['Карта', 'Дебетовая', 3435], ['Нал', 'Наличные', 220], ['Кредитка', 'Кредитная', 10],
        ['Копилка', 'Сберегательная', 3940], ['Вклад', 'Сберегательная', 3754],
      ]);
      expect(totalLabels(ws)).toEqual([IN_BALANCE, SAVINGS]);
      const inBalance = bs.rows.filter((r) => r.type !== 'savings');
      const savings = bs.rows.filter((r) => r.type === 'savings');
      const sums = (rows: typeof bs.rows) =>
        [sum(rows.map((r) => r.start)), sum(rows.map((r) => r.income)), sum(rows.map((r) => r.expense)),
          sum(rows.map((r) => r.transfers)), sum(rows.map((r) => r.now))];
      const HEADS = ['На начало', 'Поступления', 'Траты', 'Переводы', 'Сейчас'];
      expect(HEADS.map((h) => num(ws, IN_BALANCE, h))).toEqual(sums(inBalance));
      expect(HEADS.map((h) => num(ws, SAVINGS, h))).toEqual(sums(savings));
      expect([num(ws, IN_BALANCE, 'На начало'), num(ws, IN_BALANCE, 'Сейчас')]).toEqual([1200, 3665]);
      expect([num(ws, SAVINGS, 'На начало'), num(ws, SAVINGS, 'Сейчас')]).toEqual([8000, 7694]);
      expect(num(ws, IN_BALANCE, 'Долг')).toBe(0);
      expect(value(ws, SAVINGS, 'Долг')).toBeNull();
      for (const h of ['Счёт', 'Сейчас']) expect(cell(ws, SAVINGS, h).font?.bold).toBe(true);
    });

    it('below the table: «На картах» 3435 (debit only), «Всего» 3665 (without savings), «Сбережения» 7694', async () => {
      const ws = sheet(await open(await accountsReport(sav, TODAY, '2026-06')), 'Счета');
      expect(['На картах', 'Наличные', 'Долг по кредитке', 'Всего', 'Сбережения'].map((l) => besideLabel(ws, l)))
        .toEqual([3435, 220, 0, 3665, 7694]);
    });
  });

  describe('a sheet per account', () => {
    it('lists the movements of the month with the running balance of the engine', async () => {
      const wb = await open(await accountsReport(data, TODAY, OCT));
      const ws = sheet(wb, 'Карта');
      expect(headers(ws)).toEqual(['Дата', 'Что', 'Сумма', 'Остаток']);
      const moves = accountMovements(data, ACC.card, '2026-10-01', '2026-10-31', TODAY);
      const rows = dataRows(ws);
      expect(rows).toHaveLength(moves.length);
      expect(rows.map((r) => [date(ws, r, 'Дата'), text(ws, r, 'Что'), num(ws, r, 'Сумма'), num(ws, r, 'Остаток')]))
        .toEqual(moves.map((m) => [m.date, m.what, m.amount, m.running]));
      const last = rows[rows.length - 1] ?? 0;
      expect(num(ws, last, 'Остаток')).toBe(moves[moves.length - 1]?.running);
      expect(cell(ws, last, 'Остаток').numFmt).toBe(MONEY_FORMAT);
      expect(ws.autoFilter).toBe(`A${HEADER_ROW}:D${HEADER_ROW + moves.length}`);
    });

    it('shows the credit account movements on its own sheet', async () => {
      const ws = sheet(await open(await accountsReport(data, TODAY, OCT)), 'Кредитка');
      const moves = accountMovements(data, ACC.credit, '2026-10-01', '2026-10-31', TODAY);
      expect(dataRows(ws).map((r) => num(ws, r, 'Остаток'))).toEqual(moves.map((m) => m.running));
    });
  });

  describe('«Выписки кредитки»', () => {
    it('shows the 12 statements of the engine', async () => {
      const ws = sheet(await open(await accountsReport(data, TODAY, OCT)), 'Выписки кредитки');
      const HEADERS = ['Выписка на', 'Долг с прошлой', 'Погашено', 'Покупки', 'Возвраты и переводы', 'Долг по выписке', 'Спишется', 'Сумма списания'];
      expect(headers(ws)).toEqual(HEADERS);
      const statements = creditStatements(data, TODAY);
      const rows = dataRows(ws);
      expect(rows).toHaveLength(12);
      expect(rows.map((r) => [
        date(ws, r, 'Выписка на'), num(ws, r, 'Долг с прошлой'), num(ws, r, 'Погашено'), num(ws, r, 'Покупки'),
        num(ws, r, 'Возвраты и переводы'), num(ws, r, 'Долг по выписке'), date(ws, r, 'Спишется'), num(ws, r, 'Сумма списания'),
      ])).toEqual(statements.map((s) => [s.close, s.carried, s.repaid, s.purchases, s.other, s.debt, s.payDate, s.payAmount]));
      expect(num(ws, '04.12.2026', 'Сумма списания')).toBe(10);
      expect(cell(ws, '04.12.2026', 'Выписка на').numFmt).toBe(DATE_FORMAT);
      expect(cell(ws, '04.12.2026', 'Сумма списания').numFmt).toBe(MONEY_FORMAT);
    });

    it('shows the next debit below the table', async () => {
      const ws = sheet(await open(await accountsReport(data, TODAY, OCT)), 'Выписки кредитки');
      const next = nextCreditDebit(data, TODAY);
      expect(cellDate(besideLabel(ws, 'Ближайшее списание', 1))).toBe(next?.date);
      expect(besideLabel(ws, 'Ближайшее списание', 2)).toBe(next?.amount);
    });

    it('is left out without a credit card, and account sheets keep their names', async () => {
      const noCard: Data = scenario();
      noCard.accounts = noCard.accounts.filter((a) => a.type !== 'credit');
      expect(sheetNames(await open(await accountsReport(noCard, TODAY, OCT)))).toEqual(['Счета', 'Карта', 'Наличные']);
    });
  });

  it('makes account sheet names valid, at most 31 characters and unique ignoring case', async () => {
    const odd: Data = scenario();
    odd.accounts = [
      { id: 'a1', name: 'Счёт: евро/доллар [основной]?*', type: 'debit', start: 0 },
      { id: 'a2', name: "'Копилка'", type: 'savings', start: 0 },
      { id: 'a3', name: 'Очень длинное название счёта в банке', type: 'debit', start: 0 },
      { id: 'a4', name: 'Очень длинное название счёта в банке', type: 'debit', start: 0 },
      { id: 'a5', name: 'карта', type: 'debit', start: 0 },
      { id: 'a6', name: 'КАРТА', type: 'debit', start: 0 },
      { id: 'a7', name: 'счета', type: 'cash', start: 0 },
      { id: 'a8', name: '  ', type: 'cash', start: 0 },
      { id: 'a9', name: 'history', type: 'cash', start: 0 },
    ];
    const names = sheetNames(await open(await accountsReport(odd, TODAY, OCT)));
    expect(names).toEqual([
      'Счета',
      'Счёт евро доллар основной',
      'Копилка',
      'Очень длинное название счёта в',
      'Очень длинное название счёт (2)',
      'карта',
      'КАРТА (2)',
      'счета (2)',
      'Счёт',
      'history (2)',
    ]);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(31);
  });
});

describe('forecastReport — the scenario, forecast from October 2026', () => {
  const data = scenario();
  const f = forecast(data);
  const MONTHS = [
    'Месяц', 'Доходы', 'Расходы', 'Постоянные', 'Разовые', 'Покупки', 'Переводы в / из сбережений', 'Остаток на конец',
    'Запас над подушкой',
  ];
  const WEEKS = ['Неделя', 'С', 'По', 'Доходы', 'Расходы', 'Переводы в / из сбережений', 'Остаток на конец', 'Ниже подушки'];

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the file after the forecast months and has «Месяцы» and «Недели»', async () => {
    const file = await forecastReport(data, TODAY);
    expect(file.filename).toBe('Прогноз — Октябрь 2026 – Декабрь 2026.xlsx');
    expect(file.buffer).toBeInstanceOf(ArrayBuffer);
    expect(sheetNames(await open(file))).toEqual(['Месяцы', 'Недели']);
  });

  it('the header: the forecast start and its balance, the cushion and the given generation date', async () => {
    const wb = await open(await forecastReport(data, '2026-11-02'));
    const expected = 'Начало прогноза 01.10.2026: 1\u00A0000,00\u00A0€ · подушка 100,00\u00A0€ · сформировано 02.11.2026';
    expect(subtitles(wb)).toEqual({ 'Месяцы': expected, 'Недели': expected });
    expect(cellText(sheet(wb, 'Месяцы').getCell('A1').value)).toBe('Прогноз по месяцам — Октябрь 2026 – Декабрь 2026');
    expect(cellText(sheet(wb, 'Недели').getCell('A1').value)).toBe('Прогноз по неделям — 28.09.2026 – 27.12.2026');
  });

  it('prints today on this device as the generation date by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0));
    const wb = await open(await forecastReport(data));
    expect(subtitles(wb)['Месяцы']).toMatch(/сформировано 03\.10\.2026$/);
  });

  it('«Месяцы»: the three forecast months, every number the engine’s', async () => {
    const ws = sheet(await open(await forecastReport(data, TODAY)), 'Месяцы');
    expect(headers(ws)).toEqual(MONTHS);
    expect(dataRows(ws).map((r) => cellText(ws.getRow(r).getCell(1).value))).toEqual(['Октябрь 2026', 'Ноябрь 2026', 'Декабрь 2026']);
    for (const m of f.months) {
      expect(MONTHS.slice(1).map((h) => num(ws, m.label, h)))
        .toEqual([m.income, m.expenses, m.recurring, m.oneOff, m.purchases, m.transfers, m.end, m.overCushion]);
      expect(cell(ws, m.label, 'Остаток на конец').numFmt).toBe(MONEY_FORMAT);
    }
    expect([num(ws, 'Октябрь 2026', 'Доходы'), num(ws, 'Октябрь 2026', 'Расходы'), num(ws, 'Октябрь 2026', 'Остаток на конец')])
      .toEqual([3205, 1335, 2870]);
    expect(num(ws, 'Декабрь 2026', 'Остаток на конец')).toBe(840);
  });

  it('«Месяцы»: the start balance and the cushion as numbers under the table', async () => {
    const ws = sheet(await open(await forecastReport(data, TODAY)), 'Месяцы');
    expect(besideLabel(ws, 'На начало прогноза')).toBe(f.start);
    expect(besideLabel(ws, 'Подушка')).toBe(data.settings.cushion);
    expect(ws.getRow(lastRowOf(ws, 'Подушка')).getCell(2).numFmt).toBe(MONEY_FORMAT);
  });

  it('«Недели»: the 13 weeks with their dates, flows and end balance from the engine; none below a cushion of 100', async () => {
    const ws = sheet(await open(await forecastReport(data, TODAY)), 'Недели');
    expect(headers(ws)).toEqual(WEEKS);
    const rows = dataRows(ws);
    expect(rows).toHaveLength(13);
    rows.forEach((r, i) => {
      const w = f.weeks[i]!;
      expect(num(ws, r, 'Неделя')).toBe(w.n);
      expect([date(ws, r, 'С'), date(ws, r, 'По')]).toEqual([w.from, w.to]);
      expect([num(ws, r, 'Доходы'), num(ws, r, 'Расходы'), num(ws, r, 'Переводы в / из сбережений'), num(ws, r, 'Остаток на конец')])
        .toEqual([w.income, w.expenses, w.transfers, w.end]);
      expect(text(ws, r, 'Ниже подушки')).toBeUndefined();
    });
    expect(cell(ws, rows[0]!, 'С').numFmt).toBe(DATE_FORMAT);
    expect([date(ws, rows[0]!, 'С'), num(ws, rows[0]!, 'Остаток на конец')]).toEqual(['2026-09-28', 4000]);
    expect(besideLabel(ws, 'Недель ниже подушки')).toBe(0);
    expect(besideLabel(ws, 'Минимальный остаток')).toBe(f.minEnd);
    expect(cellDate(ws.getRow(lastRowOf(ws, 'Минимальный остаток')).getCell(3).value)).toBe(f.minWeekFrom);
  });

  it('with a cushion of 1000: the weeks ending below it are marked and counted, the reserve follows', async () => {
    const d = scenario();
    d.settings.cushion = 1000;
    const g = forecast(d);
    const wb = await open(await forecastReport(d, TODAY));
    const weeks = sheet(wb, 'Недели');
    const marked = dataRows(weeks).map((r) => text(weeks, r, 'Ниже подушки') === 'да');
    expect(marked).toEqual(g.weeks.map((w) => w.end < w.cushion));
    expect(marked.filter(Boolean)).toHaveLength(3);
    expect(besideLabel(weeks, 'Недель ниже подушки')).toBe(g.weeksBelow);
    expect(num(sheet(wb, 'Месяцы'), 'Декабрь 2026', 'Запас над подушкой')).toBe(-160);
  });
});

describe('forecastReport — savings: only free money, with the transfers to and from savings', () => {
  it('«Месяцы» and «Недели» carry the engine’s transfers (−80 / +30 / +18) and the free-money ends', async () => {
    const sav = savingsScenario();
    const g = forecast(sav);
    const wb = await open(await forecastReport(sav, TODAY));
    const months = sheet(wb, 'Месяцы');
    expect(dataRows(months).map((r) => [num(months, r, 'Переводы в / из сбережений'), num(months, r, 'Остаток на конец')]))
      .toEqual([[-80, 1470], [30, 2335], [18, 1733]]);
    expect(cell(months, 'Июнь 2026', 'Переводы в / из сбережений').numFmt).toBe(MONEY_FORMAT);
    expect(besideLabel(months, 'На начало прогноза')).toBe(2260);
    const weeks = sheet(wb, 'Недели');
    expect(dataRows(weeks).map((r) => num(weeks, r, 'Переводы в / из сбережений'))).toEqual(g.weeks.map((w) => w.transfers));
    expect(dataRows(weeks).map((r) => num(weeks, r, 'Переводы в / из сбережений')))
      .toEqual([-400, 70, 250, 0, 0, 30, 0, 0, 0, -20, 45, -7, 0]);
    expect(dataRows(weeks).map((r) => num(weeks, r, 'Остаток на конец')))
      .toEqual([1360, 1370, 1470, 1470, 970, 1000, 935, 2335, 2335, 1725, 1740, 1733, 1733]);
  });
});

describe('text cells keep an Excel escape literally, like the backup', () => {
  const TRICKY = 'Чек_x0041_1';

  /** The scenario with «Чек_x0041_1» as a «Что», the card named «_x0042_» and a category «_x00e9_» in use. */
  function tricky(): Data {
    const d = scenario();
    d.operations.find((o) => o.id === 'o-bilet')!.what = TRICKY;
    d.accounts.find((a) => a.id === ACC.card)!.name = '_x0042_';
    d.categories.expense.push({ name: '_x00e9_' });
    d.operations.push({ id: 'o-e', date: '2026-10-15', kind: 'expense', category: '_x00e9_', what: 'a_b', amount: 7, account: ACC.cash });
    return d;
  }

  async function sharedStrings(file: ReportFile): Promise<string> {
    const JSZip = (await import('jszip')).default; // exceljs's own zip library
    const zip = await JSZip.loadAsync(file.buffer);
    return zip.file('xl/sharedStrings.xml')!.async('string');
  }

  it('month report: «Что», the account and the category read back as written; the file has _x005F_', async () => {
    const file = await monthReport(tricky(), OCT, TODAY);
    const wb = await open(file);
    const moves = sheet(wb, 'Движения');
    const row = dataRows(moves).find((r) => text(moves, r, 'Что') === TRICKY);
    expect(row).toBeDefined();
    expect(dataRows(moves).map((r) => text(moves, r, 'Счёт'))).toContain('_x0042_');
    expect(dataRows(moves).map((r) => text(moves, r, 'Категория'))).toContain('_x00e9_');
    expect(dataRows(moves).map((r) => text(moves, r, 'Что'))).toContain('a_b');
    expect(dataRows(sheet(wb, 'Категории')).map((r) => text(sheet(wb, 'Категории'), r, 'Категория'))).toContain('_x00e9_');
    const strings = await sharedStrings(file);
    expect(strings).toContain('Чек_x005F_x0041_1');
    expect(strings).toContain('_x005F_x00e9_');
    expect(strings).not.toMatch(/(?<!_x005F)_x0041_/);
  });

  it('year report: a category row reads back as written; lower-case hex is escaped too (Excel reads both)', async () => {
    const file = await yearReport(tricky(), TODAY);
    const cats = sheet(await open(file), 'Категории');
    expect(dataRows(cats).map((r) => cellText(cats.getRow(r).getCell(1).value))).toContain('_x00e9_');
    expect(await sharedStrings(file)).toContain('_x005F_x00e9_');
  });

  it('accounts report: the account name in the table and in the title of its sheet reads back as written', async () => {
    const wb = await open(await accountsReport(tricky(), TODAY, OCT, TODAY));
    const accounts = sheet(wb, 'Счета');
    expect(dataRows(accounts).map((r) => text(accounts, r, 'Счёт'))).toContain('_x0042_');
    const own = wb.worksheets.find((ws) => cellText(ws.getCell('A1').value) === '_x0042_ — движения');
    expect(own).toBeDefined();
    expect(dataRows(own!).map((r) => text(own!, r, 'Что'))).not.toContain('B');
  });
});
