// Excel reports on request: the month report, the year statistics, accounts and movements, the forecast.
// Every number comes from the engine — this module only lays the numbers out and styles them.
// Every text cell is written through escapeText (like the backup), so «Чек_x0041_1» shows as typed.
// ExcelJS is loaded lazily, when the first report is made.
import type { Cell, Workbook, Worksheet } from 'exceljs';
import {
  CARD_REPAYMENT_LABEL,
  FREE_AFTER_SAVINGS_LABEL,
  ROW_CHECK_LABEL,
  TO_SAVINGS_LABEL,
  accountMovements,
  accountingMonths,
  balances,
  creditCardId,
  creditStatements,
  dailySpend,
  dateIn,
  forecast,
  monthEnd,
  monthItems,
  monthCardRepayment,
  monthLabel,
  monthStart,
  monthSummary,
  nextCreditDebit,
  roundCents,
  yearStats,
} from '../engine';
import type { Data, ISODate, YM } from '../engine';
import { DATE_FORMAT, MONEY_FORMAT, escapeText, isoToExcelDate } from './excel';
import { ACCOUNT_TYPE_LABEL, DUPLICATE_LABEL, JOURNAL_STATUS_LABEL, KIND_LABEL, SOURCE_LABEL } from './labels';

export interface ReportFile {
  filename: string;
  buffer: ArrayBuffer;
}

export const PERCENT_FORMAT = '0%';

const TOTAL = 'ИТОГО';
const DELETED_ACCOUNT = '(удалённый счёт)';
const HEADER_FILL = 'FF2E3A59';
const WHITE = 'FFFFFFFF';
const SUBTITLE_COLOR = 'FF6B7280';
const MIN_WIDTH = 10;
const MAX_WIDTH = 40;
const TITLE_SIZE = 14;
const BODY_SIZE = 11; // column widths count characters of the 11 pt default font

// ── Layout of a sheet ───────────────────────────────────────────────────
type Kind = 'text' | 'money' | 'date' | 'percent';

/** Text, a number, or an ISO date 'YYYY-MM-DD' (shown as a date); null or undefined leaves the cell empty. */
type Value = string | number | null | undefined;

interface Column {
  header: string;
  kind: Kind;
}

/** A line under the table: a label and the values right of it. */
interface Note {
  label: string;
  values: [Value, Kind][];
}

interface Table {
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Value[][];
  totals?: Value[][]; // bold lines right under the rows (ИТОГО), a border over the first
  filter?: boolean; // autofilter over the header and the rows, not the totals
  notes?: Note[];
}

const TITLE_ROW = 1;
const SUBTITLE_ROW = 2;
const HEADER_ROW = 3;

const isIsoDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);

function put(cell: Cell, v: Value, kind: Kind): void {
  if (v === null || v === undefined) return;
  if (typeof v === 'string') {
    if (kind === 'date' && isIsoDate(v)) {
      cell.value = isoToExcelDate(v);
      cell.numFmt = DATE_FORMAT;
    } else {
      cell.value = escapeText(v);
    }
    return;
  }
  cell.value = v;
  if (kind === 'money') cell.numFmt = MONEY_FORMAT;
  if (kind === 'percent') cell.numFmt = PERCENT_FORMAT;
}

const NBSP = '\u00A0';

/** '1234.5' → '1 234,50 €' with no-break spaces, as the app writes money in a text (never «-0,00 €»). */
function ruMoney(n: number): string {
  const cents = Math.round(Math.abs(roundCents(n)) * 100);
  const int = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+$)/g, NBSP);
  return `${n < 0 && cents > 0 ? '-' : ''}${int},${String(cents % 100).padStart(2, '0')}${NBSP}€`;
}

/** '1234.5' → '1,234.50 €' — as long as the money format shows it. */
function moneyText(n: number): string {
  const [int = '0', frac = '00'] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+$)/g, ',')}.${frac} €`;
}

/** Characters the value takes on screen. */
function shownLength(v: Value, kind: Kind): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') return kind === 'date' && isIsoDate(v) ? DATE_FORMAT.length : v.length;
  if (kind === 'money') return moneyText(v).length;
  if (kind === 'percent') return `${Math.round(v * 100)}%`.length;
  return String(v).length;
}

function addTable(wb: Workbook, name: string, t: Table): Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: true }] });
  const n = t.columns.length;
  const widths = t.columns.map(() => 0);
  const measure = (values: Value[], kinds: Kind[]) =>
    values.forEach((v, i) => {
      widths[i] = Math.max(widths[i] ?? 0, shownLength(v, kinds[i] ?? 'text'));
    });
  const kinds = t.columns.map((c) => c.kind);

  const title = ws.getCell(TITLE_ROW, 1);
  title.value = escapeText(t.title);
  title.font = { bold: true, size: TITLE_SIZE };
  if (n > 1) ws.mergeCells(TITLE_ROW, 1, TITLE_ROW, n);
  // Not merged: a merged cell clips its text, a plain one runs on over the empty cells to its right.
  const subtitle = ws.getCell(SUBTITLE_ROW, 1);
  subtitle.value = escapeText(t.subtitle);
  subtitle.font = { italic: true, color: { argb: SUBTITLE_COLOR } };

  const header = ws.getRow(HEADER_ROW);
  t.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = escapeText(c.header);
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  measure(t.columns.map((c) => c.header), t.columns.map(() => 'text'));

  let r = HEADER_ROW + 1;
  for (const values of t.rows) {
    const row = ws.getRow(r++);
    values.forEach((v, i) => put(row.getCell(i + 1), v, kinds[i] ?? 'text'));
    measure(values, kinds);
  }
  if (t.filter) ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: r - 1, column: n } };

  (t.totals ?? []).forEach((values, k) => {
    const row = ws.getRow(r++);
    for (let i = 0; i < n; i++) {
      const cell = row.getCell(i + 1);
      put(cell, values[i], kinds[i] ?? 'text');
      cell.font = { bold: true };
      if (k === 0) cell.border = { top: { style: 'thin' } };
    }
    measure(values, kinds);
  });

  if (t.notes && t.notes.length > 0) {
    r++; // an empty row between the table and the notes
    for (const note of t.notes) {
      const row = ws.getRow(r++);
      const label = row.getCell(1);
      label.value = escapeText(note.label);
      label.font = { bold: true };
      note.values.forEach(([v, kind], i) => put(row.getCell(i + 2), v, kind));
      measure([note.label, ...note.values.map(([v]) => v)], ['text', ...note.values.map(([, kind]) => kind)]);
    }
  }

  const fitted = fitTitle(widths.map((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + 2))), t.title.length);
  fitted.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  return ws;
}

/** Widens the columns evenly (up to the maximum width) until the merged title over them shows in full. */
function fitTitle(widths: number[], titleLength: number): number[] {
  const need = Math.ceil((titleLength * TITLE_SIZE) / BODY_SIZE);
  const out = [...widths];
  let short = need - out.reduce((a, b) => a + b, 0);
  while (short > 0 && out.some((w) => w < MAX_WIDTH)) {
    const open = out.filter((w) => w < MAX_WIDTH).length;
    const step = Math.ceil(short / open);
    for (let i = 0; i < out.length && short > 0; i++) {
      const w = out[i] ?? MAX_WIDTH;
      const add = Math.min(step, MAX_WIDTH - w, short);
      out[i] = w + add;
      short -= add;
    }
  }
  return out;
}

// ── Workbook, file, texts ───────────────────────────────────────────────
async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Трекер расходов';
  return wb;
}

async function toFile(wb: Workbook, filename: string): Promise<ReportFile> {
  // writeBuffer gives a Node-style Buffer (a view that may share a larger pool); copying it into a
  // fresh Uint8Array gives an ArrayBuffer of exactly the file's bytes.
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  return { filename, buffer: bytes.buffer };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** '2026-10-05' → '05.10.2026'. */
const ruDate = (d: ISODate): string => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** The local date on this device. */
function localToday(): ISODate {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

const generated = (on: ISODate): string => `сформировано ${ruDate(on)}`;

const monthPeriod = (ym: YM): string => `${ruDate(monthStart(ym))} – ${ruDate(monthEnd(ym))}`;

function yearLabel(data: Data): string {
  const months = accountingMonths(data.settings);
  return `${monthLabel(months[0] ?? data.settings.accountingStart)} – ${monthLabel(months[months.length - 1] ?? data.settings.accountingStart)}`;
}

const total = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** The account's name; an id no account has any more reads «(удалённый счёт)». */
function accountName(data: Data, id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  return data.accounts.find((a) => a.id === id)?.name ?? DELETED_ACCOUNT;
}

// ── Sheet names ─────────────────────────────────────────────────────────
const SHEET_NAME_MAX = 31;

/** A name Excel accepts: no \ / ? * : [ ], not starting or ending with an apostrophe, not blank. */
function cleanSheetName(name: string): string {
  return name.replace(/[\\/?*:[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s']+|[\s']+$/g, '');
}

/**
 * Hands out valid, unique sheet names (Excel compares them ignoring case): a name already used gets
 * ' (2)', ' (3)', … within 31 characters. `taken` are the names of the report's own sheets.
 */
function sheetNamer(taken: string[]): (wanted: string) => string {
  const used = new Set(['history', ...taken.map((n) => n.toLowerCase())]); // Excel keeps «History» for itself
  return (wanted) => {
    const base = cleanSheetName(wanted) || 'Счёт';
    for (let k = 1; ; k++) {
      const suffix = k === 1 ? '' : ` (${k})`;
      const cut = base.slice(0, SHEET_NAME_MAX - suffix.length).replace(/[\uD800-\uDBFF]$/, '').replace(/[\s']+$/, '');
      const name = cut + suffix;
      if (!used.has(name.toLowerCase())) {
        used.add(name.toLowerCase());
        return name;
      }
    }
  };
}

// ── Month report ────────────────────────────────────────────────────────
/**
 * «Итоги», «Категории», «Движения», «По дням» of month ym; `generatedOn` (default: today on this device) goes in the
 * subtitles and is the «today» of the card repayment already debited. As the tracker's «Месяц»: transfers into savings,
 * what is free after them and the card repayment are lines of their own, in no expense sum.
 */
export async function monthReport(data: Data, ym: YM, generatedOn: ISODate = localToday()): Promise<ReportFile> {
  const wb = await newWorkbook();
  const label = monthLabel(ym);
  const subtitle = `Период: ${monthPeriod(ym)} · ${generated(generatedOn)}`;
  const s = monthSummary(data, ym);
  const hasLimits = s.byCategory.some((c) => c.limit !== undefined);
  const repayment = monthCardRepayment(data, ym, generatedOn);
  const repaymentLabel = `${CARD_REPAYMENT_LABEL} (${repayment.day}-го)`;

  addTable(wb, 'Итоги', {
    title: `Итоги — ${label}`,
    subtitle,
    columns: [{ header: 'Показатель', kind: 'text' }, { header: 'Сумма', kind: 'money' }],
    rows: [
      ['Доход план', s.incomePlan],
      ['Доход факт', s.incomeFact],
      ['Расход план', s.expensePlan],
      ['Расход факт', s.expenseFact],
      ['Баланс факт', s.balanceFact],
      ['Лимиты всего', s.limitsTotal],
      ['Остаток лимитов', s.limitsLeft],
      [`${TO_SAVINGS_LABEL} план`, s.toSavings.plan],
      [`${TO_SAVINGS_LABEL} факт`, s.toSavings.fact],
      [`${FREE_AFTER_SAVINGS_LABEL} план`, s.freeAfterSavings.plan],
      [`${FREE_AFTER_SAVINGS_LABEL} факт`, s.freeAfterSavings.fact],
      [`${repaymentLabel} план`, repayment.plan],
      [`${repaymentLabel} факт`, repayment.fact],
    ],
    notes: [{ label: `${CARD_REPAYMENT_LABEL} — справочно: покупки по кредитке уже в расходах, списание — в остатках`, values: [] }],
  });

  addTable(wb, 'Категории', {
    title: `Расходы по категориям — ${label}`,
    subtitle,
    columns: [
      { header: 'Категория', kind: 'text' },
      { header: 'Лимит', kind: 'money' },
      { header: 'План', kind: 'money' },
      { header: 'Факт', kind: 'money' },
      { header: 'Остаток лимита', kind: 'money' },
      { header: '% лимита', kind: 'percent' },
    ],
    rows: [
      ...s.byCategory.map((c): Value[] => [c.name, c.limit, c.plan, c.fact, c.left, c.share]),
      ['Без категории', null, s.uncategorized.plan, s.uncategorized.fact, null, null],
    ],
    totals: [[TOTAL, hasLimits ? s.limitsTotal : null, s.expensePlan, s.expenseFact, hasLimits ? s.limitsLeft : null, null]],
    // not categories: under the plan and the fact, outside ИТОГО (net into savings; income − expenses − that)
    notes: [
      { label: TO_SAVINGS_LABEL, values: [[null, 'money'], [s.toSavings.plan, 'money'], [s.toSavings.fact, 'money']] },
      { label: FREE_AFTER_SAVINGS_LABEL, values: [[null, 'money'], [s.freeAfterSavings.plan, 'money'], [s.freeAfterSavings.fact, 'money']] },
    ],
  });

  const items = monthItems(data, ym);
  // Income and expenses as «Итоги» counts them; transfers apart — a sum of all three would mean nothing.
  const line = (name: string, plan: number | null, fact: number): Value[] =>
    [name, null, null, null, null, plan, fact, null, null, null, null];
  addTable(wb, 'Движения', {
    title: `Движения — ${label}`,
    subtitle,
    columns: [
      { header: 'Дата', kind: 'date' },
      { header: 'Источник', kind: 'text' },
      { header: 'Тип', kind: 'text' },
      { header: 'Категория', kind: 'text' },
      { header: 'Что', kind: 'text' },
      { header: 'План', kind: 'money' },
      { header: 'Факт', kind: 'money' },
      { header: 'Статус', kind: 'text' },
      { header: 'Счёт', kind: 'text' },
      { header: 'На счёт', kind: 'text' },
      { header: 'Дубль или проверка', kind: 'text' },
    ],
    // As «Лента»: a transfer has no category (one typed in the tracker is kept, unused); the last column is the
    // tracker's «Дубль или проверка» — a possible duplicate or the check of the row's type and accounts.
    rows: items.map((i): Value[] => [
      i.date,
      SOURCE_LABEL[i.source],
      KIND_LABEL[i.kind],
      i.kind === 'transfer' ? null : i.category,
      i.what,
      i.plan,
      i.fact,
      JOURNAL_STATUS_LABEL[i.status],
      accountName(data, i.account),
      accountName(data, i.toAccount),
      i.duplicate !== undefined ? DUPLICATE_LABEL[i.duplicate] : i.check !== undefined ? ROW_CHECK_LABEL[i.check] : null,
    ]),
    totals: [
      line('Доходы', s.incomePlan, s.incomeFact),
      line('Расходы', s.expensePlan, s.expenseFact),
      line('Переводы', null, total(items.filter((i) => i.kind === 'transfer').map((i) => i.fact))),
    ],
    filter: true,
  });

  const days = dailySpend(data, ym);
  addTable(wb, 'По дням', {
    title: `Траты по дням — ${label}`,
    subtitle,
    columns: [{ header: 'День', kind: 'date' }, { header: 'Потрачено', kind: 'money' }],
    rows: days.map((spent, i): Value[] => [dateIn(ym, i + 1), spent]),
    // no ИТОГО: days count journal rows by their date, the month by the accounting month — the sums can differ
  });

  return toFile(wb, `Отчёт — ${label}.xlsx`);
}

// ── Year report ─────────────────────────────────────────────────────────
/** «Месяцы» and «Категории» (categories × months) of the accounting year; `generatedOn` (default: today on this device) goes in the subtitles. */
export async function yearReport(data: Data, generatedOn: ISODate = localToday()): Promise<ReportFile> {
  const wb = await newWorkbook();
  const period = yearLabel(data);
  const subtitle = `Учётный год: ${period} · ${generated(generatedOn)}`;
  const y = yearStats(data);
  const sumOf = (pick: (m: (typeof y.months)[number]) => number): number => total(y.months.map(pick));

  addTable(wb, 'Месяцы', {
    title: 'Доходы и расходы по месяцам',
    subtitle,
    columns: [
      { header: 'Месяц', kind: 'text' },
      { header: 'Доход план', kind: 'money' },
      { header: 'Доход факт', kind: 'money' },
      { header: 'Расход план', kind: 'money' },
      { header: 'Расход факт', kind: 'money' },
      { header: 'Баланс', kind: 'money' },
      { header: 'Накоплено', kind: 'money' },
      { header: 'Расход факт/план', kind: 'percent' },
    ],
    rows: y.months.map((m): Value[] => [
      m.label, m.incomePlan, m.incomeFact, m.expensePlan, m.expenseFact, m.balance, m.cumulative, m.ratio,
    ]),
    totals: [[
      TOTAL,
      sumOf((m) => m.incomePlan),
      sumOf((m) => m.incomeFact),
      sumOf((m) => m.expensePlan),
      sumOf((m) => m.expenseFact),
      sumOf((m) => m.balance),
      null,
      null,
    ]],
    notes: [
      { label: 'Средний расход в месяц', values: [[y.avgExpense, 'money']] },
      { label: 'Самый дорогой месяц', values: [[y.maxMonth ?? '—', 'text']] },
    ],
  });

  const monthColumns = y.months.map((m): Column => ({ header: m.label, kind: 'money' }));
  addTable(wb, 'Категории', {
    title: 'Расходы по категориям и месяцам',
    subtitle,
    columns: [{ header: 'Категория', kind: 'text' }, ...monthColumns, { header: 'Итого', kind: 'money' }],
    rows: [
      ...y.matrix.map((row): Value[] => [row.name, ...row.byMonth, row.total]),
      ['Без категории', ...y.uncategorized, total(y.uncategorized)],
    ],
    totals: [[TOTAL, ...y.months.map((m) => m.expenseFact), sumOf((m) => m.expenseFact)]],
  });

  return toFile(wb, `Статистика — ${period}.xlsx`);
}

// ── Accounts report ─────────────────────────────────────────────────────
const ACCOUNTS_SHEET = 'Счета';
// the tracker's totals of «Счета»: savings accounts are outside the balance («Всего») and have their own line
const IN_BALANCE_TOTAL = 'ИТОГО в балансе (без сбережений)';
const SAVINGS_TOTAL = 'Сбережения (вне баланса)';
const CREDIT_SHEET = 'Выписки кредитки';

/**
 * «Счета» (balances on `today`), a sheet of movements in month ym per account, «Выписки кредитки» (statements).
 * `generatedOn` (default: `today`) goes in the subtitles.
 */
export async function accountsReport(data: Data, today: ISODate, ym: YM, generatedOn: ISODate = today): Promise<ReportFile> {
  const wb = await newWorkbook();
  const label = monthLabel(ym);
  const onToday = `на ${ruDate(today)}`;
  const cardId = creditCardId(data);
  const card = data.accounts.find((a) => a.id === cardId);
  const nameOf = sheetNamer(card ? [ACCOUNTS_SHEET, CREDIT_SHEET] : [ACCOUNTS_SHEET]);
  const b = balances(data, today);
  const inBalance = b.rows.filter((r) => r.type !== 'savings');
  const savings = b.rows.filter((r) => r.type === 'savings');
  const sums = (rows: typeof b.rows): number[] => [
    total(rows.map((r) => r.start)), total(rows.map((r) => r.income)), total(rows.map((r) => r.expense)), total(rows.map((r) => r.transfers)),
  ];

  addTable(wb, ACCOUNTS_SHEET, {
    title: 'Остатки на счетах',
    subtitle: `Остатки ${onToday} · ${generated(generatedOn)}`,
    columns: [
      { header: 'Счёт', kind: 'text' },
      { header: 'Тип', kind: 'text' },
      { header: 'На начало', kind: 'money' },
      { header: 'Поступления', kind: 'money' },
      { header: 'Траты', kind: 'money' },
      { header: 'Переводы', kind: 'money' },
      { header: 'Сейчас', kind: 'money' },
      { header: 'Долг', kind: 'money' },
    ],
    rows: b.rows.map((r): Value[] => [r.name, ACCOUNT_TYPE_LABEL[r.type], r.start, r.income, r.expense, r.transfers, r.now, r.debt]),
    // as the tracker's «Счета»: the total of the accounts in the balance («Всего»), the savings accounts apart
    totals: [
      [IN_BALANCE_TOTAL, null, ...sums(inBalance), b.total, b.creditDebt],
      [SAVINGS_TOTAL, null, ...sums(savings), b.savings, null],
    ],
    notes: [
      { label: 'На картах', values: [[b.cards, 'money']] },
      { label: 'Наличные', values: [[b.cash, 'money']] },
      { label: 'Долг по кредитке', values: [[b.creditDebt, 'money']] },
      { label: 'Всего', values: [[b.total, 'money']] },
      { label: 'Сбережения', values: [[b.savings, 'money']] },
    ],
  });

  const from = monthStart(ym);
  const to = monthEnd(ym);
  for (const account of data.accounts) {
    const moves = accountMovements(data, account.id, from, to, today);
    addTable(wb, nameOf(account.name), {
      title: `${account.name} — движения`,
      subtitle: `${label}: ${monthPeriod(ym)} · ${generated(generatedOn)}`,
      columns: [
        { header: 'Дата', kind: 'date' },
        { header: 'Что', kind: 'text' },
        { header: 'Сумма', kind: 'money' },
        { header: 'Остаток', kind: 'money' },
      ],
      rows: moves.map((m): Value[] => [m.date, m.what, m.amount, m.running]),
      totals: [[TOTAL, null, total(moves.map((m) => m.amount)), null]],
      filter: true,
    });
  }

  if (card) {
    const next = nextCreditDebit(data, today);
    addTable(wb, CREDIT_SHEET, {
      title: `Выписки кредитки — ${card.name}`,
      subtitle: `Учётный год: ${yearLabel(data)} · списания ${onToday} · ${generated(generatedOn)}`,
      columns: [
        { header: 'Выписка на', kind: 'date' },
        { header: 'Долг с прошлой', kind: 'money' },
        { header: 'Погашено', kind: 'money' },
        { header: 'Покупки', kind: 'money' },
        { header: 'Возвраты и переводы', kind: 'money' },
        { header: 'Долг по выписке', kind: 'money' },
        { header: 'Спишется', kind: 'date' },
        { header: 'Сумма списания', kind: 'money' },
      ],
      rows: creditStatements(data, today).map((st): Value[] => [
        st.close, st.carried, st.repaid, st.purchases, st.other, st.debt, st.payDate, st.payAmount,
      ]),
      notes: [
        { label: 'Ближайшее списание', values: next ? [[next.date, 'date'], [next.amount, 'money']] : [['—', 'text']] },
      ],
    });
  }

  return toFile(wb, `Счета — ${label}.xlsx`);
}

// ── Forecast report ─────────────────────────────────────────────────────
const BELOW = 'да';
/** Transfers to savings (−) and from them (+): the free money they move, neither income nor an expense. */
const TRANSFERS = 'Переводы в / из сбережений';
/** The reserve by limits of the forecast: the everyday spending still to come, in the expenses. */
const RESERVE = 'Резерв по лимитам';

/**
 * «Месяцы» (the three forecast months) and «Недели» (the 13 weeks) of the forecast, as the «Прогноз» view shows
 * them; `generatedOn` (default: today on this device) goes in the subtitles with the forecast start and the cushion.
 */
export async function forecastReport(data: Data, generatedOn: ISODate = localToday()): Promise<ReportFile> {
  const wb = await newWorkbook();
  const f = forecast(data, generatedOn);
  // «Резерв по лимитам (повседневные траты)»: a column only when there is one (it is in «Расходы»)
  const reserve = f.months.some((m) => m.reserve !== 0);
  const cushion = data.settings.cushion;
  const first = f.months[0];
  const last = f.months[f.months.length - 1];
  const period = `${first?.label ?? ''} – ${last?.label ?? ''}`;
  const startDay = monthStart(data.settings.forecastStart);
  const subtitle = `Начало прогноза ${ruDate(startDay)}: ${ruMoney(f.start)} · подушка ${ruMoney(cushion)} · ${generated(generatedOn)}`;

  addTable(wb, 'Месяцы', {
    title: `Прогноз по месяцам — ${period}`,
    subtitle,
    columns: [
      { header: 'Месяц', kind: 'text' },
      { header: 'Доходы', kind: 'money' },
      { header: 'Расходы', kind: 'money' },
      { header: 'Постоянные', kind: 'money' },
      { header: 'Разовые', kind: 'money' },
      { header: 'Покупки', kind: 'money' },
      ...(reserve ? [{ header: RESERVE, kind: 'money' } as const] : []),
      { header: TRANSFERS, kind: 'money' },
      { header: 'Остаток на конец', kind: 'money' },
      { header: 'Запас над подушкой', kind: 'money' },
    ],
    rows: f.months.map((m): Value[] => [
      m.label, m.income, m.expenses, m.recurring, m.oneOff, m.purchases, ...(reserve ? [m.reserve] : []), m.transfers, m.end,
      m.overCushion,
    ]),
    notes: [
      { label: 'На начало прогноза', values: [[f.start, 'money']] },
      { label: 'Подушка', values: [[cushion, 'money']] },
    ],
  });

  const weeks = f.weeks;
  addTable(wb, 'Недели', {
    title: `Прогноз по неделям — ${ruDate(weeks[0]?.from ?? startDay)} – ${ruDate(weeks[weeks.length - 1]?.to ?? startDay)}`,
    subtitle,
    columns: [
      { header: 'Неделя', kind: 'text' },
      { header: 'С', kind: 'date' },
      { header: 'По', kind: 'date' },
      { header: 'Доходы', kind: 'money' },
      { header: 'Расходы', kind: 'money' },
      ...(reserve ? [{ header: RESERVE, kind: 'money' } as const] : []),
      { header: TRANSFERS, kind: 'money' },
      { header: 'Остаток на конец', kind: 'money' },
      { header: 'Ниже подушки', kind: 'text' },
    ],
    // below the cushion exactly as the engine counts f.weeksBelow
    rows: weeks.map((w): Value[] => [
      w.n, w.from, w.to, w.income, w.expenses, ...(reserve ? [w.reserve] : []), w.transfers, w.end, w.end < w.cushion ? BELOW : null,
    ]),
    filter: true,
    notes: [
      { label: 'Недель ниже подушки', values: [[f.weeksBelow, 'text']] },
      { label: 'Минимальный остаток', values: [[f.minEnd, 'money'], [f.minWeekFrom, 'date']] },
    ],
  });

  return toFile(wb, `Прогноз — ${period}.xlsx`);
}
