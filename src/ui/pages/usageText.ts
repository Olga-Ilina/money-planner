// Texts of the «Ещё» pages: «3 операции, 10 плановых записей, …» (what still uses a category or an
// account) and month ranges («Октябрь 2026 — сентябрь 2027»).
import { monthLabel } from '../../engine';
import type { YM } from '../../engine';

/** '2026-10' → 'Октябрь'. */
export const monthName = (ym: YM): string => monthLabel(ym).split(' ')[0] ?? ym;

/** «Октябрь 2026 — сентябрь 2027» (also within one year): the one format of a month range, as in «Отчёты». */
export function monthRange(first: YM, last: YM): string {
  const second = monthLabel(last);
  return `${monthLabel(first)} — ${second.charAt(0).toLowerCase()}${second.slice(1)}`;
}

/** Russian plural: `forms` = [1, 2–4, 5+] («операция», «операции», «операций»). */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Rows of the data by source. */
export interface RowCounts {
  operations: number;
  journal: number;
  recurring: number;
  purchases: number;
}

const FORMS: Record<keyof RowCounts, readonly [string, string, string]> = {
  operations: ['операция', 'операции', 'операций'],
  journal: ['плановая запись', 'плановые записи', 'плановых записей'],
  recurring: ['постоянный платёж', 'постоянных платежа', 'постоянных платежей'],
  purchases: ['покупка', 'покупки', 'покупок'],
};

/** «2 операции, 5 плановых записей» — only the sources that have rows. */
export function rowCountsText(c: RowCounts): string[] {
  return (Object.keys(FORMS) as (keyof RowCounts)[])
    .filter((k) => c[k] > 0)
    .map((k) => `${c[k]} ${plural(c[k], FORMS[k])}`);
}
