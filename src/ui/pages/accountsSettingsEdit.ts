// Changes of the accounts and the credit-card settings («Счета и кредитка»). Rows refer to an account
// by id, so renaming is free; an account that any row (or the credit settings) still uses is never
// removed. The credit settings «use» an account the way the engine does: while auto-payments run, the
// card they repay and the account they come from — chosen or by default (creditCardId / payFromId).
// Never in place: every function returns a new Data (or the same one when nothing changes).
import { clampDay, creditCardId, opt, payFromId } from '../../engine';
import type { Account, AccountType, CreditSettings, Data } from '../../engine';
import { rowCountsText } from './usageText';
import type { RowCounts } from './usageText';

export type CreditField = 'Карта' | 'Со счёта';

export interface AccountUsage extends RowCounts {
  /** Fields of the credit settings that name this account: «Карта», «Со счёта». */
  credit: CreditField[];
  total: number;
}

/**
 * The card and the account auto-payments run between — as the engine picks them (chosen, else the
 * first credit / first other account) — or nothing when no auto-payment is made (switched off, or no
 * card or no account to pay from). Only these accounts carry money through the credit settings.
 */
export function autoPayAccounts(d: Data): { card?: string; payer?: string } {
  if (!d.credit.auto) return {};
  const card = creditCardId(d);
  const payer = payFromId(d);
  const exists = (id: string | undefined): id is string => id !== undefined && d.accounts.some((a) => a.id === id);
  return exists(card) && exists(payer) ? { card, payer } : {};
}

/** What uses account `id`: rows by source (a transfer counts on either end) and the credit settings. */
export function accountUsage(d: Data, id: string): AccountUsage {
  const is = (v: string | undefined) => opt(v) === id;
  const operations = d.operations.filter((o) => is(o.account) || is(o.toAccount)).length;
  const journal = d.journal.filter((r) => is(r.account)).length;
  const recurring = d.recurring.filter((r) => is(r.account)).length;
  const purchases = d.purchases.filter((p) => is(p.account)).length;
  const auto = autoPayAccounts(d);
  const credit: CreditField[] = [];
  if (auto.card === id) credit.push('Карта');
  if (auto.payer === id) credit.push('Со счёта');
  return { operations, journal, recurring, purchases, credit, total: operations + journal + recurring + purchases + credit.length };
}

const CREDIT_WAY_OUT = 'выберите там другой счёт или выключите «Гасится автоматически»';

/**
 * Why the account cannot be deleted and how to free it, in a form that fits any count: «Счёт нельзя
 * удалить. На нём: 1 покупка — укажите в них другой счёт. Он выбран в настройках кредитки («Со
 * счёта») — выберите там другой счёт или выключите «Гасится автоматически».»
 */
export function accountBlockText(u: AccountUsage): string {
  const parts = ['Счёт нельзя удалить.'];
  const rows = rowCountsText(u);
  if (rows.length > 0) parts.push(`На нём: ${rows.join(', ')} — укажите в них другой счёт.`);
  if (u.credit.length > 0) {
    parts.push(`Он выбран в настройках кредитки (${u.credit.map((f) => `«${f}»`).join(', ')}) — ${CREDIT_WAY_OUT}.`);
  }
  return parts.join(' ');
}

const key = (name: string): string => name.trim().toLocaleLowerCase('ru');

/** Why `name` cannot be an account name (`id`: the account being renamed), or undefined. */
export function accountNameError(d: Data, name: string | undefined, id?: string): string | undefined {
  if (name === undefined || name.trim() === '') return 'Введите название';
  const k = key(name);
  return d.accounts.some((a) => a.id !== id && key(a.name) === k) ? 'Такой счёт уже есть' : undefined;
}

export type AccountFields = Omit<Account, 'id'>;

/** Adds an account at the end (the name trimmed). */
export function addAccount(d: Data, fields: AccountFields, id: string): Data {
  return { ...d, accounts: [...d.accounts, { id, name: fields.name.trim(), type: fields.type, start: fields.start }] };
}

/**
 * Why account `id` cannot take `type`, or undefined: while auto-payments run, the card they repay must
 * stay a credit card and the account they come from must not become one (the engine would then pick
 * other accounts by default, or run the payments through a wrong kind of account).
 */
export function accountTypeError(d: Data, id: string, type: AccountType): string | undefined {
  const auto = autoPayAccounts(d);
  let field: CreditField | undefined;
  if (auto.card === id && type !== 'credit') field = 'Карта';
  else if (auto.payer === id && type === 'credit') field = 'Со счёта';
  return field && `Тип не сменить: счёт выбран в настройках кредитки («${field}») — ${CREDIT_WAY_OUT}.`;
}

/**
 * `next` (the accounts reordered or changed) with the card and the account auto-payments ran between in
 * `prev`: when the default pick (the first credit / first other account) would now land elsewhere, the
 * old accounts are chosen explicitly — a reorder or another account's new type never moves the payments.
 */
function keepAutoPay(prev: Data, next: Data): Data {
  const was = autoPayAccounts(prev);
  if (was.card === undefined || was.payer === undefined) return next;
  const typeOf = (id: string) => next.accounts.find((a) => a.id === id)?.type;
  let credit = next.credit;
  if (creditCardId(next) !== was.card && typeOf(was.card) === 'credit') credit = { ...credit, accountId: was.card };
  const payerType = typeOf(was.payer);
  if (payFromId({ ...next, credit }) !== was.payer && payerType !== undefined && payerType !== 'credit') {
    credit = { ...credit, fromAccountId: was.payer };
  }
  return credit === next.credit ? next : { ...next, credit };
}

/**
 * Changes name, type and start of account `id`; the rows keep pointing to it by id. Throws when the
 * credit settings need its type (accountTypeError). An explicit choice of it in the credit settings
 * that its new type no longer fits (only possible while no auto-payment uses it) is cleared.
 */
export function updateAccount(d: Data, id: string, fields: AccountFields): Data {
  if (accountTypeError(d, id, fields.type) !== undefined) throw new Error('the credit settings need this type');
  const accounts = d.accounts.map((a) =>
    a.id === id ? { id, name: fields.name.trim(), type: fields.type, start: fields.start } : a,
  );
  const staleCard = opt(d.credit.accountId) === id && fields.type !== 'credit';
  const staleFrom = opt(d.credit.fromAccountId) === id && fields.type === 'credit';
  let credit = d.credit;
  if (staleCard || staleFrom) {
    credit = { ...credit };
    if (staleCard) delete credit.accountId;
    if (staleFrom) delete credit.fromAccountId;
  }
  return keepAutoPay(d, { ...d, accounts, credit });
}

/**
 * Removes account `id`; throws while anything still uses it (see accountUsage). An explicit choice of
 * it in the credit settings that no auto-payment uses (switched off) goes with it — never left dangling.
 */
export function removeAccount(d: Data, id: string): Data {
  if (accountUsage(d, id).total > 0) throw new Error('the account is still used');
  const accounts = d.accounts.filter((a) => a.id !== id);
  const card = opt(d.credit.accountId) === id;
  const from = opt(d.credit.fromAccountId) === id;
  if (!card && !from) return { ...d, accounts };
  const credit = { ...d.credit };
  if (card) delete credit.accountId;
  if (from) delete credit.fromAccountId;
  return { ...d, accounts, credit };
}

/**
 * Moves the account at `index` one place up (-1) or down (1); the same Data at the ends. The auto-payments
 * keep their accounts (see keepAutoPay).
 */
export function moveAccount(d: Data, index: number, delta: -1 | 1): Data {
  const to = index + delta;
  if (index < 0 || index >= d.accounts.length || to < 0 || to >= d.accounts.length) return d;
  const accounts = [...d.accounts];
  const [a] = accounts.splice(index, 1);
  accounts.splice(to, 0, a as Account);
  return keepAutoPay(d, { ...d, accounts });
}

/** Changes the credit-card settings; the statement and payment days are kept within 1..28. */
export function setCredit(d: Data, patch: Partial<CreditSettings>): Data {
  const credit: CreditSettings = { ...d.credit, ...patch };
  credit.closeDay = clampDay(credit.closeDay);
  credit.payDay = clampDay(credit.payDay);
  return { ...d, credit };
}
