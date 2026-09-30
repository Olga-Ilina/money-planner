// Page «Кредитка» (registered as 'credit'; owner D3): the card's settings, its debt now and next
// auto-payment, and the 12 statements of the accounting year (spec §4 «Кредитка», §5 «Счета»).
import { useContext, useState } from 'preact/hooks';
import { balances, clampDay, creditCardId, creditStatements, nextCreditDebit, payFromId, ymOf } from '../../engine';
import type { CreditStatement, ISODate } from '../../engine';
import { formatDate, formatDay, formatMoney, isNegativeMoney } from '../format';
import { Banner, Button, EmptyState, Money, Page, Row, Section, Sheet, StatCard, StatGrid } from '../kit';
import { PageContext, pushPage } from '../nav';
import type { RoutedPageProps } from '../nav';
import { FUTURE_NOTE, autoPays, balanceOnToday, creditCard, nothingToDebitText } from '../screens/accountsParts';
import { accountName, appData, today } from '../state';
import './CreditPage.css';

const TITLE = 'Кредитка';

export function CreditPage(_props: RoutedPageProps) {
  const tab = useContext(PageContext)?.tab ?? 'accounts';
  const [shown, setShown] = useState<CreditStatement | null>(null);
  const d = appData();
  const day = today();
  const card = creditCard(d);
  const toSettings = () => pushPage(tab, 'accounts-settings');

  if (!card) {
    // the setting names an account that is gone, or there is no credit account at all
    const deleted = creditCardId(d) !== undefined;
    return (
      <Page title={TITLE}>
        {deleted ? (
          <EmptyState
            title="Карта в настройках удалена — выберите карту"
            text="Пока карта не выбрана, выписок и списаний нет."
            action={{ label: 'Выбрать карту', onClick: toSettings }}
          />
        ) : (
          <EmptyState
            title="Кредитной карты нет"
            text="Добавьте счёт с типом «Кредитная» — здесь появятся его выписки и списания."
            action={{ label: 'Счета и кредитка', onClick: toSettings }}
          />
        )}
      </Page>
    );
  }

  const auto = autoPays(d);
  const payFrom = payFromId(d);
  const next = nextCreditDebit(d, day);
  const debt = balances(d, day).rows.find((r) => r.id === card.id)?.debt ?? 0;
  const onToday = balanceOnToday(d, card.id, day);
  const closeDay = clampDay(d.credit.closeDay);
  const payDay = clampDay(d.credit.payDay);
  const statements = creditStatements(d, day);
  // the engine's rule for every statement: the payment follows the statement, in the next month when its day is not later
  const first = statements[0];
  const paysNextMonth = first !== undefined && ymOf(first.payDate) !== ymOf(first.close);

  return (
    <Page title={TITLE}>
      <StatGrid columns={2}>
        <StatCard label="Долг сейчас" value={debt} sub={onToday === undefined ? undefined : FUTURE_NOTE} />
        {onToday !== undefined && <StatCard label="Долг на сегодня" value={Math.min(0, onToday)} />}
        {auto && (
          <StatCard
            label="Ближайшее списание"
            value={next?.amount ?? 0}
            sub={nextDebitSub(next, accountName(d, payFrom))}
          />
        )}
      </StatGrid>

      {d.credit.auto && payFrom === undefined && (
        <Banner tone="warning">Автопогашение не работает: нет счёта, с которого списывать.</Banner>
      )}

      <Section header="Настройки">
        <Row title="Карта" value={card.name} />
        <Row title="Выписка" value={`${closeDay}-го числа`} />
        <Row title="Списание" value={`${payDay}-го числа${paysNextMonth ? ' следующего месяца' : ''}`} />
        <Row title="Автопогашение" value={d.credit.auto ? 'Включено' : 'Выключено'} />
        {d.credit.auto && <Row title="Со счёта" value={payFrom === undefined ? 'Нет счёта' : accountName(d, payFrom)} />}
        <Row icon="sliders" title="Изменить настройки" chevron onClick={toSettings} />
      </Section>

      <Section header="Выписки">
        {statements.map((st) => {
          const current = st.from <= day && day <= st.close;
          return (
            <Row
              key={st.close}
              title={
                <>
                  <span class="credit-page-close">{formatDay(st.close, { year: true })}</span>
                  {current && (
                    <>
                      {' '}
                      <span class="credit-page-badge">Текущая</span>
                    </>
                  )}
                </>
              }
              subtitle={statementNote(st, auto, day)}
              value={<Money value={st.debt} />}
              chevron
              onClick={() => setShown(st)}
            />
          );
        })}
      </Section>

      <StatementSheet st={shown} auto={auto} day={day} onClose={() => setShown(null)} />
    </Page>
  );
}

/** The line under «Ближайшее списание»: when and from which account, or that there is nothing to take. */
function nextDebitSub(next: { date: ISODate; amount: number } | null, from: string): string {
  if (!next) return 'до конца учётного года нет';
  return next.amount > 0 ? `${formatDay(next.date)} со счёта ${from}` : nothingToDebitText(next.date);
}

/** What happens to the statement's debt: debited (or to be), to be paid by hand, or nothing. */
function statementNote(st: CreditStatement, auto: boolean, day: ISODate): string {
  if (auto) {
    if (st.payAmount <= 0) return 'Без списания';
    return `${st.payDate <= day ? 'Списано' : 'Спишется'} ${formatDay(st.payDate)}: ${formatMoney(st.payAmount)}`;
  }
  return isNegativeMoney(st.debt) ? `Оплатить до ${formatDay(st.payDate)}` : 'Без списания';
}

/** How one statement's debt is made up (the columns of the tracker's statements). */
function StatementSheet({ st, auto, day, onClose }: { st: CreditStatement | null; auto: boolean; day: ISODate; onClose: () => void }) {
  return (
    <Sheet
      open={st !== null}
      title={st ? `Выписка ${formatDate(st.close)}` : ''}
      onClose={onClose}
      right={<Button kind="plain" onClick={onClose}>Готово</Button>}
    >
      {st && (
        <Section footer="Долг по выписке = долг с прошлой + погашено + покупки + возвраты и переводы.">
          <Row
            title="Период"
            value={st.from <= st.close ? `${formatDate(st.from)} – ${formatDate(st.close)}` : 'До даты остатков'}
          />
          <Row title="Долг с прошлой" value={<Money value={st.carried} />} />
          <Row title="Погашено" value={<Money value={st.repaid} />} />
          <Row title="Покупки" value={<Money value={st.purchases} />} />
          <Row title="Возвраты и переводы" value={<Money value={st.other} />} />
          <Row title="Долг по выписке" value={<Money value={st.debt} />} />
          {auto ? (
            <Row
              title={`${st.payDate <= day ? 'Списано' : 'Спишется'} ${formatDay(st.payDate)}`}
              value={<Money value={st.payAmount} />}
            />
          ) : (
            <Row title="Оплатить до" value={formatDay(st.payDate, { year: true })} />
          )}
        </Section>
      )}
    </Sheet>
  );
}
