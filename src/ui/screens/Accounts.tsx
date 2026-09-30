// Root screen of the «Счета» tab (spec §5): totals, the balance of every account now, the credit
// card's statements, a transfer between accounts and the «Счета и движения» export. Owner: D3.
// Savings accounts are outside «Всего» and the forecast: their own total, their own group of rows.
import { ACCOUNT_TYPE_LABEL, balances, opt, warnings } from '../../engine';
import type { BalanceRow, Data, Warnings } from '../../engine';
import { formatDate, formatMoney } from '../format';
import { Banner, Button, EmptyState, Money, Page, Row, Section, StatCard, StatGrid } from '../kit';
import { openTab, pushPage } from '../nav';
import { openSheet } from '../sheets/host';
import { appData, today } from '../state';
import { CreditStatementsRow, ExportButton, TYPE_ICON, creditCard, defaultMonth } from './accountsParts';
import { openFeed, openFeedCheck } from './Feed';
import './Accounts.css';

export function Accounts() {
  const d = appData();
  const day = today();
  const b = balances(d, day);
  const card = creditCard(d);
  const inBalance = b.rows.filter((r) => r.type !== 'savings');
  const savings = b.rows.filter((r) => r.type === 'savings');
  const startsOn = `Остатки на начало — на ${formatDate(d.settings.balancesDate)}.`;
  return (
    <Page title="Счета" right={<ExportButton ym={defaultMonth(d, day)} />}>
      <StatGrid columns={2}>
        <StatCard label="На картах" value={b.cards} />
        <StatCard label="Наличные" value={b.cash} />
        <StatCard label="Долг по кредитке" value={b.creditDebt} />
        <StatCard label="Всего" value={b.total} />
        <StatCard label="Сбережения" value={b.savings} sub="вне «Всего» и прогноза" />
      </StatGrid>

      <BalanceWarnings d={d} w={warnings(d)} />

      {d.accounts.length === 0 ? (
        <EmptyState
          title="Счетов пока нет"
          text="Добавьте карту, наличные или кредитку — здесь появятся их остатки."
          action={{ label: 'Добавить счёт', onClick: () => pushPage('accounts', 'accounts-settings') }}
        />
      ) : (
        <>
          {inBalance.length > 0 && (
            <Section header="Остатки" footer={savings.length === 0 ? startsOn : undefined}>
              {inBalance.map((r) => (
                <AccountRow key={r.id} r={r} />
              ))}
            </Section>
          )}
          {savings.length > 0 && (
            <Section header="Сбережения" footer={startsOn}>
              {savings.map((r) => (
                <AccountRow key={r.id} r={r} />
              ))}
            </Section>
          )}
        </>
      )}

      {card && (
        <Section header="Кредитка">
          <CreditStatementsRow tab="accounts" />
        </Section>
      )}

      {d.accounts.length >= 2 && (
        <div class="accounts-actions">
          <Button full onClick={() => openSheet('operation', { preset: { kind: 'transfer' } })}>
            Перевод между счетами
          </Button>
        </div>
      )}
    </Page>
  );
}

/** An account with its type and balance now; opens its page. */
function AccountRow({ r }: { r: BalanceRow }) {
  return (
    <Row
      icon={TYPE_ICON[r.type]}
      title={r.name}
      subtitle={ACCOUNT_TYPE_LABEL[r.type]}
      value={<Money value={r.now} />}
      chevron
      onClick={() => pushPage('accounts', 'account', { id: r.id })}
    />
  );
}

/** How many of the credit settings (the card, the account to pay from) name an account that no longer exists. */
function deletedInCreditSettings(d: Data): number {
  const known = new Set(d.accounts.map((a) => a.id));
  return [d.credit.accountId, d.credit.fromAccountId].filter((id) => {
    const given = opt(id);
    return given !== undefined && !known.has(given);
  }).length;
}

/** Rows that reach no balance, with what to do about them. */
function BalanceWarnings({ d, w }: { d: Data; w: Warnings }) {
  const toFeed = { label: 'Открыть ленту', onClick: () => openFeed() };
  const inSettings = deletedInCreditSettings(d);
  const inRecords = w.unknownAccounts - inSettings; // the engine counts both
  return (
    <>
      {w.unassigned.count > 0 && (
        <Banner tone="warning" action={{ label: 'Открыть ленту', onClick: () => openFeedCheck('unassigned') }}>
          {`Оплачено без счёта: ${formatMoney(w.unassigned.sum)} (записей: ${w.unassigned.count}). `}
          Этих денег нет ни в одном остатке — укажите счёт.
        </Banner>
      )}
      {w.transfersWithoutTarget > 0 && (
        <Banner tone="warning" action={toFeed}>
          {`Переводов без счёта зачисления: ${w.transfersWithoutTarget}. `}
          Деньги ушли со счёта, но никуда не пришли — укажите, на какой счёт.
        </Banner>
      )}
      {inRecords > 0 && (
        <Banner tone="warning" action={toFeed}>
          {`Ссылок на удалённый счёт: ${inRecords}. `}
          Такие записи не попадают в остатки — выберите другой счёт.
        </Banner>
      )}
      {inSettings > 0 && (
        <Banner tone="warning" action={{ label: 'Открыть настройки', onClick: () => pushPage('accounts', 'accounts-settings') }}>
          В настройках кредитки указан удалённый счёт. Выписки и автопогашение считаются неверно — выберите другой счёт.
        </Banner>
      )}
      {w.recurringMarkedWithoutDay > 0 && (
        <Banner tone="warning" action={{ label: 'Открыть постоянные', onClick: () => openTab('more', 'recurring') }}>
          {`Постоянных платежей с отметками, но без дня: ${w.recurringMarkedWithoutDay}. `}
          Без даты они не попадают в остатки — укажите день.
        </Banner>
      )}
    </>
  );
}
