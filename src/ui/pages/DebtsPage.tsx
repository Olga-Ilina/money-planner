// Page «Долги» (registered as 'debts' in src/ui/pages.ts); owner D5.
// Each debt: what is left, paid of the total (bar), status, rate and the next payment, as on the
// tracker's «Долги» sheet (the rules: debtLeft / debtStatus of the engine); on top the totals. A row
// opens DebtForm.
import { addDays, debtLeft, debtStatus, isDebtOpen, opt } from '../../engine';
import type { Debt, ISODate } from '../../engine';
import { formatDate, formatMoney } from '../format';
import { EmptyState, Icon, Money, Page, ProgressBar, Row, Section, StatCard, StatGrid } from '../kit';
import type { RoutedPageProps } from '../nav';
import { openSheet } from '../sheets/host';
import { DOT, dotted } from '../sheets/planForm';
import { appData, today } from '../state';
import './DebtsPage.css';

/** A rate stored as a fraction (0.049), shown in percent: «4,9 %». */
export function ratePercent(rate: number): string {
  return `${String(Number((rate * 100).toPrecision(12))).replace('.', ',')} %`;
}

function nextLine(x: Debt): string | undefined {
  const next = opt(x.nextDate);
  // no-break spaces keep «следующий» with its date
  if (x.payment !== undefined && next !== undefined) return `Платёж ${formatMoney(x.payment)}${DOT}следующий\u00a0${formatDate(next)}`;
  if (x.payment !== undefined) return `Платёж ${formatMoney(x.payment)} в месяц`;
  if (next !== undefined) return `Следующий платёж\u00a0${formatDate(next)}`;
  return undefined;
}

function DebtRow({ x, now }: { x: Debt; now: ISODate }) {
  const left = debtLeft(x);
  const status = debtStatus(x);
  const total = x.total ?? 0;
  const paid = x.paid ?? 0;
  const next = opt(x.nextDate);
  // the tracker highlights a payment date before today + 3 of a debt with something left
  const soon = next !== undefined && left !== undefined && left > 0 && next < addDays(now, 3);
  const subtitle = dotted([opt(x.whom), x.rate !== undefined ? `ставка ${ratePercent(x.rate)}` : undefined]);
  const line = status !== 'Закрыт' ? nextLine(x) : undefined;
  return (
    <Row
      title={x.name}
      subtitle={subtitle || undefined}
      value={left !== undefined ? <Money value={left} /> : undefined}
      valueTone={status === 'Закрыт' ? 'muted' : 'default'}
      onClick={() => openSheet('debt', { initial: x })}
      bar={total > 0 ? <ProgressBar value={Math.min(paid, total)} max={total} tone="green" label="Выплачено из суммы долга" /> : undefined}
    >
      <span class="debts-line">
        Выплачено {formatMoney(paid)}
        {x.total !== undefined && <> из {formatMoney(x.total)}</>}
        {status && (
          <>
            {DOT}
            <span class={`debts-status${status === 'Закрыт' ? ' tone-green' : ''}`}>{status}</span>
          </>
        )}
      </span>
      {line && (
        <>
          <span class="sr-only">, </span>
          <span class={`debts-line${soon ? ' tone-orange' : ''}`}>{line}</span>
        </>
      )}
    </Row>
  );
}

export function DebtsPage(_props: RoutedPageProps) {
  const d = appData();
  const now = today();
  const add = () => openSheet('debt');
  const left = d.debts.reduce((s, x) => s + (debtLeft(x) ?? 0), 0);
  const paid = d.debts.reduce((s, x) => s + (x.paid ?? 0), 0);
  const payments = d.debts.reduce((s, x) => s + (isDebtOpen(x) ? (x.payment ?? 0) : 0), 0);

  return (
    <Page
      title="Долги"
      right={
        <button type="button" class="icon-button" aria-label="Новый долг" onClick={add}>
          <Icon name="plus" />
        </button>
      }
    >
      {d.debts.length === 0 ? (
        <EmptyState
          title="Долгов пока нет"
          text="Кредиты, рассрочки и личные долги — с прогрессом погашения и датой следующего платежа."
          action={{ label: 'Добавить долг', onClick: add }}
        />
      ) : (
        <>
          <StatGrid>
            <StatCard label="Осталось" value={left} />
            <StatCard label="Выплачено" value={paid} />
            <StatCard label="Платежи в месяц" value={payments} />
          </StatGrid>
          <Section footer="Внесли платёж — откройте долг и обновите «Выплачено» и дату следующего платежа.">
            {d.debts.map((x) => (
              <DebtRow key={x.id} x={x} now={now} />
            ))}
          </Section>
        </>
      )}
    </Page>
  );
}
