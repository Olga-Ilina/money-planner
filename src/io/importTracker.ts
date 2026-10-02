// Loads the Excel tracker «Трекер и планер расходов» (.xlsx) into the app's data. Cell addresses
// are fixed by the tracker generator, except «Постоянные», whose columns are found by header text,
// and the ends of the tables, which are read down to the generator's footer wherever rows the user
// inserted or deleted have moved it. Numbers typed over formula cells are not carried over; they
// are listed in `overrides`. Cell notes (comments) have no place in the model; each one is
// reported in `notes`.
// exceljs (and jszip) are loaded lazily, so the app bundle stays small.
import type { CellValue, Workbook, Worksheet } from 'exceljs';
import type JSZip from 'jszip';
import { accountingMonths, monthLabel, monthStart, newId, parseMonthLabel, SCHEMA_VERSION, ymOf } from '../engine';
import type {
  Account, CreditSettings, Data, Debt, ExpenseCategory, ISODate, JournalRow, Mark, Operation, Purchase, Recurring, Settings, YM,
} from '../engine';
import { cellDate, cellNumber, cellText, criterionMatches, isFormula, unwrap } from './excel';
import { ACCOUNT_TYPE_LABEL, CHECK, JOURNAL_STATUS_LABEL, KIND_LABEL, parseAccountType, parseKind, parseStatus } from './labels';
import { stripDrawings } from './stripDrawings';

export interface ImportResult {
  data: Data;
  /** Rows that were skipped or changed on the way in, in Russian for the user. */
  notes: string[];
  /** Constants typed over formula cells, e.g. «Счета!E10 = 1234»; their values are ignored. */
  overrides: string[];
}

/** A file that cannot be loaded; the message is in Russian and meant for the user. */
export class TrackerImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackerImportError';
  }
}

/**
 * The sheet of the planned rows is «Запланированные»; the tracker's generator called it «Журнал» until it was renamed
 * (the model and the code still say `journal`). A file has one of the two names, never both (see trackerSheets); the
 * notes name the one the file has (Reader.name).
 */
const PLANNED = 'Запланированные';
const PLANNED_BEFORE_RENAME = 'Журнал';

const SHEETS = ['Настройки', 'Операции', 'Счета', PLANNED, 'Постоянные', 'Покупки', 'Месяц', 'Долги'] as const;
type SheetName = (typeof SHEETS)[number];
type Sheets = Record<SheetName, Worksheet>;

/**
 * Formula cells of the tracker where a typed constant replaces the calculation. In a table (`to: 'table'`) they go
 * down to its last row, wherever rows the user inserted or deleted have moved it (see Reader.bounds).
 * The helpers of savings accounts outside the balance (excel-planners 1aff566): the flag «в балансе» of a row's
 * account — Запланированные V, Операции T, Постоянные AF (the accounting-year expansion, rows 8–367) and AK (the forecast
 * expansion, rows 8–97), Покупки U — and Операции U, a transfer's effect on the free money (build_tracker.py 43–45,
 * 233, 334–338, 659, 682, 731). Files built before them have these cells empty.
 */
const FORMULA_AREAS: { sheet: SheetName; cols: string[]; from: number; to: number | 'table' }[] = [
  { sheet: 'Настройки', cols: ['C'], from: 10, to: 10 },
  { sheet: 'Операции', cols: ['B', 'J', 'K', 'Q', 'T', 'U'], from: 10, to: 'table' },
  { sheet: 'Счета', cols: ['E', 'F', 'G', 'H', 'I'], from: 10, to: 21 },
  { sheet: PLANNED, cols: ['B', 'L', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'], from: 10, to: 'table' },
  { sheet: 'Постоянные', cols: ['AF'], from: 8, to: 367 },
  { sheet: 'Постоянные', cols: ['AK'], from: 8, to: 97 },
  { sheet: 'Покупки', cols: ['R', 'U'], from: 7, to: 'table' },
];

/** Headers of «Постоянные» (row 7) matched after collapsing whitespace, ignoring case. */
const RECURRING_HEADERS = {
  what: 'Что', kind: 'Тип', category: 'Категория', day: 'День', amount: 'Сумма',
  every: 'Раз в N мес.', from: 'Действует с', to: 'по', account: 'Счёт',
} as const;
type RecurringColumn = keyof typeof RECURRING_HEADERS;

/** The columns of «Операции» the import reads (B, J, K and the helpers right of them are formulas). */
const OPERATION_INPUTS = ['C', 'D', 'E', 'F', 'G', 'H', 'I'];

/**
 * The columns of «Запланированные» the import reads, except M «Месяц учёта»: that one is a formula unless a month is
 * typed over it (B, L, N and the helpers right of them are formulas).
 */
const JOURNAL_INPUTS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

/** The columns of «Покупки» the import reads besides the name in C. */
const PURCHASE_INPUTS = ['D', 'E', 'F', 'G', 'L', 'N', 'O', 'P'];

/** The columns of «Долги» the import reads besides the name in C. */
const DEBT_INPUTS = ['D', 'E', 'F', 'H', 'I', 'J'];

/** Every column of a table the import reads, for telling a row with input. */
const PURCHASE_READ = ['C', ...PURCHASE_INPUTS];
const DEBT_READ = ['C', ...DEBT_INPUTS];

/** The sheets that hold a table of rows under a header, down to the generator's footer (see Reader.bounds). */
type TableSheet = 'Операции' | 'Запланированные' | 'Постоянные' | 'Покупки' | 'Долги';

/**
 * The note the tracker's generator writes under a table: merged over `from`:`to`, its text starting with `label`
 * (compared ignoring letter case and runs of spaces).
 * - Запланированные: «Факт: вписанная «Сумма факт» …» merged C:N on J_BOT+2 (261–264);
 * - Операции: «Знак суммы не важен: …» merged C:K on O_BOT+2 (356–358);
 * - Покупки: «Покупка живёт только здесь: …» merged C:P on B_BOT+3, under ИТОГО (756–758).
 * It ends the table only below the last row with the sheet's helper (ROW_FORMULA), which every row of the table
 * has: a copy of it inside the table, or the same merge and text the user made there, is not the end. Nor is it data,
 * inside a table or under it: the loops skip it, without a note (Запланированные, Операции and Покупки; the other sheets have
 * no such note). It gets inside a table when a later SUM of the user's reaches it (Покупки: a range that ends at or
 * below it, see Reader.bounds) or when the helper is filled down past it.
 */
const FOOTER_NOTES: Partial<Record<TableSheet, { from: string; to: string; label: string }>> = {
  Запланированные: { from: 'C', to: 'N', label: 'Факт:' },
  Операции: { from: 'C', to: 'K', label: 'Знак суммы не важен' },
  Покупки: { from: 'C', to: 'P', label: 'Покупка живёт только здесь' },
};

/**
 * The totals rows the generator writes under a table, told by their formulas whatever their label says (the user
 * may rename or unmerge it; a file saved by Excel has the totals' results, which would be loaded as a row): each
 * column holds SUM over the table of the column it names.
 * - Покупки ИТОГО on B_BOT+1: E, F, H, J = SUM of their own column, O = SUM(S) (747–752);
 * - Долги ИТОГО on DG_BOT+1: E, F, G, I = SUM of their own column (1161–1164).
 * «Постоянные» is told by its G, SUMPRODUCT over the amounts (see isRecurringTotals).
 */
const TOTAL_SUMS: Partial<Record<TableSheet, Record<string, string>>> = {
  Покупки: { E: 'E', F: 'F', H: 'H', J: 'J', O: 'S' },
  Долги: { E: 'E', F: 'F', G: 'G', I: 'I' },
};

/**
 * Every formula the generator writes in those totals rows, the ones above and Долги K = IFERROR(F/E,0) (1166): a
 * constant typed over one is listed in `overrides`. «Постоянные»: G and the months (630, 634).
 */
const TOTAL_FORMULAS: Partial<Record<TableSheet, string[]>> = {
  Покупки: ['E', 'F', 'H', 'J', 'O'],
  Долги: ['E', 'F', 'G', 'I', 'K'],
};

/** Text the generator writes on a totals row in a column the import reads: «Постоянные» H (638), merged H:J. */
const TOTALS_LABELS = ['← в среднем в месяц'];

/**
 * The label the generator writes on a totals row, merged from B to `to` (compared ignoring letter case and runs of
 * spaces): «Постоянные» «Оплачено расходов» and «Получено доходов» over B:F (629); «Покупки» and «Долги» «ИТОГО» over
 * B:D (748, 1162). It tells a totals row whose formulas are all gone (see Reader.skipBareTotals).
 */
const TOTALS_ROW_LABELS: Partial<Record<TableSheet, { to: string; labels: string[] }>> = {
  Постоянные: { to: 'F', labels: ['Оплачено расходов', 'Получено доходов'] },
  Покупки: { to: 'D', labels: ['ИТОГО'] },
  Долги: { to: 'D', labels: ['ИТОГО'] },
};

/**
 * What the import knows of the totals rows under a table: `is` tells one; `reach`, for a row whose totals sum the
 * rows above it, the last row they sum (undefined for any other row); `name` is the column of a row's name, `read`
 * the columns of a row the import reads; `formulas` those where the generator writes a formula on a totals row.
 */
interface Totals {
  is: (row: number) => boolean;
  reach: (row: number) => number | undefined;
  name: string;
  read: string[];
  formulas: string[];
}

/** A range of one column, e.g. E7:E18 or $G$8:$G$37 (a sheet name before it is not looked at). */
const RANGE = /\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)/gi;

/**
 * How far `formula` runs over the table in column `col`: the last row of its ranges of that column that run from the
 * table's top row `top` or below (a row inserted at the top moves the range down) to a row above `row` (a row inserted
 * right above the totals is left out); undefined when it has none. The totals row copied higher up has none: its
 * relative range then starts above the table.
 */
function rangeReach(formula: string, col: string, top: number, row: number): number | undefined {
  let reach: number | undefined;
  for (const [, from, first, to, last] of formula.matchAll(RANGE)) {
    if (from?.toUpperCase() !== col || to?.toUpperCase() !== col) continue;
    if (Number(first) >= top && Number(first) <= Number(last) && Number(last) < row) reach = Math.max(reach ?? 0, Number(last));
  }
  return reach;
}

/** rangeReach of a formula that is all SUM over one range. */
function sumReach(formula: string, col: string, top: number, row: number): number | undefined {
  const range = /^SUM\(\s*([^,()]+?)\s*\)$/i.exec(formula)?.[1];
  return range === undefined ? undefined : rangeReach(range, col, top, row);
}

/**
 * The formula of a cell (a shared formula as the formula of its own cell); undefined for a value, an empty cell or a
 * cell merged into another.
 */
function formulaAt(ws: Worksheet, col: string, row: number): string | undefined {
  const c = ws.getCell(`${col}${row}`);
  if (c.isMerged && c.master.address !== c.address) return undefined;
  return isFormula(c.value) ? c.formula : undefined;
}

/**
 * Whether `row` is a totals row of «Покупки» or «Долги» (TOTAL_SUMS) under the table from `top`, and how far it sums
 * the table: the last row the totals in place sum (any one of them in place makes it a totals row); undefined for
 * any other row.
 */
function sumsReach(ws: Worksheet, sheet: TableSheet, top: number, row: number): number | undefined {
  let reach: number | undefined;
  for (const [col, of] of Object.entries(TOTAL_SUMS[sheet] ?? {})) {
    const formula = formulaAt(ws, col, row);
    const last = formula === undefined ? undefined : sumReach(formula, of, top, row);
    if (last !== undefined) reach = Math.max(reach ?? 0, last);
  }
  return reach;
}

/**
 * The totals rows of «Покупки» or «Долги» under the table from `top` (TOTAL_SUMS, TOTAL_FORMULAS); `read`: the
 * columns read, the name in C among them.
 */
function sumsTotals(ws: Worksheet, sheet: 'Покупки' | 'Долги', top: number, read: string[]): Totals {
  const reach = (row: number): number | undefined => sumsReach(ws, sheet, top, row);
  return { is: (row) => reach(row) !== undefined, reach, name: 'C', read, formulas: TOTAL_FORMULAS[sheet] ?? [] };
}

/**
 * How far the «в среднем в месяц» total of a «Постоянные» row sums the table from `top`: its «Сумма» (column
 * `amount`) holds SUMPRODUCT(…*$G$8:$G$37/…) over the amounts (628–631). The range is absolute, so a copy of the
 * row inside the table still ends below it and sums nothing above it. Undefined for any other row.
 */
function averageReach(ws: Worksheet, amount: string | undefined, top: number, row: number): number | undefined {
  const formula = amount === undefined ? undefined : formulaAt(ws, amount, row);
  return formula === undefined || amount === undefined || !/^SUMPRODUCT\(/i.test(formula) ? undefined : rangeReach(formula, amount, top, row);
}

/**
 * Whether `row` is one of the totals rows of «Постоянные» (R_BOT+1 and +2, 628–634) under the table from `top`: its
 * «Сумма» holds the «в среднем в месяц» total (averageReach) — or, where a value was typed over that, it has no name
 * and a month holds its total, SUMIFS over the expansion (634). Only rows below the last row an expansion refers to
 * are looked at for the end of the table (see Reader.bounds): a table row holds no such SUMIFS.
 */
function isRecurringTotals(ws: Worksheet, cols: { what: string; amount?: string }, months: string[], top: number, row: number): boolean {
  if (averageReach(ws, cols.amount, top, row) !== undefined) return true;
  return isBlank(cell(ws, cols.what, row)) && months.some((col) => /^SUMIFS\(/i.test(formulaAt(ws, col, row) ?? ''));
}

/** What the note on a row below the footer calls it: a note under the table, or its totals row. */
const FOOTER_NAME: Record<TableSheet, string> = {
  Запланированные: 'примечания под таблицей',
  Операции: 'примечания под таблицей',
  Постоянные: 'итоговой строки',
  Покупки: 'итоговой строки',
  Долги: 'итоговой строки',
};

/**
 * The formula every table row of a sheet has, for telling where the tracker's formulas end (a deleted row takes
 * its formulas with it and the ranges of the sums shrink). Запланированные feeds every total through its hidden helpers P…U
 * (P: the fact), Операции through P…R (Q: the amount), Покупки through Q…T (R: the plan). Долги has no helper that
 * any total reads: its only totals, ИТОГО (1162–1164), sum E, F, G and I over the whole table — the input columns
 * E, F and I, and G, the row's own MAX(E−F,0) — so Excel counts every row above it and there is no such note there.
 * Постоянные has no helper on its own rows: see recurringFormulas.
 */
const ROW_FORMULA = { Запланированные: 'P', Операции: 'Q', Покупки: 'R' } as const;

/**
 * What the note on a row without the tracker's own formulas says Excel does — a row below them (a deleted row took
 * them) or one the user inserted among the table's rows (Excel does not fill them in): no sum counts it, except the
 * sheet's own totals over the input columns of the whole table, whose ranges grow over a row inserted inside them.
 * Постоянные: G38/G39, the «в среднем в месяц» totals, SUMPRODUCT over D, G and H (630). Покупки: ИТОГО sums E, F, H
 * and J and O = SUM(S) (748–753); of those only E «Стоимость» and F «Уже отложено» are input — H, J and S are the
 * row's own formulas, which it does not have. No note on Долги (see ROW_FORMULA). «В суммах»: the row counters over
 * the input columns do count an inserted row, their ranges grow over it too (Операции «Строк без счёта», Счета
 * «Оплачено без счёта — строк» and «Переводов без «на счёт»», 281, 442–447); a row below the formulas has the same
 * wording.
 */
const BELOW_FORMULAS: Partial<Record<SheetName, string>> = {
  Запланированные: 'в суммах Excel не учитывается',
  Операции: 'в суммах Excel не учитывается',
  Постоянные: 'в суммах Excel не учитывается (кроме итога «в среднем в месяц»)',
  Покупки: 'в суммах Excel не учитывается (кроме сумм «Стоимость» и «Уже отложено» в строке «ИТОГО»)',
};

/**
 * What the tracker's formulas do with a row without a name, where the app counts it anyway. Every helper of the
 * expansions of «Постоянные» starts with IF($C="",0,…) or IF($C="","",…); only the display-only «в среднем в
 * месяц» totals (G38, G39: SUMPRODUCT over D, G and H) do not look at the name. The plan of «Покупки» is
 * R = IF(C="",0,N(E)), but its fact S = IF(N="✓",IF(O<>"",O,N(E)),0) does not look at the name.
 */
const EXCEL_SKIPS_RECURRING = 'в Excel такая строка не учитывается (кроме итога «в среднем в месяц»)';
const EXCEL_SKIPS_ROW = 'в Excel такая строка не учитывается';
const EXCEL_COUNTS_ONLY_FACT = 'в Excel у такой строки учитывается только факт, без плана';

const quoted = (s: string): string => `«${s}»`;

/**
 * A name on Настройки that rows refer to (an account, an expense category): as the app has it (trimmed) and as
 * Excel has it — the raw value, which the tracker's SUMIFS take as their criterion (through Счета B, Месяц B and
 * Статистика B, which repeat it).
 */
interface Named {
  name: string;
  raw: unknown;
}

/** Characters that Excel's SUMIFS, COUNTIFS and MATCH read as wildcards in a criterion. */
const WILDCARDS = /[*?~]/;

/** The month names of Настройки V6:V17, January first, among which Excel looks up C7 and C9. */
const MONTH_NAMES = Array.from({ length: 12 }, (_, k) => monthLabel(`2000-${String(k + 1).padStart(2, '0')}`).split(' ')[0] ?? '');

/**
 * Счета C34 as the generator writes it: =Настройки!$N$6, the name of the first account (also written without
 * the $ or with the sheet name in quotes).
 */
function isFirstAccountFormula(v: CellValue): boolean {
  const formula = typeof v === 'object' && v !== null && 'formula' in v ? v.formula : undefined;
  return typeof formula === 'string' && formula.replace(/[\s$']/g, '').replace(/^=/, '').toLowerCase() === 'настройки!n6';
}

const MS_PER_DAY = 86_400_000;
/** The Excel serial number of 1970-01-01. */
const EXCEL_1970 = 25_569;

/** Serial 1 as ExcelJS reads it from a date-formatted cell: 1899-12-31 (see EXCEL_EPOCH in excel.ts). */
const SERIAL_1_MS = (1 - EXCEL_1970) * MS_PER_DAY;

/**
 * A date of the tracker: `cellDate`, except that a Date before serial 1 is no date. ExcelJS makes a Date of any
 * number in a date-formatted cell, so 0, 0.5 or −1 there arrive as 1899-12-30 and earlier; in a General cell the
 * same numbers are no date either. (The backup reader keeps such Dates: it writes years before 1900 that way.)
 */
function trackerDate(v: unknown): ISODate | undefined {
  const u = unwrap(v);
  return u instanceof Date && u.getTime() < SERIAL_1_MS ? undefined : cellDate(v);
}

/** How much of a cell note is repeated in the import note. */
const NOTE_PREVIEW = 60;

/**
 * Excel for Mac stores a threaded comment as a note that starts with a notice about the version of Excel
 * and has the text after «Comment:» (Russian Excel: «Комментарий:»), each reply after its own marker.
 */
const THREADED_MARKERS = ['Comment:', 'Комментарий:'];

/**
 * The text of a cell note on one line, cut to NOTE_PREVIEW characters (with «…» when cut). Of a threaded
 * comment only the text after the last marker is taken, not the notice.
 */
function noteText(note: string | { texts?: { text?: string }[] }): string {
  const whole = typeof note === 'string' ? note : (note.texts ?? []).map((run) => run.text ?? '').join('');
  const afterMarker = Math.max(...THREADED_MARKERS.map((marker) => {
    const at = whole.lastIndexOf(marker);
    return at < 0 ? -1 : at + marker.length;
  }));
  const raw = afterMarker < 0 ? whole : whole.slice(afterMarker);
  const chars = Array.from(raw.replace(/\s+/g, ' ').trim());
  return chars.length > NOTE_PREVIEW ? `${chars.slice(0, NOTE_PREVIEW).join('')}…` : chars.join('');
}

/** Text as it was typed, on one line: a line break or a tab is shown as a space (the spaces are what a note is about). */
const asTyped = (raw: string): string => raw.replace(/\s/g, ' ');

/** True for a text value (a formula's text result, rich text and a hyperlink's text too). */
const isText = (v: unknown): boolean => typeof unwrap(v) === 'string';

function isBlank(v: unknown): boolean {
  const u = unwrap(v);
  return u === null || u === undefined || (typeof u === 'string' && u.trim() === '');
}

/** Empty as Excel's C="" sees it: no value or "" (spaces are text there, so not empty). */
function isEmpty(v: unknown): boolean {
  const u = unwrap(v);
  return u === null || u === undefined || u === '';
}

/** A value typed over a cell that holds a formula by default. */
const typedOver = (v: unknown): boolean => !isFormula(v) && !isBlank(v);

/** A value in a cell of a totals row where the generator writes nothing: anything but its own labels (TOTALS_LABELS). */
function isTyped(v: unknown): boolean {
  const u = unwrap(v);
  return !isBlank(v) && !(typeof u === 'string' && TOTALS_LABELS.includes(u.replace(/\s+/g, ' ').trim()));
}

/**
 * How a cell value is shown to the user in notes and overrides; an error value by its text, e.g. «#N/A».
 * A Date that is not a date of the tracker (ExcelJS makes a Date of any number in a date-formatted cell)
 * is shown as the serial number Excel stores, not as the browser's time-zone dependent text.
 */
function shown(v: unknown): string {
  const u = unwrap(v);
  if (typeof u === 'object' && u !== null && 'error' in u) return String(u.error);
  const iso = cellText(v) ?? trackerDate(v);
  if (iso !== undefined) return iso;
  return u instanceof Date && !Number.isNaN(u.getTime()) ? String(Number((u.getTime() / MS_PER_DAY + EXCEL_1970).toFixed(6))) : String(u);
}

/** Drops keys whose value is undefined, so rows look like ones made by hand. */
function compact<T extends object>(row: T): T {
  for (const key of Object.keys(row) as (keyof T)[]) if (row[key] === undefined) delete row[key];
  return row;
}

/**
 * The value of a cell. A cell merged into another one is empty, as it is in Excel (ExcelJS gives it the value of
 * the merge): a name merged over «Кому / банк» is not the name a second time.
 */
function cell(ws: Worksheet, col: string, row: number): CellValue {
  const c = ws.getCell(`${col}${row}`);
  return c.isMerged && c.master.address !== c.address ? null : c.value;
}

/**
 * Whether the row has its cell in `col` (the helper of ROW_FORMULA): its formula, or a value typed over it — that one
 * Excel sums as it is, and it is listed in `overrides` (FORMULA_AREAS).
 */
function hasHelper(ws: Worksheet, col: string, row: number): boolean {
  const v = cell(ws, col, row);
  return isFormula(v) || !isBlank(v);
}

/** The last row from `from` to `to` that has its helper in `col` (hasHelper); undefined when none does. */
function lastHelperRow(ws: Worksheet, col: string, from: number, to: number): number | undefined {
  for (let row = to; row >= from; row--) if (hasHelper(ws, col, row)) return row;
  return undefined;
}

/**
 * Where the tracker's own formulas of a table's rows are: `last`, the last row that has them (undefined when the
 * sheet has none — then nothing can be told), and whether a row has its own (`own`).
 */
interface RowFormulas {
  last: number | undefined;
  own: (row: number) => boolean;
}

/** The rows of a table whose own formula is the helper in `col` (ROW_FORMULA). */
function helperFormulas(ws: Worksheet, col: string, top: number): RowFormulas {
  return { last: lastHelperRow(ws, col, top, ws.rowCount), own: (row) => hasHelper(ws, col, row) };
}

/**
 * The input rows of «Постоянные» from `from` on that the sheet's formulas refer to. Excel counts a row only through
 * the expansions, whose formulas refer to it as $C{row} (the k-th accounting month of row s is on row s + 30k,
 * columns Y…AE; the forecast months, AG…AJ), so a row no formula refers to is not counted: one below the last row
 * referred to (a deleted row took its expansions), or one the user inserted among them (Excel adds no expansion
 * for it). A shared formula is read as the formula of its own cell.
 */
function recurringFormulas(ws: Worksheet, from: number): RowFormulas {
  const rows = new Set<number>();
  ws.eachRow((r) => r.eachCell((c) => {
    if (!isFormula(c.value)) return;
    for (const [, n] of (c.formula ?? '').matchAll(/(?<![!\w$])\$C(\d+)/g)) if (Number(n) >= from) rows.add(Number(n));
  }));
  return { last: rows.size === 0 ? undefined : Math.max(...rows), own: (row) => rows.has(row) };
}

/** Whether `row` holds the generator's note under the table of `sheet` (FOOTER_NOTES). */
function isNoteRow(ws: Worksheet, sheet: TableSheet, row: number): boolean {
  const note = FOOTER_NOTES[sheet];
  if (note === undefined) return false;
  const master = ws.getCell(`${note.from}${row}`);
  if (!master.isMerged || master.master.address !== master.address) return false;
  if (ws.getCell(`${note.to}${row}`).master.address !== master.address) return false;
  const text = unwrap(master.value);
  return typeof text === 'string' && text.replace(/\s+/g, ' ').trim().toLowerCase().startsWith(note.label.toLowerCase());
}

/**
 * Whether `row` has the label of a totals row of `sheet` (TOTALS_ROW_LABELS) as the generator writes it: in B, merged
 * over exactly B to its `to` column.
 */
function hasTotalsLabel(ws: Worksheet, sheet: TableSheet, row: number): boolean {
  const label = TOTALS_ROW_LABELS[sheet];
  if (label === undefined) return false;
  const master = ws.getCell(`B${row}`);
  if (!master.isMerged || master.master.address !== master.address) return false;
  const last = ws.getColumn(label.to).number;
  const cells = ws.getRow(row);
  if (cells.getCell(last).master.address !== master.address || cells.getCell(last + 1).master.address === master.address) return false;
  const text = unwrap(master.value);
  if (typeof text !== 'string') return false;
  const typed = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return label.labels.some((l) => l.toLowerCase() === typed);
}

/** «E «100», F «10»»: the values of the cells `cols` of a row, for a note. */
const listed = (ws: Worksheet, cols: string[], row: number): string => cols.map((col) => `${col} ${quoted(shown(cell(ws, col, row)))}`).join(', ');

/**
 * Whether `row` is one of the rows the generator writes under the table of `sheet`: its note (FOOTER_NOTES) or a
 * totals row (`totals`).
 */
const isGeneratorRow = (ws: Worksheet, sheet: TableSheet, row: number, totals: Totals | undefined): boolean =>
  isNoteRow(ws, sheet, row) || (totals?.is(row) ?? false);

/**
 * The rows of a table (see Reader.bounds): the last one, `end`; the generator's row under it that ends it, `footer`
 * (undefined when there is none); and whether a totals row further down sums over a row, `summedBelow`.
 */
interface Table {
  end: number;
  footer: number | undefined;
  summedBelow: (row: number) => boolean;
}

/** Parsers for cells holding a label, a ✓ or (the marks of «Постоянные») a ✓ or a number. */
const accountType = (v: CellValue) => parseAccountType(cellText(v));
const status = (v: CellValue) => parseStatus(cellText(v));
const checked = (v: CellValue): true | undefined => (cellText(v) === CHECK ? true : undefined);
const mark = (v: CellValue): Mark | undefined => (cellText(v) === CHECK ? CHECK : cellNumber(v));
/** Счета C33 «Гасится автоматически»: «Да» or «Нет». */
const yesNo = (v: CellValue): boolean | undefined => {
  const answer = cellText(v)?.toLowerCase();
  return answer === 'да' ? true : answer === 'нет' ? false : undefined;
};

/** exceljs and jszip; a chunk that fails to download is a connection problem, not a bad file. */
async function libraries(): Promise<[typeof import('exceljs'), JSZip]> {
  try {
    const [exceljs, jszip] = await Promise.all([import('exceljs'), import('jszip')]);
    return [exceljs.default, jszip.default];
  } catch {
    throw new TrackerImportError('Не удалось загрузить модуль, проверьте подключение.');
  }
}

async function openWorkbook(buf: ArrayBuffer): Promise<Workbook> {
  const [ExcelJS, Zip] = await libraries();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await stripDrawings(buf, Zip));
  } catch {
    throw new TrackerImportError('Не удалось прочитать файл: это не книга Excel (.xlsx) или файл повреждён.');
  }
  return workbook;
}

function trackerSheets(workbook: Workbook): Sheets {
  const current = workbook.getWorksheet(PLANNED);
  const before = workbook.getWorksheet(PLANNED_BEFORE_RENAME);
  const found = (name: SheetName): Worksheet | undefined => (name === PLANNED ? current ?? before : workbook.getWorksheet(name));
  const missing = SHEETS.filter((name) => !found(name));
  if (missing.length > 0) {
    throw new TrackerImportError(
      `Это не «Трекер и планер расходов» или его старая версия: не найдены листы ${missing.map(quoted).join(', ')}.`,
    );
  }
  if (current && before) {
    throw new TrackerImportError(
      `В файле есть и лист ${quoted(PLANNED)}, и лист ${quoted(PLANNED_BEFORE_RENAME)} — в трекере должен остаться один.`,
    );
  }
  return Object.fromEntries(SHEETS.map((name) => [name, found(name)])) as Sheets;
}

/**
 * Reads the tracker's sheets. Every number, date, label and mark goes through a parser; a value
 * that is there but does not parse is noted and left out, never dropped silently (free text such
 * as «Категория» is taken as it is; free text or a name such as «Что» that is not text is taken as
 * it is shown, with a note). A number typed as text is used and noted (Excel does not count it); a
 * whole number outside its range is noted and not used. A cell gets one note at most: text is read as
 * the number it means and then judged like a number. A row with input in any column the import reads
 * is a row; without a name it is loaded with an empty name and a note (which says so when Excel does
 * not count such a row). Labels and ✓ are matched after trimming and ignoring case; what a note says
 * about Excel is decided on the raw value, as its formulas see it (ignoring case, not spaces; SUMIFS,
 * COUNTIFS and MATCH also read * ? ~ as wildcards): a ✓ or a label those formulas look for, with spaces
 * around it, is loaded and noted. Accounts and expense categories named in rows are matched the same
 * way, and noted where Excel's criterion — the raw name — does not match; a name with a wildcard is
 * noted once. Notes are kept per sheet and come out in the order of the tracker's tabs.
 */
class Reader {
  private readonly accounts: Account[] = [];
  /** The account named on Настройки N6 (the first row), what the generator's Счета C34 points at. */
  private firstRowAccount: Account | undefined;
  private byName = new Map<string, Account & Named>();
  /** Expense categories by name as it is and in lower case (a name as it is wins over another one in another case). */
  private expenseByName = new Map<string, Named>();
  private readonly bySheet = new Map<SheetName, string[]>();
  /** The last row of each table read (see bounds), for the formula cells typed over in it (readOverrides). */
  readonly tableEnds: Partial<Record<TableSheet, number>> = {};
  /** The generator's formula cells of each totals row found (see afterTable), for a value typed over them. */
  readonly totalsCells: { sheet: TableSheet; row: number; cols: string[] }[] = [];

  constructor(private readonly s: Sheets) {}

  /** Notes in tab order, and in reading order within a sheet. */
  get notes(): string[] {
    return SHEETS.flatMap((name) => this.bySheet.get(name) ?? []);
  }

  /** The name the file gives the sheet: «Запланированные» may be «Журнал» in it. */
  private name(sheet: SheetName): string {
    return this.s[sheet].name;
  }

  /** «Лист «X», строка N, столбец Y» — what a note is about. */
  private where(sheet: SheetName, col: string, row: number): string {
    return `Лист ${quoted(this.name(sheet))}, строка ${row}, столбец ${col}`;
  }

  private note(sheet: SheetName, message: string): void {
    const notes = this.bySheet.get(sheet) ?? [];
    notes.push(message);
    this.bySheet.set(sheet, notes);
  }

  /** A cell through `parse`; a non-blank value that does not parse gets a note and is left out. */
  private parsed<T>(sheet: SheetName, col: string, row: number, parse: (v: CellValue) => T | undefined): T | undefined {
    const v = cell(this.s[sheet], col, row);
    const value = parse(v);
    if (value === undefined && !isBlank(v)) {
      this.note(sheet, `${this.where(sheet, col, row)}: ${quoted(shown(v))} не распознано — не загружено`);
    }
    return value;
  }

  /** `parsed`, and a number read from a text cell is noted too. */
  private read<T>(sheet: SheetName, col: string, row: number, parse: (v: CellValue) => T | undefined): T | undefined {
    const value = this.parsed(sheet, col, row, parse);
    this.numberFromText(sheet, col, row, cell(this.s[sheet], col, row), value);
    return value;
  }

  /** A number read from a text cell is still used, but Excel does not count text, so the user is told. */
  private numberFromText(sheet: SheetName, col: string, row: number, v: CellValue, value: unknown): void {
    if (typeof value === 'number' && isText(v)) {
      this.note(sheet, `${this.where(sheet, col, row)}: ${quoted(shown(v))} — в Excel это текст и не учитывается; загружено как число`);
    }
  }

  /**
   * `read` for a cell that holds a ✓ (Покупки «Куплено», a month mark of «Постоянные»). The app reads the ✓ after
   * trimming; Excel's ="✓" does not trim, so a ✓ with spaces around it is no mark there, and the cell gets one note.
   */
  private readTick<T>(sheet: SheetName, col: string, row: number, parse: (v: CellValue) => T | undefined): T | undefined {
    const value = this.read(sheet, col, row, parse);
    const raw = unwrap(cell(this.s[sheet], col, row));
    if (typeof raw === 'string' && raw !== CHECK && raw.trim() === CHECK) {
      this.note(sheet, `${this.where(sheet, col, row)}: ${quoted(asTyped(raw))} — в Excel с пробелами это не отметка; загружено как ${CHECK}`);
    }
    return value;
  }

  /**
   * A label (a type, a status, «Да», a month) that the app matched after trimming and ignoring case. Excel's
   * formulas compare the raw text (=, SUMIFS, COUNTIFS, MATCH: ignoring case, not spaces), so a label with spaces
   * is not that label there: the cell gets one note. Callers pass only labels the tracker's formulas look for in
   * that column; another one with spaces (e.g. «Нет» of C33) is treated by Excel as it is here.
   */
  private excelLabel(sheet: SheetName, col: string, row: number, label: string): void {
    const raw = unwrap(cell(this.s[sheet], col, row));
    if (typeof raw === 'string' && raw.toLowerCase() !== label.toLowerCase()) {
      this.note(sheet, `${this.where(sheet, col, row)}: ${quoted(asTyped(raw))} — в Excel с пробелами не распознаётся; загружено как ${quoted(label)}`);
    }
  }

  /**
   * «Тип» of Запланированные and Постоянные: «Доход» is income, anything else an expense, as in Excel, whose formulas only
   * look for «Доход» there ($D="Доход", SUMIFS "Доход" and "<>Доход").
   */
  private incomeOrExpense(sheet: SheetName, col: string | undefined, row: number): 'income' | 'expense' {
    if (col === undefined) return 'expense';
    const v = cell(this.s[sheet], col, row);
    if (parseKind(cellText(v)) === 'income') {
      this.excelLabel(sheet, col, row, KIND_LABEL.income);
      return 'income';
    }
    // A value that is not text (TRUE, a number, a date) is not «Доход» for Excel either, so it is an expense there
    // too; it is noted all the same, since it is not a type (text other than «Доход» is an expense without a note).
    if (!isBlank(v) && !isText(v)) {
      this.note(sheet, `${this.where(sheet, col, row)}: ${quoted(shown(v))} — не текст; загружено как ${quoted(KIND_LABEL.expense)}`);
    }
    return 'expense';
  }

  private num(sheet: SheetName, col: string, row: number): number | undefined {
    return this.read(sheet, col, row, cellNumber);
  }

  /**
   * A number that has to be a whole number from `min` to `max` (`noun` names what it is, for the note
   * about a text). Numeric text is taken as the number it means and then judged like a number typed as
   * a number; a cell gets one note, which says what was in it and what was done. One that does not fit is
   * left out and `instead` says what is used in its place.
   */
  private whole(sheet: SheetName, col: string, row: number, min: number, max: number, noun: string, instead: string): number | undefined {
    const n = this.parsed(sheet, col, row, cellNumber);
    if (n === undefined) return undefined;
    const v = cell(this.s[sheet], col, row);
    if (Number.isInteger(n) && n >= min && n <= max) {
      this.numberFromText(sheet, col, row, v, n);
      return n;
    }
    const typed = quoted(shown(v));
    const problem = isText(v) ? `${typed} — текст и не ${noun} ${min}–${max}` : `${typed} не подходит (нужно целое число от ${min} до ${max})`;
    this.note(sheet, `${this.where(sheet, col, row)}: ${problem} — ${instead}`);
    return undefined;
  }

  private date(sheet: SheetName, col: string, row: number): string | undefined {
    return this.read(sheet, col, row, trackerDate);
  }

  /**
   * The account named in a cell, matched by name ignoring case and surrounding spaces. A value that is not text
   * is matched by how it is shown, with a note; a name that matches no account is noted and left out.
   */
  private accountAt(sheet: SheetName, col: string, row: number, excel: 'SUMIFS' | '=' = 'SUMIFS', at = `строка ${row}`): string | undefined {
    const v = cell(this.s[sheet], col, row);
    if (isBlank(v)) return undefined;
    const name = shown(v); // text is trimmed
    const account = this.byName.get(name.toLowerCase());
    if (!account) {
      this.note(sheet, `Счёт ${quoted(name)} не найден (${this.name(sheet)}, ${at})`);
      return undefined;
    }
    if (!isText(v)) this.note(sheet, `${this.where(sheet, col, row)}: ${quoted(name)} — не текст; загружено как счёт ${quoted(account.name)}`);
    else this.excelReference(sheet, col, row, account, 'со счётом', excel);
    return account.id;
  }

  /**
   * «Категория» of a row. On an expense row (the only rows whose category the app and the tracker's SUMIFS match)
   * a text that names an expense category after trimming and ignoring case is loaded as that category, as Excel
   * counts it there ignoring case, and it is noted where Excel does not match it (spaces around it). Elsewhere it
   * is free text.
   */
  private category(sheet: SheetName, col: string, row: number, expense: boolean): string | undefined {
    const typed = this.freeText(sheet, col, row);
    const category = typed === undefined || !expense
      ? undefined
      : (this.expenseByName.get(typed) ?? this.expenseByName.get(typed.toLowerCase()));
    if (!category) return typed;
    if (isText(cell(this.s[sheet], col, row))) this.excelReference(sheet, col, row, category, 'с категорией', 'SUMIFS');
    return category.name;
  }

  /**
   * A reference that the app matched to `target` after trimming and ignoring case. Excel compares the raw texts,
   * ignoring case but not spaces, and (SUMIFS) with the wildcards of the name: where that does not match, the
   * two differ by the spaces around them and the cell gets one note. The same raw text is always a match here;
   * what wildcards in the name do to it is said once, on the name.
   */
  private excelReference(sheet: SheetName, col: string, row: number, target: Named, what: string, excel: 'SUMIFS' | '='): void {
    const raw = unwrap(cell(this.s[sheet], col, row));
    const name = target.raw;
    if (typeof raw !== 'string' || typeof name !== 'string' || raw.toLowerCase() === name.toLowerCase()) return;
    if (excel === 'SUMIFS' && criterionMatches(name, raw)) return;
    this.note(sheet, `${this.where(sheet, col, row)}: ${quoted(asTyped(raw))} — в Excel с пробелами не совпадает ${what} ${quoted(asTyped(name))}; загружено как ${quoted(target.name)}`);
  }

  /** One note on a name that the tracker's SUMIFS take as a criterion, when it holds a wildcard. */
  private wildcardName(col: string, row: number, owner: string, own: string): void {
    const raw = unwrap(cell(this.s['Настройки'], col, row));
    if (typeof raw !== 'string' || !WILDCARDS.test(raw)) return;
    this.note('Настройки', `${this.where('Настройки', col, row)}: ${quoted(asTyped(raw))} — в Excel *, ? и ~ в названии — знаки шаблона: `
      + `в итоги ${owner} могут попасть чужие строки или не попасть ${own} собственные; в приложении — только ${own} строки`);
  }

  /**
   * A free-text cell (a category, «Кому / банк», a priority, a name on Настройки): text as it is, trimmed; a value
   * that is not text (TRUE, an error, a date, a number) as it is shown, with a note, so it does not vanish.
   */
  private freeText(sheet: SheetName, col: string, row: number): string | undefined {
    const v = cell(this.s[sheet], col, row);
    if (isBlank(v)) return undefined;
    const value = shown(v); // text is trimmed
    if (!isText(v)) this.note(sheet, `${this.where(sheet, col, row)}: ${quoted(value)} — не текст; загружено как текст`);
    return value;
  }

  /** The date of a row, or a note that the row is skipped. */
  private rowDate(sheet: SheetName, row: number): string | undefined {
    const v = cell(this.s[sheet], 'C', row);
    const date = trackerDate(v);
    if (!date) this.skip(sheet, row, isBlank(v) ? 'нет даты' : `дата ${quoted(shown(v))} не распознана`);
    return date;
  }

  /**
   * The name of a row that is loaded («Что», «Название», in `col`). A value that is not text (a number, TRUE,
   * an error, a date) is loaded as it is shown, with a note. A row without a name is loaded with '' and a note,
   * never dropped silently; `excel` says what the tracker's formulas do with such a row when they do not count it
   * as the app does (they do on Запланированные, Операции and Долги). Those formulas test C="", which is false for a name
   * of spaces: Excel counts that row, so its note does not say otherwise.
   */
  private title(sheet: SheetName, col: string, row: number, header: string, excel?: string): string {
    const v = cell(this.s[sheet], col, row);
    if (isBlank(v)) {
      const skipped = excel !== undefined && isEmpty(v);
      const done = skipped ? `${excel}; загружено без названия и учитывается` : 'загружено без названия';
      this.note(sheet, `Лист ${quoted(this.name(sheet))}, строка ${row}: нет ${quoted(header)} — ${done}`);
      return '';
    }
    return this.freeText(sheet, col, row) ?? '';
  }

  /**
   * The rows of the table of `sheet`, from `top` down to the row above its footer: the first of the generator's rows
   * under it (isGeneratorRow) — below `last`, the last row with the sheet's helper, where there is one — that no
   * totals row further down sums over (`summedBelow`), which ends it wherever rows the user inserted or deleted have
   * moved it; without one, down to the sheet's last row (so to its last row with input). Never a fixed row: inserted
   * rows push the table's own rows down past it.
   *
   * A totals row further down whose range ends at or below a row means Excel counts the rows in between, so that row
   * does not end the table: a subtotal the user made inside it, say. So nothing below the footer is summed by any
   * totals row, and «в Excel не учитывается» holds for what is there. (The second totals row of «Постоянные» sums the
   * table above the first one, not over it: the first one is the end.)
   */
  private bounds(sheet: TableSheet, top: number, last: number | undefined, totals?: Totals): Table {
    const ws = this.s[sheet];
    const sums: { row: number; reach: number }[] = [];
    ws.eachRow((_, row) => { // only the rows that hold a value, in order
      const reach = row < top ? undefined : totals?.reach(row);
      if (reach !== undefined) sums.push({ row, reach });
    });
    const summedBelow = (row: number): boolean => sums.some((sum) => sum.row > row && sum.reach >= row);
    let footer: number | undefined;
    for (let row = Math.max(top, (last ?? 0) + 1); row <= ws.rowCount && footer === undefined; row++) {
      if (isGeneratorRow(ws, sheet, row, totals) && !summedBelow(row)) footer = row;
    }
    const end = footer === undefined ? ws.rowCount : footer - 1;
    this.tableEnds[sheet] = end;
    return { end, footer, summedBelow };
  }

  /**
   * Whether a row of a table is skipped as a totals row inside it: its totals sum the rows above it (Totals.reach), and
   * a totals row further down sums over it (Table.summedBelow) — Excel counts the rows below it, so it is not the end.
   * It is not data either (a subtotal the user made): one note, whatever else it holds, its name too.
   */
  private skipInnerTotals(sheet: TableSheet, row: number, table: Table, totals: Totals): boolean {
    if (totals.reach(row) === undefined || !table.summedBelow(row)) return false;
    this.note(sheet, `Лист ${quoted(this.name(sheet))}, строка ${row}: строка с суммой строк выше — не загружена`);
    return true;
  }

  /**
   * Whether a row is skipped as a totals row with none of the generator's formulas left (every total typed over or
   * cleared — «Вставить значения» over the row): the generator's label (hasTotalsLabel), no name, no formula in any
   * cell where the generator writes one (Totals.formulas), and no totals row further down sums over it (`table`;
   * below the end of the table none does). Nothing in Excel counts it then, and it is not data: the income total of
   * «Постоянные» would come in as an expense. It does not end the table, since it sums nothing. One note lists what
   * it holds (not the generator's own labels); with nothing typed there, there is nothing to tell.
   */
  private skipBareTotals(sheet: TableSheet, row: number, totals: Totals, table?: Table): boolean {
    const ws = this.s[sheet];
    const bare = hasTotalsLabel(ws, sheet, row) && isBlank(cell(ws, totals.name, row))
      && !totals.formulas.some((col) => isFormula(cell(ws, col, row))) && !(table?.summedBelow(row) ?? false);
    if (!bare) return false;
    const typed = totals.read.filter((col) => isTyped(cell(ws, col, row)));
    if (typed.length > 0) this.note(sheet, `Лист ${quoted(this.name(sheet))}, строка ${row}: итоговая строка без формул — не загружена: ${listed(ws, typed, row)}`);
    return true;
  }

  /**
   * Whether a row is skipped as a row without a name whose cells the import reads (`cols`, the name `nameCol` among
   * them) hold nothing but formulas: it is not loaded, with one note, since it may be a totals row whose formulas
   * are not the generator's. Only on the sheets with a totals row (Постоянные, Покупки, Долги); a row of Запланированные or
   * Операции needs a date anyway, and without a name it is loaded as Excel counts it.
   */
  private skipFormulasOnly(sheet: TableSheet, row: number, cols: string[], nameCol: string): boolean {
    const ws = this.s[sheet];
    const only = isBlank(cell(ws, nameCol, row)) && cols.every((col) => {
      const v = cell(ws, col, row);
      return v === null || v === undefined || v === '' || isFormula(v);
    });
    if (only) this.note(sheet, `Лист ${quoted(this.name(sheet))}, строка ${row}: строка из формул без названия — не загружена`);
    return only;
  }

  /**
   * The columns of a row that hold input, in the order given: a value in one of `cols`, or a value typed over the
   * formula of one of `typed` (Запланированные M). A row is a row when it has any.
   */
  private withInput(sheet: TableSheet, row: number, cols: string[], typed: string[] = []): string[] {
    const ws = this.s[sheet];
    return [...cols.filter((col) => !isBlank(cell(ws, col, row))), ...typed.filter((col) => typedOver(cell(ws, col, row)))];
  }

  /**
   * The rows from the footer of a table on (`footer`; nothing when there is none). A row with input below it: the
   * ranges of all the tracker's formulas end above the footer, so nothing in Excel counts such a row, and it is not
   * loaded either — but never silently: one note lists what it holds. The generator's own rows there (isGeneratorRow)
   * are not input; on a totals row (the footer or one after it) a value typed over the generator's formula is listed
   * in overrides (readOverrides), and one typed anywhere else — nothing reads it either — gets one note. A totals row
   * with every one of its formulas typed over gets the note of skipBareTotals, as it does inside the table.
   */
  private afterTable(sheet: TableSheet, footer: number | undefined, input: (row: number) => string[], totals?: Totals): void {
    if (footer === undefined) return;
    const ws = this.s[sheet];
    ws.eachRow((_, row) => { // only the rows that hold a value, in order
      if (row < footer) return;
      if (totals?.is(row)) {
        this.totalsCells.push({ sheet, row, cols: totals.formulas });
        const typed = totals.read.filter((col) => !totals.formulas.includes(col) && isTyped(cell(ws, col, row)));
        if (typed.length === 0) return;
        const what = typed.length === 1 ? 'значение в итоговой строке — не загружено' : 'значения в итоговой строке — не загружены';
        this.note(sheet, `Лист ${quoted(this.name(sheet))}, строка ${row}: ${what}: ${listed(ws, typed, row)}`);
        return;
      }
      if (row === footer || isNoteRow(ws, sheet, row) || (totals !== undefined && this.skipBareTotals(sheet, row, totals))) return;
      const cols = input(row);
      if (cols.length > 0) {
        this.note(sheet, `Лист ${quoted(this.name(sheet))}, строка ${row}: ниже ${FOOTER_NAME[sheet]} — в Excel не учитывается; не загружено: ${listed(ws, cols, row)}`);
      }
    });
  }

  /**
   * The note on a loaded row without the tracker's own formulas (`formulas`), first among the notes of its row: below
   * the last row that has them, or among the rows that have them without its own (a row the user inserted). Whether
   * there was one — it has said what Excel does with the row.
   */
  private withoutFormulas(sheet: SheetName, row: number, formulas: RowFormulas): boolean {
    const excel = BELOW_FORMULAS[sheet];
    const { last, own } = formulas;
    if (excel === undefined || last === undefined || (row <= last && own(row))) return false;
    const where = row > last ? 'ниже формул трекера' : 'у строки нет формул трекера';
    this.note(sheet, `Лист ${quoted(this.name(sheet))}, строка ${row}: ${where} — ${excel}; загружено`);
    return true;
  }

  private skip(sheet: SheetName, row: number, reason: string): void {
    this.note(sheet, `${this.name(sheet)}, строка ${row}: ${reason} — строка не загружена`);
  }

  /**
   * A month of «Настройки»: the year in C{row} (a whole four-digit number, or the file is refused), the month name
   * below it. Excel takes the month as IFERROR(MATCH(C7,V6:V17,0),1): the first month name the text matches,
   * ignoring case but not spaces and with its wildcards, and January when none does. The app takes a month name
   * after trimming (one with spaces is noted); anything else is taken as Excel takes it, with a note.
   *
   * The year is used only through DATE(C6,…) and DATE(C8,…) (FC_Y and AC_Y, tracker_const.py 9–10), and DATE takes
   * digits typed as text for the number they spell: such a year is the same in Excel, with no note. Other text the
   * app reads as a whole year (a decimal mark, spaces) is loaded as that number, and its note says only that.
   */
  private month(row: number, what: string): YM {
    const ws = this.s['Настройки'];
    const yearValue = cell(ws, 'C', row);
    const year = cellNumber(yearValue);
    if (year === undefined || !Number.isInteger(year) || year < 1000 || year > 9999) {
      throw new TrackerImportError(`На листе «Настройки» не задан ${what}: год в C${row}, месяц в C${row + 1}.`);
    }
    const typedYear = unwrap(yearValue);
    if (typeof typedYear === 'string' && !/^\d+$/.test(typedYear)) {
      this.note('Настройки', `${this.where('Настройки', 'C', row)}: ${quoted(shown(yearValue))} — текст; загружено как число`);
    }
    const monthValue = cell(ws, 'C', row + 1);
    const name = cellText(monthValue);
    const ym = name === undefined ? null : parseMonthLabel(`${name} ${year}`);
    if (ym) {
      this.excelLabel('Настройки', 'C', row + 1, monthLabel(ym).split(' ')[0] ?? ''); // with spaces MATCH finds none
      return ym;
    }
    const raw = unwrap(monthValue);
    const found = typeof raw === 'string' ? MONTH_NAMES.findIndex((month) => criterionMatches(raw, month)) : -1;
    const month = found < 0 ? 0 : found;
    const taken = `взят ${(MONTH_NAMES[month] ?? '').toLowerCase()}, как в Excel`;
    const typed = quoted(typeof raw === 'string' ? asTyped(raw) : shown(monthValue));
    const problem = found < 0 ? 'месяц не распознан' : 'шаблон, а не название месяца';
    this.note('Настройки', `${this.where('Настройки', 'C', row + 1)}: ${isBlank(monthValue) ? `месяц не указан — ${taken}` : `${typed} — ${problem}; ${taken}`}`);
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }

  /**
   * Cell notes (comments) of the sheets read: the model has no place for them, so each one is only
   * reported, with the start of its text. Called last, so a sheet's notes follow its value notes.
   * ExcelJS only sees a comment on a cell that has a value or a style (the tracker's input areas are
   * styled, so a note on a cell the import reads is caught).
   */
  cellNotes(): void {
    for (const name of SHEETS) {
      this.s[name].eachRow({ includeEmpty: true }, (row) => {
        row.eachCell({ includeEmpty: true }, (c) => {
          if (!c.note) return;
          const text = noteText(c.note);
          this.note(name, `Лист ${quoted(this.name(name))}, ячейка ${c.address}: есть примечание${text ? ` ${quoted(text)}` : ''} — в приложение не переносится`);
        });
      });
    }
  }

  settings(): Settings {
    const forecastStart = this.month(6, 'месяц начала прогноза');
    const accountingStart = this.month(8, 'месяц начала учёта');
    const cushion = this.num('Настройки', 'C', 11) ?? 0;
    // Счета C4 is a formula by default (the first day of the accounting year); a typed date replaces it.
    const typedDate = isFormula(this.s['Счета'].getCell('C4').value) ? undefined : this.date('Счета', 'C', 4);
    return { accountingStart, forecastStart, cushion, balancesDate: typedDate ?? monthStart(accountingStart) };
  }

  /** Expense categories with their limits on «Месяц» (row 12+i belongs to Настройки J6+i), income categories. */
  categories(): Data['categories'] {
    const expense: ExpenseCategory[] = [];
    for (let i = 0; i < 30; i++) {
      const name = this.freeText('Настройки', 'J', 6 + i);
      if (!name) continue;
      // Месяц and Статистика match rows by this name: SUMIFS(…, J_CAT, $B, …), where B repeats it.
      this.wildcardName('J', 6 + i, 'категории', 'её');
      expense.push(compact({ name, limit: this.num('Месяц', 'C', 12 + i) }));
      const named = { name, raw: unwrap(cell(this.s['Настройки'], 'J', 6 + i)) };
      this.expenseByName.set(name, named);
      this.expenseByName.set(name.toLowerCase(), this.expenseByName.get(name.toLowerCase()) ?? named);
    }
    const income: { name: string }[] = [];
    for (let row = 6; row <= 17; row++) {
      const name = this.freeText('Настройки', 'L', row);
      if (name) income.push({ name });
    }
    return { expense, income };
  }

  /** Accounts: names on Настройки N6:N17, type and start on the same row of «Счета» (10…21). */
  readAccounts(): Account[] {
    for (let i = 0; i < 12; i++) {
      const name = this.freeText('Настройки', 'N', 6 + i);
      if (!name) continue;
      // Счета E:G and the credit card block sum rows by this name: SUMIFS(…, O_ACC, $B, …), where B repeats it.
      this.wildcardName('N', 6 + i, 'счёта', 'его');
      const account: Account = { id: newId(), name, type: this.typeOfAccount(10 + i), start: this.num('Счета', 'D', 10 + i) ?? 0 };
      if (i === 0) this.firstRowAccount = account;
      this.accounts.push(account);
      this.byName.set(name.toLowerCase(), { ...account, raw: unwrap(cell(this.s['Настройки'], 'N', 6 + i)) });
    }
    return this.accounts;
  }

  /**
   * Счета C{row}: the tracker's formulas look for every type — SUMIFS "Дебетовая" («На картах»), "Наличные" and
   * "Сберегательная" («Всего» without them, «Сбережения», the ИТОГО rows); COUNTIFS "Сберегательная" (the flag «в
   * балансе» of every row's account) and "Кредитная", MATCH "Кредитная". An unknown or empty type is a debit account.
   */
  private typeOfAccount(row: number): Account['type'] {
    const type = this.read('Счета', 'C', row, accountType);
    if (type === undefined) return 'debit';
    this.excelLabel('Счета', 'C', row, ACCOUNT_TYPE_LABEL[type]);
    return type;
  }

  /** Счета C33 «Гасится автоматически»: Excel's IF(C33="Да", …) looks only for «Да»; anything else, empty too, is off. */
  private autoPay(): boolean {
    const auto = this.read('Счета', 'C', 33, yesNo) ?? false;
    if (auto) this.excelLabel('Счета', 'C', 33, 'Да');
    return auto;
  }

  credit(): CreditSettings {
    const payFrom = this.s['Счета'].getCell('C34').value;
    const auto = this.autoPay();
    // Счета G compares it with each account: IF($B=$C$34, …), an = without wildcards.
    const fromAccountId = isFormula(payFrom) ? undefined : this.accountAt('Счета', 'C', 34, '=', 'C34');
    if (auto && isFirstAccountFormula(payFrom)) this.cardPaysItself();
    return compact({
      auto,
      fromAccountId,
      closeDay: this.creditDay(35, 'закрытия выписки'),
      payDay: this.creditDay(36, 'списания долга'),
    });
  }

  /**
   * C34 is the generator's =Настройки!$N$6. When that first account is the credit card, Excel pays the card from
   * itself (Счета G adds the payment to the card, $B=$C$32, and takes it from $C$34: nothing changes), while the
   * app, with no pay-from account chosen, pays from the first account that is not a credit card (payFromId).
   * One note naming both, only when there is such an account.
   */
  private cardPaysItself(): void {
    const first = this.firstRowAccount;
    if (first?.type !== 'credit') return;
    const app = this.accounts.find((a) => a.type !== 'credit');
    if (!app) return; // no auto-payment in the app, none that changes anything in Excel
    this.note('Счета', `${this.where('Счета', 'C', 34)}: в Excel списание идёт со счёта ${quoted(first.name)}, в приложении — со счёта `
      + `${quoted(app.name)}; проверьте «Со счёта» в «Счета и кредитка»`);
  }

  /**
   * Счета C35/C36: Excel takes MAX(1, MIN(28, N(cell))), so a missing or unreadable day is the 1st and
   * a day above 28 is the 28th; DATE then drops a fraction. The result is always a whole day 1..28.
   */
  private creditDay(row: number, what: string): number {
    const v = cell(this.s['Счета'], 'C', row);
    const day = cellNumber(v);
    const label = `Кредитка: день ${what} (Счета, C${row})`;
    if (day === undefined) {
      const problem = isBlank(v) ? 'не указан' : `${quoted(shown(v))} не распознан`;
      this.note('Счета', `${label} ${problem} — взят 1, как в Excel`);
      return 1;
    }
    const taken = Math.trunc(Math.max(1, Math.min(28, day)));
    if (isText(v)) {
      // Excel reads text as 0, so there the day is 1. One note for the cell: it is text, what Excel does
      // (only when that is not what was loaded), and what was loaded.
      const excel = taken === 1 ? '' : ', там взят день 1';
      const loaded = taken === day ? `загружен день ${taken}` : `взят ${taken}`;
      this.note('Счета', `${this.where('Счета', 'C', row)}: ${quoted(shown(v))} — в Excel это текст${excel}; ${loaded}`);
    } else if (taken !== day) {
      const why = day < 1 || day > 28 ? 'вне 1–28' : 'не целое';
      this.note('Счета', `${label} ${quoted(shown(v))} ${why} — взят ${taken}, как в Excel`);
    }
    return taken;
  }

  operations(): Operation[] {
    const ws = this.s['Операции'];
    const rows: Operation[] = [];
    const input = (row: number): string[] => this.withInput('Операции', row, OPERATION_INPUTS);
    const formulas = helperFormulas(ws, ROW_FORMULA.Операции, 10);
    const { end, footer } = this.bounds('Операции', 10, formulas.last);
    for (let row = 10; row <= end; row++) {
      if (isNoteRow(ws, 'Операции', row) || input(row).length === 0) continue;
      const date = this.rowDate('Операции', row);
      if (!date) continue;
      const kindValue = cell(ws, 'D', row);
      const kind = parseKind(cellText(kindValue));
      if (!kind) {
        this.skip('Операции', row, isBlank(kindValue) ? 'нет типа' : `тип ${quoted(shown(kindValue))} не распознан`);
        continue;
      }
      this.withoutFormulas('Операции', row, formulas);
      this.excelLabel('Операции', 'D', row, KIND_LABEL[kind]); // SUMIFS look for "Доход", "Расход" and "Перевод"
      rows.push(compact({
        id: newId(),
        date,
        kind,
        category: this.category('Операции', 'E', row, kind === 'expense'),
        what: this.title('Операции', 'F', row, 'Что'),
        amount: this.num('Операции', 'G', row) ?? 0,
        account: this.accountAt('Операции', 'H', row),
        toAccount: kind === 'transfer' ? this.accountAt('Операции', 'I', row) : undefined,
      }));
    }
    this.afterTable('Операции', footer, input);
    return rows;
  }

  journal(months: YM[]): JournalRow[] {
    const ws = this.s[PLANNED];
    const rows: JournalRow[] = [];
    const input = (row: number): string[] => this.withInput(PLANNED, row, JOURNAL_INPUTS, ['M']);
    const formulas = helperFormulas(ws, ROW_FORMULA[PLANNED], 10);
    const { end, footer } = this.bounds(PLANNED, 10, formulas.last);
    for (let row = 10; row <= end; row++) {
      if (isNoteRow(ws, PLANNED, row) || input(row).length === 0) continue;
      const date = this.rowDate(PLANNED, row);
      if (!date) continue;
      this.withoutFormulas(PLANNED, row, formulas);
      const kind = this.incomeOrExpense(PLANNED, 'D', row);
      rows.push(compact({
        id: newId(),
        date,
        kind,
        category: this.category(PLANNED, 'E', row, kind === 'expense'),
        what: this.title(PLANNED, 'F', row, 'Что'),
        plan: this.num(PLANNED, 'G', row),
        fact: this.num(PLANNED, 'H', row),
        status: this.journalStatus(row),
        account: this.accountAt(PLANNED, 'J', row),
        priority: this.freeText(PLANNED, 'K', row),
        month: this.journalMonth(row, date, months),
      }));
    }
    this.afterTable(PLANNED, footer, input);
    return rows;
  }

  /**
   * Запланированные «Статус». Excel's formulas look for «Оплачено» and «Отменено» ($I="Оплачено", $I="Отменено",
   * SUMIFS "<>Оплачено"); «Запланировано» and «Перенесено» are never looked for, so Excel treats them alike.
   */
  private journalStatus(row: number): JournalRow['status'] {
    const value = this.read(PLANNED, 'I', row, status);
    if (value === 'paid' || value === 'cancelled') this.excelLabel(PLANNED, 'I', row, JOURNAL_STATUS_LABEL[value]);
    return value;
  }

  /**
   * Column M: a formula is the default (month of the date); a typed label of one of the 12
   * accounting months overrides it. Excel looks the label up among those 12 (R: MATCH($M, Настройки
   * X6:X17, 0), build_tracker.py 227–228) and falls back to the month of the date for anything else.
   * MATCH reads * ? ~ as wildcards: text that is no label but matches some is taken as the first of
   * them, as Excel takes it, with a note.
   */
  private journalMonth(row: number, date: string, months: YM[]): YM | undefined {
    const v = cell(this.s[PLANNED], 'M', row);
    if (!typedOver(v)) return undefined;
    const label = cellText(v);
    const ym = label === undefined ? null : parseMonthLabel(label);
    const raw = unwrap(v);
    const matched = !ym && typeof raw === 'string' ? months.find((m) => criterionMatches(raw, monthLabel(m))) : undefined;
    if (matched && typeof raw === 'string') {
      this.note(PLANNED, `${this.name(PLANNED)}, строка ${row}: месяц учёта ${quoted(asTyped(raw))} — шаблон, а не название месяца; `
        + `взят ${quoted(monthLabel(matched))}, как в Excel`);
      return matched === ymOf(date) ? undefined : matched;
    }
    const problem = !ym ? 'не распознан' : !months.includes(ym) ? 'не входит в 12 месяцев учёта' : undefined;
    if (!ym || problem) {
      // Text not recognised is shown as typed: spaces around it are why MATCH finds no label (as for C7/C9).
      const typed = !ym && typeof raw === 'string' ? asTyped(raw) : shown(v);
      this.note(PLANNED, `${this.name(PLANNED)}, строка ${row}: месяц учёта ${quoted(typed)} ${problem} — взят месяц даты`);
      return undefined;
    }
    this.excelLabel(PLANNED, 'M', row, monthLabel(ym)); // MATCH($M, the 12 labels, 0) looks for every label
    return ym === ymOf(date) ? undefined : ym;
  }

  recurring(months: YM[]): Recurring[] {
    const sheet = 'Постоянные';
    const ws = this.s[sheet];
    const { cols, monthCols } = recurringColumns(ws);
    const parsed = <T>(name: RecurringColumn, row: number, parse: (v: CellValue) => T | undefined): T | undefined => {
      const col = cols[name];
      return col === undefined ? undefined : this.read(sheet, col, row, parse);
    };
    const whole = (name: RecurringColumn, row: number, min: number, max: number, noun: string, instead: string): number | undefined => {
      const col = cols[name];
      return col === undefined ? undefined : this.whole(sheet, col, row, min, max, noun, instead);
    };
    // Every column the import reads except «Что»: a row with input in one of them is a row, named or not.
    const inputs = [...Object.entries(cols).filter(([name]) => name !== 'what').map(([, col]) => col), ...monthCols];
    const rows: Recurring[] = [];
    const read = [cols.what, ...inputs];
    const input = (row: number): string[] => this.withInput(sheet, row, read);
    const totals: Totals = {
      is: (row) => isRecurringTotals(ws, cols, monthCols, 8, row),
      reach: (row) => averageReach(ws, cols.amount, 8, row),
      name: cols.what,
      read,
      formulas: [...(cols.amount === undefined ? [] : [cols.amount]), ...monthCols],
    };
    const formulas = recurringFormulas(ws, 8);
    const table = this.bounds(sheet, 8, formulas.last, totals);
    for (let row = 8; row <= table.end; row++) {
      if (this.skipInnerTotals(sheet, row, table, totals) || this.skipBareTotals(sheet, row, totals, table)) continue;
      if (input(row).length === 0 || this.skipFormulasOnly(sheet, row, read, cols.what)) continue;
      // Without its formulas the row note has said what Excel does; the note on the name does not repeat it.
      const noted = this.withoutFormulas(sheet, row, formulas);
      const what = this.title(sheet, cols.what, row, 'Что', noted ? undefined : EXCEL_SKIPS_RECURRING);
      const kind = this.incomeOrExpense(sheet, cols.kind, row);
      // Read in the order of the columns, so the notes of a row come in that order too.
      const category = cols.category === undefined ? undefined : this.category(sheet, cols.category, row, kind === 'expense');
      const day = whole('day', row, 1, 31, 'день месяца', 'не загружено');
      const amount = parsed('amount', row, cellNumber) ?? 0;
      const every = whole('every', row, 1, 12, 'число месяцев', 'взято 1');
      const from = parsed('from', row, trackerDate);
      const to = parsed('to', row, trackerDate);
      const account = cols.account === undefined ? undefined : this.accountAt(sheet, cols.account, row);
      const marks: Record<YM, Mark> = {};
      months.forEach((ym, k) => {
        const col = monthCols[k];
        const value = col === undefined ? undefined : this.readTick(sheet, col, row, mark);
        if (value !== undefined) marks[ym] = value;
      });
      rows.push(compact({
        id: newId(),
        what,
        kind,
        category,
        day,
        amount,
        every: every !== undefined && every > 1 ? every : undefined,
        from,
        to,
        account,
        marks,
      }));
    }
    this.afterTable(sheet, table.footer, input, totals);
    return rows;
  }

  purchases(): Purchase[] {
    const ws = this.s['Покупки'];
    const rows: Purchase[] = [];
    const input = (row: number): string[] => this.withInput('Покупки', row, PURCHASE_READ);
    const totals = sumsTotals(ws, 'Покупки', 7, PURCHASE_READ);
    const formulas = helperFormulas(ws, ROW_FORMULA.Покупки, 7);
    const table = this.bounds('Покупки', 7, formulas.last, totals);
    for (let row = 7; row <= table.end; row++) {
      if (isNoteRow(ws, 'Покупки', row)) continue; // the generator's note: a later SUM of the user's reaches it, or the helper was filled down past it
      if (this.skipInnerTotals('Покупки', row, table, totals) || this.skipBareTotals('Покупки', row, totals, table)) continue;
      if (input(row).length === 0 || this.skipFormulasOnly('Покупки', row, PURCHASE_READ, 'C')) continue;
      const noted = this.withoutFormulas('Покупки', row, formulas);
      // Whether Excel sees it bought (S = IF(N="✓",…), the raw value) decides what Excel counts of a row
      // without a name; N is read (and noted) below. Without its formulas the row note has said it already.
      const bought = unwrap(cell(ws, 'N', row)) === CHECK ? EXCEL_COUNTS_ONLY_FACT : EXCEL_SKIPS_ROW;
      const excel = noted ? undefined : bought;
      rows.push(compact({
        id: newId(),
        what: this.title('Покупки', 'C', row, 'Что покупаем', excel),
        category: this.category('Покупки', 'D', row, true),
        cost: this.num('Покупки', 'E', row),
        saved: this.num('Покупки', 'F', row),
        date: this.date('Покупки', 'G', row),
        priority: this.freeText('Покупки', 'L', row),
        bought: this.readTick('Покупки', 'N', row, checked) ?? false,
        price: this.num('Покупки', 'O', row),
        account: this.accountAt('Покупки', 'P', row),
      }));
    }
    this.afterTable('Покупки', table.footer, input, totals);
    return rows;
  }

  /** Excel counts every row above ИТОГО (see ROW_FORMULA), so a row here gets no note about the formulas. */
  debts(): Debt[] {
    const ws = this.s['Долги'];
    const rows: Debt[] = [];
    const input = (row: number): string[] => this.withInput('Долги', row, DEBT_READ);
    const totals = sumsTotals(ws, 'Долги', 7, DEBT_READ);
    const table = this.bounds('Долги', 7, undefined, totals);
    for (let row = 7; row <= table.end; row++) {
      if (this.skipInnerTotals('Долги', row, table, totals) || this.skipBareTotals('Долги', row, totals, table)) continue;
      if (input(row).length === 0 || this.skipFormulasOnly('Долги', row, DEBT_READ, 'C')) continue;
      rows.push(compact({
        id: newId(),
        name: this.title('Долги', 'C', row, 'Название'),
        whom: this.freeText('Долги', 'D', row),
        total: this.num('Долги', 'E', row),
        paid: this.num('Долги', 'F', row),
        rate: this.num('Долги', 'H', row),
        payment: this.num('Долги', 'I', row),
        nextDate: this.date('Долги', 'J', row),
      }));
    }
    this.afterTable('Долги', table.footer, input, totals);
    return rows;
  }
}

/**
 * Column letters of «Постоянные» by the header texts in row 7. The 12 month columns start at the
 * first header cell (from C on) that is a formula; only headers left of them are looked at,
 * because the helper tables to the right repeat some of the names.
 */
function recurringColumns(ws: Worksheet): { cols: Partial<Record<RecurringColumn, string>> & { what: string }; monthCols: string[] } {
  const header = ws.getRow(7);
  let firstMonth: number | undefined;
  for (let col = 3; col <= header.cellCount; col++) {
    if (isFormula(header.getCell(col).value)) {
      firstMonth = col;
      break;
    }
  }
  const cols: Partial<Record<RecurringColumn, string>> = {};
  const wanted = Object.entries(RECURRING_HEADERS).map(([key, title]) => [key as RecurringColumn, title.toLowerCase()] as const);
  for (let col = 3; col < (firstMonth ?? 3); col++) {
    const title = cellText(header.getCell(col).value)?.replace(/\s+/g, ' ').toLowerCase();
    const match = wanted.find(([key, t]) => t === title && cols[key] === undefined);
    if (match) cols[match[0]] = ws.getColumn(col).letter;
  }
  if (firstMonth === undefined || cols.what === undefined) {
    throw new TrackerImportError('Лист «Постоянные» не похож на трекер: в строке 7 нет заголовка «Что» или столбцов месяцев.');
  }
  const start = firstMonth;
  return { cols: { ...cols, what: cols.what }, monthCols: Array.from({ length: 12 }, (_, k) => ws.getColumn(start + k).letter) };
}

/**
 * Constants typed over the formula cells of FORMULA_AREAS (a table's area ends at its last row, `tableEnds`) and of
 * the totals rows found (`totalsCells`), in the order of the tracker's tabs.
 */
function readOverrides(
  s: Sheets, tableEnds: Partial<Record<TableSheet, number>>, totalsCells: { sheet: TableSheet; row: number; cols: string[] }[],
): string[] {
  const overrides: string[] = [];
  const typed = (sheet: SheetName, col: string, row: number): void => {
    const v = cell(s[sheet], col, row);
    if (!isFormula(v) && !isBlank(v)) overrides.push(`${s[sheet].name}!${col}${row} = ${shown(v)}`);
  };
  for (const name of SHEETS) {
    for (const { sheet, cols, from, to } of FORMULA_AREAS.filter((area) => area.sheet === name)) {
      const last = to === 'table' ? tableEnds[sheet as TableSheet] ?? from - 1 : to;
      for (let row = from; row <= last; row++) for (const col of cols) typed(sheet, col, row);
    }
    for (const { sheet, row, cols } of totalsCells.filter((totals) => totals.sheet === name)) for (const col of cols) typed(sheet, col, row);
  }
  return overrides;
}

export async function importTracker(buf: ArrayBuffer): Promise<ImportResult> {
  const s = trackerSheets(await openWorkbook(buf));
  const reader = new Reader(s);
  const settings = reader.settings();
  const categories = reader.categories();
  const accounts = reader.readAccounts();
  const months = accountingMonths(settings);
  const data: Data = {
    schemaVersion: SCHEMA_VERSION,
    settings,
    categories,
    accounts,
    credit: reader.credit(),
    operations: reader.operations(),
    journal: reader.journal(months),
    recurring: reader.recurring(months),
    purchases: reader.purchases(),
    debts: reader.debts(),
  };
  reader.cellNotes();
  return { data, notes: reader.notes, overrides: readOverrides(s, reader.tableEnds, reader.totalsCells) };
}
