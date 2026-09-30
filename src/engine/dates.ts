// Date helpers on 'YYYY-MM-DD' / 'YYYY-MM' strings. Integer arithmetic only — no Date objects,
// so there are no time-zone shifts.
import type { ISODate, Settings, YM } from './model';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

function parseYM(ym: YM): [number, number] {
  return [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
}

function makeYM(year: number, month: number): YM {
  return `${pad4(year)}-${pad2(month)}`;
}

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Days since 1970-01-01 for a civil date and back (proleptic Gregorian calendar).
function toDayNumber(d: ISODate): number {
  let y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(n: number): ISODate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${pad4(y)}-${pad2(m)}-${pad2(day)}`;
}

export function ymOf(d: ISODate): YM {
  return d.slice(0, 7);
}

export function addMonths(ym: YM, n: number): YM {
  const [y, m] = parseYM(ym);
  const total = y * 12 + (m - 1) + n;
  return makeYM(Math.floor(total / 12), (((total % 12) + 12) % 12) + 1);
}

/** Months from a to b (b − a). */
export function monthDiff(a: YM, b: YM): number {
  const [ya, ma] = parseYM(a);
  const [yb, mb] = parseYM(b);
  return (yb * 12 + mb) - (ya * 12 + ma);
}

export function daysInMonth(ym: YM): number {
  const [y, m] = parseYM(ym);
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

export function monthStart(ym: YM): ISODate {
  return `${ym}-01`;
}

export function monthEnd(ym: YM): ISODate {
  return `${ym}-${pad2(daysInMonth(ym))}`;
}

/** Date in month `ym` on `day`, clamped to 1..month length (day 31 in February → 28/29). */
export function dateIn(ym: YM, day: number): ISODate {
  return `${ym}-${pad2(Math.min(Math.max(1, Math.trunc(day)), daysInMonth(ym)))}`;
}

/** Credit-card statement and payment days are kept within 1..28. */
export function clampDay(n: number): number {
  return Math.max(1, Math.min(28, n));
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDayNumber(toDayNumber(d) + n);
}

export function mondayOnOrBefore(d: ISODate): ISODate {
  const n = toDayNumber(d);
  const sinceMonday = (((n + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday
  return fromDayNumber(n - sinceMonday);
}

export function accountingMonths(s: Settings): YM[] {
  return Array.from({ length: 12 }, (_, k) => addMonths(s.accountingStart, k));
}

export function forecastMonths(s: Settings): YM[] {
  return Array.from({ length: 3 }, (_, k) => addMonths(s.forecastStart, k));
}

export function inAccountingYear(ym: YM, s: Settings): boolean {
  const k = monthDiff(s.accountingStart, ym);
  return k >= 0 && k < 12;
}

/** '2026-10' → 'Октябрь 2026'. */
export function monthLabel(ym: YM): string {
  const [y, m] = parseYM(ym);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** 'Октябрь 2026' → '2026-10'; null when the text is not a month label. */
export function parseMonthLabel(label: string): YM | null {
  const match = /^\s*(\S+)\s+(\d{4})\s*$/.exec(label);
  if (!match) return null;
  const name = (match[1] ?? '').toLowerCase();
  const index = MONTH_NAMES.findIndex((n) => n.toLowerCase() === name);
  if (index < 0) return null;
  return makeYM(Number(match[2]), index + 1);
}
