// Three-month cash forecast and 13 weekly balances, as on the tracker's «Прогноз» sheet.
// Months: journal by accounting month, everything else by date.
// Weeks count the same rows as the months — nothing that is already inside the money at the
// forecast start — placed by date: journal rows of accounting month ≥ the forecast start month
// (a row dated before the start lands in the week of the start), everything else dated on or
// after the start. Recurring payments count only on their dates inside the 3 forecast months.
// Only free money: a row of a savings account moves nothing; a transfer across the line between the balance and
// savings (and the credit card paid from savings) is `transfers` — neither income nor an expense.
import { balanceCheck, cashAtForecastStart, freeMoneyMoves, freeMoneyTransfers } from './accounts';
import type { FreeMoneyMove } from './accounts';
import { addDays, forecastMonths, mondayOnOrBefore, monthEnd, monthLabel, monthStart } from './dates';
import type { Data, ISODate, JournalRow, YM } from './model';
import { opt } from './opt';
import { journalExpected, journalMonth, opAmount, purchaseExpected, recurringDate, recurringExpected } from './rules';

export interface Flows {
  income: number;
  recurring: number; // recurring expenses
  oneOff: number; // journal expenses + expense operations
  purchases: number;
  transfers: number; // «Переводы в сбережения (−) / из сбережений (+)»: not income, not an expense
}

export interface ForecastMonth extends Flows {
  ym: YM;
  label: string;
  from: ISODate;
  to: ISODate;
  expenses: number;
  free: number; // income − expenses
  end: number; // the previous end + free + transfers
  overCushion: number; // end − cushion
}

export interface ForecastWeek extends Flows {
  n: number; // 1..13
  from: ISODate; // Monday
  to: ISODate; // Sunday
  expenses: number;
  end: number; // the previous end + income − expenses + transfers
  cushion: number;
}

export interface Forecast {
  start: number;
  months: ForecastMonth[];
  weeks: ForecastWeek[];
  minEnd: number; // lowest weekly end
  minWeekFrom: ISODate; // first week with the lowest end
  weeksBelow: number; // weeks ending below the cushion
  freeTotal: number;
  expensesTotal: number;
}

const WEEKS = 13;

/** What `flows` needs once per forecast: which rows count (not of a savings account) and the moves across the line. */
interface Scope {
  counts: (id: string | undefined) => boolean;
  moves: FreeMoneyMove[];
}

function flows(data: Data, scope: Scope, from: ISODate, to: ISODate, journalIn: (r: JournalRow) => boolean): Flows {
  const s = data.settings;
  const inRange = (d: ISODate | undefined): boolean => {
    const day = opt(d);
    return day !== undefined && day >= from && day <= to;
  };
  const { counts } = scope;
  const f: Flows = { income: 0, recurring: 0, oneOff: 0, purchases: 0, transfers: freeMoneyTransfers(data, from, to, scope.moves) };
  for (const r of data.journal) {
    if (!journalIn(r) || !counts(r.account)) continue;
    if (r.kind === 'income') f.income += journalExpected(r);
    else f.oneOff += journalExpected(r);
  }
  for (const ym of forecastMonths(s)) {
    for (const rec of data.recurring) {
      if (!inRange(recurringDate(rec, ym)) || !counts(rec.account)) continue;
      if (rec.kind === 'income') f.income += recurringExpected(rec, ym, s);
      else f.recurring += recurringExpected(rec, ym, s);
    }
  }
  for (const o of data.operations) {
    if (o.kind === 'transfer' || !inRange(o.date) || !counts(o.account)) continue;
    if (o.kind === 'income') f.income += opAmount(o);
    else f.oneOff += opAmount(o);
  }
  for (const p of data.purchases) {
    if (inRange(p.date) && counts(p.account)) f.purchases += purchaseExpected(p);
  }
  return f;
}

export function forecast(data: Data): Forecast {
  const s = data.settings;
  const scope: Scope = { counts: balanceCheck(data), moves: freeMoneyMoves(data) };
  const start = cashAtForecastStart(data, scope.moves);

  let end = start;
  const months = forecastMonths(s).map((ym): ForecastMonth => {
    const from = monthStart(ym);
    const to = monthEnd(ym);
    const f = flows(data, scope, from, to, (r) => journalMonth(r, s) === ym);
    const expenses = f.recurring + f.oneOff + f.purchases;
    const free = f.income - expenses;
    end += free + f.transfers;
    return { ym, label: monthLabel(ym), from, to, ...f, expenses, free, end, overCushion: end - s.cushion };
  });

  const fs = monthStart(s.forecastStart);
  const firstMonday = mondayOnOrBefore(fs);
  const journalAt = (r: JournalRow): ISODate | undefined =>
    journalMonth(r, s) >= s.forecastStart ? (r.date < fs ? fs : r.date) : undefined;
  let weekEnd = start;
  const weeks = Array.from({ length: WEEKS }, (_, i): ForecastWeek => {
    const from = addDays(firstMonday, 7 * i);
    const to = addDays(from, 6);
    const at = (r: JournalRow): boolean => {
      const d = journalAt(r);
      return d !== undefined && d >= from && d <= to;
    };
    const f = flows(data, scope, from < fs ? fs : from, to, at);
    const expenses = f.recurring + f.oneOff + f.purchases;
    weekEnd += f.income - expenses + f.transfers;
    return { n: i + 1, from, to, ...f, expenses, end: weekEnd, cushion: s.cushion };
  });

  let minEnd = Infinity;
  let minWeekFrom = firstMonday;
  for (const w of weeks) {
    if (w.end < minEnd) {
      minEnd = w.end;
      minWeekFrom = w.from;
    }
  }

  return {
    start,
    months,
    weeks,
    minEnd,
    minWeekFrom,
    weeksBelow: weeks.filter((w) => w.end < w.cushion).length,
    freeTotal: months.reduce((acc, m) => acc + m.free, 0),
    expensesTotal: months.reduce((acc, m) => acc + m.expenses, 0),
  };
}
