// Transfers between the user's own accounts and savings accounts outside the balance (specs 2026-10-01-savings-accounts
// and 2026-10-01-planned-transfers): which accounts count in the balance, how a transfer moves the free money, and the
// tracker's checks of a row's type and accounts («Дубль или проверка»).
import type { Data, OpKind } from './model';
import { opt } from './opt';

/** What a transfer needs of a row: an operation, a journal row or a recurring payment. */
export interface TransferFields {
  kind: OpKind;
  account?: string;
  toAccount?: string;
}

/**
 * Whether a row of account `id` counts in the balance — in «Всего» and in the forecast: every account but a savings
 * one. A row without an account, or of an account that no longer exists, counts in the balance, as in the tracker
 * (its flag is 0 only for a name found among the «Сберегательная» accounts).
 */
export function inBalance(data: Pick<Data, 'accounts'>, id: string | undefined): boolean {
  return balanceCheck(data)(id);
}

/** `inBalance` for many rows: looks the savings accounts up once. */
export function balanceCheck(data: Pick<Data, 'accounts'>): (id: string | undefined) => boolean {
  const outside = new Set(data.accounts.filter((a) => a.type === 'savings').map((a) => a.id));
  return (id) => {
    const given = opt(id);
    return given === undefined || !outside.has(given);
  };
}

/**
 * How a transfer moves the free money, per unit of its amount: −1 from the balance into savings, +1 out of savings
 * into the balance, 0 inside one group or without «На счёт» (the tracker's helpers Операции U, Запланированные X,
 * Постоянные AM / AN). A transfer without «Со счёта» comes from the balance. An expense or an income: 0.
 */
export function freeMoneyFactor(data: Pick<Data, 'accounts'>, row: TransferFields): number {
  return transferFactor(balanceCheck(data), row);
}

/** `freeMoneyFactor` for many rows: `counts` is `balanceCheck(data)`, looked up once. */
export function transferFactor(counts: (id: string | undefined) => boolean, row: TransferFields): number {
  if (row.kind !== 'transfer' || opt(row.toAccount) === undefined) return 0;
  return Number(counts(row.toAccount)) - Number(counts(row.account));
}

/**
 * The tracker's checks of a row («Дубль или проверка» on «Операции» and «Запланированные»; the app checks
 * «Постоянные» too), in its order: an income to a savings account looks like a transfer from the user's own card; a
 * transfer needs «На счёт», and another account than «Со счёта». A row with a check is never marked as a duplicate.
 */
export type RowCheck = 'looksLikeTransfer' | 'noTarget' | 'sameAccount';

export function rowCheck(data: Pick<Data, 'accounts'>, row: TransferFields): RowCheck | null {
  const account = opt(row.account);
  const to = opt(row.toAccount);
  if (row.kind === 'income' && account !== undefined && !inBalance(data, account)) return 'looksLikeTransfer';
  if (row.kind !== 'transfer') return null;
  if (to === undefined) return 'noTarget';
  return to === account ? 'sameAccount' : null;
}
