// Page «Постоянные платежи» (registered as 'recurring' in src/ui/pages.ts); owner D5.
// Expenses, incomes and transfers apart, each with its rhythm, day, period, account («Со счёта → На счёт» for a
// transfer) and amount; on top the average per month as in the tracker (amount / «раз в N мес.»; transfers are in
// neither). A row opens RecurringForm, where the months are marked.
import { monthlyAverage, opt } from '../../engine';
import type { Data, ISODate, Recurring } from '../../engine';
import { formatDate } from '../format';
import { EmptyState, Icon, Money, Page, Row, Section, StatCard, StatGrid } from '../kit';
import type { RoutedPageProps } from '../nav';
import { openSheet } from '../sheets/host';
import { dotted } from '../sheets/planForm';
import { accountName, appData, today } from '../state';

/** «каждый месяц» / «раз в 3 мес.»; a missing or 0 rhythm is every month (as in the tracker). */
export function everyLabel(every: number | undefined): string {
  const n = Math.max(1, every ?? 1);
  return n === 1 ? 'каждый месяц' : `раз в ${n} мес.`;
}

/** «каждый месяц, 5-го · с 01.10.2026 · Карта» (a no-break space keeps «с» with its date). */
function describe(d: Data, r: Recurring): string {
  const parts = [`${everyLabel(r.every)}, ${r.day ? `${r.day}-го` : 'день не указан'}`];
  const from = opt(r.from);
  const to = opt(r.to);
  if (from !== undefined && to !== undefined) parts.push(`с\u00a0${formatDate(from)} по\u00a0${formatDate(to)}`);
  else if (from !== undefined) parts.push(`с\u00a0${formatDate(from)}`);
  else if (to !== undefined) parts.push(`по\u00a0${formatDate(to)}`);
  if (r.kind === 'transfer') {
    parts.push(`${accountName(d, opt(r.account)) || 'счёт не указан'} → ${accountName(d, opt(r.toAccount)) || 'не указан'}`);
    return dotted(parts);
  }
  const account = accountName(d, opt(r.account));
  if (account) parts.push(account);
  return dotted(parts);
}

function RecurringRow({ d, r, now }: { d: Data; r: Recurring; now: ISODate }) {
  const to = opt(r.to);
  const ended = to !== undefined && to < now;
  return (
    <Row
      title={r.what}
      subtitle={describe(d, r)}
      value={<Money value={r.amount} tone="plain" />}
      valueTone={ended || r.kind === 'transfer' ? 'muted' : r.kind === 'income' ? 'green' : 'default'}
      onClick={() => openSheet('recurring', { initial: r })}
    />
  );
}

export function RecurringPage(_props: RoutedPageProps) {
  const d = appData();
  const now = today();
  const expenses = d.recurring.filter((r) => r.kind === 'expense');
  const incomes = d.recurring.filter((r) => r.kind === 'income');
  const transfers = d.recurring.filter((r) => r.kind === 'transfer');
  const add = () => openSheet('recurring');
  const hint = 'Коснитесь платежа, чтобы изменить его или отметить месяцы.';

  return (
    <Page
      title="Постоянные платежи"
      right={
        <button type="button" class="icon-button" aria-label="Новый постоянный платёж" onClick={add}>
          <Icon name="plus" />
        </button>
      }
    >
      {d.recurring.length === 0 ? (
        <EmptyState
          title="Постоянных платежей пока нет"
          text="Аренда, связь, подписки, зарплата: вносятся один раз, дальше — отметки по месяцам."
          action={{ label: 'Добавить платёж', onClick: add }}
        />
      ) : (
        <>
          <StatGrid columns={2}>
            <StatCard label="Расходы в месяц" value={monthlyAverage(d.recurring, 'expense')} sub="в среднем" />
            <StatCard label="Доходы в месяц" value={monthlyAverage(d.recurring, 'income')} sub="в среднем" tone="pos" />
          </StatGrid>
          {expenses.length > 0 && (
            <Section header="Расходы" footer={incomes.length === 0 && transfers.length === 0 ? hint : undefined}>
              {expenses.map((r) => (
                <RecurringRow key={r.id} d={d} r={r} now={now} />
              ))}
            </Section>
          )}
          {incomes.length > 0 && (
            <Section header="Доходы" footer={transfers.length === 0 ? hint : undefined}>
              {incomes.map((r) => (
                <RecurringRow key={r.id} d={d} r={r} now={now} />
              ))}
            </Section>
          )}
          {transfers.length > 0 && (
            <Section header="Переводы" footer={`Не доходы и не расходы: деньги переходят между вашими счетами. ${hint}`}>
              {transfers.map((r) => (
                <RecurringRow key={r.id} d={d} r={r} now={now} />
              ))}
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
