import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATE_FORMAT, MONEY_FORMAT, cellDate, cellNumber, cellText, criterionMatches, escapeText, isFormula, isoToExcelDate, unwrap } from '../../src/io/excel';

const oct1 = new Date(Date.UTC(2026, 9, 1));
const richText = { richText: [{ text: 'Аренда ' }, { font: { bold: true }, text: 'квартиры' }] };
const hyperlink = { text: 'Сайт', hyperlink: 'https://example.com' };

describe('excel helpers stay cheap to load', () => {
  it('do not import exceljs', () => {
    const source = readFileSync(join(import.meta.dirname, '../../src/io/excel.ts'), 'utf8');
    expect(source).not.toMatch(/['"]exceljs['"]/);
  });
});

describe('isFormula', () => {
  it.each([
    [{ formula: 'A1+1', result: 2 }, true],
    [{ formula: 'A1+1' }, true],
    [{ sharedFormula: 'B2', result: 3 }, true],
    [{ sharedFormula: 'B2' }, true],
    [null, false],
    [undefined, false],
    [5, false],
    ['=A1', false],
    [true, false],
    [oct1, false],
    [richText, false],
    [hyperlink, false],
    [{ error: '#DIV/0!' }, false],
  ])('%j → %s', (v, expected) => {
    expect(isFormula(v)).toBe(expected);
  });
});

describe('unwrap', () => {
  it('gives the result of a formula', () => {
    expect(unwrap({ formula: 'A1+1', result: 2 })).toBe(2);
    expect(unwrap({ sharedFormula: 'B2', result: 'текст' })).toBe('текст');
  });

  it('gives undefined for a formula without a result', () => {
    expect(unwrap({ formula: 'A1+1' })).toBeUndefined();
    expect(unwrap({ sharedFormula: 'B2' })).toBeUndefined();
  });

  it('joins the runs of rich text', () => {
    expect(unwrap(richText)).toBe('Аренда квартиры');
  });

  it('gives the text of a hyperlink', () => {
    expect(unwrap(hyperlink)).toBe('Сайт');
  });

  it('joins the rich text of a hyperlink', () => {
    expect(unwrap({ text: richText, hyperlink: 'https://example.com' })).toBe('Аренда квартиры');
  });

  it('keeps plain values as they are', () => {
    expect(unwrap(null)).toBeNull();
    expect(unwrap(undefined)).toBeUndefined();
    expect(unwrap(12.5)).toBe(12.5);
    expect(unwrap('abc')).toBe('abc');
    expect(unwrap(false)).toBe(false);
    expect(unwrap(oct1)).toBe(oct1);
    const error = { error: '#N/A' };
    expect(unwrap(error)).toBe(error);
  });
});

describe('cellText', () => {
  it('trims strings', () => {
    expect(cellText('  Еда  ')).toBe('Еда');
  });

  it('turns numbers into strings', () => {
    expect(cellText(42)).toBe('42');
    expect(cellText(-1.5)).toBe('-1.5');
    expect(cellText(0)).toBe('0');
  });

  it('reads formulas, rich text and hyperlinks', () => {
    expect(cellText({ formula: 'B1', result: ' Кафе ' })).toBe('Кафе');
    expect(cellText({ sharedFormula: 'B1', result: 7 })).toBe('7');
    expect(cellText(richText)).toBe('Аренда квартиры');
    expect(cellText(hyperlink)).toBe('Сайт');
  });

  it.each([
    ['empty string', ''],
    ['spaces only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['formula without result', { formula: 'A1' }],
    ['error', { error: '#REF!' }],
    ['boolean', true],
    ['date', oct1],
  ])('%s → undefined', (_name, v) => {
    expect(cellText(v)).toBeUndefined();
  });
});

describe('cellNumber', () => {
  it('keeps numbers', () => {
    expect(cellNumber(1234.5)).toBe(1234.5);
    expect(cellNumber(-20)).toBe(-20);
    expect(cellNumber(0)).toBe(0);
  });

  it.each([
    ['1 234,50', 1234.5],
    ['1 234,50', 1234.5],
    ['1 234.50', 1234.5],
    ['12 345 678', 12345678],
    ['1234.5', 1234.5],
    ['1234,5', 1234.5],
    ['  -20 ', -20],
    ['-0,5', -0.5],
    ['+15', 15],
    ['100', 100],
  ])('parses the text %j → %d', (text, n) => {
    expect(cellNumber(text)).toBe(n);
  });

  it('reads the result of a formula', () => {
    expect(cellNumber({ formula: 'SUM(A1:A3)', result: 90 })).toBe(90);
    expect(cellNumber({ sharedFormula: 'A1', result: '1 000,25' })).toBe(1000.25);
    expect(cellNumber(richText)).toBeUndefined();
    expect(cellNumber({ richText: [{ text: '1 234' }, { text: ',50' }] })).toBe(1234.5);
  });

  it.each([
    ['formula without result', { formula: 'A1' }],
    ['empty string', ''],
    ['text', 'Еда'],
    ['two separators', '1.234,50'],
    ['two decimal points', '1.2.3'],
    ['trailing text', '100 €'],
    ['boolean', true],
    ['date', oct1],
    ['null', null],
    ['undefined', undefined],
    ['error', { error: '#VALUE!' }],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('%s → undefined', (_name, v) => {
    expect(cellNumber(v)).toBeUndefined();
  });
});

describe('cellDate', () => {
  it('reads a Date as its UTC calendar day', () => {
    expect(cellDate(oct1)).toBe('2026-10-01');
    expect(cellDate(new Date(Date.UTC(2026, 9, 1, 23, 59)))).toBe('2026-10-01');
  });

  it('reads Excel serial numbers (epoch 1899-12-30, whole days)', () => {
    expect(cellDate(46296)).toBe('2026-10-01');
    expect(cellDate(46296.75)).toBe('2026-10-01');
    expect(cellDate(46326)).toBe('2026-10-31');
    expect(cellDate(45351)).toBe('2024-02-29');
  });

  it('reads up to the last day Excel has: serial 2958465 is 9999-12-31, also with a time of day', () => {
    expect(cellDate(2958465)).toBe('9999-12-31');
    expect(cellDate(2958465.75)).toBe('9999-12-31');
    expect(cellDate(1)).toBeDefined(); // the first day
  });

  it('serials 1–60 come out one day earlier than Excel shows them (its made-up 1900-02-29 is serial 60); from 61 on they agree', () => {
    expect([1, 59, 60, 61].map((serial) => cellDate(serial))).toEqual(['1899-12-31', '1900-02-27', '1900-02-28', '1900-03-01']);
  });

  // Excel has dates from serial 1 to 2958465 (shown as 1900-01-01 … 9999-12-31); anything else is no date.
  it.each([0, 0.5, -1, -45000, 2958466, 5000000, 1e12])('a serial number outside Excel\'s dates (%s) is no date', (serial) => {
    expect(cellDate(serial)).toBeUndefined();
    expect(cellDate({ formula: 'A1', result: serial })).toBeUndefined();
  });

  // ExcelJS gives a Date for a number in a date-formatted cell, so the year of a Date has to fit YYYY.
  it('a Date whose year has not four digits is no date', () => {
    expect(cellDate(new Date(Date.UTC(9999, 11, 31)))).toBe('9999-12-31');
    expect(cellDate(new Date(Date.UTC(10000, 0, 1)))).toBeUndefined();
    expect(cellDate(new Date(8.64e15))).toBeUndefined(); // the last moment a Date holds: year 275760
    expect(cellDate(isoToExcelDate('0001-01-01'))).toBe('0001-01-01');
    const yearMinusOne = new Date(0);
    yearMinusOne.setUTCFullYear(-1, 0, 1);
    expect(cellDate(yearMinusOne)).toBeUndefined();
  });

  it.each([
    ['01.10.2026', '2026-10-01'],
    ['1.10.2026', '2026-10-01'],
    ['29.02.2024', '2024-02-29'],
    [' 31.12.2026 ', '2026-12-31'],
    ['2026-10-01', '2026-10-01'],
    ['2024-02-29', '2024-02-29'],
  ])('reads the text %j → %s', (text, iso) => {
    expect(cellDate(text)).toBe(iso);
  });

  it('reads the result of a formula', () => {
    expect(cellDate({ formula: 'TODAY()', result: oct1 })).toBe('2026-10-01');
    expect(cellDate({ sharedFormula: 'C10', result: 46296 })).toBe('2026-10-01');
    expect(cellDate({ formula: 'C10' })).toBeUndefined();
  });

  it.each([
    ['impossible day', '31.02.2026'],
    ['month 13', '01.13.2026'],
    ['day 0', '2026-10-00'],
    ['impossible ISO day', '2026-02-29'],
    ['short year', '01.10.26'],
    ['other format', '10/01/2026'],
    ['text', 'завтра'],
    ['empty string', ''],
    ['invalid Date', new Date(Number.NaN)],
    ['NaN', Number.NaN],
    ['boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['error', { error: '#N/A' }],
  ])('%s → undefined', (_name, v) => {
    expect(cellDate(v)).toBeUndefined();
  });
});

describe('isoToExcelDate', () => {
  it('gives UTC midnight of the day', () => {
    const d = isoToExcelDate('2026-10-01');
    expect(d.getTime()).toBe(Date.UTC(2026, 9, 1));
    expect(d.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it.each(['2026-10-01', '2024-02-29', '2026-12-31', '2027-01-01'])('round-trips %s through cellDate', (iso) => {
    expect(cellDate(isoToExcelDate(iso))).toBe(iso);
  });

  // Date.UTC(50, …) is 1950: it reads the years 0–99 as 1900–1999. The helper must keep the year.
  it.each([
    ['0000-01-01', 0], ['0001-01-01', 1], ['0050-01-01', 50], ['0099-12-31', 99], ['0100-01-01', 100], ['1899-12-31', 1899],
  ])('keeps the year of %s (%s)', (iso, year) => {
    const d = isoToExcelDate(iso);
    expect(d.getUTCFullYear()).toBe(year);
    expect(d.toISOString().slice(0, 10)).toBe(iso);
    expect(cellDate(d)).toBe(iso);
  });

  it('is UTC midnight also for the years 0–99', () => {
    const d = isoToExcelDate('0050-06-15');
    expect([d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([50, 5, 15]);
  });
});

describe('number formats shared by the Excel files', () => {
  it('shows money in euro with two decimals, negative in red; the € is a quoted literal', () => {
    expect(MONEY_FORMAT).toBe('#,##0.00 "€";[Red]-#,##0.00 "€"');
  });

  it('shows dates as dd.mm.yyyy', () => {
    expect(DATE_FORMAT).toBe('dd.mm.yyyy');
  });
});

describe('criterionMatches: a text criterion as SUMIFS, COUNTIFS and MATCH(…,0) match it', () => {
  it.each([
    ['Карта', 'Карта', true], ['Карта', 'карта', true], ['КАРТА', 'карта', true], // letter case is ignored
    ['Карта', ' Карта', false], ['Карта', 'Карта ', false], [' Карта ', 'Карта', false], // spaces are not
    ['Карта', 'Карта 2', false], ['Карта', 'Карт', false], // the whole text, not a part
    ['Ноя*', 'Ноябрь', true], ['Ноя*', 'Ноя', true], ['Ноя*', 'Октябрь', false], ['*', '', true], ['*ь', 'Январь', true],
    ['Карта*', ' Карта', false], ['*Карта*', ' Карта ', true],
    ['?юнь', 'Июнь', true], ['?юнь', 'юнь', false], ['Ию?ь', 'Июль', true], ['Visa *1234', 'Visa *1234', true], ['Visa *1234', 'Visa 1234', true],
    ['Счёт?', 'Счёт?', true], ['Счёт?', 'Счёт1', true], ['Счёт?', 'Счёт', false],
    ['A~*', 'A*', true], ['A~*', 'Ab', false], ['A~?', 'A?', true], ['A~~', 'A~', true], ['A~B', 'AB', true], ['A~B', 'A~B', false],
    ['a.b', 'a.b', true], ['a.b', 'axb', false], ['(1)+[2]', '(1)+[2]', true], ['$^', '$^', true], // no other special characters
    ['а\nб', 'а\nб', true], ['а*б', 'а\nб', true], // a line break is a character like any other
  ])('%j matches %j: %s', (criterion, text, expected) => {
    expect(criterionMatches(criterion, text)).toBe(expected);
  });

  // Every character a regular expression treats specially is an ordinary character in a criterion (the hyphen of
  // «Т-Банк» or «10-2026» once made the whole import fail).
  it.each(['-', '.', '(', ')', '[', ']', '\\', '^', '$', '|', '+', '{', '}', '/'])('%j is a character like any other', (c) => {
    expect(criterionMatches(`Т${c}Банк`, `т${c}банк`)).toBe(true);
    expect(criterionMatches(`Т${c}Банк`, `Т${c}Банк `)).toBe(false);
    expect(criterionMatches(`Т${c}Банк`, 'ТxБанк')).toBe(false);
    expect(criterionMatches(`*${c}*`, `а${c}б`)).toBe(true);
    expect(criterionMatches(`?${c}`, `а${c}`)).toBe(true);
    expect(criterionMatches(`~${c}`, c)).toBe(true); // ~ before it is dropped
  });

  it.each([
    ['Т-Банк', 'т-банк', true], ['Альфа-Банк', 'Альфа-Банк', true], ['10-2026', 'Январь', false], ['10-2026', '10-2026', true],
    ['ЁЛКА', 'ёлка', true], ['ёлка', 'ЕЛКА', false], // ё and Ё are one letter in two cases; е is another letter
    ['*a*b', 'xaybzb', true], ['a*b*c', 'abcbc', true], ['a*b*c', 'abcb', false], ['**', '', true], ['*?', '', false], ['?*', 'x', true],
    ['~*', '*', true], ['~*', 'x', false], ['~~*', '~abc', true], ['~?*', '?x', true], ['A~', 'A~', true], ['A~', 'A', false], ['~', '~', true],
  ])('%j matches %j: %s', (criterion, text, expected) => {
    expect(criterionMatches(criterion, text)).toBe(expected);
  });

  // Excel's text is UTF-16: ? stands for one code unit, so a character outside the BMP (an emoji) is two of them.
  it.each([
    ['?', '😀', false], ['??', '😀', true], ['*', '😀', true], ['😀', '😀', true], ['?😀', 'a😀', true], ['😀?', '😀😀', false], ['😀??', '😀😀', true],
  ])('%j matches %j: %s (? is one UTF-16 code unit)', (criterion, text, expected) => {
    expect(criterionMatches(criterion, text)).toBe(expected);
  });

  it('takes no exponential time: «*x*x*x*x*y» against 10 000 characters stays under 50 ms', () => {
    const text = 'x'.repeat(10_000);
    const start = performance.now();
    expect(criterionMatches('*x*x*x*x*y', text)).toBe(false);
    expect(criterionMatches('*x*x*x*x*y', `${text}y`)).toBe(true);
    expect(criterionMatches('*x*x*x*x*y', `y${text}`)).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('has no size limit', () => {
    const long = 'Я'.repeat(100_000);
    expect(criterionMatches(long, long.toLowerCase())).toBe(true);
    expect(criterionMatches(`${long}*`, `${long}-хвост`)).toBe(true);
    expect(criterionMatches(`*${long}`, `-${long}`)).toBe(true);
    expect(criterionMatches(long, `${long}я`)).toBe(false);
  });
});

describe('escapeText', () => {
  it('writes the _ of every _xHHHH_ (either case of hex) as _x005F_, so Excel shows the text as it is', () => {
    expect(escapeText('Чек_x0041_1')).toBe('Чек_x005F_x0041_1');
    expect(escapeText('_x00e9_ и _x00E9_')).toBe('_x005F_x00e9_ и _x005F_x00E9_');
    // the second _ starts _x0042_ as soon as the first sequence is read: both are escaped
    expect(escapeText('_x0041_x0042_')).toBe('_x005F_x0041_x005F_x0042_');
    expect(escapeText('__x0041_')).toBe('__x005F_x0041_');
    expect(escapeText('_x005F_')).toBe('_x005F_x005F_');
  });

  it('leaves every other text alone', () => {
    for (const text of ['', 'a_b', '_X0041_', '_x004_', '_x00411_', '_xG041_', 'Продукты']) expect(escapeText(text)).toBe(text);
  });
});
