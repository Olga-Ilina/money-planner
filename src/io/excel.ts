// Reading and writing ExcelJS cell values. Pure helpers — this module must not import exceljs,
// so screens that only need them do not load the library.
//
// An ExcelJS cell value is one of: null, number, string, boolean, Date, {formula, result?},
// {sharedFormula, result?}, {richText: [{text}]}, {text, hyperlink}, {error}.
import { addDays, daysInMonth } from '../engine/dates';
import type { ISODate } from '../engine/model';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

/** Euro with two decimals, negative in red. The € is quoted: a literal in the number-format grammar. */
export const MONEY_FORMAT = '#,##0.00 "€";[Red]-#,##0.00 "€"';
export const DATE_FORMAT = 'dd.mm.yyyy';

/** A '_' that starts '_xHHHH_' (hex in either case): Excel reads such a sequence as the character HHHH, and so does ExcelJS. */
const ESCAPE_START = /_(?=x[0-9A-Fa-f]{4}_)/g;

/**
 * Text to put in a cell so that Excel and ExcelJS show it as it is: each '_' that starts an '_xHHHH_'
 * sequence is written as '_x005F_' (the code of '_' itself), so «Чек_x0041_1» stays «Чек_x0041_1».
 */
export function escapeText(text: string): string {
  return text.replace(ESCAPE_START, '_x005F_');
}

/** Excel serial day 0; serials count whole days from here (the 1900 leap-year bug is already in it). */
const EXCEL_EPOCH: ISODate = '1899-12-30';

export function isFormula(v: unknown): boolean {
  return isObject(v) && ('formula' in v || 'sharedFormula' in v);
}

/** The plain value behind a cell: a formula's result (undefined when not calculated), rich text joined, a hyperlink's text. */
export function unwrap(v: unknown): unknown {
  if (!isObject(v)) return v;
  if (isFormula(v)) return v.result;
  if (Array.isArray(v.richText)) return v.richText.map((run: unknown) => (isObject(run) ? String(run.text ?? '') : '')).join('');
  if ('hyperlink' in v && 'text' in v) return unwrap(v.text); // the text may itself be rich text
  return v;
}

/** Trimmed text of a string or number cell; empty, error, boolean and date cells give undefined. */
export function cellText(v: unknown): string | undefined {
  const u = unwrap(v);
  if (typeof u === 'number') return Number.isFinite(u) ? String(u) : undefined;
  if (typeof u !== 'string') return undefined;
  const text = u.trim();
  return text === '' ? undefined : text;
}

/** A number, or numeric text with ',' or '.' as the decimal mark and spaces (incl. nbsp) between thousands. */
export function cellNumber(v: unknown): number | undefined {
  const u = unwrap(v);
  if (typeof u === 'number') return Number.isFinite(u) ? u : undefined;
  if (typeof u !== 'string') return undefined;
  const text = u.replace(/\s/g, '');
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return undefined;
  return Number(text.replace(',', '.'));
}

/** The date as 'YYYY-MM-DD'; undefined when it does not exist or its year has not exactly four digits (0000–9999). */
function isoOf(y: number, m: number, d: number): ISODate | undefined {
  if (!Number.isInteger(y) || y < 0 || y > 9999 || m < 1 || m > 12) return undefined;
  const ym = `${pad4(y)}-${pad2(m)}`;
  if (d < 1 || d > daysInMonth(ym)) return undefined;
  return `${ym}-${pad2(d)}`;
}

/**
 * Serials 1 to 2958465 are dates; a time of day is the fraction. Counted from EXCEL_EPOCH, serial 1 is
 * 1899-12-31 here, while Excel shows it as 1900-01-01: the epoch absorbs Excel's made-up 1900-02-29
 * (serial 60), so serials 1–60 come out one day earlier than Excel shows them and 61 on agree
 * (61 is 1900-03-01, 2958465 is 9999-12-31).
 */
const LAST_SERIAL = 2958465;

/**
 * A Date (its UTC day), an Excel serial number in Excel's date range, or text 'dd.mm.yyyy' / 'yyyy-mm-dd'.
 * ExcelJS turns a number in a date-formatted cell into a Date, so a Date is checked for its year too.
 */
export function cellDate(v: unknown): ISODate | undefined {
  const u = unwrap(v);
  if (u instanceof Date) {
    if (Number.isNaN(u.getTime())) return undefined;
    return isoOf(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate());
  }
  if (typeof u === 'number') {
    const serial = Math.floor(u);
    return serial >= 1 && serial <= LAST_SERIAL ? addDays(EXCEL_EPOCH, serial) : undefined; // NaN and ±Infinity fail both
  }
  if (typeof u !== 'string') return undefined;
  const text = u.trim();
  const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (ru) return isoOf(Number(ru[3]), Number(ru[2]), Number(ru[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return undefined;
}

/**
 * UTC midnight of the day — what ExcelJS writes as a date cell without a time-zone shift. The year
 * is set with setUTCFullYear: Date.UTC reads the years 0–99 as 1900–1999.
 */
export function isoToExcelDate(iso: ISODate): Date {
  const date = new Date(0);
  date.setUTCFullYear(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return date;
}

const TILDE = 0x7e;
const ASTERISK = 0x2a;
const QUESTION = 0x3f;

/** A `*` of a criterion; ANY is a `?`. Every other token is a code unit, folded (0…0xFFFF). */
const STAR = -1;
const ANY = -2;

const foldedUnits = new Map<number, number>();

/**
 * A UTF-16 code unit without its letter case: the lower case of its upper case (so ё and Ё, ς and σ are one
 * letter), as long as each is one code unit; otherwise the unit itself (a surrogate half has no case).
 */
function fold(unit: number): number {
  let result = foldedUnits.get(unit);
  if (result === undefined) {
    const c = String.fromCharCode(unit);
    const upper = c.toUpperCase();
    const lower = (upper.length === 1 ? upper : c).toLowerCase();
    result = lower.length === 1 ? lower.charCodeAt(0) : unit;
    foldedUnits.set(unit, result);
  }
  return result;
}

/**
 * Whether Excel's SUMIFS, COUNTIFS and MATCH(…, 0) match `text` with the text criterion `criterion`: the whole
 * text, ignoring letter case but not spaces; `*` stands for any run of characters, `?` for one character, and `~`
 * takes the next character as it is (`~*`, `~?`, `~~`; before another character the `~` is dropped, and a `~` at
 * the end stands for itself). Every other character, a hyphen or a bracket too, is only itself. Excel's text is
 * UTF-16, so `?` stands for one code unit (a character outside the BMP, e.g. an emoji, is two). Criteria that start
 * with a comparison (=, <, >) are not handled: names do not.
 *
 * A glob match with two pointers: on a mismatch it goes back only to the last `*` passed and lets it take one more
 * code unit, so the time is at most the product of the two lengths, never exponential, and there is no size limit.
 */
export function criterionMatches(criterion: string, text: string): boolean {
  const pattern: number[] = [];
  for (let i = 0; i < criterion.length; i++) {
    const unit = criterion.charCodeAt(i);
    if (unit === TILDE && i + 1 < criterion.length) pattern.push(fold(criterion.charCodeAt(++i)));
    else if (unit === ASTERISK) pattern.push(STAR);
    else if (unit === QUESTION) pattern.push(ANY);
    else pattern.push(fold(unit));
  }
  let p = 0;
  let t = 0;
  let star = -1; // the pattern index of the last * passed …
  let starEnd = 0; // … and the text index where the run it takes ends so far
  while (t < text.length) {
    const token = pattern[p];
    if (token === STAR) {
      star = p++;
      starEnd = t;
    } else if (token !== undefined && (token === ANY || token === fold(text.charCodeAt(t)))) {
      p++;
      t++;
    } else if (star >= 0) {
      p = star + 1;
      t = ++starEnd;
    } else {
      return false;
    }
  }
  while (pattern[p] === STAR) p++;
  return p === pattern.length;
}
