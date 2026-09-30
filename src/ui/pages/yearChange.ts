// What moving the accounting year («Учёт с») does to the data (page «Настройки»), from the engine's own
// rules: recurring marks count only inside the 12 accounting months (in reports and in balances);
// journal rows (by «Месяц учёта») and operations outside them leave the feed and the reports, but still
// count in the balances — from «Дата остатков» on (journal rows by accounting month, operations by date).
import { balances, dateInBalances, inAccountingYear, journalMonth, monthInBalances, ymOf } from '../../engine';
import type { Data, ISODate, YM } from '../../engine';
import { plural } from './usageText';

export interface OutOfYear {
  marks: number;
  journal: number;
  operations: number;
}

const withStart = (d: Data, accountingStart: YM): Data => ({ ...d, settings: { ...d.settings, accountingStart } });

/** Recurring marks, journal rows and operations outside the accounting year that starts at `accountingStart`. */
export function outOfYear(d: Data, accountingStart: YM): OutOfYear {
  const s = withStart(d, accountingStart).settings;
  const outside = (ym: YM) => !inAccountingYear(ym, s);
  return {
    marks: d.recurring.reduce((n, r) => n + Object.keys(r.marks).filter(outside).length, 0),
    journal: d.journal.filter((r) => outside(journalMonth(r, s))).length,
    operations: d.operations.filter((o) => outside(ymOf(o.date))).length,
  };
}

/** Whether any account balance of `today` differs once the accounting year starts at `accountingStart`. */
function balancesChange(d: Data, accountingStart: YM, today: ISODate): boolean {
  const before = balances(d, today).rows;
  const after = balances(withStart(d, accountingStart), today).rows;
  return before.some((r, i) => Math.abs(r.now - (after[i]?.now ?? r.now)) >= 0.005);
}

/**
 * The note shown while a new accounting year is chosen: «Вне учётного года: 4 отметки в постоянных,
 * 10 плановых записей, 6 операций — их не будет в ленте и отчётах, а отметки не попадут и в остатки.
 * Остатки счетов изменятся.»
 */
export function yearChangeNote(d: Data, accountingStart: YM, today: ISODate): string {
  const out = outOfYear(d, accountingStart);
  const rows = out.journal + out.operations;
  const count = (n: number, forms: readonly [string, string, string], tail = '') =>
    n > 0 ? [`${n} ${plural(n, forms)}${tail}`] : [];
  const parts = [
    ...count(out.marks, ['отметка', 'отметки', 'отметок'], ' в постоянных'),
    ...count(out.journal, ['плановая запись', 'плановые записи', 'плановых записей']),
    ...count(out.operations, ['операция', 'операции', 'операций']),
  ];
  let text: string;
  if (parts.length === 0) text = 'Все отметки, плановые записи и операции останутся в учётном году.';
  else if (out.marks === 0) text = `Вне учётного года: ${parts.join(', ')} — их не будет в ленте и отчётах.`;
  else if (rows === 0) text = `Вне учётного года: ${parts.join(', ')} — они не попадут ни в отчёты, ни в остатки.`;
  else {
    text = `Вне учётного года: ${parts.join(', ')} — их не будет в ленте и отчётах, а отметки не попадут и в остатки.`;
  }
  return balancesChange(d, accountingStart, today) ? `${text} Остатки счетов изменятся.` : text;
}

/** Journal rows and operations outside the accounting year as it is that the balances do not count either (before «Дата остатков»). */
function outOfYearBeforeBalances(d: Data): number {
  const s = d.settings;
  const journal = d.journal.filter((r) => {
    const month = journalMonth(r, s);
    return !inAccountingYear(month, s) && !monthInBalances(month, s);
  }).length;
  const operations = d.operations.filter((o) => !inAccountingYear(ymOf(o.date), s) && !dateInBalances(o.date, s)).length;
  return journal + operations;
}

/**
 * On «Учёт и прогноз» while records lie outside the accounting year as it is (the rows «Сегодня» counts
 * «вне учётного года»: journal rows by «Месяц учёта», operations by date): what that means and how to see
 * them. The balances count them only from «Дата остатков» on (the engine's rule), so the note says which.
 * Undefined when there are none.
 */
export function outOfYearNote(d: Data): string | undefined {
  const out = outOfYear(d, d.settings.accountingStart);
  const parts = [
    ...(out.journal > 0 ? [`${out.journal} ${plural(out.journal, ['плановая запись', 'плановые записи', 'плановых записей'])}`] : []),
    ...(out.operations > 0 ? [`${out.operations} ${plural(out.operations, ['операция', 'операции', 'операций'])}`] : []),
  ];
  if (parts.length === 0) return undefined;
  const total = out.journal + out.operations;
  const before = outOfYearBeforeBalances(d);
  const head = `Вне учётного года: ${parts.join(', ')}. `;
  const see = 'Чтобы увидеть их в ленте и отчётах, выберите учётный год, в который они входят.';
  if (before === 0) {
    return `${head}Такие записи учтены в остатках, но не попадают в ленту и отчёты. Чтобы увидеть их там, выберите учётный год, в который они входят.`;
  }
  if (before === total) {
    return `${head}Такие записи не попадают ни в остатки (они раньше даты остатков), ни в ленту и отчёты. ${see}`;
  }
  return (
    `${head}Такие записи не попадают в ленту и отчёты, а в остатках учтены только те, что не раньше даты остатков ` +
    `(${total - before} из ${total}). ${see}`
  );
}
