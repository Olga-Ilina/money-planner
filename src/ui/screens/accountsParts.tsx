// Pieces shared by «Счета», the account page and «Кредитка» (owner D3): account type icons, the
// credit card and its next auto-payment, the default month and the «Счета и движения» export.
import { useRef, useState } from 'preact/hooks';
import { accountMovements, accountingMonths, addDays, creditCardId, nextCreditDebit, payFromId, ymOf } from '../../engine';
import type { Account, AccountType, Data, ISODate, YM } from '../../engine';
import { formatDay, formatMoney } from '../format';
import { ioErrorMessage, loadReports } from '../io';
import { Icon, Row, showToast } from '../kit';
import type { IconName } from '../kit';
import { pushPage } from '../nav';
import { shareFile } from '../share';
import { appData, clampMonth, today } from '../state';
import type { Tab } from '../state';

export const TYPE_ICON: Record<AccountType, IconName> = {
  debit: 'card',
  cash: 'cash',
  credit: 'card',
  savings: 'wallet',
};

/** The credit card the statements are for; undefined without one (or when the setting names a deleted account). */
export function creditCard(d: Data): Account | undefined {
  const id = creditCardId(d);
  return id === undefined ? undefined : d.accounts.find((a) => a.id === id);
}

/** Auto-payments are made: switched on and there is an account to take them from. */
export function autoPays(d: Data): boolean {
  return d.credit.auto && payFromId(d) !== undefined;
}

/** «10 ноября списывать нечего»: the next debit date has a statement with no debt. */
export function nothingToDebitText(date: ISODate): string {
  return `${formatDay(date)} списывать нечего`;
}

/**
 * «Спишется 10 декабря: 300,00 €» — a credit card debit, the one format for «Счета» and «Сегодня»
 * («Списано …» on the debit day itself: it is already made).
 */
export function debitText(debit: { date: ISODate; amount: number }, day: ISODate): string {
  return `${debit.date <= day ? 'Списано' : 'Спишется'} ${formatDay(debit.date)}: ${formatMoney(debit.amount)}`;
}

/** One line about the next auto-payment of the credit card (on the debit day itself it is already made). */
export function nextDebitText(d: Data, day: ISODate): string {
  if (!d.credit.auto) return 'Автопогашение выключено';
  if (payFromId(d) === undefined) return 'Автопогашение не работает: нет счёта';
  const next = nextCreditDebit(d, day);
  if (!next) return 'До конца учётного года списаний нет';
  if (next.amount <= 0) return nothingToDebitText(next.date);
  return debitText(next, day);
}

/** Under «Сейчас» when it includes records dated after today. */
export const FUTURE_NOTE = 'включая записи на будущие даты';

/** After every date a record can have. */
const NO_END: ISODate = '9999-12-31';

/** The balance at the start of day `from`: the account's start plus every counted movement dated before it. */
export function balanceBefore(d: Data, id: string, from: ISODate, day: ISODate): number {
  const earlier = accountMovements(d, id, '0000-01-01', addDays(from, -1), day);
  const last = earlier[earlier.length - 1];
  return last ? last.running : (d.accounts.find((a) => a.id === id)?.start ?? 0);
}

/**
 * «Сейчас» counts every recorded fact from the balances date on (the tracker's rule), also records dated
 * after today, so it can differ from the running balance of a month. When the account has such records
 * this is its balance on today (what the running balance shows); otherwise undefined.
 */
export function balanceOnToday(d: Data, id: string, day: ISODate): number | undefined {
  const tomorrow = addDays(day, 1);
  if (accountMovements(d, id, tomorrow, NO_END, day).length === 0) return undefined;
  return balanceBefore(d, id, tomorrow, day);
}

/** The month shown by default: the current one, or the nearest accounting month when today is outside the year. */
export function defaultMonth(d: Data, day: ISODate): YM {
  const current = ymOf(day);
  return clampMonth(current, accountingMonths(d.settings), current);
}

/** «Выписки и списания ›» with the next auto-payment under it; opens the page «Кредитка» in `tab`. */
export function CreditStatementsRow({ tab }: { tab: Tab }) {
  return (
    <Row
      icon="calendar"
      title="Выписки и списания"
      subtitle={nextDebitText(appData(), today())}
      chevron
      onClick={() => pushPage(tab, 'credit')}
    />
  );
}

/**
 * The download button of «Счета»: balances, the movements of month `ym` and the statements as .xlsx,
 * handed to the share sheet. Disabled while the file is made; a failure is shown in a toast.
 */
export function ExportButton({ ym }: { ym: YM }) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const d = appData();
    const day = today();
    try {
      const { accountsReport } = await loadReports();
      const { filename, buffer } = await accountsReport(d, day, ym);
      await shareFile(filename, buffer);
    } catch (e) {
      showToast(ioErrorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      class="icon-button"
      aria-label="Выгрузить счета и движения"
      disabled={busy}
      onClick={() => void run()}
    >
      <Icon name="download" />
    </button>
  );
}
