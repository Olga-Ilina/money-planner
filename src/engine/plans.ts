// Rules of the tracker's plan sheets that the screens show: «Постоянные» (the average per month),
// «Покупки» («Хватит ли денег», «Осталось накопить») and «Долги» (what is left, the status).
import { inBalance } from './transfers';
import type { Forecast } from './forecast';
import type { Data, Debt, Purchase, Recurring } from './model';
import { roundCents } from './money';
import { opt } from './opt';

/** «В среднем в месяц» of «Постоянные»: Σ amount / every (blank or ≤ 1 = every month) over one kind. */
export function monthlyAverage(rows: readonly Recurring[], kind: Recurring['kind']): number {
  return rows.reduce((sum, r) => (r.kind === kind ? sum + r.amount / Math.max(1, r.every ?? 1) : sum), 0);
}

/** «Хватит ли денег» of «Покупки»: «Куплено», «Из сбережений», «Хватает», «Не хватает», «Вне прогноза». */
export type PurchaseStatus = 'bought' | 'savings' | 'enough' | 'short' | 'outside';

/**
 * «Хватит ли денег» of the tracker: bought → «Куплено»; no date → nothing (null); bought from a savings account →
 * «Из сбережений» (the money comes from savings: the free money of the forecast, which leaves such a purchase out, is
 * not compared with the cushion — nor is the savings balance); a date outside the 13 forecast weeks → «Вне прогноза»;
 * else the end of the week holding the date against the cushion (≥ → «Хватает», < → «Не хватает»).
 * `data` tells the savings accounts (`inBalance`).
 */
export function purchaseStatus(p: Purchase, fc: Forecast, data: Pick<Data, 'accounts'>): PurchaseStatus | null {
  if (p.bought) return 'bought';
  const date = opt(p.date);
  if (date === undefined) return null;
  if (!inBalance(data, p.account)) return 'savings';
  const week = fc.weeks.find((w) => date >= w.from && date <= w.to);
  if (!week) return 'outside';
  return week.end >= week.cushion ? 'enough' : 'short';
}

/** «Осталось накопить» of «Покупки»: Σ (cost − saved), each never below 0, over the purchases not yet bought. */
export function leftToSave(purchases: readonly Purchase[]): number {
  return purchases.reduce((s, p) => (p.bought ? s : s + Math.max((p.cost ?? 0) - (p.saved ?? 0), 0)), 0);
}

/** «Остаток» of «Долги»: total − paid (in cents), never below 0; undefined without a total. */
export function debtLeft(x: Debt): number | undefined {
  return x.total === undefined ? undefined : Math.max(roundCents(x.total - (x.paid ?? 0)), 0);
}

/** «Статус» of «Долги», as the tracker writes it. */
export type DebtStatus = 'Закрыт' | 'В работе' | 'Не начат';

/** «Статус» of the tracker: nothing left → «Закрыт», something paid → «В работе», else «Не начат». */
export function debtStatus(x: Debt): DebtStatus | undefined {
  const left = debtLeft(x);
  if (left === undefined) return undefined;
  if (left <= 0) return 'Закрыт';
  return (x.paid ?? 0) > 0 ? 'В работе' : 'Не начат';
}

/** Not closed, as debtStatus sees it: something is left, or there is no total to tell. */
export function isDebtOpen(x: Debt): boolean {
  const left = debtLeft(x);
  return left === undefined || left > 0;
}
