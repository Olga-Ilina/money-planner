// Page of one account (registered as 'account', params { id }; owner D3): how its balance now is
// made up, and the movements of a month with the running balance (spec §5 «Счета»).
import { signal } from '@preact/signals';
import { useContext } from 'preact/hooks';
import {
  ACCOUNT_TYPE_LABEL, KIND_LABEL, MOVEMENT_SOURCE_LABEL, accountMovements, accountingMonths, balances, creditCardId, monthEnd,
  monthStart, opt, ymOf,
} from '../../engine';
import type { Data, Movement, YM } from '../../engine';
import { formatDate, formatDay } from '../format';
import { EmptyState, Money, MonthPicker, Page, Row, Section, StatCard, StatGrid } from '../kit';
import type { IconName } from '../kit';
import { PageContext, pushPage } from '../nav';
import type { RoutedPageProps } from '../nav';
import { CreditStatementsRow, ExportButton, FUTURE_NOTE, balanceBefore, balanceOnToday } from '../screens/accountsParts';
import { openSheet } from '../sheets/host';
import { appData, clampMonth, onResetSession, today } from '../state';
import type { Tab } from '../state';
import './AccountPage.css';

/** The month chosen on an account page (shared by all accounts); null = the current month. */
const chosenMonth = signal<YM | null>(null);
onResetSession(() => {
  chosenMonth.value = null;
});

export function AccountPage({ params }: RoutedPageProps) {
  const tab = useContext(PageContext)?.tab ?? 'accounts';
  const d = appData();
  const day = today();
  const account = d.accounts.find((a) => a.id === params.id);
  if (!account) {
    return (
      <Page title="Счёт">
        <EmptyState title="Счёт не найден" text="Возможно, его удалили." />
      </Page>
    );
  }

  const months = accountingMonths(d.settings);
  const current = ymOf(day);
  const ym = clampMonth(chosenMonth.value ?? current, months, current);
  const from = monthStart(ym);
  const to = monthEnd(ym);
  const moves = accountMovements(d, account.id, from, to, day);
  const opening = balanceBefore(d, account.id, from, day);
  const last = moves[moves.length - 1];
  const closing = last ? last.running : opening;
  const row = balances(d, day).rows.find((r) => r.id === account.id);
  const onToday = balanceOnToday(d, account.id, day);
  const undated = d.purchases.filter((p) => p.account === account.id && p.bought && opt(p.date) === undefined);

  return (
    <Page title={account.name} subtitle={ACCOUNT_TYPE_LABEL[account.type]} right={<ExportButton ym={ym} />}>
      {row && (
        <div class={`account-page-stats${onToday === undefined ? '' : ' account-page-stats-pair'}`}>
          <StatGrid columns={2}>
            <StatCard label="Сейчас" value={row.now} sub={onToday === undefined ? undefined : FUTURE_NOTE} />
            {onToday !== undefined && <StatCard label="На сегодня" value={onToday} />}
            <StatCard label="На начало" value={row.start} sub={`на ${formatDate(d.settings.balancesDate)}`} />
            <StatCard label="Поступления" value={row.income} />
            <StatCard label="Траты" value={row.expense} />
            <StatCard label="Переводы" value={row.transfers} />
          </StatGrid>
        </div>
      )}

      {account.id === creditCardId(d) && (
        <Section>
          <CreditStatementsRow tab={tab} />
        </Section>
      )}

      <div class="account-page-month">
        <MonthPicker value={ym} months={months} onChange={(m) => (chosenMonth.value = m)} />
      </div>

      <Section
        header="Движения"
        footer={
          undated.length > 0
            ? `Покупки без даты есть в остатке, но не в движениях: ${undated.map((p) => p.what || 'без названия').join(', ')}. Укажите дату покупки.`
            : undefined
        }
      >
        <Row title={<span class="account-page-edge">{`Остаток на ${formatDay(from)}`}</span>} value={<Money value={opening} />} />
        {moves.length === 0 ? (
          <Row title={<span class="account-page-none">Движений нет</span>} />
        ) : (
          moves.map((m, i) => <MovementRow key={`${m.source}-${m.id}-${m.ym ?? ''}-${i}`} d={d} m={m} tab={tab} />)
        )}
        <Row title={<span class="account-page-edge">{`Остаток на ${formatDay(to)}`}</span>} value={<Money value={closing} />} />
      </Section>
    </Page>
  );
}

function MovementRow({ d, m, tab }: { d: Data; m: Movement; tab: Tab }) {
  const op = m.source === 'operation' ? d.operations.find((o) => o.id === m.id) : undefined;
  const transfer = op?.kind === 'transfer';
  // where it comes from, in the app's words («Плановая запись», «Автопогашение»)
  const label = transfer ? KIND_LABEL.transfer : MOVEMENT_SOURCE_LABEL[m.source];
  const open = () => {
    if (m.source === 'repayment') pushPage(tab, 'credit');
    else if (m.source === 'recurring') openSheet('item', { item: { source: m.source, id: m.id, ym: m.ym } });
    else openSheet('item', { item: { source: m.source, id: m.id } });
  };
  return (
    <Row
      icon={movementIcon(m, op?.kind)}
      title={m.what || 'Без названия'}
      subtitle={`${formatDay(m.date)} · ${label}`}
      value={
        <span class="account-page-value">
          <span class={`account-page-amount${m.amount > 0 ? ' tone-green' : ''}`}>
            <Money value={m.amount} tone="plain" signed />
          </span>
          <span class="account-page-running">
            <span class="sr-only">, остаток </span>
            <Money value={m.running} />
          </span>
        </span>
      }
      onClick={open}
    />
  );
}

function movementIcon(m: Movement, kind: string | undefined): IconName {
  switch (m.source) {
    case 'operation':
      return kind === 'transfer' ? 'arrows' : kind === 'income' ? 'plus-circle' : 'cart';
    case 'journal':
      return 'calendar';
    case 'recurring':
      return 'repeat';
    case 'purchase':
      return 'cart';
    case 'repayment':
      return 'card';
  }
}
