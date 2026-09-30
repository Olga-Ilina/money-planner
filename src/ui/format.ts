// Display formats of the app: euro amounts the Russian way ('1 234,56 €'), dates as 'дд.мм.гггг'
// or '30 сентября', and today's LOCAL calendar date. Dates are model strings ('YYYY-MM-DD') and are
// never turned into Date objects, so no time zone can shift them.
import { roundCents } from '../engine';
import type { ISODate } from '../engine';

/** Rounded to cents, half away from zero (the engine's rounding; -12.345 → -12.35, never -0). */
export { roundCents };

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' });

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** '1 234,56 €' (no-break spaces); `signed` adds '+' to positive amounts. */
export function formatMoney(n: number, opts: { signed?: boolean } = {}): string {
  const v = roundCents(n);
  const text = money.format(v);
  return opts.signed && v > 0 ? `+${text}` : text;
}

/** True when the rounded amount is below zero (what formatMoney shows with a minus). */
export function isNegativeMoney(n: number): boolean {
  return roundCents(n) < 0;
}

function parts(iso: ISODate): [number, number, number] | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/** '2026-09-30' → '30.09.2026'; anything that is not a date comes back unchanged. */
export function formatDate(iso: ISODate): string {
  const m = ISO_DATE.exec(iso);
  if (!m || !parts(iso)) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** '2026-12-10' → '10.12' (a date inside a line, the year is clear from the context); non-dates come back unchanged. */
export function formatShortDate(iso: ISODate): string {
  const m = ISO_DATE.exec(iso);
  if (!m || !parts(iso)) return iso;
  return `${m[3]}.${m[2]}`;
}

/** '2026-09-30' → '30 сентября' (with `year`: '30 сентября 2026'); non-dates come back unchanged. */
export function formatDay(iso: ISODate, opts: { year?: boolean } = {}): string {
  const p = parts(iso);
  if (!p) return iso;
  const [y, mo, d] = p;
  const text = `${d} ${MONTHS_GENITIVE[mo - 1]}`;
  return opts.year ? `${text} ${y}` : text;
}

/** Day of the week of a calendar date, 0 = Sunday (Sakamoto's method: integer arithmetic, no Date). */
function weekday(y: number, m: number, d: number): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const yy = m < 3 ? y - 1 : y;
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + (t[m - 1] ?? 0) + d) % 7;
}

/** '2026-09-30' → 'Среда, 30 сентября' (the «Сегодня» subtitle); non-dates come back unchanged. */
export function formatWeekdayDate(iso: ISODate): string {
  const p = parts(iso);
  if (!p) return iso;
  const [y, mo, d] = p;
  return `${WEEKDAYS[weekday(y, mo, d)]}, ${formatDay(iso)}`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The LOCAL calendar date 'YYYY-MM-DD' (not the UTC date) of `now` — today by default, or any moment,
 * e.g. todayISO(new Date(stamp)). Prefer the reactive today() from state.ts in components.
 */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * The local calendar date of a stored timestamp such as meta.lastBackupAt ('2026-09-30T22:30:00.000Z'
 * → '2026-10-01' in Auckland); undefined when there is none or it cannot be read. Show it with formatDate.
 */
export function localDateOf(stamp: string | undefined): ISODate | undefined {
  if (!stamp) return undefined;
  const t = Date.parse(stamp);
  return Number.isFinite(t) ? todayISO(new Date(t)) : undefined;
}
